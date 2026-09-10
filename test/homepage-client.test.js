"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const path=require("node:path");

const PROJECT_ROOT=path.join(__dirname,"..");
const RELEASE=require(path.join(PROJECT_ROOT,"package.json"));
const BUILD=RELEASE.strataBuild||RELEASE.version;
const html=fs.readFileSync(path.join(PROJECT_ROOT,"public","pages","index.html"),"utf8");
const appSource=fs.readFileSync(path.join(PROJECT_ROOT,"public","scripts","app.js"),"utf8");
const catalog=JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT,"public","data","exercises.json"),"utf8"));
const Discovery=require(path.join(PROJECT_ROOT,"public","scripts","discovery-core"));
const Preview=require(path.join(PROJECT_ROOT,"public","scripts","preview-core"));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);

class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
  contains(name){return this.values.has(name);}
}

class Element{
  constructor(id){
    this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.open=false;this.disabled=false;
    this.dataset={};this.attributes={};this.classList=new ClassList();this.listeners={};this.parentElement={classList:new ClassList()};
  }
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  focus(){}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(){return null;}
  querySelectorAll(){return [];}
  get options(){return [...this.innerHTML.matchAll(/<option value="([^"]+)"/g)].map(match=>({value:match[1]}));}
  getBoundingClientRect(){return{left:0,right:1000,top:0,bottom:1000};}
}

function jsonResponse(status,data){
  return{ok:status>=200&&status<300,status,json:async()=>data};
}

function deferred(){
  let resolve,reject;
  const promise=new Promise((onResolve,onReject)=>{resolve=onResolve;reject=onReject;});
  return{promise,resolve,reject};
}

function createRuntime({meResponse,guestPlan=null,serverUser=null,activation=false}={}){
  const elements=new Map(ids.map((id)=>[id,new Element(id)]));
  const starters=["dumbbells","bodyweight","barbell"].map(name=>{const button=new Element(name);button.dataset.previewStarter=name;return button;});
  const storage=new Map();
  const documentListeners={};
  const document={
    body:new Element("body"),
    getElementById(id){return elements.get(id)||null;},
    addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);},
    querySelectorAll(selector){return selector==="[data-preview-starter]"?starters:[];}
  };
  if(serverUser){
    elements.get("accountButton").textContent=`${serverUser.name} profile`;
    elements.get("accountButton").href="/account.html";
    elements.get("accountButton").classList.add("signed-in");
    elements.get("signupButton").hidden=true;
    elements.get("discoverButton").hidden=false;
    elements.get("discoverButton").href="/discover.html";
    elements.get("discoverButton").textContent="Strata+";
    elements.get("planCount").textContent=String(serverUser.planCount);
    elements.get("planButton").href="/planner.html";
    elements.get("planButton").setAttribute("aria-label",`Open weekly planner, ${serverUser.planCount} exercises`);
  }
  const context={
    console,document,location:{search:""},history:{replaceState(){}},requestAnimationFrame:(callback)=>callback(),setTimeout,clearTimeout,URLSearchParams,
    window:{location:{assign(){}},StrataDiscovery:Discovery,StrataPreview:Preview},
    localStorage:{getItem(key){return key==="strata_guest_plan_v1"&&guestPlan!==null?guestPlan:storage.get(key)??null;},setItem(key,value){storage.set(key,value);},removeItem(key){storage.delete(key);}},
    fetch:async(pathname)=>{
      if(pathname==="/api/me")return typeof meResponse==="function"?meResponse():meResponse;
      if(pathname===`/exercises.json?v=${BUILD}`)return jsonResponse(200,catalog);
      return jsonResponse(404,{error:"Not found."});
    }
  };
  context.globalThis=context;
  vm.createContext(context);
  if(activation){
    context.StrataDiscovery=Discovery;context.StrataPreview=Preview;
    context.StrataOnboarding=require("../public/scripts/onboarding-core");
    for(const script of ["activation-core.js","activation-home.js"])vm.runInContext(fs.readFileSync(path.join(PROJECT_ROOT,"public/scripts",script),"utf8"),context,{filename:script});
    context.window.StrataHomeActivation=context.StrataHomeActivation;
  }
  vm.runInContext(appSource,context,{filename:"app.js"});
  return{context,elements,starters};
}

async function settle(){
  await new Promise(setImmediate);
  await new Promise(setImmediate);
}

test("homepage preserves its server-rendered account header while account state is pending or unavailable",async()=>{
  const pending=deferred();
  const serverUser={name:"Saeed",planCount:4};
  const {context,elements}=createRuntime({meResponse:()=>pending.promise,serverUser});
  await settle();

  assert.equal(vm.runInContext("state.accountStatus",context),"loading");
  assert.equal(elements.get("accountButton").textContent,"Saeed profile");
  assert.equal(elements.get("signupButton").hidden,true);
  assert.equal(elements.get("planCount").textContent,"4");

  pending.reject(new TypeError("offline"));
  await settle();

  assert.equal(vm.runInContext("state.accountStatus",context),"unavailable");
  assert.equal(elements.get("accountButton").textContent,"Saeed profile");
  assert.equal(elements.get("signupButton").hidden,true);
  assert.equal(elements.get("discoverButton").textContent,"Strata+");
  assert.equal(elements.get("planCount").textContent,"4");
});

