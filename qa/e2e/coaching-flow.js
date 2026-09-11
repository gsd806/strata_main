"use strict";

const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {mkdtempSync,rmSync}=require("node:fs");
const http=require("node:http");
const {tmpdir}=require("node:os");
const {join,resolve}=require("node:path");
const test=require("node:test");
const {chromium}=require("playwright");

const ROOT=join(__dirname,"..","..");
const WAIT_MS=10_000;
const PASSWORD="coaching-browser-password-123";
let app,browser,baseUrl,runtimeDir,serverLogs="";

async function unusedPort(){
  const probe=http.createServer();
  await new Promise((done,reject)=>{probe.once("error",reject);probe.listen(0,"127.0.0.1",done);});
  const port=probe.address().port;
  await new Promise((done,reject)=>probe.close((error)=>error?reject(error):done()));
  return port;
}

async function startApp(){
  const port=await unusedPort();baseUrl=`http://127.0.0.1:${port}`;runtimeDir=mkdtempSync(join(tmpdir(),"strata-coaching-e2e-"));
  app=spawn(process.execPath,["server.js"],{
    cwd:ROOT,
    env:{...process.env,HOST:"127.0.0.1",PORT:String(port),NODE_ENV:"test",TZ:"UTC",TRUST_PROXY:"true",SECURE_COOKIES:"false",ADMIN_EMAIL:"",TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",STRATA_DATA_DIR:runtimeDir,ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",EMAIL_VERIFICATION_ENABLED:"false",PADDLE_CHECKOUT_ENABLED:"false",PADDLE_CLIENT_TOKEN:"",PADDLE_API_KEY:"",PADDLE_WEBHOOK_SECRET:"",PADDLE_PRICE_ID:"",PADDLE_PRODUCT_ID:"",APP_BASE_URL:baseUrl},
    stdio:["ignore","pipe","pipe"]
  });
  for(const stream of [app.stdout,app.stderr])stream.on("data",(chunk)=>{serverLogs=(serverLogs+chunk.toString()).slice(-16_384);});
  const deadline=Date.now()+WAIT_MS;
  while(Date.now()<deadline){
    if(app.exitCode!==null)throw new Error(`Coaching E2E server exited during startup.\n${serverLogs}`);
    try{if((await fetch(`${baseUrl}/healthz`)).ok)return;}catch{}
    await new Promise((done)=>setTimeout(done,50));
  }
  throw new Error(`Coaching E2E server did not become healthy.\n${serverLogs}`);
}

async function stopApp(){
  if(!app||app.exitCode!==null||app.signalCode!==null)return;
  await new Promise((done)=>{
    let settled=false,forceTimer;
    const finish=()=>{if(settled)return;settled=true;clearTimeout(forceTimer);done();};
    app.once("exit",finish);app.kill("SIGTERM");forceTimer=setTimeout(()=>{try{app.kill("SIGKILL");}catch{}finish();},2_000);
  });
}

async function cleanup(){
  try{await browser?.close();}
  finally{await stopApp();if(runtimeDir)rmSync(runtimeDir,{recursive:true,force:true});}
}

async function signup(context,label){
  const response=await context.request.post("/api/signup",{headers:{Origin:baseUrl},data:{name:`Coaching ${label}`,email:`coaching-${label}@example.test`,password:PASSWORD}});
  assert.equal(response.status(),201,await response.text());
  return (await response.json()).user;
}

async function activatePlus(context){
  const plan=await context.request.get("/api/plan");assert.equal(plan.status(),200,await plan.text());
  const {csrfToken}=await plan.json(),response=await context.request.post("/api/discovery/trial",{headers:{Origin:baseUrl,"X-CSRF-Token":csrfToken},data:{}});
  assert.ok([200,201].includes(response.status()),await response.text());
}

function calorieNumber(text){return Number(String(text||"").replace(/[^0-9]/g,""));}

