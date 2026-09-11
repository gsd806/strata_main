/* global module, require */
(function(root,factory){
  const progress=typeof module==="object"&&module.exports?require("./discover-progress"):root.StrataDiscoverProgress;
  const api=factory(progress);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscoverRender=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(Progress){
  "use strict";

  function createProgressRenderer({element,escapeHtml,exerciseName,readableDate,days}){
    function setHidden(id,hidden){const node=element(id);if(node)node.hidden=hidden;}
    function clearMetrics(){for(const id of ["progressAdherence","progressVolume","progressConsistency","progressSessions"]){const node=element(id);if(node)node.textContent="";}}
    function renderList(target,items,kind,hasMore){
      const node=element(target);if(!node)return;
      if(!items.length){node.innerHTML=`<p class="progress-empty">${kind==="improvement"?(hasMore?"No like-for-like improvement appears in the 100 most recent sessions. Older sessions are not included here.":"Repeat an exercise in two completed sessions to see a like-for-like improvement."):(hasMore?"No comparable performance high appears in the 100 most recent sessions. Open full history for older records.":"Complete a workout to establish your first logged personal best.")}</p>`;return;}
      node.innerHTML=items.map((item)=>{
        const detail=kind==="improvement"?`${item.previous.formatted} → ${item.metric.formatted}`:`${item.metric.label} · ${item.metric.formatted}`;
        return `<article class="progress-record"><span aria-hidden="true">${kind==="improvement"?"↑":"◆"}</span><div><strong>${escapeHtml(exerciseName(item.exerciseId))}</strong><p>${escapeHtml(detail)}</p><small>${escapeHtml(readableDate(item.workout.date))} · same format and unit</small></div></article>`;
      }).join("");
    }
    function render({workouts,weeklyPlan,historyAvailable,historyStatus,historyError="",hasMore,now=new Date()}){
      const requestedStatus=["loading","ready","error"].includes(historyStatus)?historyStatus:(historyAvailable?"ready":"error");
      const status=requestedStatus==="ready"&&!historyAvailable?"error":requestedStatus;
      setHidden("progressLoadingState",status!=="loading");setHidden("progressLoadError",status!=="error");setHidden("progressFirstWorkout",true);setHidden("progressHistoryContent",true);
      const retry=element("progressRetry");if(retry)retry.disabled=status==="loading";
      if(status==="loading"){
        const message=element("progressLoadingMessage");if(message)message.textContent="Loading your completed workouts…";
        clearMetrics();return{status};
      }
      if(status==="error"){
        const message=element("progressLoadErrorMessage");if(message)message.textContent=historyError||"We couldn't load workout history. Your saved Plan was not changed.";
        clearMetrics();return{status};
      }
      if(!element("progressAdherence"))return{status};
      element("repeatImprovementScope").textContent=hasMore?"Within the 100 most recent sessions":"Comparable sessions";element("repeatImprovementTitle").textContent=hasMore?"RECENT REPEAT IMPROVEMENTS":"REPEAT IMPROVEMENTS";element("personalBestScope").textContent=hasMore?"Within the 100 most recent sessions":"From your recorded history";element("personalBestTitle").textContent=hasMore?"RECENT PERFORMANCE HIGHS":"LOGGED PERSONAL BESTS";
      const data=Progress.snapshot({workouts,weeklyPlan,days,now,hasMore});
      if(!data.completed.length){setHidden("progressFirstWorkout",false);clearMetrics();return{status,empty:true};}
      setHidden("progressHistoryContent",false);
      element("progressAdherence").textContent=data.adherence;element("progressAdherenceDetail").textContent=data.adherenceDetail;element("progressVolume").textContent=data.volume;element("progressVolumeDetail").textContent=data.volumeDetail;element("progressConsistency").textContent=data.consistency;element("progressConsistencyDetail").textContent=data.consistencyDetail;element("progressSessions").textContent=data.sessions;element("progressSessionsDetail").textContent=data.sessionsDetail;
      renderList("repeatImprovementList",data.records.improvements,"improvement",hasMore);renderList("personalBestList",data.records.bests,"best",hasMore);
      return{status,empty:false};
    }
    return{render,renderList};
  }

  return{createProgressRenderer};
});
