/* global module */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataAppNavigation=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const ALIASES=Object.freeze({today:"today",todayWorkspace:"today",plan:"plan",planWorkspace:"plan",explore:"library",exploreWorkspace:"library",progress:"progress",progressWorkspace:"progress",recommendations:"recommendations",library:"library",exerciseExplorer:"library",battle:"battle",profile:"profile",community:"community",communityPlans:"community",monthly:"monthly",monthlyPlan:"monthly",session:"session",sessionBuilder:"session",block:"block",trainingBlockWorkspace:"block",saved:"saved",savedExercises:"saved"});
  const PLAN_FEATURES=new Set(["session","block","monthly","community"]);
  function decodedHash(value){try{return decodeURIComponent(String(value||"").replace(/^#/,""));}catch{return "";}}
  function featureAlias(value){const name=decodedHash(value);return Object.hasOwn(ALIASES,name)?ALIASES[name]:null;}
  function legacyDestination(value){const feature=featureAlias(value);return feature==="today"?"/workout.html":feature==="plan"?"/planner.html":null;}
  function safeDiscoverNext(value){
    const raw=String(value||"");
    if(raw==="discover"||raw==="/discover.html")return "/discover.html";
    if(!raw.startsWith("/discover.html#"))return "";
    const hash=decodedHash(raw.slice("/discover.html".length));
    return Object.hasOwn(ALIASES,hash)?`/discover.html#${hash}`:"";
  }
  function discoverReturnPath(locationLike=globalThis.location){return safeDiscoverNext(`/discover.html${locationLike?.hash||""}`)||"/discover.html";}
  function ownerFor(feature){return PLAN_FEATURES.has(feature)?"plan":feature==="progress"?"progress":"exercises";}
  function updateProductNavigation({feature,label,document}){
    const owner=ownerFor(feature);document.body.dataset.productOwner=owner;
    for(const link of document.querySelectorAll("[data-product-owner]")){
      if(!link.dataset.productOwner)continue;
      const active=link.dataset.productOwner===owner;link.classList.toggle("active",active);
      if(active)link.setAttribute("aria-current","page");else link.removeAttribute("aria-current");
    }
    const exerciseTools=document.getElementById("exerciseToolNavigation"),breadcrumb=document.getElementById("planToolBreadcrumb"),toolName=document.getElementById("planToolName");
    if(exerciseTools)exerciseTools.hidden=owner!=="exercises";
    if(breadcrumb)breadcrumb.hidden=owner!=="plan";
    if(toolName)toolName.textContent=label;
    document.title=`${feature==="progress"?"Your training progress":label} · STRATA`;
  }
  return{ALIASES,decodedHash,featureAlias,legacyDestination,safeDiscoverNext,discoverReturnPath,ownerFor,updateProductNavigation};
});
