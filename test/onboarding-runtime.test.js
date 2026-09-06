"use strict";

const test=require("node:test"),assert=require("node:assert/strict"),fs=require("node:fs"),vm=require("node:vm");
const {join}=require("node:path");
const ROOT=join(__dirname,".."),GUEST_KEY="strata_guest_plan_v1";
const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const emptyWeek=()=>({version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map(day=>[day,[]]))});
const previewWeek=emptyWeek();
previewWeek.days.Monday=[{instanceId:"preview-one",exerciseId:"bench-press",sets:3,reps:"8–12"}];

async function setup({guest=false,switchedAccount=false,saveStatus=200,accountFailure=false,noRandomUUID=false}={}){
  const html=fs.readFileSync(join(ROOT,"public/pages/onboarding.html"),"utf8");
  const elements=new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(match=>[match[1],{
    id:match[1],value:"",disabled:true,hidden:false,checked:false,textContent:"",innerHTML:"",listeners:{},options:[],
    addEventListener(type,listener){this.listeners[type]=listener;},focus(){},after(){},remove(){}
  }]));
  elements.get("goal").value="balanced";elements.get("level").value="Beginner";elements.get("minutes").value="35";
  const state={values:new Map(),failGuestWrite:false,requests:[],plan:emptyWeek()};
  const response=(status,data)=>({ok:status>=200&&status<300,status,json:async()=>data});
  const context={
    document:{getElementById:id=>elements.get(id)||null,querySelectorAll:()=>[],createElement:()=>({})},
    window:{StrataOnboarding:{DAYS,buildWeek:(_profile,_exercises,_discovery,makeId)=>{state.generatedId=makeId();return {plan:previewWeek,sessions:[]};}},StrataDiscovery:{}},
    localStorage:{getItem:key=>state.values.get(key)||null,setItem(key,value){
      if(key===GUEST_KEY&&state.failGuestWrite){state.failGuestWrite=false;throw new Error("Browser storage is temporarily unavailable.");}
      state.values.set(key,value);
    }},
    navigator:{onLine:true},crypto:noRandomUUID?{}:{randomUUID:()=>"preview-one"},Blob,URL,console,
    fetch:async(path,options={})=>{
      state.requests.push({path,options});
      if(path.startsWith("/exercises.json"))return response(200,[{id:"bench-press",equipment:"Barbell"}]);
      if(path==="/api/plan"&&options.method!=="PUT"){
        if(accountFailure)return response(503,{error:"Account storage unavailable"});
        return guest?response(401,{error:"Sign in required"}):response(200,{user:{id:"account-a"},csrfToken:"csrf-a",plan:state.plan,planUpdatedAt:100});
      }
      if(path==="/api/me")return guest?response(401,{error:"Sign in required"}):response(200,{user:{id:switchedAccount?"account-b":"account-a"},csrfToken:switchedAccount?"csrf-b":"csrf-a"});
      if(path==="/api/plan"&&options.method==="PUT"){
        if(saveStatus!==200)return response(saveStatus,{error:"Your week changed",code:"PLAN_CHANGED"});
        state.plan=JSON.parse(options.body).plan;
        return response(200,{ok:true,plan:state.plan,planUpdatedAt:101});
      }
      throw new Error(`Unexpected request ${path}`);
    }
  };
  vm.runInNewContext(fs.readFileSync(join(ROOT,"public/scripts/onboarding.js"),"utf8"),context,{filename:"onboarding.js"});
  for(let i=0;i<6;i++)await new Promise(resolve=>setImmediate(resolve));
  const generate=()=>elements.get("setupForm").listeners.submit({preventDefault(){}});
  const save=()=>elements.get("saveWeek").listeners.click();
  return {state,elements,generate,save};
}

test("onboarding guest save can retry after browser storage fails without inventing a tab conflict",async()=>{
  const fixture=await setup({guest:true});
  fixture.generate();fixture.state.failGuestWrite=true;
  await fixture.save();
  assert.equal(fixture.state.values.has(GUEST_KEY),false);
  assert.match(fixture.elements.get("setupStatus").textContent,/temporarily unavailable/);
  await fixture.save();
  assert.deepEqual(JSON.parse(fixture.state.values.get(GUEST_KEY)),previewWeek);
  assert.match(fixture.elements.get("setupStatus").textContent,/Saved in this browser/);
});

test("onboarding preserves guest changes made in another tab",async()=>{
  const fixture=await setup({guest:true});fixture.generate();
  const otherWeek={...emptyWeek(),restDay:"Saturday"};
  fixture.state.values.set(GUEST_KEY,JSON.stringify(otherWeek));
  await fixture.save();
  assert.deepEqual(JSON.parse(fixture.state.values.get(GUEST_KEY)),otherWeek);
  assert.match(fixture.elements.get("setupStatus").textContent,/changed in another tab/);
});

test("onboarding prevents an account A preview from being saved after switching to account B",async()=>{
  const fixture=await setup({switchedAccount:true});fixture.generate();await fixture.save();
  assert.equal(fixture.state.requests.filter(request=>request.options.method==="PUT").length,0);
  assert.match(fixture.elements.get("setupStatus").textContent,/account changed/);
});

test("onboarding sends the original account and revision and preserves its preview on conflict",async()=>{
  const fixture=await setup({saveStatus:409});fixture.generate();await fixture.save();
  const request=fixture.state.requests.find(item=>item.options.method==="PUT");
  assert.equal(request.options.headers["X-Strata-User"],"account-a");
  assert.equal(request.options.headers["X-CSRF-Token"],"csrf-a");
  assert.equal(JSON.parse(request.options.body).expectedPlanUpdatedAt,100);
  assert.deepEqual(fixture.state.plan,emptyWeek());
  assert.equal(fixture.elements.get("saveControls").hidden,false);
  assert.match(fixture.elements.get("setupStatus").textContent,/preview is safe here/);
});

test("onboarding does not silently enter guest mode when account storage fails",async()=>{
  const fixture=await setup({accountFailure:true});
  assert.equal(fixture.elements.get("setupFields").disabled,true);
  assert.equal(fixture.elements.get("offlineSetup").hidden,false);
  fixture.generate();await fixture.save();
  assert.equal(fixture.state.values.has(GUEST_KEY),false);
  assert.equal(fixture.state.requests.filter(request=>request.options.method==="PUT").length,0);
});

test("onboarding preview works where crypto.randomUUID is unavailable",async()=>{
  const fixture=await setup({guest:true,noRandomUUID:true});fixture.generate();
  assert.match(fixture.state.generatedId,/^setup-[a-zA-Z0-9_-]+$/);
  await fixture.save();assert.deepEqual(JSON.parse(fixture.state.values.get(GUEST_KEY)),previewWeek);
});
