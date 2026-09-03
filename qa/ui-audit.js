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
function positive(value,label){assert.ok(value>0,`${label}: expected a positive count, received ${value}`);}

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
    page.on("console",message=>{const location=message.location();if(message.type()==="error"&&(!location.url||isFirstParty(location.url)))errors.push(`console: ${message.text()}`);});
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
    assert.equal(snapshot.buyVisible,true,"A signed-in unpaid account should see the Discovery purchase control");
    assert.equal(snapshot.buyDisabled,true,"Checkout must stay disabled when Paddle configuration is off");
    assert.match(snapshot.checkoutStatus,/temporarily unavailable|not configured correctly/i);
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
    assert.equal(new URL(page.url()).pathname,"/pricing","Unpaid mobile users must remain behind the Discovery paywall");
    snapshot.mobileOverflow=await page.evaluate(()=>document.documentElement.scrollWidth-document.documentElement.clientWidth);
    assert.ok(snapshot.mobileOverflow<=1,`Mobile layout overflows horizontally by ${snapshot.mobileOverflow}px`);
    await capture(page,"pricing-locked-mobile.png",{fullPage:true});

    await page.setViewportSize({width:320,height:700});
    snapshot.narrowOverflow={};
    for(const route of ["/","/account.html","/planner.html","/discover.html","/pricing","/contact","/terms","/privacy","/refunds","/install.html"]){
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