test("a Strata+ member builds, tracks, reloads, and safely refreshes a coaching week",{timeout:60_000},async()=>{
  const context=await browser.newContext({baseURL:baseUrl,serviceWorkers:"block",timezoneId:"UTC",viewport:{width:1280,height:900},extraHTTPHeaders:{"X-Forwarded-For":"198.51.100.241"}});
  context.setDefaultTimeout(WAIT_MS);
  const page=await context.newPage(),pageErrors=[];page.on("pageerror",(error)=>pageErrors.push(error.message));
  try{
    const user=await signup(context,"owner");await activatePlus(context);
    await page.goto("/discover.html",{waitUntil:"domcontentloaded"});
    await page.waitForFunction(()=>globalThis.document.querySelector("#userName")?.textContent==="Coaching owner");
    const destinations=page.locator(".destination-nav .destination-link");
    assert.equal(await destinations.count(),5);assert.match((await destinations.nth(4).textContent())||"",/Personal training/i);
    await destinations.nth(4).click();await page.locator("#coachingSetup").waitFor({state:"visible"});

    await page.fill("#coachingAge","31");await page.fill("#coachingHeight","178");await page.fill("#coachingWeight","82");await page.fill("#coachingBodyFat","18.5");
    await page.selectOption("#coachingDailyActivity","moderate");await page.selectOption("#coachingGoal","deficit");await page.selectOption("#coachingGoalPace","gentle");await page.selectOption("#coachingExperience","intermediate");await page.fill("#coachingFrequency","3");await page.locator("#coachingFrequency").dispatchEvent("change");await page.selectOption("#coachingDuration","60");
    assert.deepEqual(await page.locator('input[name="trainingDays"]:checked').evaluateAll((nodes)=>nodes.map((node)=>node.value)),["Monday","Wednesday","Friday"]);
    await page.click("#coachingAddCapability");const capability=page.locator("#coachingCapabilityRows .coaching-capability-row").first();
    await capability.locator("[data-capability-exercise]").fill("Flat Dumbbell Press");await capability.locator("[data-capability-sets]").fill("4");await capability.locator("[data-capability-reps]").fill("10");await capability.locator("[data-capability-weight]").fill("32");await capability.locator("[data-capability-unit]").selectOption("kg");
    await page.check('input[name="caloriePattern"][value="training_day"]');await page.check("#coachingMacrosEnabled");

    const profileResponsePromise=page.waitForResponse((response)=>new URL(response.url()).pathname==="/api/coaching/profile"&&response.request().method()==="PUT");
    await page.click("#coachingGenerate");const profileResponse=await profileResponsePromise;assert.equal(profileResponse.status(),200,await profileResponse.text());
    const profileRequest=profileResponse.request(),profileBody=profileRequest.postDataJSON(),profileResult=await profileResponse.json();
    assert.ok(profileRequest.headers()["x-csrf-token"]);assert.equal(profileBody.expectedUserId,user.id);assert.equal(profileBody.expectedRevision,0);
    assert.deepEqual({measurementSystem:profileBody.profile.measurementSystem,preferredLoadUnit:profileBody.profile.preferredLoadUnit,age:profileBody.profile.age,heightCm:profileBody.profile.heightCm,weightKg:profileBody.profile.weightKg,bodyFatPercent:profileBody.profile.bodyFatPercent,sexForEquation:profileBody.profile.sexForEquation,goal:profileBody.profile.goal,goalPace:profileBody.profile.goalPace,experience:profileBody.profile.experience,lifestyleActivity:profileBody.profile.lifestyleActivity,workoutDays:profileBody.profile.workoutDays,sessionMinutes:profileBody.profile.sessionMinutes,caloriePattern:profileBody.profile.caloriePattern,macroPreference:profileBody.profile.macroPreference},{measurementSystem:"metric",preferredLoadUnit:"kg",age:31,heightCm:178,weightKg:82,bodyFatPercent:18.5,sexForEquation:null,goal:"fat_loss",goalPace:"gentle",experience:"intermediate",lifestyleActivity:"moderately_active",workoutDays:["Monday","Wednesday","Friday"],sessionMinutes:60,caloriePattern:"zigzag",macroPreference:"balanced"});
    assert.deepEqual(profileBody.profile.usualExercises,[{exerciseId:"flat-dumbbell-press",maxSets:4,maxReps:10,maxWeightKg:32}]);assert.ok(profileBody.profile.availableEquipment.includes("Dumbbells"));assert.equal(profileResult.profile.revision,1);

    await page.locator("#coachingDashboard").waitFor({state:"visible"});assert.equal(await page.locator("#coachingDashboardTitle").evaluate((node)=>node===globalThis.document.activeElement),true,"successful generation should focus the visible dashboard heading");
    assert.equal(await page.locator("#coachingWeekGrid .coaching-day-card").count(),7);assert.equal(await page.locator("#coachingWeekGrid .coaching-day-card.is-training").count(),3);assert.match((await page.locator("#coachingWeekGrid").textContent())||"",/Flat Dumbbell Press/);
    assert.equal(await page.locator("#coachingCalorieWeek .coaching-calorie-card").count(),7);const renderedCalories=await page.locator("#coachingCalorieWeek .coaching-calorie-card > strong").allTextContents();assert.ok(new Set(renderedCalories.map(calorieNumber)).size>1,"zigzag targets must visibly vary by day");
    const goalOptions=page.locator("#coachingGoalComparison .coaching-goal-option");assert.equal(await goalOptions.count(),3);const goalText=(await goalOptions.allTextContents()).join(" ");assert.match(goalText,/Deficit/i);assert.match(goalText,/Maintain/i);assert.match(goalText,/Build/i);assert.equal(await page.locator("#coachingGoalComparison .coaching-goal-option.is-selected").count(),1);
    assert.match((await page.locator("#coachingMethodList").textContent())||"",/Katch–McArdle/i);assert.ok(await page.locator("#coachingProjectionChart svg[role=img]").count()===1);assert.match((await page.locator("#coachingProjectionNote").textContent())||"",/not promised outcomes/i);

    const date=await page.locator("#coachingLogDate").inputValue(),target=profileResult.week.nutrition.dailyTargets.find((entry)=>entry.date===date).calories;
    await page.fill("#coachingCaloriesEaten","1800");await page.fill("#coachingProteinEaten","150");await page.fill("#coachingCarbsEaten","200");await page.fill("#coachingFatEaten","60");
    const logResponsePromise=page.waitForResponse((response)=>new URL(response.url()).pathname===`/api/coaching/logs/${date}`&&response.request().method()==="PUT");await page.click("#coachingSaveLog");const logResponse=await logResponsePromise;assert.equal(logResponse.status(),200,await logResponse.text());
    const logBody=logResponse.request().postDataJSON(),savedLog=await logResponse.json();assert.ok(logResponse.request().headers()["x-csrf-token"]);assert.equal(logBody.expectedUserId,user.id);assert.equal(logBody.expectedRevision,0);assert.deepEqual(logBody.log,{calories:1800,proteinG:150,carbsG:200,fatG:60});assert.equal(savedLog.log.remainingCalories,Math.max(0,target-1800));

    await page.reload({waitUntil:"domcontentloaded"});await page.locator("#coachingDashboard").waitFor({state:"visible"});assert.equal(await page.locator("#coachingCaloriesEaten").inputValue(),"1800");assert.equal(await page.locator("#coachingProteinEaten").inputValue(),"150");assert.match((await page.locator("#coachingProgressSummary").textContent())||"",/1,800 kcal/);
    await destinations.nth(2).click();await page.locator("#progressCalorieCard").waitFor({state:"visible"});assert.equal(await page.locator("#progressCoachingCaloriesEaten").inputValue(),"1800");assert.equal(await page.locator("#progressCoachingProteinEaten").inputValue(),"150");assert.match((await page.locator("#progressCalorieTitle").textContent())||"",/LOG [A-Z]+’S TOTAL/);assert.equal(await page.locator(".progress-calorie-form label > span").first().evaluate((node)=>globalThis.getComputedStyle(node).color),"rgb(16, 17, 15)");
    await page.fill("#progressCoachingCaloriesEaten","1825");await page.fill("#progressCoachingProteinEaten","151");await page.fill("#progressCoachingCarbsEaten","201");await page.fill("#progressCoachingFatEaten","61");const progressSavePromise=page.waitForResponse((response)=>new URL(response.url()).pathname===`/api/coaching/logs/${date}`&&response.request().method()==="PUT");await page.click("#progressCoachingSaveLog");const progressSave=await progressSavePromise;assert.equal(progressSave.status(),200,await progressSave.text());assert.equal(progressSave.request().postDataJSON().expectedRevision,1);assert.equal((await progressSave.json()).log.revision,2);assert.match((await page.locator("#progressCoachingSummary").textContent())||"",/1,825 kcal/);await destinations.nth(4).click();await page.locator("#coachingDashboard").waitFor({state:"visible"});

    const snapshotResponse=await context.request.get("/api/coaching/week");assert.equal(snapshotResponse.status(),200);const snapshot=await snapshotResponse.json();
    const external=await context.request.put(`/api/coaching/logs/${date}`,{headers:{Origin:baseUrl,"X-CSRF-Token":snapshot.csrfToken},data:{log:{calories:1900,proteinG:155,carbsG:210,fatG:65},expectedRevision:2,expectedUserId:user.id}});assert.equal(external.status(),200,await external.text());
    await page.fill("#coachingCaloriesEaten","1850");await page.fill("#coachingProteinEaten","152");await page.fill("#coachingCarbsEaten","205");await page.fill("#coachingFatEaten","62");
    const conflictPromise=page.waitForResponse((response)=>new URL(response.url()).pathname===`/api/coaching/logs/${date}`&&response.request().method()==="PUT");await page.click("#coachingSaveLog");const conflict=await conflictPromise;assert.equal(conflict.status(),409);await page.waitForFunction(()=>/latest revision is loaded/i.test(globalThis.document.querySelector("#coachingLogStatus")?.textContent||""));assert.equal(await page.locator("#coachingCaloriesEaten").inputValue(),"1850","the reviewed local entry should remain on screen while its revision advances");
    const recoveredPromise=page.waitForResponse((response)=>new URL(response.url()).pathname===`/api/coaching/logs/${date}`&&response.request().method()==="PUT"&&response.status()===200);await page.click("#coachingSaveLog");const recovered=await recoveredPromise;assert.equal(recovered.request().postDataJSON().expectedRevision,3);assert.equal((await recovered.json()).log.revision,4);

    await page.click("#coachingEditProfile");await page.uncheck("#coachingMacrosEnabled");const macrosOffPromise=page.waitForResponse((response)=>new URL(response.url()).pathname==="/api/coaching/profile"&&response.request().method()==="PUT");await page.click("#coachingGenerate");const macrosOff=await macrosOffPromise;assert.equal(macrosOff.status(),200,await macrosOff.text());await page.locator("#coachingDashboard").waitFor({state:"visible"});assert.equal(await page.locator(".coaching-macro-log").first().isHidden(),true);assert.equal(await page.locator("#coachingProteinEaten").inputValue(),"");
    await page.fill("#coachingCaloriesEaten","1875");const calorieOnlyPromise=page.waitForResponse((response)=>new URL(response.url()).pathname===`/api/coaching/logs/${date}`&&response.request().method()==="PUT");await page.click("#coachingSaveLog");const calorieOnly=await calorieOnlyPromise;assert.equal(calorieOnly.status(),200,await calorieOnly.text());assert.deepEqual(calorieOnly.request().postDataJSON().log,{calories:1875,proteinG:null,carbsG:null,fatG:null});

    let releaseDiscovery,finishDiscovery;const discoveryGate=new Promise((resolveGate)=>{releaseDiscovery=resolveGate;}),discoveryHandled=new Promise((resolveHandled)=>{finishDiscovery=resolveHandled;});
    await page.route("**/api/discovery",async(route)=>{await discoveryGate;try{await route.continue();}finally{finishDiscovery();}});await signup(context,"replacement");
    await page.evaluate(()=>globalThis.dispatchEvent(new Event("focus")));await page.waitForFunction(()=>globalThis.document.querySelector("#userName")?.textContent==="Checking account…");
    const purged=await page.evaluate(()=>({height:globalThis.document.querySelector("#coachingHeight")?.value,weight:globalThis.document.querySelector("#coachingWeight")?.value,capabilities:globalThis.document.querySelector("#coachingCapabilityRows")?.textContent,week:globalThis.document.querySelector("#coachingWeekGrid")?.textContent,calories:globalThis.document.querySelector("#coachingCaloriesEaten")?.value,projection:globalThis.document.querySelector("#coachingProjectionChart")?.textContent,mainHidden:globalThis.document.querySelector("main")?.hidden}));
    assert.deepEqual(purged,{height:"",weight:"",capabilities:"",week:"",calories:"",projection:"",mainHidden:true},"account revalidation must purge prior health and intake data before loading the next account");releaseDiscovery();await discoveryHandled;
    await page.unroute("**/api/discovery");assert.deepEqual(pageErrors,[],`Unexpected browser errors:\n${pageErrors.join("\n")}`);
  }finally{await context.close();}
});

test.before(async()=>{
  try{await startApp();const options={headless:true};if(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH)options.executablePath=resolve(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH);browser=await chromium.launch(options);}
  catch(error){await cleanup();throw error;}
});
test.after(cleanup);
