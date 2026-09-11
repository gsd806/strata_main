"use strict";

const test=require("node:test"),assert=require("node:assert/strict");
const {spawn}=require("node:child_process"),{mkdirSync,mkdtempSync,rmSync}=require("node:fs"),{join}=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const ROOT=join(__dirname,"..");let server,directory,base;

async function launch(){
  mkdirSync(join(ROOT,"test-runtime"),{recursive:true});directory=mkdtempSync(join(ROOT,"test-runtime","coaching-http-"));
  server=spawn(process.execPath,["server.js"],{cwd:ROOT,env:{...process.env,HOST:"127.0.0.1",PORT:"0",NODE_ENV:"test",ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",STRATA_DATA_DIR:directory,TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",EMAIL_VERIFICATION_ENABLED:"false",PADDLE_CHECKOUT_ENABLED:"false",PADDLE_CLIENT_TOKEN:"",PADDLE_API_KEY:"",PADDLE_WEBHOOK_SECRET:"",PADDLE_PRICE_ID:"",PADDLE_PRODUCT_ID:""},stdio:["ignore","pipe","pipe"]});
  base=await new Promise((resolve,reject)=>{let output="",errors="";const timer=setTimeout(()=>reject(new Error(`Coaching server startup timed out: ${errors}`)),6000);server.stdout.on("data",(chunk)=>{output=(output+chunk).slice(-4096);const match=output.match(/Strata running at http:\/\/127\.0\.0\.1:(\d+)/);if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}});server.stderr.on("data",(chunk)=>{errors=(errors+chunk).slice(-4096);});server.once("error",reject);server.once("exit",(code)=>reject(new Error(`Coaching server exited ${code}: ${errors}`)));});
}
async function stop(){if(server&&server.exitCode===null)await new Promise((resolve)=>{const timer=setTimeout(()=>server.kill("SIGKILL"),2000);server.once("exit",()=>{clearTimeout(timer);resolve();});server.kill("SIGTERM");});if(directory)rmSync(directory,{recursive:true,force:true});}
async function request(path,account=null,method="GET",body,headers={}){const response=await fetch(`${base}${path}`,{method,headers:{Origin:base,"Content-Type":"application/json",...(account?{Cookie:account.cookie,"X-CSRF-Token":account.csrf}:{}),...headers},...(body===undefined?{}:{body:typeof body==="string"?body:JSON.stringify(body)})});return {status:response.status,data:await response.json(),cookie:response.headers.get("set-cookie")?.split(";")[0]||""};}
async function account(suffix,{plus=true}={}){const signup=await request("/api/signup",null,"POST",{name:`Coach ${suffix}`,email:`coach-${suffix}@example.test`,password:"strong-coaching-password-123"});assert.equal(signup.status,201);const me=await request("/api/me",{cookie:signup.cookie,csrf:""});const result={cookie:signup.cookie,csrf:me.data.csrfToken,id:me.data.user.id};if(plus)assert.ok([200,201].includes((await request("/api/discovery/trial",result,"POST",{})).status));return result;}
function profile(overrides={}){return {version:1,measurementSystem:"metric",preferredLoadUnit:"kg",age:30,heightCm:180,weightKg:80,bodyFatPercent:null,sexForEquation:"male",goal:"maintenance",goalPace:"moderate",experience:"intermediate",lifestyleActivity:"moderately_active",workoutDays:["Monday","Wednesday","Friday"],sessionMinutes:60,usualExercises:[{exerciseId:"flat-dumbbell-press",maxSets:4,maxReps:10,maxWeightKg:30}],availableEquipment:[],movementLimitations:[],caloriePattern:"zigzag",flexibleDay:null,macroPreference:"balanced",timeZone:"Asia/Dubai",...overrides};}

test.before(launch);test.after(stop);

test("every coaching endpoint fails closed without an authenticated active Strata+ entitlement",async()=>{
  for(const path of ["/api/coaching/profile","/api/coaching/week","/api/coaching/logs/2026-09-07"]){assert.equal((await request(path)).status,401,path);}
  const free=await account("free",{plus:false});
  for(const [path,method,body] of [["/api/coaching/profile","GET"],["/api/coaching/profile","PUT",{profile:profile(),expectedRevision:0}],["/api/coaching/week","GET"],["/api/coaching/logs/2026-09-07","GET"],["/api/coaching/logs/2026-09-07","PUT",{log:{calories:2000},expectedRevision:0}]]){
    const result=await request(path,free,method,body);assert.equal(result.status,402,path);assert.equal(result.data.code,"DISCOVERY_ACCESS_REQUIRED");
  }
});

