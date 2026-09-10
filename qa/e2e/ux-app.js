"use strict";
/* global document, window, Node, innerWidth */
const assert=require("node:assert/strict");
const {existsSync,mkdirSync,readFileSync}=require("node:fs");
const {extname,join,resolve}=require("node:path");
const test=require("node:test");
const {chromium}=require("playwright");
const {AxeBuilder}=require("@axe-core/playwright");
const ROOT=join(__dirname,"..",".."),ORIGIN="http://strata-ux.test";
const CATALOG=JSON.parse(readFileSync(join(ROOT,"public/data/exercises.json"),"utf8"));
const DISCOVERY=JSON.parse(readFileSync(join(ROOT,"src/data/discovery-data.json"),"utf8"));
const USER={id:"ux-member",name:"UX Member",discovery:{active:true}},CSRF="ux-csrf";
const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const PLAN={version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map(day=>[day,[]]))};
const PREFS={goal:"hypertrophy",level:"Advanced",days:4,equipment:[...new Set(CATALOG.map(item=>item.equipment))],preferences:[],limitations:[]};
let browser;
function asset(path){if(path==="/exercises.json")return join(ROOT,"public/data/exercises.json");const rel=path==="/"?"index.html":path.slice(1),ext=extname(rel),folder=ext===".html"?"pages":ext===".js"?"scripts":ext===".css"?"styles":"";return[join(ROOT,"public",rel),join(ROOT,"public",folder,rel)].find(existsSync);}
async function fixture(t){
  const context=await browser.newContext({baseURL:ORIGIN,serviceWorkers:"block",viewport:{width:390,height:844},reducedMotion:"reduce"});t.after(()=>context.close());context.setDefaultTimeout(8000);
  const page=await context.newPage(),errors=[],calls=[];let history="ready",releaseHistory,access=true;
  page.on("pageerror",error=>errors.push(error.message));
  await context.route("**/*",async route=>{
    const path=new URL(route.request().url()).pathname,json=(value,status=200)=>route.fulfill({status,contentType:"application/json",body:JSON.stringify(value)});calls.push(path);
    if(path==="/api/me")return json({user:{...USER,discovery:{active:access}},csrfToken:CSRF});
    if(path==="/api/discovery")return json({user:USER,csrfToken:CSRF,exercises:CATALOG,...DISCOVERY,preferences:PREFS,ratings:{aggregates:[{exercise_id:CATALOG[0].id,rating_count:2,overall:4.5}],user:[]},weeklyPlan:PLAN,weeklyPlanUpdatedAt:0,monthlyPlan:null,monthlyPlanUpdatedAt:0});
    if(path==="/api/workouts"){if(history==="pending")await new Promise(done=>{releaseHistory=done;});return history==="error"?json({error:"Unavailable"},503):json({workouts:[],hasMore:false,csrfToken:CSRF});}
    if(path==="/api/training")return json({user:USER,csrfToken:CSRF,block:null,adaptation:null});
    if(path==="/api/ratings/aggregates")return access?json({aggregates:[{exercise_id:CATALOG[0].id,rating_count:2,overall:4.5}]}):json({error:"Access expired"},402);
    if(path==="/api/preferences"&&!access)return json({error:"Access expired"},402);
    if(path==="/api/community-plans")return json({plans:[],pagination:{nextOffset:null}});
    if(path.startsWith("/api/"))return json({error:`Unexpected ${path}`},404);
    const file=asset(path);if(file)return route.fulfill({path:file});return route.fulfill({status:404,body:"Missing asset"});
  });
  return{page,errors,calls,setHistory(value){history=value;},release(){releaseHistory?.();},expire(){access=false;}};
}
async function shot(page,name){if(!process.env.STRATA_QA_ARTIFACT_DIR)return;const dir=resolve(process.env.STRATA_QA_ARTIFACT_DIR);mkdirSync(dir,{recursive:true});await page.screenshot({path:join(dir,name),fullPage:false});}

test("Exercises opens with the library and retains a keyboard-accessible optional starter week",async t=>{
  const {page,errors}=await fixture(t);await page.goto("/");await page.locator(".exercise-row").first().waitFor();
  assert.equal(await page.locator("#preview").getAttribute("open"),null);assert.match(await page.title(),/^Exercises/);
  const order=await page.evaluate(()=>document.querySelector("#rankings").compareDocumentPosition(document.querySelector("#preview"))&Node.DOCUMENT_POSITION_FOLLOWING);assert.ok(order);
  await page.locator(".score-guide summary").focus();await page.keyboard.press("Enter");assert.match(await page.locator(".score-guide").innerText(),/fixed exercise score[\s\S]*Match for you[\s\S]*five-point scale/);
  await page.locator("#preview > summary").focus();await page.keyboard.press("Enter");await page.locator("#quickPreviewSubmit").waitFor();await page.locator("#quickPreviewSubmit").click();await page.locator("#quickWeekPreview").waitFor();assert.equal(await page.locator(".quick-week-grid > *").count(),7);
  await page.locator("#preview > summary").click();await page.locator(".score-guide summary").click();for(const width of [320,390,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));if(width<980){const search=await page.locator("#searchInput").boundingBox(),muscle=await page.locator("#musclePanel").boundingBox();assert.ok(search.y<muscle.y,"Search comes before muscle reference information on mobile");}await shot(page,`exercises-${width}.png`);}assert.deepEqual(errors,[]);
});

