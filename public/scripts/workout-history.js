/* global module */
(function(root,factory){
  "use strict";
  const history=factory();
  if(typeof module==="object"&&module.exports)module.exports=history;
  else root.StrataWorkoutHistory=history;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function create({$,state,workout:W,view,esc,chart,accountRead,saveError,blockSession,renderPlan,mergeMemory,memoryReadyFor,renderSession,loadWorkoutMemory,fetchWorkout,selectWorkout,toast,recover,locationLike=globalThis.location,historyLike=globalThis.history}){

    function render(){
      const completed=state.history.filter((item)=>item.status==="completed"),sets=completed.reduce((total,item)=>total+item.completedSets,0),active=state.history.filter((item)=>item.status==="active").length;
      const recoveryIds=new Set(state.recoveries.filter((record)=>record.dirty).map((record)=>record.workout.id));
      const visibleHistory=state.history.filter((item)=>item.status!=="active"||!recoveryIds.has(item.id));
      $("historyStats").innerHTML=`<div><strong>${completed.length}</strong><span>Completed · loaded history</span></div><div><strong>${sets}</strong><span>Sets in completed sessions</span></div><div><strong>${active}</strong><span>Open · loaded history</span></div>`;
      $("historyList").innerHTML=visibleHistory.length?visibleHistory.map((item)=>`<article class="history-row"><div><span class="status-chip${item.status==="active"?" active":""}">${item.status==="active"?"In progress":"Completed"}</span><h4>${esc(item.title)}</h4><p>${esc(item.date)} · ${item.completedSets}/${item.totalSets} sets · ${W.duration(item.elapsedSeconds)}</p></div><button type="button" class="button secondary compact" data-history="${esc(item.id)}">${item.status==="active"?"Resume":"View"}</button></article>`).join(""):recoveryIds.size?"<div class='empty-state'><strong>Review your device draft above.</strong>The saved session stays separate until you choose which work to keep.</div>":"<div class='empty-state'><strong>Your story starts with one session.</strong>Start from your plan and your completed work will appear here.</div>";
      $("loadMore").hidden=!state.hasMore;$("loadMore").disabled=state.historyBusy;chart.renderControls();
    }

    async function load({more=false}={}){
      if(state.historyBusy||state.blocked)return;
      state.historyBusy=true;$("refreshHistory").disabled=true;$("loadMore").disabled=true;$("historyError").hidden=true;
      try{
        const result=await accountRead(`/api/workouts?limit=20&offset=${more?state.offset:0}&memory=1`);
        if(!Array.isArray(result.workouts)||typeof result.hasMore!=="boolean")throw new Error("Workout history returned an incomplete response. Try again.");
        state.offset=(more?state.offset:0)+result.workouts.length;
        const combined=more?[...state.history,...result.workouts]:result.workouts;
        state.history=[...new Map(combined.map((item)=>[item.id,item])).values()].sort((a,b)=>b.startedAt-a.startedAt);
        if(more)mergeMemory(result.workouts);else{state.memoryHistory=result.workouts;state.memoryExhausted=!result.hasMore;state.memoryError="";}
        state.hasMore=result.hasMore;renderPlan();render();
        if(state.workout){state.memoryReady=memoryReadyFor(state.workout);renderSession();if(!state.memoryReady)void loadWorkoutMemory(state.workout.id);}
      }catch(error){
        if(error.status===401)blockSession();
        $("historyError").hidden=false;$("historyError").textContent=saveError(error);
      }finally{state.historyBusy=false;$("refreshHistory").disabled=false;$("loadMore").disabled=false;}
    }

    async function openDetail(id){
      if(state.detailBusy||state.blocked)return;
      state.detailBusy=true;
      try{
        const workout=await fetchWorkout(id);if(!workout)throw new Error("This session is no longer in saved history. Refresh the history list.");
        if(workout.status==="active"){
          if(state.workout?.status==="active"&&state.workout.id!==workout.id){toast("Choose Save & close for your current session before switching. You can resume it later.");return;}
          if(state.dirty){toast("Review and save your current device changes before resuming a saved session.");return;}
          selectWorkout(workout);$("sessionPanel").scrollIntoView({block:"start"});return;
        }
        $("detailTitle").textContent=workout.title;$("detailBody").innerHTML=view.detailMarkup(workout);$("detailDialog").showModal();
      }catch(error){toast(saveError(error));}
      finally{state.detailBusy=false;}
    }

    async function openRequested(){
      const prefix="#resume=";
      if(!locationLike.hash.startsWith(prefix))return false;
      let requested="";try{requested=decodeURIComponent(locationLike.hash.slice(prefix.length));}catch{return false;}
      const recoveryIndex=state.recoveries.findIndex((record)=>record.dirty&&record.workout.id===requested);
      const clearRequest=()=>{const url=new URL(locationLike.href);url.hash="";historyLike.replaceState(null,"",url);};
      if(recoveryIndex>=0){await recover(recoveryIndex);clearRequest();return true;}
      const active=state.history.find((item)=>item.id===requested&&item.status==="active");
      if(!active)return false;
      await openDetail(active.id);clearRequest();return true;
    }

    function upsert(summary){
      state.history=[summary,...state.history.filter((item)=>item.id!==summary.id)].sort((a,b)=>b.startedAt-a.startedAt);
      mergeMemory([summary]);render();
    }

    return{render,load,openDetail,openRequested,upsert};
  }

  return{create};
});
