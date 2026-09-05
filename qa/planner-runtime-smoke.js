"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const BUILD=require(join(PROJECT_ROOT,"package.json")).version;
const CATALOG_URL=`/exercises.json?v=${BUILD}`;
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const html=readPublic("pages","planner.html");
const exercises=JSON.parse(readPublic("data","exercises.json"));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
}

let focusedSelector="";
class Element{
  constructor(id){
    this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.disabled=false;
    this.dataset={};this.attributes={};this.listeners={};this.classList=new ClassList();this.parentElement={classList:new ClassList()};
  }
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  querySelector(selector){
    if(this.id!=="libraryList")return null;
    return {focus(){focusedSelector=selector;}};
  }
}

const elements=new Map(ids.map((id)=>[id,new Element(id)]));
const documentListeners={};
const document={
  getElementById(id){return elements.get(id)||null;},
  addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);},
  querySelector(){return null;},
  querySelectorAll(){return [];}
};

const plan={version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map((day)=>[day,[]]))};
plan.days.Monday.push({instanceId:"runtime-plan-item",exerciseId:exercises[0].id,sets:3,reps:"8–12"});
const fetches=[];
const requests=[];
const windowListeners={};
const context={
  console,document,history:{replaceState(){}},location:{search:"",href:"http://strata.test/planner.html",origin:"http://strata.test",assign(){}},
  window:{
    location:{replace(){}},
    matchMedia:()=>({matches:false}),
    addEventListener(type,handler){(windowListeners[type]||=[]).push(handler);}
  },
  localStorage:{getItem(){return null;},setItem(){}},
  fetch:async(path,options={})=>{
    fetches.push(path);
    requests.push({path,options});
    if(path===CATALOG_URL)return {ok:true,json:async()=>exercises};
    if(path==="/api/plan")return {ok:true,json:async()=>({plan,user:{id:"u1",name:"Planner Audit",email:"audit@example.test"},csrfToken:"planner-csrf",planUpdatedAt:1_700_000_000_100})};
    if(path==="/api/community-plans/mine")return {ok:true,json:async()=>({plans:[],csrfToken:"planner-csrf"})};
    if(path==="/api/community-plans"&&options.method==="POST")return {ok:true,json:async()=>({ok:true,plan:{id:"shared-runtime",title:"Runtime strength week",description:"A runtime-tested week.",authorName:"Planner Audit",plan,published:true,createdAt:Date.now(),updatedAt:Date.now()}})};
    if(path==="/api/community-plans/shared-runtime"&&options.method==="DELETE")return {ok:true,json:async()=>({ok:true})};
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  },
  requestAnimationFrame:(callback)=>callback(),setTimeout,clearTimeout,URL,URLSearchParams
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(readPublic("scripts","planner.js"),context,{filename:"planner.js"});

function renderedIds(){
  return [...elements.get("libraryList").innerHTML.matchAll(/data-library-id="([^"]+)"/g)].map((match)=>match[1]);
}

function clickLoadMore(){
  const target={
    closest(selector){return selector==="[data-load-more-library]"?{dataset:{}}:null;}
  };
  const event={target,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};
  for(const handler of documentListeners.click||[])handler(event);
}

function clickUnpublish(){
  const target={
    closest(selector){return selector==="[data-unpublish-plan]"?{dataset:{unpublishPlan:"shared-runtime"}}:null;}
  };
  const event={target,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};
  for(const handler of documentListeners.click||[])handler(event);
}

(async()=>{
  await new Promise(setImmediate);

  const initialIds=renderedIds();
  const initialMarkup=elements.get("libraryList").innerHTML;
  assert.equal(initialIds.length,32,"Desktop planner should initially render 32 library cards");
  assert.equal(new Set(initialIds).size,32,"Initial planner page must not contain duplicate cards");
  assert.match(initialMarkup,/data-load-more-library/,"Expanded catalog should expose Load more");
  assert.match(initialMarkup,/Load 32 more/,"Desktop Load more should reveal the next 32 cards");

  clickLoadMore();

  const expandedIds=renderedIds();
  assert.equal(elements.get("sharePlanGuest").hidden,true,"Signed-in planners should not see the guest publishing prompt");
  assert.equal(elements.get("sharePlanAccount").hidden,false,"Signed-in planners should see publishing controls");
  elements.get("sharePlanTitle").value="Runtime strength week";
  elements.get("sharePlanDescription").value="A runtime-tested week.";
  elements.get("sharePlanConfirm").checked=false;
  for(const handler of elements.get("sharePlanForm").listeners.submit||[])handler({preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(fetches.filter((path)=>path==="/api/community-plans").length,0,"Publishing must wait for explicit privacy confirmation");
  assert.match(elements.get("sharePlanStatus").textContent,/confirm/i);
  vm.runInContext('state.plan.days.Tuesday.push({instanceId:"dirty-before-publish",exerciseId:state.exercises[1].id,sets:3,reps:"8–12"});state.revision+=1;',context);
  elements.get("sharePlanConfirm").checked=true;
  for(const handler of elements.get("sharePlanForm").listeners.submit||[])handler({preventDefault(){}});
  await new Promise(setImmediate);
  const publishRequest=requests.find((request)=>request.path==="/api/community-plans"&&request.options.method==="POST");
  assert.ok(publishRequest,"Publishing must call the community-plan endpoint");
  assert.equal(publishRequest.options.headers["X-CSRF-Token"],"planner-csrf","Publishing must include the signed-in CSRF token");
  const publishBody=JSON.parse(publishRequest.options.body);
  assert.equal(Object.hasOwn(publishBody,"plan"),false,"Publishing must snapshot the already-saved server plan instead of trusting a second client copy");
  assert.equal(publishBody.expectedPlanUpdatedAt,1_700_000_000_100,"Publishing must bind the upload to the Plan revision shown to the user");
  const saveIndex=requests.findIndex((request)=>request.path==="/api/plan"&&request.options.method==="PUT"),publishIndex=requests.indexOf(publishRequest);
  assert.ok(saveIndex>=0&&saveIndex<publishIndex,"A dirty weekly plan must finish saving before its community snapshot is published");
  assert.match(elements.get("ownSharedPlans").innerHTML,/Runtime strength week/);

  clickUnpublish();
  assert.match(elements.get("ownSharedPlans").innerHTML,/Confirm unpublish/,"Unpublish requires an explicit second confirmation");
  clickUnpublish();
  await new Promise(setImmediate);
  assert.equal(fetches.filter((path)=>path==="/api/community-plans/shared-runtime").length,1,"Confirmed unpublish must call DELETE once");
  assert.match(elements.get("ownSharedPlans").innerHTML,/not shared a week/i);
  const expandedResultStatus=elements.get("libraryResultStatus").textContent;

  let guestCommunityFetches=0;
  context.fetch=async(path)=>{
    if(path===CATALOG_URL)return {ok:true,json:async()=>exercises};
    if(path==="/api/plan")return {ok:false,status:401,json:async()=>({error:"Not signed in."})};
    if(path==="/api/community-plans/mine")guestCommunityFetches+=1;
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  };
  await vm.runInContext("init()",context);
  assert.equal(elements.get("sharePlanGuest").hidden,false,"Guest planners should see the sign-in publishing prompt");
  assert.equal(elements.get("sharePlanAccount").hidden,true,"Guest planners must not see account publishing controls");
  assert.equal(guestCommunityFetches,0,"Guest planners must not request private community management data");
  const result={
    catalogFetch:fetches.filter((path)=>path===CATALOG_URL).length===1,
    planFetch:requests.filter((request)=>request.path==="/api/plan"&&!request.options.method).length===1,
    planSave:saveIndex>=0&&saveIndex<publishIndex,
    communityFetch:fetches.filter((path)=>path==="/api/community-plans/mine").length===1,
    communityPublish:Boolean(publishRequest),
    communityUnpublish:fetches.filter((path)=>path==="/api/community-plans/shared-runtime").length===1,
    guestPublishingPrompt:elements.get("sharePlanGuest").hidden===false&&elements.get("sharePlanAccount").hidden===true,
    initialCards:initialIds.length,
    initialLoadMore:true,
    expandedCards:expandedIds.length,
    uniqueExpandedCards:new Set(expandedIds).size,
    firstPagePreserved:initialIds.every((id,index)=>expandedIds[index]===id),
    loadMoreStillAvailable:/data-load-more-library/.test(elements.get("libraryList").innerHTML),
    focusedFirstNewCard:focusedSelector==='[data-library-index="32"] [data-quick-add]',
    resultStatus:expandedResultStatus
  };

  assert.equal(result.catalogFetch,true);
  assert.equal(result.planFetch,true);
  assert.equal(result.planSave,true);
  assert.equal(result.communityFetch,true);
  assert.equal(result.communityPublish,true);
  assert.equal(result.communityUnpublish,true);
  assert.equal(result.guestPublishingPrompt,true);
  assert.equal(result.expandedCards,64,"One desktop Load more action should render 64 cards total");
  assert.equal(result.uniqueExpandedCards,64,"Load more must not duplicate library cards");
  assert.equal(result.firstPagePreserved,true,"Load more should preserve the original first page order");
  assert.equal(result.loadMoreStillAvailable,true,"A 200-item library should have more results after 64 cards");
  assert.equal(result.focusedFirstNewCard,true,"Focus should move to the first newly revealed card");
  assert.match(result.resultStatus,/Showing 64 of 200 matching movements\./);
  console.log(JSON.stringify(result,null,2));
})().catch((error)=>{console.error(error);process.exitCode=1;});
