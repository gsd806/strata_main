/* global module, require */
(function(root,factory){
  const progress=typeof module==="object"&&module.exports?require("./discover-progress"):root.StrataDiscoverProgress;
  const api=factory(progress);
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscoverRender=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(Progress){
  "use strict";

  function createProgressRenderer({element,escapeHtml,exerciseName,readableDate,days}){
    function renderList(target,items,kind,hasMore){
      const node=element(target);if(!node)return;
      if(!items.length){node.innerHTML=`<p class="progress-empty">${kind==="improvement"?(hasMore?"No new logged high appears in the 100 most recent workouts. Older workouts are not included here.":"Repeat an exercise to compare its highest logged value with earlier records."):(hasMore?"No logged high appears in the 100 most recent workouts. Open full history for older records.":"Complete a workout to record your first values.")}</p>`;return;}
      node.innerHTML=items.map((item)=>{
        const detail=kind==="improvement"?`${item.previous.formatted} → ${item.metric.formatted}`:`${item.metric.label} · ${item.metric.formatted}`;
        return `<article class="progress-record"><span aria-hidden="true">${kind==="improvement"?"↑":"◆"}</span><div><strong>${escapeHtml(exerciseName(item.exerciseId))}</strong><p>${escapeHtml(detail)}</p><small>${escapeHtml(readableDate(item.workout.date))} · same format and unit</small></div></article>`;
      }).join("");
    }
    function render({workouts,weeklyPlan,historyAvailable,historyLoading=false,hasMore,now=new Date()}){
      if(!element("progressAdherence"))return;
      element("repeatImprovementScope").textContent=hasMore?"Within the 100 most recent workouts":"Earlier records in loaded history";element("repeatImprovementTitle").textContent="New logged highs";element("personalBestScope").textContent=hasMore?"Within the 100 most recent workouts":"From your recorded history";element("personalBestTitle").textContent="Best logged values";
      element("progressFirstWorkout").hidden=true;element("progressHistoryContent").hidden=true;
      const load=element("progressLoadState");if(load)load.hidden=historyAvailable;
      if(!historyAvailable){
        if(element("progressLoadTitle"))element("progressLoadTitle").textContent=historyLoading?"Loading your workout history…":"Workout history couldn’t load";
        if(element("progressLoadMessage"))element("progressLoadMessage").textContent=historyLoading?"Checking your saved workouts.":"Check your connection and try again to review your saved workouts.";
        if(element("progressRetry"))element("progressRetry").hidden=historyLoading;
        return;
      }
      const data=Progress.snapshot({workouts,weeklyPlan,days,now,hasMore});
      if(!data.completed.length){
        element("progressFirstWorkout").hidden=false;const action=element("progressFirstAction");
        if(action){const active=Progress.safeWorkoutList(workouts).find(workout=>workout.status==="active"&&workout.id.trim()),planned=Progress.scheduledDays(weeklyPlan,days).length>0;action.href=active?`/workout.html#resume=${encodeURIComponent(active.id)}`:planned?"/workout.html":"/planner.html";action.textContent=active?"Resume workout":planned?"Start first workout":"Build your first week";}return;
      }
      element("progressHistoryContent").hidden=false;
      element("progressAdherence").textContent=data.adherence;element("progressAdherenceDetail").textContent=data.adherenceDetail;element("progressVolume").textContent=data.volume;element("progressVolumeDetail").textContent=data.volumeDetail;element("progressConsistency").textContent=data.consistency;element("progressConsistencyDetail").textContent=data.consistencyDetail;element("progressSessions").textContent=data.sessions;element("progressSessionsDetail").textContent=data.sessionsDetail;
      renderList("repeatImprovementList",data.records.improvements,"improvement",hasMore);renderList("personalBestList",data.records.bests,"best",hasMore);
    }
    return{render,renderList};
  }

  return{createProgressRenderer};
});
