"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const readPrivateData=(name)=>fs.readFileSync(join(PROJECT_ROOT,"src","data",name),"utf8");
const exercises=JSON.parse(readPublic("data","exercises.json"));
const discovery=JSON.parse(readPrivateData("discovery-data.json"));

const html=readPublic("pages","discover.html");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
  contains(name){return this.values.has(name);}
}
class Element{
  constructor(id){this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.open=false;this.disabled=false;this.dataset={};this.attributes={};this.classList=new ClassList();this.parentElement={classList:new ClassList()};this.listeners={};this.queryResults=new Map();}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  async emit(type,event={}){for(const handler of this.listeners[type]||[])await handler(event);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  showModal(){this.open=true;}
  close(){this.open=false;}
  focus(){}
  scrollIntoView(){}
  append(){}
  querySelector(selector){return this.queryResults.get(selector)||new Element("child");}
  querySelectorAll(){return [];}
  closest(){return null;}
  get selectedOptions(){const labels={hypertrophy:"Hypertrophy selection",strength:"Strength skill",balanced:"Balanced","time-efficient":"Time-efficient setup"};return [{textContent:labels[this.value]||this.value}];}
}
const elements=new Map(ids.map((id)=>[id,new Element(id)]));
const document={
  body:new Element("body"),
  getElementById(id){return elements.get(id)||null;},
  querySelector(){return null;},
  querySelectorAll(selector){if(selector==="dialog")return [elements.get("detailDialog"),elements.get("communityApplyDialog")];return [];},
  addEventListener(){},
  createElement(){return new Element("created");}
};
const weeklyPlan={version:1,restDay:"Sunday",days:Object.fromEntries(["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"].map((day)=>[day,day==="Monday"?[{instanceId:"runtime-plan-item",exerciseId:"flat-dumbbell-press",sets:3,reps:"8–12"}]:[]]))};
const response={user:{id:"u1",name:"Runtime Audit",email:"audit@example.test"},csrfToken:"csrf",exercises,methodology:discovery.methodology,sources:discovery.sources,limitedConfidenceExercises:discovery.limitedConfidenceExercises,preferences:{version:1,goal:"hypertrophy",level:"Intermediate",days:4,equipment:[...new Set(exercises.map((exercise)=>exercise.equipment))],preferences:["stable","long-range"],limitations:[]},ratings:{aggregates:[],user:[]},weeklyPlan,weeklyPlanUpdatedAt:1_700_000_000_100};
const communityPlan={id:"11111111-1111-4111-8111-111111111111",title:"Runtime <Week>",description:"A shared smoke-test plan.",authorName:"Other Member",plan:weeklyPlan,createdAt:1_700_000_000_000,updatedAt:1_700_000_000_000};
const fetches=[],requests=[];let discoveryAttempts=0,planSaveRevision=1_700_000_000_300;
const context={console,document,window:{location:{replace(){}}},location:{},navigator:{},requests,fetch:async(path,options={})=>{
  fetches.push(path);requests.push({path,options});
  if(path==="/api/discovery"&&++discoveryAttempts===1)throw new TypeError("Failed to fetch");
  if(String(path).startsWith("/api/community-plans?"))return {ok:true,json:async()=>({plans:[communityPlan],pagination:{limit:12,offset:0,nextOffset:null}})};
  if(String(path).endsWith("/apply"))return {ok:true,json:async()=>({ok:true,plan:weeklyPlan,planUpdatedAt:1_700_000_000_200})};
  if(path==="/api/plan"&&options.method==="PUT"){
    if(context.forcePlanConflict){context.forcePlanConflict=false;return {ok:false,status:409,json:async()=>({error:"Your weekly plan changed in another tab or device.",code:"PLAN_CHANGED",plan:context.authoritativeConflictPlan,planUpdatedAt:1_700_000_000_400})};}
    const body=JSON.parse(options.body);return {ok:true,json:async()=>({ok:true,plan:body.plan,planUpdatedAt:planSaveRevision})};
  }
  return {ok:true,json:async()=>response};
},setTimeout,clearTimeout,URL,File:globalThis.File,FormData:class{},Intl,globalThis:null};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(readPublic("scripts","discovery-core.js"),context,{filename:"discovery-core.js"});
vm.runInContext(readPublic("scripts","monthly-plan-core.js"),context,{filename:"monthly-plan-core.js"});
vm.runInContext(readPublic("scripts","discover.js"),context,{filename:"discover.js"});
assert.equal(vm.runInContext("state.activeFeature",context),"recommendations","feature navigation must initialize before discovery data resolves");
assert.equal(vm.runInContext('Object.keys(FEATURE_CONFIG).filter((name)=>featurePanel(name).hidden).length',context),6,"only the default workspace should remain visible during discovery loading");

(async()=>{
  await new Promise(setImmediate);
  assert.equal(elements.get("discoveryLoadError").hidden,false,"a failed initial request must expose recovery UI");
  assert.match(elements.get("discoveryLoadErrorMessage").textContent,/Could not reach STRATA[\s\S]*try again/i,"browser-native network errors must be normalized");
  assert.equal(elements.get("discoveryRetry").disabled,false,"retry must remain available after failure");
  await elements.get("discoveryRetry").emit("click");
  await new Promise(setImmediate);
  assert.equal(elements.get("discoveryLoadError").hidden,true,"a successful retry must clear the error UI");
  vm.runInContext(`
    globalThis.featureAudit={defaultFeature:state.activeFeature,defaultVisible:!el("recommendations").hidden,defaultHidden:Object.keys(FEATURE_CONFIG).filter((name)=>featurePanel(name).hidden).length};
    activateFeature("explorer");
    featureAudit.explorerFeature=state.activeFeature;featureAudit.explorerVisible=!el("exerciseExplorer").hidden;featureAudit.explorerHidden=Object.keys(FEATURE_CONFIG).filter((name)=>featurePanel(name).hidden).length;
    globalThis.location.hash="#alternativeSection";
    restoreFeatureFromHistory();
  `,context);
  await new Promise(setImmediate);
  vm.runInContext(`
    featureAudit.unknownHashFeature=state.activeFeature;
    globalThis.location.hash="";
    activateFeature("recommendations");
    state.compare=["flat-dumbbell-press","machine-chest-press","cable-fly"];
    renderCompareTray();
    openComparison();
    openDetail("flat-dumbbell-press");
    globalThis.audit={recommendations:state.recommendations.length,results:discoveryResults().length,renderedResults:(el("exerciseGrid").innerHTML.match(/class="exercise-card"/g)||[]).length,hasLoadMore:/data-load-more-exercises/.test(el("exerciseGrid").innerHTML),compareCount:state.compare.length,detailOpen:el("detailDialog").open,bodyLocked:document.body.classList.contains("dialog-open")};
  `,context);
  const draftValues={comfort:1,pump:2,enjoyment:4,stability:5,setup:2,overall:4},draftForm=new Element("ratingDraft");
  draftForm.dataset.ratingForm="flat-dumbbell-press";
  draftForm.elements={namedItem:(name)=>({value:draftValues[name]})};
  elements.get("detailContent").queryResults.set("[data-rating-form]",draftForm);
  vm.runInContext("globalThis.ratingRefreshPromise=refreshCommunityRatings({force:true});",context);
  await context.ratingRefreshPromise;
  context.audit.ratingDraftPreserved=Object.entries(draftValues).every(([name,value])=>new RegExp(`name="${name}">[\\s\\S]*?<option value="${value}" selected`).test(elements.get("detailContent").innerHTML));
  vm.runInContext('closeDialog("detailDialog"); activateFeature("community");',context);
  await new Promise(setImmediate);
  vm.runInContext(`
    openCommunityApplyDialog("11111111-1111-4111-8111-111111111111");
    globalThis.communityBeforeApply={dialogOpen:el("communityApplyDialog").open,applyRequests:requests.filter((request)=>String(request.path).endsWith("/apply")).length};
    globalThis.communityApplyPromise=applyCommunityPlan();
  `,context);
  await context.communityApplyPromise;
  const applyRequest=requests.find((request)=>String(request.path).endsWith("/apply"));
  const applyBody=applyRequest?JSON.parse(applyRequest.options.body):{};
  vm.runInContext(`
    activateFeature("session");
    generateSession();
    el("sessionDay").value="Tuesday";
    globalThis.sessionSavePromise=addSessionToWeek();
  `,context);
  await context.sessionSavePromise;
  const sessionRequest=requests.find((request)=>request.path==="/api/plan"&&request.options.method==="PUT"),sessionBody=sessionRequest?JSON.parse(sessionRequest.options.body):{};
  const sessionSavedRevision=vm.runInContext("state.weeklyPlanUpdatedAt",context),sessionPlanLinkShown=elements.get("sessionOpenPlan").hidden===false;
  context.authoritativeConflictPlan=JSON.parse(JSON.stringify(sessionBody.plan));context.authoritativeConflictPlan.days.Wednesday=[];context.forcePlanConflict=true;
  vm.runInContext(`
    el("sessionGroup").value="lower";
    generateSession();
    el("sessionDay").value="Wednesday";
    globalThis.sessionConflictPromise=addSessionToWeek();
  `,context);
  await context.sessionConflictPromise;
  const result={
    ...context.audit,
    ...context.featureAudit,
    discoveryFetch:fetches.filter((path)=>path==="/api/discovery").length===2,
    battleBuilder:/Flat Dumbbell Press/.test(elements.get("battleSelects").innerHTML),
    battleSlots:(elements.get("battleSelects").innerHTML.match(/data-battle-slot=/g)||[]).length,
    battleTable:/Official FitScore/.test(elements.get("battleResults").innerHTML),
    battleRows:(elements.get("battleResults").innerHTML.match(/<tr>/g)||[]).length,
    battleVisible:!elements.get("battleResults").hidden,
    battleStatus:/Compared 3 exercises/.test(elements.get("battleStatus").textContent),
    scoreAudit:/Weighted baseline/.test(elements.get("detailContent").innerHTML),
    evidence:/Does not support/.test(elements.get("detailContent").innerHTML),
    alternatives:/Find an alternative/.test(elements.get("detailContent").innerHTML),
    ratings:/Community score/.test(elements.get("detailContent").innerHTML),
    communityFetch:fetches.filter((path)=>String(path).startsWith("/api/community-plans?")).length===1,
    communityRendered:/Runtime &lt;Week&gt;/.test(elements.get("communityPlanGrid").innerHTML),
    communitySevenDayPreview:(elements.get("communityPlanGrid").innerHTML.match(/class="shared-plan-day/g)||[]).length===7,
    communityConfirmation:context.communityBeforeApply.dialogOpen&&context.communityBeforeApply.applyRequests===0,
    communityApplied:Boolean(applyRequest&&applyRequest.options.method==="POST"&&applyRequest.options.headers["X-CSRF-Token"]==="csrf"&&applyBody.sourceUpdatedAt===communityPlan.updatedAt&&applyBody.targetUpdatedAt===response.weeklyPlanUpdatedAt),
    communityPlanLink:elements.get("communityOpenPlan").hidden===false,
    sessionGenerated:vm.runInContext("state.session.items.length",context)===4&&/personal match/.test(elements.get("sessionResults").innerHTML)&&/rest/.test(elements.get("sessionResults").innerHTML),
    sessionOptions:/value="full"/.test(elements.get("sessionGroup").innerHTML)&&/value="20"/.test(elements.get("sessionLength").innerHTML)&&/value="35"/.test(elements.get("sessionLength").innerHTML)&&/value="50"/.test(elements.get("sessionLength").innerHTML),
    sessionAdded:Boolean(sessionRequest&&sessionRequest.options.headers["X-CSRF-Token"]==="csrf"&&sessionBody.expectedPlanUpdatedAt===1_700_000_000_200&&sessionBody.plan.days.Tuesday.length===4),
    sessionPlanRevision:sessionSavedRevision===planSaveRevision,
    sessionPlanLink:sessionPlanLinkShown,
    sessionConflictHandled:requests.filter((request)=>request.path==="/api/plan"&&request.options.method==="PUT").length===2&&vm.runInContext("state.weeklyPlanUpdatedAt",context)===1_700_000_000_400&&vm.runInContext("state.weeklyPlan.days.Wednesday.length",context)===0&&/latest plan is loaded/i.test(elements.get("sessionStatus").textContent),
    weeklyPulse:/scheduled training days/.test(elements.get("weeklyPulseDetail").textContent)&&/^width:\d+(?:\.\d+)?%$/.test(elements.get("weeklyPulseBar").attributes.style)
  };
  assert.equal(result.recommendations,8);
  assert.equal(result.results,exercises.length);
  assert.equal(result.renderedResults,Math.min(24,result.results));
  assert.equal(result.hasLoadMore,result.results>24);
  assert.equal(result.compareCount,3);
  assert.equal(result.defaultFeature,"recommendations");
  assert.equal(result.defaultVisible,true);
  assert.equal(result.defaultHidden,6);
  assert.equal(result.explorerFeature,"explorer");
  assert.equal(result.explorerVisible,true);
  assert.equal(result.explorerHidden,6);
  assert.equal(result.unknownHashFeature,"explorer");
  assert.equal(result.battleSlots,4);
  assert.ok(result.battleRows>=10);
  for(const key of ["discoveryFetch","battleBuilder","battleTable","battleVisible","battleStatus","detailOpen","bodyLocked","scoreAudit","evidence","alternatives","ratings","ratingDraftPreserved","communityFetch","communityRendered","communitySevenDayPreview","communityConfirmation","communityApplied","communityPlanLink","sessionGenerated","sessionOptions","sessionAdded","sessionPlanRevision","sessionPlanLink","sessionConflictHandled","weeklyPulse"])assert.equal(result[key],true,key);
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
