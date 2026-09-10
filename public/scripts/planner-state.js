/* global module, require */
(function(root,factory){
  const api=factory(typeof module==="object"&&module.exports?require("./planner-logic"):root.StrataPlannerLogic);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataPlannerState=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(logic){
  "use strict";

  const SELECTED_DAY_PREFIX="strata_planner_selected_day_v1:";

  function createState({desktopPageSize=32}={}){
    return{
      exercises:[],plan:null,user:null,query:"",group:"all",drag:null,selectedDay:"Monday",
      ready:false,guest:false,guestRaw:null,saveTimer:null,savePromise:null,lastSaveError:null,planUpdatedAt:0,revision:0,savedRevision:0,navigating:false,libraryLimit:desktopPageSize,
      accountChanged:false,undoRemoval:null,replacement:null,templatePreview:null,draftKey:"",draftValue:"",recoverySource:null,recoveredDrafts:[],draftStorageError:false,
      conflictDraft:null,conflictLatest:null,conflictReview:false,csrfToken:"",sharedPlans:[],sharedPlansLoaded:false,sharedPlansRequest:0,shareBusy:false,pendingUnpublish:"",
      activationCandidates:[],activationCandidateId:"",activationBusy:false,activationDirectClaim:false,copyPreview:null,copyTrigger:null
    };
  }

  function selectionScope({guest,userId}){return guest?"guest":`user-${encodeURIComponent(String(userId||""))}`;}
  function selectionKey(context){return `${SELECTED_DAY_PREFIX}${selectionScope(context)}`;}
  function firstTrainingDay(plan){return logic.DAYS.find(day=>!logic.isRestDay(plan,day))||"Monday";}
  function readSelectedDay(storage,context,plan){
    let selected="";
    try{selected=String(storage.getItem(selectionKey(context))||"");}catch{/* Storage is optional. */}
    return logic.DAYS.includes(selected)&&!logic.isRestDay(plan,selected)?selected:firstTrainingDay(plan);
  }
  function writeSelectedDay(storage,context,plan,day){
    if(!logic.DAYS.includes(day)||logic.isRestDay(plan,day))return false;
    try{storage.setItem(selectionKey(context),day);return true;}catch{return false;}
  }

  return{SELECTED_DAY_PREFIX,createState,selectionScope,selectionKey,firstTrainingDay,readSelectedDay,writeSelectedDay};
});