test("homepage treats a confirmed 401 as signed out and counts the saved guest plan",async()=>{
  const first=catalog[0].id,second=catalog[1].id,third=catalog[2].id;
  const guestPlan=JSON.stringify({days:{
    Monday:[{exerciseId:first},{exerciseId:second}],
    Tuesday:[{exerciseId:third},{exerciseId:"unknown-exercise"},null],
    Wednesday:"not-an-array"
  }});
  const {context,elements}=createRuntime({meResponse:jsonResponse(401,{error:"Not signed in."}),guestPlan,serverUser:{name:"Stale",planCount:9}});
  await settle();

  assert.equal(vm.runInContext("state.accountStatus",context),"anonymous");
  assert.equal(elements.get("accountButton").textContent,"Log in");
  assert.equal(elements.get("accountButton").href,"/account.html?mode=login");
  assert.equal(elements.get("signupButton").hidden,false);
  assert.equal(elements.get("discoverButton").hidden,true);
  assert.equal(elements.get("planCount").textContent,3);
  assert.equal(elements.get("planButton").getAttribute("aria-label"),"Open weekly planner, 3 exercises");
});

test("homepage comparison scroller is a labeled keyboard-focusable region",async()=>{
  const {context,elements}=createRuntime({meResponse:jsonResponse(401,{error:"Not signed in."})});
  await settle();
  vm.runInContext(`state.compare=[${JSON.stringify(catalog[0].id)},${JSON.stringify(catalog[1].id)}];openComparison();`,context);
  const comparison=elements.get("compareContent").innerHTML;
  assert.match(comparison,/<div class="compare-table-wrap" role="region" aria-label="[^"]+ comparison table" tabindex="0">/);
  assert.match(comparison,/<caption class="sr-only">Comparison of /);
});

test("homepage exercise details expose setup, cues, common mistakes and equipment-equivalent swaps",async()=>{
  const {context,elements}=createRuntime({meResponse:jsonResponse(401,{error:"Not signed in."})});
  await settle();
  vm.runInContext(`openDetail(${JSON.stringify(catalog[0].id)})`,context);
  const detail=elements.get("detailContent").innerHTML;
  assert.match(detail,/>Set up</);
  assert.match(detail,/>Technique cues</);
  assert.match(detail,/Caution \/ Common mistake:/);
  assert.match(detail,/General catalog range/);
  assert.match(detail,/Same target, different equipment/);
  assert.equal((detail.match(/data-detail=/g)||[]).length,3);
});

test("homepage creates a real no-account shortlist with reasons and trade-offs",async()=>{
  const {context,elements}=createRuntime({meResponse:jsonResponse(401,{error:"Not signed in."})});
  await settle();
  elements.get("quickPreviewGoal").value="hypertrophy";
  elements.get("quickPreviewGroup").value="chest";
  vm.runInContext("updatePreviewEquipmentOptions()",context);
  elements.get("quickPreviewEquipment").value="Dumbbells";
  elements.get("quickPreviewLevel").value="Intermediate";
  vm.runInContext("generateQuickPreview()",context);

  assert.match(elements.get("quickPreviewSummary").textContent,/Build muscle · Chest · Dumbbells · Intermediate/);
  assert.equal((elements.get("quickPreviewResults").innerHTML.match(/class="preview-result"/g)||[]).length,3);
  assert.match(elements.get("quickPreviewResults").innerHTML,/Why this moved up/);
  assert.match(elements.get("quickPreviewResults").innerHTML,/Trade-off:/);
  assert.match(elements.get("quickPreviewResults").innerHTML,/Personal match/);
  assert.match(elements.get("quickPreviewResults").innerHTML,/FitScore/);
  assert.equal(elements.get("quickPreviewActions").hidden,false);
  assert.match(elements.get("quickPreviewStatus").textContent,/Shortlist ready/);
});

test("homepage has one score ring and lets JavaScript create the equipment default once",()=>{
  assert.equal((html.match(/class="score-ring"/g)||[]).length,1);
  const equipmentSelect=html.match(/<select id="equipmentFilter">([\s\S]*?)<\/select>/);
  assert.ok(equipmentSelect,"equipment select");
  assert.doesNotMatch(equipmentSelect[1],/All equipment/);
  assert.equal((appSource.match(/<option value="all">All equipment<\/option>/g)||[]).length,1);
});

test("each starter builds and preserves a real three-day week using its stated equipment",async()=>{
  const {context,elements,starters}=createRuntime({meResponse:jsonResponse(401,{error:"Not signed in."}),activation:true});
  await settle();
  const equipment={dumbbells:"Dumbbells",bodyweight:"Bodyweight",barbell:"Barbell / Smith"};
  for(const button of starters){
    assert.equal(button.disabled,false);
    for(const handler of button.listeners.click)handler();
    const intent=context.StrataActivation.readIntent(context.localStorage);
    assert.ok(intent,`${button.id} must save a recoverable preview`);
    assert.equal(intent.profile.equipment[0],equipment[button.id]);
    const days=Object.values(intent.plan.days).filter(items=>items.length);
    assert.equal(days.length,3);
    for(const item of days.flat())assert.equal(catalog.find(exercise=>exercise.id===item.exerciseId).equipment,equipment[button.id]);
    assert.equal(elements.get("quickWeekPreview").hidden,false);
    assert.equal(elements.get("quickPreviewActions").hidden,false);
    assert.match(elements.get("quickPreviewSummary").textContent,/3-day week ready/);
  }
});
