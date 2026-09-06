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

async function contrastRatio(locator){
  return locator.evaluate((node)=>{
    const rgba=(value)=>{
      const parts=String(value).match(/[\d.]+/g)?.map(Number)||[];
      return[parts[0]||0,parts[1]||0,parts[2]||0,parts.length>3?parts[3]:1];
    };
    const over=(top,bottom)=>{
      const alpha=top[3]+bottom[3]*(1-top[3]);
      return[0,1,2].map((index)=>(top[index]*top[3]+bottom[index]*bottom[3]*(1-top[3]))/alpha).concat(alpha);
    };
    const layers=[];
    for(let current=node;current;current=current.parentElement)layers.push(rgba(getComputedStyle(current).backgroundColor));
    let background=[255,255,255,1];
    for(let index=layers.length-1;index>=0;index-=1)background=over(layers[index],background);
    const foreground=over(rgba(getComputedStyle(node).color),background);
    const luminance=(color)=>{
      const channels=color.slice(0,3).map((part)=>{const value=part/255;return value<=.04045?value/12.92:((value+.055)/1.055)**2.4;});
      return .2126*channels[0]+.7152*channels[1]+.0722*channels[2];
    };
    const values=[luminance(foreground),luminance(background)].sort((left,right)=>right-left);
    return (values[0]+.05)/(values[1]+.05);
  });
}

async function savedPlanCount(page){
  return page.evaluate(async()=>{
    const response=await fetch("/api/plan",{credentials:"same-origin",headers:{Accept:"application/json"}});
    if(!response.ok)throw new Error(`Plan read failed with HTTP ${response.status}`);
    const data=await response.json(),days=data.plan?.days||{};
    return Object.values(days).reduce((total,items)=>total+(Array.isArray(items)?items.length:0),0);
  });
}

