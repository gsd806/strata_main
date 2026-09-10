"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const App=require("../public/scripts/app-navigation"),Navigation=require("../public/scripts/discover-navigation"),State=require("../public/scripts/discover-state"),Api=require("../public/scripts/discover-api"),Account=require("../public/scripts/account-logic");
function node(id,dataset={}){const classes=new Set();return{id,dataset,hidden:false,attributes:{},textContent:"",classList:{toggle(name,on){if(on)classes.add(name);else classes.delete(name);},contains:name=>classes.has(name)},setAttribute(name,value){this.attributes[name]=value;},removeAttribute(name){delete this.attributes[name];},focus(options){this.focusOptions=options;},scrollIntoView(options){this.scrollOptions=options;}};}
function fixture(){
  const state=State.createState(),nodes=new Map(),links=["exercises","plan","train","progress","account"].map(owner=>node(owner,{productOwner:owner})),toolLinks=Object.keys(State.FEATURE_CONFIG).map(feature=>node(feature,{featureTarget:feature}));
  for(const {panelId,headingId} of Object.values(State.FEATURE_CONFIG)){nodes.set(panelId,node(panelId));nodes.set(headingId,node(headingId));}
  for(const id of ["exerciseToolNavigation","planToolBreadcrumb","planToolName","featureStatus"])nodes.set(id,node(id));
  const document={body:node("body"),getElementById:id=>nodes.get(id),querySelectorAll:selector=>selector==="[data-product-owner]"?links:toolLinks};
  const destinations=[],handlers={},window={location:{replace:path=>destinations.push(path)},matchMedia:()=>({matches:true}),addEventListener:(type,handler)=>{handlers[type]=handler;}};
  return{state,nodes,links,toolLinks,document,window,destinations,handlers,navigation:Navigation.createFeatureNavigation({state,document,window,config:State.FEATURE_CONFIG,defaultFeature:State.FEATURE_DEFAULT})};
}
test("only recognized exercise and planning fragments survive authentication handoffs",()=>{
  for(const hash of Object.keys(App.ALIASES)){
    const path=`/discover.html#${hash}`;
    assert.equal(App.safeDiscoverNext(path),path);assert.equal(Account.safeNext(path),path);
    assert.equal(Account.safeNext("discover",null,`#${hash}`),path);
    assert.equal(new URL(Account.verificationLocation(path),"https://strata.test").searchParams.get("next"),path);
  }
  for(const invalid of ["https://evil.test/discover.html#progress","//evil.test","/discover.html#constructor","/discover.html#__proto__","/discover.html#unknown","/discover.html#progress%0a","/discover.html#%252f%252fevil.test","/discover.html#progress?next=evil","/discover.html#%","/discover.html#progress\n"]){
    assert.equal(App.safeDiscoverNext(invalid),"",invalid);assert.equal(Account.safeNext(invalid),"/planner.html",invalid);
  }
  assert.equal(Account.safeNext("discover",null,"#unknown"),"/discover.html");
  assert.equal(App.safeDiscoverNext("/discover.html#%73essionBuilder"),"/discover.html#sessionBuilder");
  assert.equal(App.discoverReturnPath({hash:"#sessionBuilder"}),"/discover.html#sessionBuilder");
  assert.equal(App.discoverReturnPath({hash:"#bad"}),"/discover.html");
});
test("legacy Today and Plan hashes redirect before activating a removed panel",()=>{
  const page=fixture();
  for(const [hash,path] of [["today","/workout.html"],["#todayWorkspace","/workout.html"],["plan","/planner.html"],["#planWorkspace","/planner.html"]]){
    assert.ok(page.navigation.featureName(hash));assert.equal(page.navigation.activate(hash),true);assert.equal(page.destinations.at(-1),path);assert.equal(page.state.activeFeature,null);
  }
  assert.equal(page.navigation.activate("#exploreWorkspace"),true);assert.equal(page.state.activeFeature,"library");
  assert.equal(page.navigation.featureName("#trainingBlockWorkspace"),"block");assert.equal(page.navigation.featureName("#savedExercises"),"saved");
});
test("each tool has one primary owner, a literal title, and appropriate contextual navigation",()=>{
  const page=fixture();
  for(const [feature,owner] of [["recommendations","exercises"],["saved","exercises"],["library","exercises"],["battle","exercises"],["profile","exercises"],["session","plan"],["block","plan"],["monthly","plan"],["community","plan"],["progress","progress"]]){
    page.navigation.activate(feature,{announce:true});
    assert.equal(page.document.body.dataset.productOwner,owner);
    const selected=page.toolLinks.filter(link=>App.ownerFor(link.dataset.featureTarget)==="exercises"&&link.attributes["aria-current"]==="location");
    assert.deepEqual(selected.map(link=>link.dataset.featureTarget),owner==="exercises"?[feature]:[]);
    assert.deepEqual(page.links.filter(link=>link.attributes["aria-current"]==="page").map(link=>link.dataset.productOwner),[owner]);
    assert.equal(page.nodes.get("exerciseToolNavigation").hidden,owner!=="exercises");assert.equal(page.nodes.get("planToolBreadcrumb").hidden,owner!=="plan");
    assert.equal(page.nodes.get("planToolName").textContent,State.FEATURE_CONFIG[feature].label);
    assert.equal(page.document.title,`${feature==="progress"?"Your training progress":State.FEATURE_CONFIG[feature].label} · STRATA`);
    assert.equal(Object.values(State.FEATURE_CONFIG).filter(({panelId})=>!page.nodes.get(panelId).hidden).length,1);
  }
});
test("hash navigation restores owner and panel without disturbing unrelated anchors, and honors reduced motion",async()=>{
  const original={location:globalThis.location,history:globalThis.history,requestAnimationFrame:globalThis.requestAnimationFrame};
  try{
    const page=fixture(),writes=[];globalThis.location={hash:"#%65xploreWorkspace"};globalThis.history={pushState:(_state,_title,hash)=>writes.push(hash)};globalThis.requestAnimationFrame=callback=>callback();
    page.navigation.initialize();assert.equal(page.state.activeFeature,"library");page.navigation.bindHistory();
    page.navigation.activate("session",{focus:true,scroll:true,smooth:true,historyMode:"push"});
    assert.deepEqual(writes,["#sessionBuilder"]);assert.deepEqual(page.nodes.get("sessionBuilder").scrollOptions,{behavior:"instant",block:"start"});assert.deepEqual(page.nodes.get(State.FEATURE_CONFIG.session.headingId).focusOptions,{preventScroll:true});
    globalThis.location.hash="#progressWorkspace";page.handlers.popstate();page.handlers.hashchange();await Promise.resolve();assert.equal(page.state.activeFeature,"progress");
    globalThis.location.hash="#featureHub";page.handlers.hashchange();await Promise.resolve();assert.equal(page.state.activeFeature,"progress");
    globalThis.location.hash="#unknown";page.handlers.hashchange();await Promise.resolve();assert.equal(page.state.activeFeature,"progress");
    globalThis.location.hash="";page.handlers.popstate();await Promise.resolve();assert.equal(page.state.activeFeature,"recommendations");
  }finally{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}}
});
test("access failures preserve safe return intent and notify the local access view without redirecting",async()=>{
  const original=globalThis.location;globalThis.location={hash:"#sessionBuilder"};
  try{
    const redirects=[],denied=[],options={fetchImpl:async()=>({ok:false,status:402,json:async()=>({code:"DISCOVERY_ACCESS_REQUIRED",error:"Access expired"})}),getCsrfToken:()=>"",getGeneration:()=>1,redirect:path=>redirects.push(path)};
    await assert.rejects(Api.createClient({...options,onAccessDenied:error=>denied.push(error)})("/api/discovery"),error=>error.redirecting===true&&error.status===402);
    assert.equal(denied.length,1);assert.equal(denied[0].message,"Access expired");assert.deepEqual(redirects,[]);
    await assert.rejects(Api.createClient(options)("/api/discovery"));assert.deepEqual(redirects,["/pricing?reason=access-revoked"]);
    options.fetchImpl=async()=>({ok:false,status:401,json:async()=>({})});await assert.rejects(Api.createClient(options)("/api/discovery"));
    assert.equal(new URL(redirects.at(-1),"https://strata.test").searchParams.get("next"),"/discover.html#sessionBuilder");
    let generation=1;options.getGeneration=()=>generation;options.fetchImpl=async()=>({ok:false,status:402,json:async()=>{generation++;return{};}});
    await assert.rejects(Api.createClient({...options,onAccessDenied:error=>denied.push(error)})("/api/discovery"),error=>error.stale===true);assert.equal(denied.length,1);
  }finally{if(original===undefined)delete globalThis.location;else globalThis.location=original;}
});

test("separate popstate and hashchange tasks dispatch a legacy redirect only once",async()=>{
  const original=globalThis.location;
  try{
    const page=fixture();globalThis.location={hash:"#planWorkspace"};page.navigation.bindHistory();page.navigation.initialize();
    page.handlers.popstate();await Promise.resolve();page.handlers.hashchange();await Promise.resolve();
    page.navigation.activate("recommendations");page.handlers.hashchange();await Promise.resolve();
    assert.deepEqual(page.destinations,["/planner.html"],"Background hydration and duplicate history events must not restart a pending redirect");
    page.handlers.pageshow({persisted:false});page.handlers.hashchange();await Promise.resolve();assert.equal(page.destinations.length,1);
    page.handlers.pageshow({persisted:true});page.handlers.hashchange();await Promise.resolve();assert.equal(page.destinations.length,2,"Restoring the document from browser cache permits a fresh redirect");
    globalThis.location.hash="#recommendations";page.handlers.popstate();await Promise.resolve();
    globalThis.location.hash="#planWorkspace";page.handlers.hashchange();await Promise.resolve();assert.equal(page.destinations.length,3,"A new user navigation after returning to Exercises permits another redirect");
  }finally{if(original===undefined)delete globalThis.location;else globalThis.location=original;}
});
