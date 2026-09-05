"use strict";

const assert=require("node:assert/strict");
const {mkdirSync}=require("node:fs");
const {resolve,join}=require("node:path");
const {chromium}=require("playwright");

const BASE_URL=(process.env.STRATA_QA_BASE_URL||"http://127.0.0.1:4173").replace(/\/+$/,""),BASE_ORIGIN=new URL(BASE_URL).origin;
const ARTIFACT_DIR=process.env.STRATA_QA_ARTIFACT_DIR?resolve(process.env.STRATA_QA_ARTIFACT_DIR):null;
const launchOptions={headless:true};
if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)launchOptions.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);

function isFirstParty(url){try{return new URL(url).origin===BASE_ORIGIN;}catch{return true;}}
function isExpectedGuestAuthConsole(message,pageUrl){
  try{return /Failed to load resource:.*401 \(Unauthorized\)/i.test(message)&&["/","/account.html"].includes(new URL(pageUrl).pathname);}
  catch{return false;}
}
function positive(value,label){assert.ok(value>0,`${label}: expected a positive count, received ${value}`);}

async function chooseOption(control,{values=[],labelPattern}={}){
  await control.waitFor({state:"visible"});
  const options=await control.locator("option").evaluateAll((nodes)=>nodes.map((node)=>({value:node.value,label:(node.textContent||"").trim(),disabled:node.disabled})).filter((option)=>!option.disabled&&option.value));
  const chosen=options.find((option)=>values.includes(option.value))||options.find((option)=>labelPattern?.test(option.label))||options[0];
  assert.ok(chosen,`${await control.getAttribute("id")||"Select"} must offer an enabled choice`);
  await control.selectOption(chosen.value);
  return chosen;
}

async function accessibleName(control){
  return control.evaluate((node)=>{
    const direct=node.getAttribute("aria-label")||"";
    const labelledBy=(node.getAttribute("aria-labelledby")||"").split(/\s+/).filter(Boolean).map((id)=>document.getElementById(id)?.textContent||"").join(" ");
    const labels=Array.from(node.labels||[]).map((label)=>label.textContent||"").join(" ");
    return `${direct} ${labelledBy} ${labels} ${node.textContent||""}`.replace(/\s+/g," ").trim();
  });
}

async function horizontalOverflow(page){
  return page.evaluate(()=>Math.max(0,document.documentElement.scrollWidth-document.documentElement.clientWidth));
}