async function clearSavedPlan(page){
  return page.evaluate(async()=>{
    const [planResponse,discoveryResponse]=await Promise.all([fetch("/api/plan",{credentials:"same-origin",headers:{Accept:"application/json"}}),fetch("/api/discovery",{credentials:"same-origin",headers:{Accept:"application/json"}})]);
    if(!planResponse.ok||!discoveryResponse.ok)throw new Error(`Plan reset prerequisites failed with HTTP ${planResponse.status}/${discoveryResponse.status}`);
    const planData=await planResponse.json(),discovery=await discoveryResponse.json(),days=Object.fromEntries(Object.keys(planData.plan?.days||{}).map((day)=>[day,[]]));
    const response=await fetch("/api/plan",{method:"PUT",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json","X-CSRF-Token":discovery.csrfToken},body:JSON.stringify({plan:{...planData.plan,days},expectedPlanUpdatedAt:planData.planUpdatedAt})});
    if(!response.ok)throw new Error(`Plan reset failed with HTTP ${response.status}`);
    return response.json();
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
    const publicHeaderLinks=await page.locator(".desktop-nav a").evaluateAll((nodes)=>nodes.map((node)=>[node.getAttribute("href"),node.textContent.trim()]));
    assert.deepEqual(publicHeaderLinks,[["#rankings","Rankings"],["/discover.html","Strata+"],["/workout.html","Train"],["/pricing","Pricing"]],"Homepage desktop navigation must expose its four primary destinations");
    assert.match((await page.locator(".discovery-offer").textContent())||"",/\$5\.99 USD[\s\S]*never a subscription/i);
    for(const [label,control] of [["homepage primary action",page.locator(".hero .button-accent").first()]]){
      const ratio=await contrastRatio(control);assert.ok(ratio>=4.5,`${label} text contrast is ${ratio.toFixed(2)}:1; expected at least 4.5:1`);
    }
    const publicDetailTrigger=page.locator("[data-detail]").first(),publicDetailDialog=page.locator("#detailDialog");
    await publicDetailTrigger.waitFor({state:"visible"});await publicDetailTrigger.focus();await page.keyboard.press("Enter");await publicDetailDialog.waitFor({state:"visible"});
    assert.equal(await publicDetailDialog.getAttribute("aria-labelledby"),"detailTitle","Homepage exercise details need an explicit dialog label");
    assert.equal(await publicDetailDialog.evaluate((dialog)=>dialog.contains(document.activeElement)),true,"Opening homepage details must move keyboard focus into the dialog");
    await page.keyboard.press("Escape");await publicDetailDialog.waitFor({state:"hidden"});
    assert.equal(await publicDetailTrigger.evaluate((trigger)=>trigger===document.activeElement),true,"Closing homepage details must return focus to its trigger");
    await Promise.all([page.waitForURL(url=>url.pathname.endsWith("/account.html")),page.click("#signupButton")]);
    await page.fill('#signupPanel input[name="name"]',"UI Audit Member With A Long Display Name");
    await page.fill('#signupPanel input[name="email"]',`audit-${Date.now()}-${process.pid}@example.test`);
    await page.fill('#signupPanel input[name="password"]',"audit-password-123");
    await Promise.all([page.waitForURL(url=>url.pathname.endsWith("/planner.html")),page.click('#signupPanel button[type="submit"]')]);
    const snapshot={signupDestination:page.url(),title:await page.title(),publicDialogKeyboard:true};
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
    const mobilePublicLinks=await page.locator(".mobile-public-nav a").evaluateAll((nodes)=>nodes.map((node)=>[node.getAttribute("href"),node.textContent.trim()]));
    assert.deepEqual(mobilePublicLinks,[["#rankings","Rankings"],["/discover.html","Strata+"],["/planner.html","Plan"],["/workout.html","Train"]],"Mobile homepage navigation must keep the four primary product destinations");
    assert.equal(await page.locator('.footer-links a[href="/policies"]').count(),1,"Mobile homepage footer must expose one Policies destination");
    assert.equal(await page.locator('.footer-links a:is([href="/terms"],[href="/privacy"],[href="/refunds"])').count(),0,"Homepage footer must not duplicate policy-directory links");
    const smallPublicTargets=await page.locator(".mobile-public-nav a").evaluateAll((nodes)=>nodes.filter((node)=>{const rect=node.getBoundingClientRect();return rect.width<44||rect.height<44;}).map((node)=>node.textContent.trim()));
    assert.deepEqual(smallPublicTargets,[],`Homepage public links below 44px: ${smallPublicTargets.join(", ")}`);
    assert.equal(await page.locator("#founder").count(),0,"Founder biography must not clutter the homepage");
    await page.goto(`${BASE_URL}/policies#founder`,{waitUntil:"networkidle"});
    assert.equal(await page.locator("#founder").isVisible(),true,"Founder section must render on the public policies page");
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

    assert.equal(new URL(page.url()).hash,"","Opening Strata+ without a tool hash must keep a clean URL");
    assert.ok(await page.evaluate(()=>scrollY<=1),"Opening Strata+ without a tool hash must stay at the top of the page");
    assert.equal(((await page.locator("#recommendationTitle").textContent())||"").replace(/\s+/g," ").trim(),"BEST EXERCISES FOR YOU.","Recommendation heading must not depend on a member's display name");
    const recommendationContrast=await contrastRatio(page.locator("#recommendationTitle"));
    assert.ok(recommendationContrast>=4.5,`Recommendation title contrast is ${recommendationContrast.toFixed(2)}:1; expected at least 4.5:1`);
    const primaryWorkout=page.getByRole("link",{name:"Start working out",exact:true}),pulseAction=page.getByRole("link",{name:"Edit weekly plan",exact:true});
    await primaryWorkout.waitFor({state:"visible"});await pulseAction.waitFor({state:"visible"});
    const primaryWorkoutUrl=new URL(await primaryWorkout.getAttribute("href"),BASE_URL),pulseDay=await page.locator("#weeklyPulse").getAttribute("data-session-day");
    assert.equal(primaryWorkoutUrl.pathname,"/workout.html");assert.equal(primaryWorkoutUrl.searchParams.get("day"),pulseDay,"The workout CTA must link to the next scheduled day shown in the pulse");
    assert.equal(new URL(await pulseAction.getAttribute("href"),BASE_URL).pathname,"/planner.html","The pulse action must remain a planning action");
    const featureWidths=await page.locator(".feature-block").evaluateAll((nodes)=>nodes.map((node)=>node.getBoundingClientRect().width));
    assert.ok(Math.max(...featureWidths)-Math.min(...featureWidths)<=1,"All seven Strata+ tool cards must use equal widths");
    await capture(page,"strata-plus-home-desktop.png",{fullPage:false});

    await page.setViewportSize({width:390,height:844});
    await page.goto(`${BASE_URL}/discover.html`,{waitUntil:"networkidle"});
    await capture(page,"strata-plus-home-mobile.png",{fullPage:false});
    await page.locator("#recommendationTitle").evaluate((node)=>window.scrollTo(0,node.getBoundingClientRect().top+window.scrollY-document.querySelector(".studio-header").getBoundingClientRect().height-20));
    await page.waitForTimeout(550);
    assert.equal(await page.locator(".studio-header .brand").isVisible(),true,"The Strata+ brand must remain visible after scrolling to a tool");
    assert.equal(await page.locator(".studio-header .studio-account").isVisible(),true,"The Strata+ account action must remain visible after scrolling to a tool");
    await capture(page,"strata-plus-recommendations-mobile.png",{fullPage:false});
    await page.goto(`${BASE_URL}/discover.html#profile`,{waitUntil:"networkidle"});
    await page.locator("#profile").waitFor({state:"visible"});
    await page.waitForFunction(()=>document.querySelector("#profileStatus")?.textContent?.trim()==="Saved");
    await page.locator("#profileTitle").evaluate((node)=>window.scrollTo({top:node.getBoundingClientRect().top+window.scrollY-document.querySelector(".studio-header").getBoundingClientRect().height-20,behavior:"instant"}));
    await page.waitForTimeout(550);
    const profileHeaderLayout=await page.locator(".studio-header").evaluate((header)=>{
      const box=(node)=>{const rect=node.getBoundingClientRect();return{top:rect.top,right:rect.right,bottom:rect.bottom,left:rect.left,width:rect.width,height:rect.height};};
      const visibleChild=(selector)=>{const node=header.querySelector(selector),rect=node.getBoundingClientRect(),hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return{box:box(node),visible:getComputedStyle(node).visibility==="visible"&&Number(getComputedStyle(node).opacity)>0,uncovered:node===hit||node.contains(hit)};};
      return{header:box(header),brand:visibleChild(".brand"),account:visibleChild(".studio-account"),logout:visibleChild("#logoutButton")};
    });
    assert.ok(profileHeaderLayout.header.top>=-1&&profileHeaderLayout.header.bottom>=64,"The Strata+ mobile header must remain fully visible while using a tool");
    for(const [name,item] of Object.entries({brand:profileHeaderLayout.brand,account:profileHeaderLayout.account,logout:profileHeaderLayout.logout})){
      assert.ok(item.visible&&item.uncovered&&item.box.top>=0&&item.box.bottom<=profileHeaderLayout.header.bottom+1,`The Strata+ ${name} control must remain visible and unobscured in profile settings`);
    }
    const profileTitleContrast=await contrastRatio(page.locator("#profileTitle"));
    assert.ok(profileTitleContrast>=4.5,`Profile title contrast is ${profileTitleContrast.toFixed(2)}:1; expected at least 4.5:1 after its entrance animation`);
    await capture(page,"strata-plus-profile-mobile.png",{fullPage:false});

    await page.setViewportSize({width:700,height:900});
    const headerLayout=await page.locator(".studio-header").evaluate((header)=>{const nav=header.querySelector(".studio-nav-mobile"),brand=header.querySelector(".brand"),user=header.querySelector(".studio-user"),box=(node)=>{const rect=node.getBoundingClientRect();return{top:rect.top,right:rect.right,bottom:rect.bottom,left:rect.left,width:rect.width,height:rect.height};};return{header:box(header),nav:box(nav),brand:box(brand),user:box(user),navPosition:getComputedStyle(nav).position,viewport:innerWidth,viewportHeight:innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
    assert.equal(headerLayout.navPosition,"fixed","At 700px, Strata+ navigation must use the same bottom-bar layout as Plan and Train");
    assert.ok(Math.abs(headerLayout.nav.bottom-headerLayout.viewportHeight)<=1,"At 700px, Strata+ navigation must stay at the viewport bottom");
    assert.ok(headerLayout.nav.left>=0&&headerLayout.nav.right<=headerLayout.viewport+1&&headerLayout.overflow<=1,"At 700px, the header and navigation must remain inside the viewport");
    assert.ok(headerLayout.header.height<=80,`At 700px, the header is unexpectedly tall at ${headerLayout.header.height}px`);
    for(const [route,selector,label] of [["/planner.html",".planner-primary-nav-mobile","Planner"],["/workout.html?day=Monday",".workout-nav-mobile","Workout"]]){
      await page.goto(`${BASE_URL}${route}`,{waitUntil:"networkidle"});
      const layout=await page.locator(selector).evaluate((node)=>{const rect=node.getBoundingClientRect();return{bottom:rect.bottom,position:getComputedStyle(node).position,viewport:innerHeight,overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};});
      assert.equal(layout.position,"fixed",`${label} navigation must use the shared bottom bar at 700px`);
      assert.ok(Math.abs(layout.viewport-layout.bottom)<=1,`${label} navigation must stay at the viewport bottom at 700px`);
      assert.ok(layout.overflow<=1,`${label} must not overflow horizontally at 700px`);
    }
    await page.setViewportSize({width:1440,height:1000});

    await clearSavedPlan(page);await page.goto(`${BASE_URL}/discover.html`,{waitUntil:"networkidle"});
    const firstWeekAction=page.getByRole("link",{name:"Build my first week",exact:true});
    await firstWeekAction.waitFor({state:"visible"});assert.equal(new URL(await firstWeekAction.getAttribute("href"),BASE_URL).pathname,"/onboarding.html");
    assert.equal(await page.locator("#plusRoutineAction").count(),0,"The hero must not duplicate the weekly pulse's planning action");
    assert.equal(new URL(await page.getByRole("link",{name:"Edit weekly plan",exact:true}).getAttribute("href"),BASE_URL).pathname,"/planner.html");

    await page.goto(`${BASE_URL}/discover.html#profile`,{waitUntil:"networkidle"});
    assert.equal(new URL(page.url()).hash,"#profile","A direct Strata+ tool hash must be preserved");
    await page.locator("#profile").waitFor({state:"visible"});
    await page.goto(`${BASE_URL}/discover.html`,{waitUntil:"networkidle"});
    assert.equal(new URL(page.url()).hash,"","Returning to plain Strata+ must not inject a default hash");
    assert.ok(await page.evaluate(()=>scrollY<=1),"Returning to plain Strata+ must stay at the top");

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
    assert.equal(await sessionAddAll.isHidden(),true,"Session plan action must stay hidden until the member explicitly builds a session");
    assert.match(((await sessionResults.textContent())||""),/your session will appear here/i);
    snapshot.contrast={sessionStatus:await contrastRatio(sessionStatus),sessionAction:await contrastRatio(sessionGenerate)};
    assert.ok(snapshot.contrast.sessionStatus>=4.5,`Session status text contrast is ${snapshot.contrast.sessionStatus.toFixed(2)}:1; expected at least 4.5:1`);
    assert.ok(snapshot.contrast.sessionAction>=4.5,`Session action text contrast is ${snapshot.contrast.sessionAction.toFixed(2)}:1; expected at least 4.5:1`);

    snapshot.sessionChoices={
      group:await chooseOption(sessionGroup,{values:["full"],labelPattern:/full body/i}),
      length:await chooseOption(sessionLength,{values:["20"],labelPattern:/20/i}),
      day:await chooseOption(sessionDay,{values:["Tuesday"],labelPattern:/Tuesday/i})
    };
    assert.equal(await sessionAddAll.isHidden(),true,"Changing the session brief must not generate a hidden session automatically");
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
    const sessionDetailTrigger=sessionResults.locator("[data-open-detail]").first(),sessionDetailDialog=page.locator("#detailDialog");
    await sessionDetailTrigger.focus();await page.keyboard.press("Enter");await sessionDetailDialog.waitFor({state:"visible"});
    assert.equal(await sessionDetailDialog.getAttribute("aria-labelledby"),"detailTitle","Strata+ exercise details need an explicit dialog label");
    assert.equal(await sessionDetailDialog.evaluate((dialog)=>dialog.contains(document.activeElement)),true,"Opening Strata+ details must move keyboard focus into the dialog");
    await page.keyboard.press("Escape");await sessionDetailDialog.waitFor({state:"hidden"});
    assert.equal(await sessionDetailTrigger.evaluate((trigger)=>trigger===document.activeElement),true,"Closing Strata+ details must return focus to its trigger");
    snapshot.sessionDialogKeyboard=true;
    snapshot.sessionDesktopOverflow=await horizontalOverflow(page);
    assert.ok(snapshot.sessionDesktopOverflow<=1,`Generated Session Builder overflows desktop by ${snapshot.sessionDesktopOverflow}px`);
    await sessionBuilder.scrollIntoViewIfNeeded();
    await capture(page,"session-builder-desktop.png",{fullPage:false});

    await page.setViewportSize({width:390,height:844});
    await page.locator("#sessionResultsTitle").evaluate((node)=>window.scrollTo(0,node.getBoundingClientRect().top+window.scrollY-document.querySelector(".studio-header").getBoundingClientRect().height-20));
    snapshot.sessionMobileOverflow=await horizontalOverflow(page);
    assert.ok(snapshot.sessionMobileOverflow<=1,`Generated Session Builder overflows mobile by ${snapshot.sessionMobileOverflow}px`);
    const mobileResultsTitle=await page.locator("#sessionResultsTitle").boundingBox();
    assert.ok(mobileResultsTitle&&mobileResultsTitle.y>=60&&mobileResultsTitle.y<844,"Generated session results must enter the mobile viewport");
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

    await page.setViewportSize({width:390,height:844});
    await page.goto(`${BASE_URL}/planner.html`,{waitUntil:"networkidle"});
    const plannerMobileNav=await page.locator(".planner-primary-nav-mobile").evaluate((node)=>{const rect=node.getBoundingClientRect();return{top:rect.top,bottom:rect.bottom,viewport:innerHeight,position:getComputedStyle(node).position};});
    assert.equal(plannerMobileNav.position,"fixed");assert.ok(Math.abs(plannerMobileNav.viewport-plannerMobileNav.bottom)<=1,`Planner mobile navigation must stay at the viewport bottom, not ${plannerMobileNav.top}px from the top`);
    await capture(page,"planner-mobile.png",{fullPage:false});
    await page.goto(`${BASE_URL}/workout.html?day=${encodeURIComponent(snapshot.sessionChoices.day.value)}`,{waitUntil:"networkidle"});
    const workoutMobileNav=await page.locator(".workout-nav-mobile").evaluate((node)=>{const rect=node.getBoundingClientRect();return{bottom:rect.bottom,viewport:innerHeight,position:getComputedStyle(node).position};});
    assert.equal(workoutMobileNav.position,"fixed");assert.ok(Math.abs(workoutMobileNav.viewport-workoutMobileNav.bottom)<=1,"Workout mobile navigation must stay at the viewport bottom");
    await capture(page,"workout-mobile.png",{fullPage:false});

    await page.setViewportSize({width:320,height:700});
    snapshot.narrowOverflow={};
    for(const route of ["/","/account.html","/verify-email.html","/forgot-password","/reset-password","/delete-account","/planner.html","/discover.html","/pricing","/contact","/policies","/terms","/privacy","/refunds","/install.html"]){
      await page.goto(`${BASE_URL}${route}`,{waitUntil:"networkidle"});
      const overflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
      snapshot.narrowOverflow[route]=overflow;
      assert.ok(overflow<=1,`${route} overflows a 320px viewport by ${overflow}px`);
      if(route==="/pricing")await capture(page,"pricing-mobile-320.png",{fullPage:true});
      if(route==="/policies")await capture(page,"policies-mobile-320.png",{fullPage:true});
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