test("profile and weekly snapshot routes enforce mutation boundaries and optimistic revisions",async()=>{
  const member=await account("profile");
  assert.deepEqual((await request("/api/coaching/profile",member)).data.profile,null);
  assert.equal((await request("/api/coaching/week",member)).data.code,"COACHING_PROFILE_REQUIRED");
  assert.equal((await request("/api/coaching/profile",member,"PUT",{profile:profile(),expectedRevision:0},{"X-CSRF-Token":"wrong"})).status,403);
  const wrongType=await request("/api/coaching/profile",member,"PUT",JSON.stringify({profile:profile(),expectedRevision:0}),{"Content-Type":"text/plain"});assert.equal(wrongType.status,415);assert.equal(wrongType.data.code,"JSON_REQUIRED");
  const wrongAccount=await request("/api/coaching/profile",member,"PUT",{profile:profile(),expectedRevision:0,expectedUserId:"someone-else"});assert.equal(wrongAccount.status,409);assert.equal(wrongAccount.data.code,"COACHING_ACCOUNT_CHANGED");
  const saved=await request("/api/coaching/profile",member,"PUT",{profile:profile(),expectedRevision:0,expectedUserId:member.id});
  assert.equal(saved.status,200);assert.equal(saved.data.profile.revision,1);assert.equal(saved.data.profile.sessionsPerWeek,3);assert.equal(saved.data.week.profileRevision,1);assert.equal(saved.data.week.training.sessions.length,3);assert.equal(saved.data.week.nutrition.dailyTargets.length,7);assert.equal(saved.data.logs.length,0);
  const week=await request("/api/coaching/week",member);assert.equal(week.status,200);assert.equal(week.data.week.planKey,saved.data.week.planKey);assert.equal(week.data.week.generatedAt,saved.data.week.generatedAt,"same-week reads reuse the persisted snapshot");
  const stale=await request("/api/coaching/profile",member,"PUT",{profile:profile({weightKg:81}),expectedRevision:0});assert.equal(stale.status,409);assert.equal(stale.data.code,"COACHING_PROFILE_CHANGED");assert.equal(stale.data.profile.weightKg,80);
  const invalid=await request("/api/coaching/profile",member,"PUT",{profile:{...profile(),userId:"untrusted"},expectedRevision:1});assert.equal(invalid.status,400);assert.match(invalid.data.error,/unsupported fields/);
  const updated=await request("/api/coaching/profile",member,"PUT",{profile:profile({weightKg:81}),expectedRevision:1});assert.equal(updated.status,200);assert.equal(updated.data.profile.revision,2);assert.equal(updated.data.week.profileRevision,2);assert.notEqual(updated.data.week.planKey,saved.data.week.planKey);
  assert.equal((await request("/api/coaching/profile",member,"DELETE",{})).status,405);
});

test("daily calorie and optional macro logs are current-week, account-scoped, and conflict safe",async()=>{
  const owner=await account("logs"),other=await account("logs-other");
  const setup=await request("/api/coaching/profile",owner,"PUT",{profile:profile({caloriePattern:"flexible_day",flexibleDay:"Saturday"}),expectedRevision:0});assert.equal(setup.status,200);
  const date=setup.data.week.weekStart,target=setup.data.week.nutrition.dailyTargets.find((day)=>day.date===date).calories;
  assert.equal((await request(`/api/coaching/logs/${date}`,owner)).data.log,null);
  const partial=await request(`/api/coaching/logs/${date}`,owner,"PUT",{log:{calories:2000,proteinG:150},expectedRevision:0});assert.equal(partial.status,400);assert.equal(partial.data.code,"INVALID_COACHING_LOG");
  const wrongDate=setup.data.week.nextWeekStart;const outside=await request(`/api/coaching/logs/${wrongDate}`,owner,"PUT",{log:{calories:2000},expectedRevision:0});assert.equal(outside.status,400);assert.equal(outside.data.code,"COACHING_LOG_OUTSIDE_CURRENT_WEEK");
  const saved=await request(`/api/coaching/logs/${date}`,owner,"PUT",{log:{calories:target-100,proteinG:150,carbsG:220,fatG:70},expectedRevision:0,expectedUserId:owner.id});
  assert.equal(saved.status,200);assert.equal(saved.data.log.revision,1);assert.equal(saved.data.log.remainingCalories,100);assert.equal(saved.data.log.overCalories,0);
  const stale=await request(`/api/coaching/logs/${date}`,owner,"PUT",{log:{calories:9999},expectedRevision:0});assert.equal(stale.status,409);assert.equal(stale.data.code,"COACHING_LOG_CHANGED");assert.equal(stale.data.log.calories,target-100);
  const over=await request(`/api/coaching/logs/${date}`,owner,"PUT",{log:{calories:target+50},expectedRevision:1});assert.equal(over.status,200);assert.equal(over.data.log.remainingCalories,0);assert.equal(over.data.log.overCalories,50);
  const macrosOff=await request("/api/coaching/profile",owner,"PUT",{profile:profile({caloriePattern:"flexible_day",flexibleDay:"Saturday",macroPreference:null}),expectedRevision:1});assert.equal(macrosOff.status,200);
  const calorieOnly=await request(`/api/coaching/logs/${date}`,owner,"PUT",{log:{calories:target,proteinG:175,carbsG:240,fatG:65},expectedRevision:2});assert.equal(calorieOnly.status,200);assert.deepEqual([calorieOnly.data.log.proteinG,calorieOnly.data.log.carbsG,calorieOnly.data.log.fatG],[null,null,null]);
  const week=await request("/api/coaching/week",owner);assert.equal(week.data.logs.length,1);assert.equal(week.data.logs[0].revision,3);
  assert.deepEqual((await request("/api/coaching/profile",other)).data.profile,null);assert.equal((await request(`/api/coaching/logs/${date}`,other)).data.code,"COACHING_PROFILE_REQUIRED");
});

