"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const RELEASE=require(join(PROJECT_ROOT,"package.json"));
const BUILD=RELEASE.strataBuild||RELEASE.version;
const CATALOG_URL=`/exercises.json?v=${BUILD}`;
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const html=readPublic("pages","planner.html");
const plannerCss=readPublic("styles","planner.css");
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
    this.checked=false;this.href="";this.inert=false;this.dataset={};this.attributes={};this.listeners={};this.classList=new ClassList();this.parentElement={classList:new ClassList()};
  }
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  focus(){focusedSelector=`#${this.id}`;}
  querySelector(selector){
    if(this.id!=="libraryList")return null;
    return {focus(){focusedSelector=selector;}};
  }
}

const elements=new Map(ids.map((id)=>[id,new Element(id)]));
const documentListeners={};
const document={
  visibilityState:"visible",
  getElementById(id){return elements.get(id)||null;},
  addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);},
  querySelector(selector){return selector.startsWith("#")?elements.get(selector.slice(1))||null:null;},
  querySelectorAll(){return [];}
};

const plan={version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map((day)=>[day,[]]))};
plan.days.Monday.push({instanceId:"runtime-plan-item",exerciseId:exercises[0].id,sets:3,reps:"8–12"});
const fetches=[];
const requests=[];
const guestStorageWrites=[];
const windowListeners={};
const context={
  console,document,history:{replaceState(){}},location:{search:"",href:"http://strata.test/planner.html",origin:"http://strata.test",assign(){}},
  window:{
    location:{replace(){}},
    matchMedia:()=>({matches:false}),
    addEventListener(type,handler){(windowListeners[type]||=[]).push(handler);}
  },
  localStorage:{getItem(){return null;},setItem(key,value){guestStorageWrites.push({key,value});}},
  fetch:async(path,options={})=>{
    fetches.push(path);
    requests.push({path,options});
    if(path===CATALOG_URL)return {ok:true,json:async()=>exercises};
    if(path==="/api/plan")return {ok:true,json:async()=>({plan,user:{id:"u1",name:"Planner Audit",email:"audit@example.test",discovery:{active:true,accessType:"paid",trial:{eligible:false,active:false}}},csrfToken:"planner-csrf",planUpdatedAt:1_700_000_000_100})};
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

function clickSelectDay(day){
  const select={dataset:{selectDay:day,dayChip:day}};
  const target={
    closest(selector){return selector==="[data-select-day]"?select:null;}
  };
  const event={target,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};
  for(const handler of documentListeners.click||[])handler(event);
}

(async()=>{
  await new Promise(setImmediate);

  const initialIds=renderedIds();
  const initialMarkup=elements.get("libraryList").innerHTML;
  const dayNavMarkup=elements.get("plannerDayNav").innerHTML;
  assert.equal(initialIds.length,32,"Desktop planner should initially render 32 library cards");
  assert.equal(new Set(initialIds).size,32,"Initial planner page must not contain duplicate cards");
  assert.match(initialMarkup,/data-load-more-library/,"Expanded catalog should expose Load more");
  assert.match(initialMarkup,/Load 32 more/,"Desktop Load more should reveal the next 32 cards");
  assert.match(initialMarkup,/>Add<\/button>/,"Library actions should use a clear text label instead of an unexplained symbol");
  assert.match(initialMarkup,/>Video<\/a>/,"Tutorial actions should use a clear text label instead of an unexplained symbol");
  for(const day of DAYS){
    const chip=dayNavMarkup.match(new RegExp(`<button\\b(?=[^>]*data-day-chip="${day}")[^>]*>`))?.[0];
    assert.ok(chip,`${day} must have a quick-add day chip`);
    assert.match(chip,/\baria-pressed="(?:true|false)"/,`${day} day chip must expose its selected state`);
  }
  assert.equal((dayNavMarkup.match(/\baria-pressed="true"/g)||[]).length,1,"Exactly one quick-add day must be selected");
  assert.match(html,/id="weekBoard"[^>]*aria-describedby="weekScrollHint"/,"The horizontal week must expose its scroll instructions");
  const finalMobileRule=plannerCss.slice(plannerCss.lastIndexOf("@media(max-width:760px)"),plannerCss.lastIndexOf("@media(max-width:480px)"));
  assert.match(finalMobileRule,/\.library-panel\{[^}]*\btop:auto\b/,"The final mobile cascade must cancel the desktop sticky offset");
  assert.doesNotMatch(finalMobileRule,/\.planner-day-chip\{[^}]*min-width:0/,"The final mobile cascade must preserve accessible day-chip targets");
  assert.match(plannerCss,/@media\(max-width:480px\)\{[^}]*\.library-panel\{[^}]*54svh[^}]*\}\.planner-day-chips\{grid-template-columns:repeat\(4,minmax\(44px,1fr\)\)/,"Small screens should expose four full-size day targets per row and leave the week within reach");
  assert.match(html,/id="exportWeeklyPlan"[^>]*>Export week/,"Export should use a short, familiar label");
  assert.match(html,/id="shareWeeklyPlan"[^>]*>Share week/,"Community publishing should not be described as a file upload");
  assert.match(html,/id="userName" href="\/account\.html"/,"Signed-in planners should have a direct account link");
  assert.equal((html.match(/class="planner-workflow"/g)||[]).length,1,"Planner onboarding should be a single compact workflow");
  assert.match(html,/Build a weekly plan in three steps/,"Planner workflow should describe its purpose to assistive technology");
  assert.match(plannerCss,/\.day-empty::before\s*\{[^}]*content:"\+"/,"Empty days should have a visible add cue");

  clickSelectDay("Tuesday");
  assert.equal(vm.runInContext("state.selectedDay",context),"Tuesday","Day chips must update the quick-add target");
  assert.match(elements.get("libraryList").innerHTML,/aria-label="Add [^"]+ to Tuesday"/,"Library add controls must announce the selected day");
  const originalRest=vm.runInContext("state.plan.restDay",context);
  for(const handler of elements.get("recommendRest").listeners.click||[])handler({currentTarget:elements.get("recommendRest")});
  const recommendedRest=vm.runInContext("state.plan.restDay",context);
  assert.notEqual(recommendedRest,originalRest,"Recommend rest day must exclude the current recovery day");
  assert.equal(vm.runInContext("state.plan.days[state.plan.restDay].length",context),0,"A recommendation must choose an empty day");

  const focusedRepsInput={
    dataset:{itemReps:"runtime-plan-item"},value:"12–15",
    closest(selector){return selector==="[data-day]"?{dataset:{day:"Monday"}}:null;}
  };
  for(const handler of documentListeners.input||[])handler({target:focusedRepsInput});
  assert.equal(vm.runInContext("state.plan.days.Monday[0].reps",context),"12–15","Typing must update plan state before the field blurs");

  clickLoadMore();

  const expandedIds=renderedIds();
  const loadMoreFocused=focusedSelector==='[data-library-index="32"] [data-quick-add]';
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
  assert.equal(JSON.parse(requests[saveIndex].options.body).expectedPlanUpdatedAt,1_700_000_000_100,"Account saves must include the plan revision that the browser loaded");
  assert.equal(JSON.parse(requests[saveIndex].options.body).plan.days.Monday[0].reps,"12–15","A lifecycle-style save must include the value from a still-focused reps field");
  assert.equal(requests[saveIndex].options.keepalive,true,"Plan saves must be eligible to finish while the page is backgrounded");
  assert.match(elements.get("ownSharedPlans").innerHTML,/Runtime strength week/);

  clickUnpublish();
  assert.match(elements.get("ownSharedPlans").innerHTML,/Confirm unpublish/,"Unpublish requires an explicit second confirmation");
  clickUnpublish();
  await new Promise(setImmediate);
  assert.equal(fetches.filter((path)=>path==="/api/community-plans/shared-runtime").length,1,"Confirmed unpublish must call DELETE once");
  assert.match(elements.get("ownSharedPlans").innerHTML,/not shared a week/i);
  const expandedResultStatus=elements.get("libraryResultStatus").textContent;

  let retrySaveAttempts=0;
  context.fetch=async(path,options={})=>{
    if(path==="/api/plan"&&options.method==="PUT"){
      retrySaveAttempts+=1;
      if(retrySaveAttempts===1)return {ok:false,status:503,json:async()=>({error:"Temporary save failure"})};
      return {ok:true,json:async()=>({ok:true,plan,planUpdatedAt:1_700_000_000_200})};
    }
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  };
  vm.runInContext("state.plan.days.Wednesday.push({instanceId:'retry-save-item',exerciseId:state.exercises[2].id,sets:3,reps:'8–12'});state.revision+=1;",context);
  assert.equal(await vm.runInContext("flushSave()",context),false,"A failed save must remain unsaved");
  assert.equal(elements.get("retryPlanSave").hidden,false,"A failed save must expose Retry");
  assert.equal(elements.get("saveStatus").textContent,"Couldn't save — Retry","A failed save must use the shared retry state");
  assert.match(elements.get("retryPlanSave").title,/could not save right now/i,"Retry must explain a temporary server failure");
  await Promise.all((elements.get("retryPlanSave").listeners.click||[]).map((handler)=>handler({currentTarget:elements.get("retryPlanSave")})));
  assert.equal(retrySaveAttempts,2,"Retry must make one fresh save request");
  assert.equal(elements.get("retryPlanSave").hidden,true,"Retry should hide after the plan saves");
  assert.equal(elements.get("saveStatus").textContent,"Saved");

  const authoritativePlan=JSON.parse(JSON.stringify(plan));
  authoritativePlan.days.Monday[0].reps="5–7";
  let conflictSaveAttempts=0;
  const conflictSaveBodies=[];
  context.fetch=async(path,options={})=>{
    if(path==="/api/plan"&&options.method==="PUT"){
      conflictSaveAttempts+=1;
      conflictSaveBodies.push(JSON.parse(options.body));
      if(conflictSaveAttempts===1)return {ok:false,status:409,json:async()=>({error:"Your weekly plan changed in another tab or device.",code:"PLAN_CHANGED",plan:authoritativePlan,planUpdatedAt:1_700_000_000_300})};
      const submitted=conflictSaveBodies.at(-1);
      return {ok:true,status:200,json:async()=>({ok:true,plan:submitted.plan,planUpdatedAt:1_700_000_000_400})};
    }
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  };
  vm.runInContext("state.plan.days.Saturday.push({instanceId:'conflicting-local-item',exerciseId:state.exercises[3].id,sets:3,reps:'8–12'});state.revision+=1;",context);
  assert.equal(await vm.runInContext("flushSave()",context),false,"A stale save must pause instead of overwriting the newer account plan");
  assert.equal(conflictSaveAttempts,1,"The dirty plan must reach the conflict response");
  assert.equal(vm.runInContext("Boolean(state.conflictDraft)",context),true,"The conflict response must enter recovery mode");
  assert.equal(vm.runInContext("state.plan.days.Monday[0].reps",context),"5–7","The planner must display the authoritative account plan after a conflict");
  assert.equal(vm.runInContext("state.conflictDraft.days.Saturday[0].instanceId",context),"conflicting-local-item","The unsaved local draft must remain recoverable");
  assert.equal(vm.runInContext("state.savedRevision<state.revision",context),true,"Conflict recovery must keep navigation and unload safeguards active");
  assert.equal(elements.get("plannerShell").inert,true,"Editing stays locked while the user considers the newer account copy");
  assert.equal(elements.get("planConflictPanel").hidden,false,"Conflict recovery must expose choices outside the inert planner");
  assert.match(elements.get("latestPlanSummary").innerHTML,/5–7/,"The comparison must show the latest account copy");
  assert.match(elements.get("localPlanSummary").innerHTML,/conflicting-local-item|movement/i,"The comparison must show the unsaved local copy");
  assert.equal(elements.get("retryPlanSave").textContent,"Review my changes");
  await Promise.all((elements.get("reviewLocalPlan").listeners.click||[]).map((handler)=>handler({currentTarget:elements.get("reviewLocalPlan")})));
  assert.equal(vm.runInContext("state.conflictReview",context),true);
  assert.equal(vm.runInContext("state.plan.days.Saturday[0].instanceId",context),"conflicting-local-item","Review restores the local draft without saving it");
  assert.equal(conflictSaveAttempts,1,"Restoring the draft must not silently retry the overwrite");
  assert.equal(elements.get("retryPlanSave").textContent,"Save reviewed changes");
  assert.equal(await vm.runInContext("flushSave()",context),false,"Navigation-style flushes cannot bypass explicit conflict confirmation");
  assert.equal(conflictSaveAttempts,1);
  await Promise.all((elements.get("retryPlanSave").listeners.click||[]).map((handler)=>handler({currentTarget:elements.get("retryPlanSave")})));
  assert.equal(conflictSaveAttempts,2);
  assert.equal(JSON.parse(vm.runInContext("JSON.stringify(state.plan)",context)).days.Saturday[0].instanceId,"conflicting-local-item");
  assert.equal(conflictSaveBodies[1].expectedPlanUpdatedAt,1_700_000_000_300,"A confirmed recovery is based on the newer account revision");
  assert.equal(vm.runInContext("state.planUpdatedAt",context),1_700_000_000_400,"The confirmed save adopts its new account revision");
  assert.equal(vm.runInContext("state.conflictReview",context),false);
  assert.equal(vm.runInContext("state.conflictLatest",context),null);
  assert.equal(elements.get("planConflictPanel").hidden,true);
  assert.equal(elements.get("retryPlanSave").hidden,true);

  let keepLatestAttempts=0;
  const nextAuthoritativePlan=JSON.parse(JSON.stringify(authoritativePlan));
  nextAuthoritativePlan.days.Monday[0].reps="3–5";
  context.fetch=async(path,options={})=>{
    if(path==="/api/plan"&&options.method==="PUT"){
      keepLatestAttempts+=1;
      return {ok:false,status:409,json:async()=>({error:"Your weekly plan changed in another tab or device.",code:"PLAN_CHANGED",plan:nextAuthoritativePlan,planUpdatedAt:1_700_000_000_500})};
    }
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  };
  vm.runInContext("state.plan.days.Friday.push({instanceId:'discarded-local-item',exerciseId:state.exercises[4].id,sets:2,reps:'10'});state.revision+=1;",context);
  assert.equal(await vm.runInContext("flushSave()",context),false);
  await Promise.all((elements.get("keepLatestPlan").listeners.click||[]).map((handler)=>handler({currentTarget:elements.get("keepLatestPlan")})));
  assert.equal(keepLatestAttempts,1,"Keeping the account plan must not issue an overwrite");
  assert.equal(vm.runInContext("state.plan.days.Monday[0].reps",context),"3–5");
  assert.equal(vm.runInContext("state.plan.days.Friday.length",context),0,"Keeping latest must discard only the unsaved local copy");
  assert.equal(vm.runInContext("state.savedRevision",context),vm.runInContext("state.revision",context),"Keeping latest must leave the planner clean");
  assert.equal(elements.get("plannerShell").inert,false);
  assert.equal(elements.get("planConflictPanel").hidden,true);

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
  assert.equal(elements.get("userName").hidden,true,"Guest planners should not see a misleading account-name link");
  assert.equal(guestCommunityFetches,0,"Guest planners must not request private community management data");
  assert.match(elements.get("plannerModeNotice").innerHTML,/Guest plan[\s\S]*separate synced account plan/i,"Guest copy must explain that signing in opens a separate plan");
  assert.doesNotMatch(elements.get("plannerModeNotice").innerHTML,/Sign in for cross-device sync/i);
  guestStorageWrites.length=0;
  vm.runInContext("state.plan.days.Monday.push({instanceId:'guest-save-one',exerciseId:state.exercises[0].id,sets:3,reps:'8–12'});state.revision+=1;",context);
  assert.equal(await vm.runInContext("flushSave()",context),true,"A guest edit must save locally");
  vm.runInContext("state.plan.days.Tuesday.push({instanceId:'guest-save-two',exerciseId:state.exercises[1].id,sets:3,reps:'8–12'});state.revision+=1;",context);
  assert.equal(await vm.runInContext("flushSave()",context),true,"A second guest edit must not deadlock behind the first save promise");
  assert.equal(guestStorageWrites.length,2,"Each guest revision must reach local storage");
  assert.equal(vm.runInContext("state.savePromise",context),null,"Guest saves must always release the tracked save promise");
  assert.equal(vm.runInContext("state.savedRevision",context),vm.runInContext("state.revision",context));

  vm.runInContext("state.navigating=true",context);
  let secondNavigationPrevented=false;
  const navigationLink={href:"http://strata.test/pricing",target:"",hasAttribute(){return false;}};
  const navigationTarget={closest(selector){return selector==="a[href]"?navigationLink:null;}};
  const navigationEvent={target:navigationTarget,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false,preventDefault(){this.defaultPrevented=true;secondNavigationPrevented=true;}};
  for(const handler of documentListeners.click||[])handler(navigationEvent);
  assert.equal(secondNavigationPrevented,true,"A second same-origin navigation must stay blocked while the first save is pending");
  vm.runInContext("state.navigating=false",context);
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
    focusedFirstNewCard:loadMoreFocused,
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
  const preservedPlan=vm.runInContext("copyPlan(state.plan)",context);
  vm.runInContext("state.plan=emptyPlan(); state.plan.days.Monday=Array.from({length:30},(_,i)=>({instanceId:'limit-'+i,exerciseId:state.exercises[0].id,sets:3,reps:'8-12'}));state.plan.days.Tuesday=[{instanceId:'move-limit',exerciseId:state.exercises[1].id,sets:3,reps:'8-12'}];",context);
  assert.equal(vm.runInContext("addExercise(state.exercises[0].id,'Monday')",context),false,"31st daily item must be rejected before mutation");
  assert.equal(vm.runInContext("moveItem('Tuesday','Monday','move-limit')",context),false,"moving into a full day must keep the source item");
  assert.equal(vm.runInContext("state.plan.days.Tuesday.length",context),1);
  const oversized=JSON.parse(JSON.stringify(preservedPlan));
  oversized.days.Monday=Array.from({length:41},(_,i)=>({instanceId:'legacy-'+i,exerciseId:exercises[0].id,sets:3,reps:'8-12'}));
  context.localStorage.getItem=()=>JSON.stringify(oversized);
  assert.equal(vm.runInContext("guestPlan().days.Monday.length",context),41,"legacy draft must not silently lose its 41st item on reload");
  vm.runInContext("state.plan=emptyPlan();for(const day of DAYS.slice(0,5))state.plan.days[day]=Array.from({length:28},(_,i)=>({instanceId:day+'-'+i,exerciseId:state.exercises[0].id,sets:3,reps:'8-12'}));",context);
  assert.equal(vm.runInContext("addExercise(state.exercises[0].id,'Saturday')",context),false,"141st weekly item must be rejected");
  vm.runInContext("renderLoadError({code:'NETWORK_ERROR',message:'Offline'})",context);
  assert.match(elements.get("weekBoard").innerHTML,/data-open-guest/,"offline account errors must offer an explicit separate guest plan");
  let offlineApiReads=0;
  context.fetch=async(path)=>{if(path===CATALOG_URL)return{ok:true,json:async()=>exercises};offlineApiReads++;throw new Error("offline");};
  await vm.runInContext("init({guestOnly:true})",context);
  assert.equal(vm.runInContext("state.ready&&state.guest&&!state.user",context),true);
  assert.equal(offlineApiReads,0,"explicit offline guest mode must not depend on an account request");
  console.log(JSON.stringify({...result,plannerCapacityGuards:true,legacyDraftPreserved:true,offlineGuestMode:true},null,2));
})().catch((error)=>{console.error(error);process.exitCode=1;});