async function savedPlanCount(page){
  return page.evaluate(async()=>{
    const response=await fetch("/api/plan",{credentials:"same-origin",headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error(`Plan read failed with HTTP ${response.status}`);
    const data=await response.json(),days=data.plan?.days||{};
    return Object.values(days).reduce((total,items)=>total+(Array.isArray(items)?items.length:0),0);
  });
}

async function capture(page,name,options={}){
  if(!ARTIFACT_DIR)return;
  mkdirSync(ARTIFACT_DIR,{recursive:true});
  await page.screenshot({path:join(ARTIFACT_DIR,name),...options});
}

let browser;
(async()=>{
  try{
    browser=await chromium.launch(launchOptions);
    const page=await browser.newPage({viewport:{width:1440,height:1000}}),errors=[];
    page.on("console",message=>{const location=message.location(),text=message.text();if(message.type()==="error"&&(!location.url||isFirstParty(location.url))&&!isExpectedGuestAuthConsole(text,page.url()))errors.push(`console at ${new URL(page.url()).pathname}: ${text}`);});
    page.on("pageerror",error=>errors.push(`page: ${error.stack||error.message}`));
    page.on("requestfailed",request=>{if(isFirstParty(request.url()))errors.push(`request: ${request.url()} ${request.failure()?.errorText||"failed"}`);});

    await page.goto(`${BASE_URL}/`,{waitUntil:"networkidle"});
    const publicHeaderLinks={
      pricing:await page.locator('.desktop-nav a[href="/pricing"]').isVisible(),
      contact:await page.locator('.desktop-nav a[href="/contact"]').isVisible()
    };
    assert.deepEqual(publicHeaderLinks,{pricing:true,contact:true},"Homepage must expose Pricing and Contact in the desktop header");
    assert.match((await page.locator(".discovery-offer").textContent())||"",/\$5\.99 USD[\s\S]*one-time purchase/i);
    await Promise.all([page.waitForURL(url=>url.pathname.endsWith("/account.html")),page.click("#signupButton")]);
    await page.fill('#signupPanel input[name="name"]',"UI Audit");
    await page.fill('#signupPanel input[name="email"]',`audit-${Date.now()}-${process.pid}@example.test`);
    await page.fill('#signupPanel input[name="password"]',"audit-password-123");
    await Promise.all([page.waitForURL(url=>url.pathname.endsWith("/planner.html")),page.click('#signupPanel button[type="submit"]')]);
    const snapshot={signupDestination:page.url(),title:await page.title()};
    assert.equal(new URL(snapshot.signupDestination).pathname,"/planner.html","A new unpaid account should land on the free planner");
    assert.match(snapshot.title,/STRATA/i);

    await page.goto(`${BASE_URL}/planner.html`,{waitUntil:"networkidle"});
    await page.locator(".library-card").first().waitFor();
    snapshot.plannerCards=await page.locator(".library-card").count();
    positive(snapshot.plannerCards,"Planner library cards");
    if(await page.locator("[data-load-more-library]").count()){
      await page.locator("[data-load-more-library]").click();
      snapshot.plannerCardsAfterLoadMore=await page.locator(".library-card").count();
      assert.ok(snapshot.plannerCardsAfterLoadMore>snapshot.plannerCards,"Planner load-more must reveal additional cards");
    }
    const [planResponse]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plan"&&response.request().method()==="PUT"),
      page.locator('[data-quick-add="flat-dumbbell-press"]').click()
    ]);
    assert.ok(planResponse.ok(),`Planner save failed with HTTP ${planResponse.status()}`);
    snapshot.scheduled=await page.locator(".scheduled-card").count();
    positive(snapshot.scheduled,"Scheduled planner cards");

    await page.goto(`${BASE_URL}/pricing`,{waitUntil:"networkidle"});
    await page.locator("#purchaseStatus").waitFor();
    snapshot.checkoutStatus=((await page.locator("#purchaseStatus").textContent())||"").trim();
    snapshot.buyVisible=await page.locator("#buyDiscovery").isVisible();
    snapshot.buyDisabled=await page.locator("#buyDiscovery").isDisabled();
    assert.equal(snapshot.buyVisible,true,"A signed-in unpaid account should see the Strata+ purchase control");
    assert.equal(snapshot.buyDisabled,true,"Checkout must stay disabled when Paddle configuration is off");
    assert.match(snapshot.checkoutStatus,/eligible for one free|temporarily unavailable|not configured correctly/i,"Pricing must explain either the available no-card trial or the disabled checkout state");
    await capture(page,"pricing-locked-desktop.png",{fullPage:true});

    await page.goto(`${BASE_URL}/discover.html`,{waitUntil:"networkidle"});
    const lockedUrl=new URL(page.url());
    snapshot.lockedDiscoveryUrl=page.url();
    assert.equal(lockedUrl.pathname,"/pricing");
    assert.equal(lockedUrl.searchParams.get("reason"),"discovery-required");

    await page.setViewportSize({width:390,height:844});
    await page.goto(`${BASE_URL}/`,{waitUntil:"networkidle"});
    assert.equal(await page.locator('.mobile-public-nav a[href="/pricing"]').isVisible(),true,"Mobile homepage must expose Pricing");
    assert.equal(await page.locator('.mobile-public-nav a[href="/contact"]').isVisible(),true,"Mobile homepage must expose Contact");
    assert.equal(await page.locator('.mobile-public-nav a[href="#founder"]').isVisible(),true,"Mobile homepage must expose the founder section");
    assert.equal(await page.locator('.footer-links a[href="/refunds"]').isVisible(),true,"Mobile homepage policies must remain visible");
    const smallPublicTargets=await page.locator(".mobile-public-nav a").evaluateAll((nodes)=>nodes.filter((node)=>{const rect=node.getBoundingClientRect();return rect.width<44||rect.height<44;}).map((node)=>node.textContent.trim()));
    assert.deepEqual(smallPublicTargets,[],`Homepage public links below 44px: ${smallPublicTargets.join(", ")}`);
    assert.equal(await page.locator("#founder").isVisible(),true,"Founder section must render on mobile");
    await page.locator("#founder").scrollIntoViewIfNeeded();
    await capture(page,"founder-mobile.png",{fullPage:false});
    await page.goto(`${BASE_URL}/discover.html`,{waitUntil:"networkidle"});
    assert.equal(new URL(page.url()).pathname,"/pricing","Unpaid mobile users must remain behind the Strata+ paywall");
    snapshot.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(snapshot.mobileOverflow<=1,`Mobile layout overflows horizontally by ${snapshot.mobileOverflow}px`);
    await capture(page,"pricing-locked-mobile.png",{fullPage:true});

    await page.setViewportSize({width:1440,height:1000});
    await page.goto(`${BASE_URL}/pricing`,{waitUntil:"networkidle"});
    const trialButton=page.locator("#trialDiscovery");
    await trialButton.waitFor({state:"visible"});
    assert.equal(await trialButton.isDisabled(),false,"An eligible account must be able to start its one-time trial without Paddle checkout");
    const [trialResponse]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==="/api/discovery/trial"&&response.request().method()==="POST"),
      trialButton.click()
    ]);
    assert.ok(trialResponse.ok(),`Trial activation failed with HTTP ${trialResponse.status()}`);
    assert.ok([200,201].includes(trialResponse.status()),`Trial activation returned unexpected HTTP ${trialResponse.status()}`);
    await page.locator("#openDiscovery").waitFor({state:"visible"});
    snapshot.trialStatus=((await page.locator("#purchaseStatus").textContent())||"").trim();
    assert.match(snapshot.trialStatus,/trial is active/i,"Pricing must confirm active trial access");
    await Promise.all([
      page.waitForURL(url=>url.pathname.endsWith("/discover.html")),
      page.locator("#openDiscovery").click()
    ]);
    await page.waitForLoadState("networkidle");

    const sessionBuilder=page.locator("#sessionBuilder"),sessionGroup=page.locator("#sessionGroup"),sessionLength=page.locator("#sessionLength"),sessionDay=page.locator("#sessionDay"),sessionGenerate=page.locator("#sessionGenerate"),sessionResults=page.locator("#sessionResults"),sessionStatus=page.locator("#sessionStatus"),sessionAddAll=page.locator("#sessionAddAll");
    const sessionFeature=page.locator('[data-feature-target="session"]').first();
    await sessionFeature.waitFor({state:"visible"});
    await sessionFeature.focus();
    await page.keyboard.press("Enter");
    await sessionBuilder.waitFor({state:"visible"});
    assert.equal(new URL(page.url()).hash,"#sessionBuilder","Session Builder navigation must preserve a shareable workspace URL");
    for(const control of [sessionGroup,sessionLength,sessionDay,sessionGenerate]){
      await control.waitFor({state:"visible"});
      positive((await accessibleName(control)).length,`${await control.getAttribute("id")} accessible name`);
    }
    const builderLabel=await sessionBuilder.getAttribute("aria-label"),builderLabelledBy=await sessionBuilder.getAttribute("aria-labelledby");
    assert.ok(builderLabel||builderLabelledBy,"Session Builder must expose an accessible section name");
    assert.ok(["status","alert"].includes((await sessionStatus.getAttribute("role"))||""),"Session Builder status must be announced");
    assert.ok(["polite","assertive"].includes((await sessionStatus.getAttribute("aria-live"))||""),"Session Builder status must use an aria-live region");

    snapshot.sessionChoices={
      group:await chooseOption(sessionGroup,{values:["full"],labelPattern:/full body/i}),
      length:await chooseOption(sessionLength,{values:["20"],labelPattern:/20/i}),
      day:await chooseOption(sessionDay,{values:["Tuesday"],labelPattern:/Tuesday/i})
    };
    const planCountBeforeSession=await savedPlanCount(page);
    await sessionGenerate.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    assert.equal(await sessionGenerate.evaluate((node)=>node===document.activeElement),true,"Session generation must remain keyboard reachable");
    const focusTreatment=await sessionGenerate.evaluate((node)=>{const style=getComputedStyle(node);return {outlineStyle:style.outlineStyle,outlineWidth:parseFloat(style.outlineWidth)||0,boxShadow:style.boxShadow};});
    assert.ok((focusTreatment.outlineStyle!=="none"&&focusTreatment.outlineWidth>=2)||focusTreatment.boxShadow!=="none","Session generation needs a visible keyboard focus treatment");
    await page.keyboard.press("Enter");
    await sessionResults.waitFor({state:"visible"});
    await sessionAddAll.waitFor({state:"visible"});
    snapshot.sessionGeneratedText=((await sessionResults.textContent())||"").replace(/\s+/g," ").trim();
    positive(snapshot.sessionGeneratedText.length,"Generated session content");
    assert.match(((await sessionStatus.textContent())||""),/ready|generated|exercise|session/i,"Session Builder must announce successful generation");
    snapshot.sessionDesktopOverflow=await horizontalOverflow(page);
    assert.ok(snapshot.sessionDesktopOverflow<=1,`Generated Session Builder overflows desktop by ${snapshot.sessionDesktopOverflow}px`);
    await sessionBuilder.scrollIntoViewIfNeeded();
    await capture(page,"session-builder-desktop.png",{fullPage:false});

    await page.setViewportSize({width:390,height:844});
    await sessionBuilder.scrollIntoViewIfNeeded();
    snapshot.sessionMobileOverflow=await horizontalOverflow(page);
    assert.ok(snapshot.sessionMobileOverflow<=1,`Generated Session Builder overflows mobile by ${snapshot.sessionMobileOverflow}px`);
    await capture(page,"session-builder-mobile.png",{fullPage:false});

    await page.setViewportSize({width:320,height:700});
    await sessionBuilder.scrollIntoViewIfNeeded();
    snapshot.sessionNarrowOverflow=await horizontalOverflow(page);
    assert.ok(snapshot.sessionNarrowOverflow<=1,`Generated Session Builder overflows a 320px viewport by ${snapshot.sessionNarrowOverflow}px`);
    const smallSessionTargets=await sessionBuilder.locator("a,button,select").evaluateAll((nodes)=>nodes.filter((node)=>{const rect=node.getBoundingClientRect(),style=getComputedStyle(node);return style.display!=="none"&&style.visibility!=="hidden"&&!node.hidden&&(rect.width<44||rect.height<44);}).map((node)=>node.id||(node.textContent||"").trim()));
    assert.deepEqual(smallSessionTargets,[],`Session Builder controls below 44px: ${smallSessionTargets.join(", ")}`);
    await capture(page,"session-builder-mobile-320.png",{fullPage:false});

    await page.setViewportSize({width:1440,height:1000});
    await sessionBuilder.scrollIntoViewIfNeeded();
    const generatedStatusBeforeSave=((await sessionStatus.textContent())||"").trim();
    const [addAllResponse]=await Promise.all([
      page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plan"&&response.request().method()==="PUT"),
      sessionAddAll.click()
    ]);
    assert.ok(addAllResponse.ok(),`Adding the generated session failed with HTTP ${addAllResponse.status()}`);
    const addAllPayload=addAllResponse.request().postDataJSON();
    assert.ok(addAllPayload?.plan?.days&&Number.isSafeInteger(addAllPayload.expectedPlanUpdatedAt),"Add-all must use the versioned saved-plan contract");
    await page.waitForFunction((before)=>{const text=(document.querySelector("#sessionStatus")?.textContent||"").trim();return Boolean(text)&&text!==before&&!/saving|adding/i.test(text);},generatedStatusBeforeSave);
    const planCountAfterSession=await savedPlanCount(page);
    assert.ok(planCountAfterSession>planCountBeforeSession,`Add-all must persist exercises (${planCountBeforeSession} before, ${planCountAfterSession} after)`);
    snapshot.sessionPlanCounts={before:planCountBeforeSession,after:planCountAfterSession};
    snapshot.sessionSavedStatus=((await sessionStatus.textContent())||"").replace(/\s+/g," ").trim();
    assert.match(snapshot.sessionSavedStatus,/added|saved|plan/i,"Session Builder must announce that the plan was updated");
    const sessionOpenPlan=page.locator("#sessionOpenPlan");
    if(await sessionOpenPlan.count()){
      await sessionOpenPlan.waitFor({state:"visible"});
      assert.equal(new URL(await sessionOpenPlan.getAttribute("href"),BASE_URL).pathname,"/planner.html","Session Builder plan link must open the planner");
      positive((await accessibleName(sessionOpenPlan)).length,"Session Builder plan-link accessible name");
      snapshot.sessionOpenPlan=true;
    }else snapshot.sessionOpenPlan=false;
    await capture(page,"session-builder-saved-desktop.png",{fullPage:false});

    await page.setViewportSize({width:320,height:700});
    snapshot.narrowOverflow={};
    for(const route of ["/","/account.html","/verify-email.html","/forgot-password","/reset-password","/delete-account","/planner.html","/discover.html","/pricing","/contact","/terms","/privacy","/refunds","/install.html"]){
      await page.goto(`${BASE_URL}${route}`,{waitUntil:"networkidle"});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      snapshot.narrowOverflow[route]=overflow;
      assert.ok(overflow<=1,`${route} overflows a 320px viewport by ${overflow}px`);
      if(route==="/pricing")await capture(page,"pricing-mobile-320.png",{fullPage:true});
      if(route==="/terms")await capture(page,"terms-mobile-320.png",{fullPage:true});
    }
    assert.equal(await page.locator(".device-card").count(),4,"Install guide should cover four device paths");
    assert.equal(await page.locator(".device-card.recommended").count(),1,"Install guide should identify the current device path");
    const smallInstallTargets=await page.locator(".install-header a,.install-actions a,.install-actions button").evaluateAll((nodes)=>nodes.filter((node)=>{
      const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
      return style.display!=="none"&&!node.hidden&&(rect.width<44||rect.height<44);
    }).map((node)=>node.textContent.trim()));
    assert.deepEqual(smallInstallTargets,[],`Install controls below 44px: ${smallInstallTargets.join(", ")}`);
    await capture(page,"install-mobile-320.png",{fullPage:true});

    snapshot.errors=errors;
    assert.deepEqual(errors,[],`Browser errors detected:\n${errors.join("\n")}`);
    process.stdout.write(`${JSON.stringify(snapshot,null,2)}\n`);
  }finally{
    await browser?.close();
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
