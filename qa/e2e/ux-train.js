"use strict";

const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {mkdirSync,mkdtempSync,readFileSync,rmSync}=require("node:fs");
const http=require("node:http");
const {tmpdir}=require("node:os");
const {join,resolve}=require("node:path");
const test=require("node:test");
const {chromium}=require("playwright");

const ROOT=join(__dirname,"..","..");
const WAIT_MS=12_000;
const CATALOG=JSON.parse(readFileSync(join(ROOT,"public/data/exercises.json"),"utf8"));
const EXERCISE=CATALOG.find(item=>item.equipment==="Barbell / Smith"&&!/seconds|sec|min/i.test(item.reps));
const CAPTURE_DIR=process.env.STRATA_TRAIN_UX_SCREENSHOTS||(process.platform==="darwin"?"/private/tmp/strata-783-train-qa":join(tmpdir(),"strata-783-train-qa"));
let app,browser,baseUrl,runtimeDir,logs="",contextNumber=0;
const pageErrors=[];

async function unusedPort(){
  const server=http.createServer();
  await new Promise((done,reject)=>{server.once("error",reject);server.listen(0,"127.0.0.1",done);});
  const port=server.address().port;
  await new Promise((done,reject)=>server.close(error=>error?reject(error):done()));return port;
}
async function startApp(){
  const port=await unusedPort();baseUrl=`http://127.0.0.1:${port}`;runtimeDir=mkdtempSync(join(tmpdir(),"strata-train-ux-e2e-"));
  app=spawn(process.execPath,["server.js"],{cwd:ROOT,env:{HOST:"127.0.0.1",PORT:String(port),NODE_ENV:"test",TZ:"UTC",TRUST_PROXY:"true",SECURE_COOKIES:"false",ADMIN_EMAIL:"",TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",STRATA_DATA_DIR:runtimeDir,ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",EMAIL_VERIFICATION_ENABLED:"false",PADDLE_CHECKOUT_ENABLED:"false",APP_BASE_URL:baseUrl},stdio:["ignore","pipe","pipe"]});
  for(const stream of [app.stdout,app.stderr])stream.on("data",chunk=>{logs=(logs+chunk.toString()).slice(-16_384);});
  const deadline=Date.now()+WAIT_MS;
  while(Date.now()<deadline){
    if(app.exitCode!==null)throw new Error(`Train UX E2E server exited.\n${logs}`);
    try{if((await fetch(`${baseUrl}/healthz`)).ok)return;}catch{}
    await new Promise(done=>setTimeout(done,50));
  }
  throw new Error(`Train UX E2E server did not become healthy.\n${logs}`);
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
async function read(context,path){
  const response=await context.request.get(path);assert.equal(response.status(),200,await response.text());return response.json();
}
async function newMember(label){
  const context=await browser.newContext({baseURL:baseUrl,serviceWorkers:"block",viewport:{width:390,height:844},timezoneId:"UTC",reducedMotion:"reduce",extraHTTPHeaders:{"X-Forwarded-For":`198.51.100.${++contextNumber}`}});
  context.setDefaultTimeout(WAIT_MS);await context.route(/^https:\/\//,route=>route.abort());
  const page=await context.newPage();page.on("pageerror",error=>pageErrors.push(`${page.url()}: ${error.message}`));
  const signup=await context.request.post("/api/signup",{headers:{Origin:baseUrl},data:{name:`Train ${label}`,email:`train-${label}@example.test`,password:"synthetic-progression-e2e-123"}});
  assert.equal(signup.status(),201,await signup.text());const user=(await signup.json()).user;
  const initial=await read(context,"/api/plan"),headers={Origin:baseUrl,"X-CSRF-Token":initial.csrfToken,"X-Strata-User":user.id};
  const trial=await context.request.post("/api/discovery/trial",{headers,data:{}});assert.ok([200,201].includes(trial.status()),await trial.text());
  return{context,page,user,headers};
}

const DAYS=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
const today=()=>DAYS[new Date().getUTCDay()];
const otherDay=()=>DAYS[(new Date().getUTCDay()+1)%7];
async function saveWeek(member,day){
  const current=await read(member.context,"/api/plan"),plan={version:1,restDay:null,restDays:[],days:Object.fromEntries(DAYS.map(name=>[name,name===day?[{instanceId:"ux-exercise",exerciseId:EXERCISE.id,sets:1,reps:"8–12"}]:[]]))};
  const response=await member.context.request.put("/api/plan",{headers:member.headers,data:{plan,expectedPlanUpdatedAt:current.planUpdatedAt,expectedUserId:member.user.id}});assert.equal(response.status(),200,await response.text());return(await response.json()).plan;
}
async function openTrain(member,suffix=""){
  await member.page.goto(`/workout.html${suffix}`,{waitUntil:"domcontentloaded"});await member.page.locator("#trainingRoom").waitFor({state:"visible"});
  await member.page.waitForFunction(()=>!globalThis.document.querySelector("#refreshHistory").disabled);
}
async function checkLayout(page,label,{allWidths=false}={}){
  const keepLocal=page.locator('[data-signal-consent="local"]');if(await keepLocal.isVisible())await keepLocal.click();
  await page.waitForFunction(()=>!globalThis.document.querySelector("#workoutToast")?.classList.contains("is-visible"));
  for(const width of allWidths?[320,390,1440]:[390]){
    await page.setViewportSize({width,height:width===1440?1000:844});
    await page.evaluate(()=>globalThis.scrollTo(0,0));
    const result=await page.evaluate(()=>({overflow:globalThis.document.documentElement.scrollWidth-globalThis.document.documentElement.clientWidth,targets:[...globalThis.document.querySelectorAll('#startPanel button,#startPanel .button,#historyTitle')].filter(node=>node.getClientRects().length).map(node=>({text:node.textContent.trim(),height:node.getBoundingClientRect().height}))}));
    assert.ok(result.overflow<=1,`${label} at ${width}px overflows by ${result.overflow}px`);assert.ok(result.targets.every(node=>node.height>=44),`${label} at ${width}px has small controls: ${JSON.stringify(result.targets)}`);
    mkdirSync(CAPTURE_DIR,{recursive:true});await page.screenshot({path:join(CAPTURE_DIR,`${label}-${width}.png`),fullPage:true});
  }
}

test("Train states expose one accurate primary action and keep history secondary",{timeout:180_000},async t=>{
  await t.test("missing week and no history remain compact; empty today leads to a scheduled day",async()=>{
    const member=await newMember("empty"),{page,context}=member;await saveWeek(member,null);await openTrain(member);
    assert.equal(await page.locator("#planStatus").textContent(),"You have not built a weekly plan yet.");
    assert.equal(await page.locator("#openPlannerFromEmpty").isVisible(),true);assert.equal(await page.locator("#startWorkout").isHidden(),true);assert.equal(await page.locator("#differentWorkout").isHidden(),true);assert.equal(await page.locator("#editWorkoutWeek").isHidden(),true);
    assert.equal(await page.locator("#workoutHistory").getAttribute("open"),null);assert.equal(await page.locator("#historyStats").isHidden(),true);assert.equal(await page.locator("#historyPerformance").isHidden(),true);
    await page.locator("#historyTitle").focus();await page.keyboard.press("Enter");await page.locator("#historyList").waitFor({state:"visible"});assert.match(await page.locator("#historyList").textContent(),/after your first completed workout/);await page.keyboard.press("Enter");
    await checkLayout(page,"empty-week");
    await saveWeek(member,otherDay());await openTrain(member);assert.equal(await page.locator("#planStatus").textContent(),"Nothing is scheduled for today.");assert.equal(await page.locator("#planStatus").isVisible(),true);assert.equal(await page.locator("#chooseScheduledDay").isVisible(),true);assert.equal(await page.locator("#differentWorkout").isHidden(),true);await checkLayout(page,"empty-today");
    await page.click("#chooseScheduledDay");assert.equal(await page.locator("#planDay").inputValue(),otherDay());assert.equal(await page.locator("#startWorkout").isVisible(),true);assert.equal(await page.locator("#startWorkout").evaluate(node=>globalThis.document.activeElement===node),true);assert.match(await page.locator("#planBrief").textContent(),/Exercises1Working sets1Estimated duration10 minEquipment/);assert.match(await page.locator("#planBrief").textContent(),new RegExp(EXERCISE.equipment));
    assert.equal(await page.locator("#differentWorkout a").getAttribute("href"),"/discover.html#sessionBuilder");await checkLayout(page,"scheduled",{allWidths:true});await context.close();
  });
  await t.test("active workout resumes from the main card, retains actuals, and completed history supports its deep link",async()=>{
    const member=await newMember("resume"),{page,context}=member;await saveWeek(member,today());await openTrain(member);
    const creating=page.waitForResponse(response=>new URL(response.url()).pathname==="/api/workouts"&&response.request().method()==="POST");await page.click("#startWorkout");const active=(await(await creating).json()).workout;await page.locator("#sessionPanel").waitFor({state:"visible"});
    const entry=page.locator("#sessionEntries [data-entry]").first();await entry.locator('[data-actual="weight"]').fill("40");await entry.locator('[data-actual="reps"]').fill("8");await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus").textContent==="Synced");await page.click("#closeSession");await page.locator("#startPanel").waitFor({state:"visible"});
    assert.equal(await page.locator("#resumeWorkout").isVisible(),true);assert.equal(await page.locator("#startWorkout").isHidden(),true);assert.equal(await page.locator("#differentWorkout").isHidden(),true);assert.equal(await page.locator("#workoutHistory").getAttribute("open"),null);await checkLayout(page,"resume-workout");
    let creates=0;page.on("request",request=>{if(new URL(request.url()).pathname==="/api/workouts"&&request.method()==="POST")creates++;});await page.click("#resumeWorkout");await page.locator("#sessionPanel").waitFor({state:"visible"});assert.equal(creates,0);assert.equal(await entry.locator('[data-actual="weight"]').inputValue(),"40");assert.equal(await entry.locator('[data-actual="reps"]').inputValue(),"8");
    await entry.locator('[data-complete="0"]').click();await page.waitForFunction(()=>globalThis.document.querySelector("#saveStatus").textContent==="Synced");await page.click("#finishWorkout");await page.locator("#finishDialog").waitFor({state:"visible"});await page.click('#finishDialog button[value="finish"]');await page.locator("#celebration").waitFor({state:"visible"});await page.locator("#progressionPanel").waitFor({state:"visible"});assert.equal(await page.locator("#checkInDifficulty").inputValue(),"");
    await openTrain(member,"#historySection");await page.waitForFunction(()=>globalThis.document.querySelector("#workoutHistory").open);assert.equal(await page.locator("#workoutHistory").evaluate(node=>node.open),true);assert.equal(await page.locator("#historyTitle").evaluate(node=>globalThis.document.activeElement===node),true);assert.equal(await page.locator("#historyStats").isVisible(),true);await page.locator(`#historyList [data-history="${active.id}"]`).click();await page.locator("#detailDialog").waitFor({state:"visible"});assert.match(await page.locator("#detailBody").textContent(),/40 kg/);await context.close();
  });
  await t.test("history failure is retryable and never presented as no history",async()=>{
    const member=await newMember("history-error"),{page,context}=member;await saveWeek(member,today());
    const fail=route=>route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Workout history is temporarily unavailable."})});await page.route("**/api/workouts?**",fail);await openTrain(member);await page.locator("#trainHistoryNotice").waitFor({state:"visible"});assert.equal(await page.locator("#startWorkout").isDisabled(),true);assert.doesNotMatch(await page.locator("#historyList").textContent(),/first completed workout/);await checkLayout(page,"history-unavailable");
    await page.unroute("**/api/workouts?**",fail);await page.click("#retryWorkoutHistory");await page.locator("#trainHistoryNotice").waitFor({state:"hidden"});await page.waitForFunction(()=>!globalThis.document.querySelector("#startWorkout").disabled);await context.close();
  });
  await t.test("inactive Strata+ access hides logging without offering an empty workout",async()=>{
    const member=await newMember("expired"),{page,context}=member;
    await page.route("**/api/me",async route=>{const response=await route.fetch(),data=await response.json();data.user.discovery.active=false;await route.fulfill({response,json:data});});
    await page.goto("/workout.html",{waitUntil:"domcontentloaded"});await page.locator("#accessPanel").waitFor({state:"visible"});assert.equal(await page.locator("#trainingRoom").isHidden(),true);assert.equal(await page.locator("#historySection").isHidden(),true);assert.match(await page.locator("#accessPanel").textContent(),/build and edit your weekly plan/);await checkLayout(page,"access-required");await context.close();
  });
  assert.deepEqual(pageErrors,[],`Unexpected browser errors: ${pageErrors.join("\n")}`);
});

test.before(async()=>{
  try{await startApp();const options={headless:true};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);browser=await chromium.launch(options);}
  catch(error){await cleanup();throw error;}
});
test.after(cleanup);