test("Progress distinguishes pending, failed, retried and empty history without showing empty metrics",async t=>{
  const f=await fixture(t),{page}=f;f.setHistory("pending");await page.goto("/discover.html#progressWorkspace");await page.locator("#progressLoadState").waitFor();assert.match(await page.locator("#progressLoadTitle").innerText(),/Loading/);assert.equal(await page.locator("#progressFirstWorkout").isHidden(),true);assert.equal(await page.locator("#progressHistoryContent").isHidden(),true);
  f.setHistory("error");f.release();await page.waitForFunction(()=>document.querySelector("#progressLoadTitle")?.textContent.includes("couldn’t load"));await page.locator("#progressRetry").waitFor();assert.match(await page.locator("#progressLoadTitle").innerText(),/couldn’t load/);assert.equal(await page.locator("#progressFirstWorkout").isHidden(),true);
  f.setHistory("ready");await page.locator("#progressRetry").focus();await page.keyboard.press("Enter");await page.locator("#progressFirstWorkout").waitFor();assert.equal(await page.locator("#progressFirstAction").innerText(),"Build your first week");assert.equal(await page.locator("#progressFirstAction").getAttribute("href"),"/planner.html");assert.equal(await page.locator("#progressHistoryContent").isHidden(),true);assert.equal(await page.locator("#progressLoadState").isHidden(),true);assert.deepEqual(f.errors,[]);
});

test("exercise and Plan child tools retain ownership, five-point scores and accessible mobile/desktop layout",{timeout:90000},async t=>{
  const {page,errors}=await fixture(t);
  for(const [hash,owner] of [["recommendations","exercises"],["exerciseExplorer","exercises"],["battle","exercises"],["profile","exercises"],["savedExercises","exercises"],["sessionBuilder","plan"],["trainingBlockWorkspace","plan"],["monthlyPlan","plan"],["communityPlans","plan"],["progressWorkspace","progress"]]){
    await page.goto(`/discover.html#${hash}`);await page.locator("main:not([hidden])").waitFor();await page.waitForFunction(()=>document.querySelector("#progressFirstWorkout")?.hidden===false);
    assert.equal(await page.locator(`.studio-nav-desktop [aria-current="page"]`).getAttribute("data-product-owner"),owner);assert.equal(await page.locator("[data-feature-panel]:visible").count(),1);assert.equal(await page.locator("#planToolBreadcrumb").isVisible(),owner==="plan");assert.equal(await page.locator("#exerciseToolNavigation").isVisible(),owner==="exercises");
    for(const width of [390,1440]){await page.setViewportSize({width,height:900});await page.evaluate(()=>window.scrollTo(0,0));assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${hash} overflow at ${width}`);const audit=await new AxeBuilder({page}).withTags(["wcag2a","wcag2aa","wcag21aa"]).analyze();assert.deepEqual(audit.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],`${hash} at ${width}`);await shot(page,`${hash}-${width}.png`);}
  }
  await page.goto("/discover.html#exerciseExplorer");await page.locator(".exercise-card").first().waitFor();await page.locator(`[data-open-detail="${CATALOG[0].id}"]`).first().click();await page.locator("#detailDialog").waitFor();assert.match(await page.locator(".rating-summary").innerText(),/4\.5\/5/);assert.match(await page.locator("#alternativeSection").innerText(),/similarity/);assert.doesNotMatch(await page.locator("#detailDialog").innerText(),/\/10\b|Personal match|Official FitScore/);assert.deepEqual(errors,[]);
});

test("an expired access response clears private content and exposes Account access management",async t=>{
  const f=await fixture(t),{page}=f;await page.goto("/discover.html#profile");await page.locator("main:not([hidden])").waitFor();await page.waitForFunction(()=>document.querySelector("#progressFirstWorkout")?.hidden===false);f.expire();await page.locator('#profileForm button[type="submit"]').click();await page.locator("#featureAccess").waitFor();assert.equal(await page.locator("main").isHidden(),true);assert.equal(await page.locator('#featureAccess a[href="/account.html"]').innerText(),"Manage access");assert.equal(await page.locator("#recommendationGrid").innerText(),"");assert.deepEqual(f.errors,[]);
});
test("access expiry during successful history reads cannot restore private Progress",async t=>{
  const f=await fixture(t),{page}=f;f.setHistory("pending");await page.goto("/discover.html#progressWorkspace");await page.locator("main:not([hidden])").waitFor();f.expire();f.setHistory("ready");f.release();await page.locator("#featureAccess").waitFor();assert.equal(await page.locator("main").isHidden(),true);assert.equal(await page.locator("#personalBestList").textContent(),"");assert.deepEqual(f.errors,[]);
});
test.before(async()=>{const options={headless:true};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);browser=await chromium.launch(options);});test.after(()=>browser?.close());
