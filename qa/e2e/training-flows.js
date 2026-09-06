"use strict";

const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {mkdtempSync,readFileSync,rmSync}=require("node:fs");
const http=require("node:http");
const {tmpdir}=require("node:os");
const {join,resolve}=require("node:path");
const test=require("node:test");
const {chromium}=require("playwright");

const ROOT=join(__dirname,"..","..");
const WAIT_MS=10_000;
const PASSWORD="synthetic-training-e2e-123";
const CATALOG=JSON.parse(readFileSync(join(ROOT,"public/data/exercises.json"),"utf8"));
let app,browser,baseUrl,runtimeDir,logs="",contextNumber=0;
const pageErrors=[];
const contexts=[];

async function unusedPort(){
  const server=http.createServer();
  await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
  const port=server.address().port;
  await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));return port;
}
async function startApp(){
  const port=await unusedPort();baseUrl=`http://127.0.0.1:${port}`;runtimeDir=mkdtempSync(join(tmpdir(),"strata-training-e2e-"));
  app=spawn(process.execPath,["server.js"],{cwd:ROOT,env:{HOST:"127.0.0.1",PORT:String(port),NODE_ENV:"test",TZ:"UTC",TRUST_PROXY:"true",SECURE_COOKIES:"false",ADMIN_EMAIL:"",TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",STRATA_DATA_DIR:runtimeDir,ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",EMAIL_VERIFICATION_ENABLED:"false",PADDLE_CHECKOUT_ENABLED:"false",APP_BASE_URL:baseUrl},stdio:["ignore","pipe","pipe"]});
  for(const stream of [app.stdout,app.stderr])stream.on("data",chunk=>{logs=(logs+chunk.toString()).slice(-16_384);});
  const deadline=Date.now()+WAIT_MS;
  while(Date.now()<deadline){
    if(app.exitCode!==null)throw new Error(`Training E2E server exited.\n${logs}`);
    try{if((await fetch(`${baseUrl}/healthz`)).ok)return;}catch{}
    await new Promise(done=>setTimeout(done,50));
  }
  throw new Error(`Training E2E server did not become healthy.\n${logs}`);
}
async function cleanup(){
  try{await browser?.close();}finally{
    if(app&&app.exitCode===null&&app.signalCode===null){
      await new Promise(done=>{
        let settled=false,forceTimer;
        const finish=()=>{if(settled)return;settled=true;clearTimeout(forceTimer);done();};
        app.once("exit",finish);app.kill("SIGTERM");forceTimer=setTimeout(()=>{try{app.kill("SIGKILL");}catch{}finish();},2000);
      });
    }
    if(runtimeDir)rmSync(runtimeDir,{recursive:true,force:true});
  }
}
async function newPage(options={}){
  const context=await browser.newContext({baseURL:baseUrl,serviceWorkers:"block",extraHTTPHeaders:{"X-Forwarded-For":`198.51.100.${++contextNumber}`},...options});
  contexts.push(context);context.setDefaultTimeout(WAIT_MS);
  await context.route(/^https:\/\//,route=>route.abort());
  const page=await context.newPage();page.on("pageerror",error=>pageErrors.push(`${page.url()}: ${error.message}`));
  return {context,page};
}
async function goto(page,path){await page.goto(path,{waitUntil:"domcontentloaded"});}
async function plannerReady(page){await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Saved");}
async function guestPlan(page){return page.evaluate(()=>JSON.parse(localStorage.getItem("strata_guest_plan_v1")));}
async function signup(context,label){
  const response=await context.request.post("/api/signup",{headers:{Origin:baseUrl},data:{name:`Training ${label}`,email:`training-${label}@example.test`,password:PASSWORD}});
  assert.equal(response.status(),201,await response.text());return(await response.json()).user;
}
async function activatePlus(context){
  const current=await accountPlan(context);
  const response=await context.request.post("/api/discovery/trial",{headers:{Origin:baseUrl,"X-CSRF-Token":current.csrfToken},data:{}});
  assert.ok([200,201].includes(response.status()),await response.text());
}
async function accountPlan(context){const response=await context.request.get("/api/plan");assert.equal(response.status(),200);return response.json();}
async function savedAccountEdit(page,action){
  const response=page.waitForResponse(item=>new URL(item.url()).pathname==="/api/plan"&&item.request().method()==="PUT");
  await action();const saved=await response;assert.equal(saved.status(),200,await saved.text());await plannerReady(page);return saved.json();
}
function fixtureWeek(){
  return {version:1,restDay:"Sunday",days:Object.fromEntries(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map(day=>[day,day==="Monday"?[{instanceId:"training-fixture",exerciseId:CATALOG.find(item=>item.equipment!=="Bodyweight"&&!/seconds|sec|min/i.test(item.reps)).id,sets:1,reps:"8–12"}]:[]]))};
}

test("training journeys use real browser controls and isolated local fixtures",{timeout:120_000},async t=>{
  await t.test("free planning supports rest toggles, replacement, undo, templates and portable imports",async()=>{
    const {context,page}=await newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
    await goto(page,"/planner.html");await plannerReady(page);
    await page.locator('[data-quick-add]').first().click();await plannerReady(page);
    const generated=await guestPlan(page),originalCount=Object.values(generated.days).flat().length;
    assert.ok(originalCount>0);
    assert.equal(await page.locator('#startPlannedWorkout').count(),0);
    assert.equal(await page.locator('#recommendRest').count(),0);
    await page.locator('[data-set-rest="Sunday"]').click();await plannerReady(page);
    await page.locator('[data-set-rest="Wednesday"]').click();await plannerReady(page);
    await page.locator('[data-set-rest="Saturday"]').click();await plannerReady(page);
    await page.reload({waitUntil:"domcontentloaded"});await plannerReady(page);
    assert.deepEqual((await guestPlan(page)).restDays,["Wednesday","Saturday"]);
    await page.locator('[data-set-rest="Wednesday"]').click();await plannerReady(page);
    assert.deepEqual((await guestPlan(page)).restDays,["Saturday"]);
    const card=page.locator('[data-day="Monday"] [data-instance-id]').first(),instance=await card.getAttribute("data-instance-id");
    await card.locator("[data-item-sets]").fill("4");await card.locator("[data-item-reps]").fill("6–8");
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days.Monday.find(item=>item.instanceId===id)?.reps==="6–8",instance);
    await card.locator("[data-replace-item]").click();
    await page.locator("#replaceExerciseDialog").waitFor({state:"visible"});await page.fill("#replaceExerciseSearch","squat");
    const replacement=await page.locator("#replaceExerciseSelect option").nth(1).getAttribute("value");
    await page.selectOption("#replaceExerciseSelect",replacement);await page.click("#confirmReplaceExercise");
    await page.waitForFunction(({id,exerciseId})=>JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days.Monday.find(item=>item.instanceId===id)?.exerciseId===exerciseId,{id:instance,exerciseId:replacement});
    const replaced=(await guestPlan(page)).days.Monday.find(item=>item.instanceId===instance);
    assert.equal(replaced.sets,4);assert.equal(replaced.reps,"6–8");
    await page.locator(`[data-remove-item="${instance}"]`).click();
    await page.waitForFunction(id=>!JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days.Monday.some(item=>item.instanceId===id),instance);
    await page.click("#undoPlanRemoval");
    await page.waitForFunction(id=>JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days.Monday.some(item=>item.instanceId===id),instance);
    await page.click("#manageWeekTemplates");await page.fill("#weekTemplateName","My reusable week");await page.click("#saveWeekTemplate");
    await page.click("#closeWeekTemplates");await page.locator("[data-quick-add]").first().click();
    await page.waitForFunction(count=>Object.values(JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days).flat().length===count,originalCount+1);
    await page.click("#manageWeekTemplates");await page.selectOption("#weekTemplateSelect",{index:1});await page.click("#previewWeekTemplate");
    assert.equal(await page.locator("#applyWeekTemplate").isDisabled(),true,"Replacement requires the user's confirmation");
    await page.check("#confirmUseTemplate");await page.click("#applyWeekTemplate");
    await page.waitForFunction(count=>Object.values(JSON.parse(localStorage.getItem("strata_guest_plan_v1")).days).flat().length===count,originalCount);
    const duplicated=await guestPlan(page);assert.ok(!Object.values(duplicated.days).flat().some(item=>item.instanceId===instance),"A copied week gets new entry identities");
    await page.click("#manageWeekTemplates");
    await page.setInputFiles("#templateFile",{name:"portable-week.json",mimeType:"application/json",buffer:Buffer.from(JSON.stringify({format:"strata-weekly-plan",version:1,plan:duplicated}))});
    await page.locator("#templatePreview").waitFor({state:"visible"});
    assert.deepEqual(await guestPlan(page),duplicated,"Import preview must not mutate the current week");
    assert.equal(await page.locator("#applyWeekTemplate").isDisabled(),true);
    await page.keyboard.press("Escape");assert.equal(await page.locator("#weekTemplatesDialog").isVisible(),false);
    await context.close();
  });

  await t.test("an account draft survives a failed save and reload without overwriting a newer server week",async()=>{
    const {context,page}=await newPage();const user=await signup(context,"draft");
    await goto(page,"/planner.html");await plannerReady(page);
    await savedAccountEdit(page,()=>page.locator("[data-quick-add]").first().click());
    const instance=await page.locator('[data-day="Monday"] [data-instance-id]').first().getAttribute("data-instance-id");
    const blockSave=async route=>route.request().method()==="PUT"?route.abort():route.continue();
    await page.route("**/api/plan",blockSave);
    await page.locator(`[data-item-reps="${instance}"]`).fill("10–12");
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Couldn't save — Retry");
    const current=await accountPlan(context);current.plan.days.Monday[0].reps="2–4";
    const changed=await context.request.put("/api/plan",{headers:{Origin:baseUrl,"X-CSRF-Token":current.csrfToken,"X-Strata-User":user.id},data:{plan:current.plan,expectedPlanUpdatedAt:current.planUpdatedAt,expectedUserId:user.id}});
    assert.equal(changed.status(),200);const newer=await changed.json();
    page.once("dialog",dialog=>dialog.accept());await page.reload({waitUntil:"domcontentloaded"});
    await page.locator("#planConflictPanel").waitFor({state:"visible"});
    assert.match(await page.locator("#latestPlanSummary").textContent(),/2–4/);assert.match(await page.locator("#localPlanSummary").textContent(),/10–12/);
    assert.equal((await accountPlan(context)).planUpdatedAt,newer.planUpdatedAt,"Reload must not save recovered local edits");
    await page.click("#reviewLocalPlan");
    assert.equal((await accountPlan(context)).planUpdatedAt,newer.planUpdatedAt,"Review must remain separate from explicit save");
    await page.unroute("**/api/plan",blockSave);
    const save=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/plan"&&response.request().method()==="PUT");await page.click("#retryPlanSave");
    const response=await save;assert.equal(response.status(),200);assert.equal(response.request().postDataJSON().expectedPlanUpdatedAt,newer.planUpdatedAt);
    await plannerReady(page);assert.equal((await accountPlan(context)).plan.days.Monday[0].reps,"10–12");
    await context.close();
  });

  await t.test("an account switch blocks a stale tab from saving its week into the replacement account",async()=>{
    const {context,page}=await newPage();const original=await signup(context,"owner-a");
    await goto(page,"/planner.html");await plannerReady(page);
    const blockSave=async route=>route.request().method()==="PUT"?route.abort():route.continue();
    await page.route("**/api/plan",blockSave);await page.locator("[data-quick-add]").first().click();
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Couldn't save — Retry");
    const replacement=await signup(context,"owner-b");assert.notEqual(replacement.id,original.id);
    await page.unroute("**/api/plan",blockSave);const writes=[];
    page.on("request",request=>{if(new URL(request.url()).pathname==="/api/plan"&&request.method()==="PUT")writes.push(request);});
    await page.click("#retryPlanSave");await page.locator("#accountChangedNotice").waitFor({state:"visible"});
    assert.equal(writes.length,0,"Identity verification must reject before sending the old account's plan");
    assert.equal(await page.locator("#plannerShell").evaluate(node=>node.inert),true);
    const retained=await page.evaluate(id=>Object.keys(localStorage).filter(key=>key.startsWith(`strata_plan_draft_v1:user-${encodeURIComponent(id)}:`)).length,original.id);
    assert.ok(retained>0,"Recovery drafts stay scoped to the original account");
    assert.equal(Object.values((await accountPlan(context)).plan.days).flat().length,0,"The replacement account must remain untouched");
    await context.close();
  });

  await t.test("a Strata+ member logs actual work, resumes and sees the same completed results in history",async()=>{
    const {context,page}=await newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
    const user=await signup(context,"mobile-workout");await activatePlus(context);
    const current=await accountPlan(context);
    const seed=await context.request.put("/api/plan",{headers:{Origin:baseUrl,"X-CSRF-Token":current.csrfToken,"X-Strata-User":user.id},data:{plan:fixtureWeek(),expectedPlanUpdatedAt:current.planUpdatedAt}});assert.equal(seed.status(),200);
    await goto(page,"/workout.html?day=Monday");
    await page.locator("#trainingRoom").waitFor({state:"visible"});await page.selectOption("#planDay","Monday");await page.click("#startWorkout");
    await page.locator("#sessionPanel").waitFor({state:"visible"});
    const entry=page.locator("#sessionEntries [data-entry]").first();
    await entry.locator('[data-actual="weight"]').fill("40");await entry.locator('[data-actual="reps"]').fill("8");await entry.locator('[data-complete="0"]').click();
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Saved to your account");
    assert.equal(await page.locator("#sessionProgress").getAttribute("value"),"100");
    assert.equal(await page.locator("#timerToggle").textContent(),"Pause");await page.click("#timerToggle");
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Saved to your account");
    await page.reload({waitUntil:"domcontentloaded"});await page.locator('#recoveryList [data-recover="0"]').click();
    await page.locator("#sessionPanel").waitFor({state:"visible"});
    assert.equal(await entry.locator('[data-actual="weight"]').inputValue(),"40");assert.equal(await entry.locator('[data-actual="reps"]').inputValue(),"8");
    assert.equal(await entry.locator('[data-complete="0"]').getAttribute("aria-pressed"),"true");
    await page.click("#finishWorkout");await page.locator("#finishDialog").waitFor({state:"visible"});await page.click('#finishDialog button[value="finish"]');
    await page.locator("#celebration").waitFor({state:"visible"});await page.locator("#historyList [data-history]").first().click();
    await page.locator("#detailDialog").waitFor({state:"visible"});const details=await page.locator("#detailBody").textContent();
    assert.match(details,/40/);assert.match(details,/8/);assert.match(details,/kg/);
    await page.click("#closeDetail");await page.reload({waitUntil:"domcontentloaded"});
    await page.locator("#historyList [data-history]").first().waitFor({state:"visible"});assert.equal(await page.locator("#historyList [data-history]").count(),1,"A completed session survives reload without duplication");
    await context.close();
  });
  await t.test("account sessions persist actual values across reload, and identity-network errors never become guest access",async()=>{
    const {context,page}=await newPage();const user=await signup(context,"workout");await activatePlus(context);
    const current=await accountPlan(context);
    const seed=await context.request.put("/api/plan",{headers:{Origin:baseUrl,"X-CSRF-Token":current.csrfToken,"X-Strata-User":user.id},data:{plan:fixtureWeek(),expectedPlanUpdatedAt:current.planUpdatedAt,expectedUserId:user.id}});
    assert.equal(seed.status(),200);
    await goto(page,"/workout.html?day=Monday");await page.locator("#trainingRoom").waitFor({state:"visible"});await page.selectOption("#planDay","Monday");
    const creating=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/workouts"&&response.request().method()==="POST");
    await page.click("#startWorkout");const created=await creating;assert.equal(created.status(),201,await created.text());
    const first=await created.json();assert.equal(created.request().headers()["x-strata-user"],user.id);
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Saved to your account");
    const entry=page.locator("#sessionEntries [data-entry]").first();
    const saving=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/workouts/${first.workout.id}`&&response.request().method()==="PUT");
    await entry.locator('[data-actual="weight"]').fill("25");await entry.locator('[data-actual="reps"]').fill("9");await entry.locator('[data-complete="0"]').click();
    const saved=await saving;assert.equal(saved.status(),200,await saved.text());assert.equal(saved.request().postDataJSON().expectedRevision,first.workout.revision);
    await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus")?.textContent==="Saved to your account");
    await page.reload({waitUntil:"domcontentloaded"});await page.locator('#recoveryList [data-recover="0"]').click();await page.locator("#sessionPanel").waitFor({state:"visible"});
    assert.equal(await entry.locator('[data-actual="weight"]').inputValue(),"25");assert.equal(await entry.locator('[data-actual="reps"]').inputValue(),"9");assert.equal(await entry.locator('[data-complete="0"]').getAttribute("aria-pressed"),"true");
    await page.click("#finishWorkout");await page.click('#finishDialog button[value="finish"]');await page.locator("#celebration").waitFor({state:"visible"});
    const persisted=await context.request.get(`/api/workouts/${first.workout.id}`);assert.equal(persisted.status(),200);const completed=(await persisted.json()).workout;
    assert.equal(completed.status,"completed");assert.equal(completed.entries[0].sets[0].weight,25);assert.equal(completed.entries[0].sets[0].reps,9);
    const disconnected=await context.newPage();disconnected.on("pageerror",error=>pageErrors.push(error.message));await disconnected.route("**/api/me",route=>route.abort());
    await goto(disconnected,"/workout.html");await disconnected.locator("#loadError").waitFor({state:"visible"});
    assert.equal(await disconnected.locator("#accessPanel").isVisible(),false,"A failed account check must not offer anonymous fallback as though the user signed out");
    assert.equal(await disconnected.locator("#trainingRoom").isVisible(),false,"Network failures must not silently select a guest log");
    await context.close();
  });
  await t.test("free accounts are gated; Strata+ setup creates an editable account week",async()=>{
    const {context,page}=await newPage({viewport:{width:390,height:844},reducedMotion:"reduce"});
    await goto(page,"/workout.html?guest=1");assert.match(page.url(),/account.html/);
    await signup(context,"setup");
    await goto(page,"/onboarding.html");assert.match(page.url(),/pricing/);
    await activatePlus(context);await goto(page,"/discover.html");
    await page.locator('#plusStartWorkout').waitFor({state:"visible"});
    await page.getByRole('link',{name:'Set up my week',exact:false}).first().click();
    await page.waitForFunction(()=>globalThis.document.querySelector('#setupFields')?.disabled===false);
    const before=(await accountPlan(context)).plan;
    await page.click('#generateWeek');await page.locator('#saveControls').waitFor({state:'visible'});
    assert.deepEqual((await accountPlan(context)).plan,before);
    await page.click('#saveWeek');await page.locator('#openPlanner').waitFor({state:'visible'});
    const after=(await accountPlan(context)).plan;
    assert.ok(Object.values(after.days).flat().length>0);assert.deepEqual(after.restDays,['Tuesday','Thursday','Saturday','Sunday']);
    await page.click('#openPlanner');await plannerReady(page);
    await context.close();
  });
  assert.deepEqual(pageErrors,[],`Unexpected browser errors:\n${pageErrors.join("\n")}`);
});

test.before(async()=>{
  try{await startApp();const options={headless:true};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);browser=await chromium.launch(options);}
  catch(error){await cleanup();throw error;}
});
test.after(cleanup);