test("expired Strata+ access denies existing coaching data without mutating it",async()=>{
  const member=await account("expired"),setup=await request("/api/coaching/profile",member,"PUT",{profile:profile(),expectedRevision:0}),date=setup.data.week.weekStart;
  assert.equal((await request(`/api/coaching/logs/${date}`,member,"PUT",{log:{calories:2000},expectedRevision:0})).status,200);
  const database=new DatabaseSync(join(directory,"strata.sqlite"));
  const before={profile:database.prepare("SELECT profile_json,revision FROM coaching_profiles WHERE user_id=?").get(member.id),log:database.prepare("SELECT calories,revision FROM coaching_daily_logs WHERE user_id=? AND log_date=?").get(member.id,date)};
  database.prepare("UPDATE discovery_trials SET expires_at=? WHERE user_id=?").run(Date.now()-1,member.id);database.close();
  const attempts=[
    ["/api/coaching/profile","GET"],
    ["/api/coaching/profile","PUT",{profile:profile({weightKg:99}),expectedRevision:1}],
    ["/api/coaching/week","GET"],
    [`/api/coaching/logs/${date}`,"GET"],
    [`/api/coaching/logs/${date}`,"PUT",{log:{calories:9999},expectedRevision:1}]
  ];
  for(const [path,method,body] of attempts){const response=await request(path,member,method,body);assert.equal(response.status,402,path);assert.equal(response.data.code,"DISCOVERY_ACCESS_REQUIRED");}
  const check=new DatabaseSync(join(directory,"strata.sqlite"),{readOnly:true}),after={profile:check.prepare("SELECT profile_json,revision FROM coaching_profiles WHERE user_id=?").get(member.id),log:check.prepare("SELECT calories,revision FROM coaching_daily_logs WHERE user_id=? AND log_date=?").get(member.id,date)};check.close();assert.deepEqual(after,before);
});

test("same-date logs remain isolated and reject a client-supplied different account",async()=>{
  const first=await account("isolation-a"),second=await account("isolation-b"),firstSetup=await request("/api/coaching/profile",first,"PUT",{profile:profile(),expectedRevision:0}),secondSetup=await request("/api/coaching/profile",second,"PUT",{profile:profile(),expectedRevision:0});
  const date=firstSetup.data.week.weekStart;assert.equal(secondSetup.data.week.weekStart,date);
  const mismatch=await request(`/api/coaching/logs/${date}`,first,"PUT",{log:{calories:1999},expectedRevision:0,expectedUserId:second.id});assert.equal(mismatch.status,409);assert.equal(mismatch.data.code,"COACHING_ACCOUNT_CHANGED");
  assert.equal((await request(`/api/coaching/logs/${date}`,first,"PUT",{log:{calories:1800},expectedRevision:0})).status,200);
  assert.equal((await request(`/api/coaching/logs/${date}`,second,"PUT",{log:{calories:2600},expectedRevision:0})).status,200);
  assert.equal((await request(`/api/coaching/logs/${date}`,first)).data.log.calories,1800);assert.equal((await request(`/api/coaching/logs/${date}`,second)).data.log.calories,2600);
});

test("profile and log compare-and-swap races have exactly one winner",async()=>{
  const member=await account("cas"),created=await request("/api/coaching/profile",member,"PUT",{profile:profile(),expectedRevision:0});assert.equal(created.status,200);
  const profileRace=await Promise.all([81,82].map((weightKg)=>request("/api/coaching/profile",member,"PUT",{profile:profile({weightKg}),expectedRevision:1})));
  assert.deepEqual(profileRace.map((item)=>item.status).sort(),[200,409]);const current=await request("/api/coaching/profile",member);assert.equal(current.data.profile.revision,2);assert.ok([81,82].includes(current.data.profile.weightKg));
  const date=(await request("/api/coaching/week",member)).data.week.weekStart,logRace=await Promise.all([1900,2100].map((calories)=>request(`/api/coaching/logs/${date}`,member,"PUT",{log:{calories},expectedRevision:0})));
  assert.deepEqual(logRace.map((item)=>item.status).sort(),[200,409]);const log=await request(`/api/coaching/logs/${date}`,member);assert.equal(log.data.log.revision,1);assert.ok([1900,2100].includes(log.data.log.calories));
});
