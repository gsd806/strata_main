/* global module */
(function(root,factory){
  "use strict";
  const context=factory();
  if(typeof module==="object"&&module.exports)module.exports=context;
  else root.StrataWorkoutContext=context;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  function activeWorkout(state){
    return state.workout?.status==="active"?state.workout:state.recoveries.find(record=>record.dirty&&record.workout.status==="active")?.workout||state.history.find(item=>item.status==="active")||null;
  }
  function create({$,state,workout:W,insights,view,esc,exercise,openDetail,recover}){
    function render(){
      const items=state.plan?.days?.[state.day]||[],hasWeek=W.DAYS.some(day=>state.plan?.days?.[day]?.length),active=activeWorkout(state);
      const index=Math.max(0,W.DAYS.indexOf(state.day)),scheduledDay=[...W.DAYS.slice(index+1),...W.DAYS.slice(0,index)].find(day=>state.plan?.days?.[day]?.length);
      const start=$("startWorkout"),resume=$("resumeWorkout"),choose=$("chooseScheduledDay"),build=$("openPlannerFromEmpty"),brief=$("planBrief"),preview=$("planPreviewDetails");
      $("planDay").innerHTML=W.DAYS.map(day=>`<option value="${day}"${day===state.day?" selected":""}>${day}${day===W.today()?" · today":""}</option>`).join("");
      $("todayLabel").textContent=active?"In progress":state.day===W.today()?`Today · ${W.localDate()}`:"Selected day";
      $("planDayField").hidden=!hasWeek||!!active;$("editWorkoutWeek").hidden=!hasWeek||!!active;
      start.hidden=!items.length||!!active;start.disabled=state.blocked||state.historyBusy||!state.historyLoaded||!!state.historyLoadError;
      resume.hidden=!active;resume.disabled=state.blocked||state.detailBusy||state.historyBusy;
      choose.hidden=!!active||!!items.length||!scheduledDay;build.hidden=!!active||hasWeek;
      $("differentWorkout").hidden=!items.length||!!active;
      $("trainHistoryNotice").hidden=!state.historyLoadError;$("trainHistoryMessage").textContent=state.historyLoadError?"Workout history could not be loaded. Retry before starting another workout.":"";
      preview.hidden=!items.length||!!active;if(preview.hidden)preview.open=false;
      brief.hidden=!items.length||!!active;brief.innerHTML="";$("planPreview").innerHTML="";
      $("startHint").textContent="";
      if(active){
        const counts=Array.isArray(active.entries)?W.progress(active):{completed:active.completedSets,total:active.totalSets};
        $("startTitle").textContent=active.title;$("planStatus").textContent=`${active.date} · ${counts.completed} of ${counts.total} sets logged.`;
        $("startHint").textContent=state.recoveries.some(record=>record.dirty&&record.workout.id===active.id)?"Resume to review your device changes and the latest saved workout.":"Continue your existing workout before starting another.";
        return;
      }
      $("startTitle").textContent=state.day===W.today()?"Today’s workout":`${state.day} workout`;
      if(!hasWeek){$("planStatus").textContent="You have not built a weekly plan yet.";return;}
      if(!items.length){
        $("planStatus").textContent=state.day===W.today()?"Nothing is scheduled for today.":`Nothing is scheduled for ${state.day}.`;
        $("startHint").textContent="Choose another day or edit your week.";
        if(scheduledDay){choose.dataset.day=scheduledDay;choose.textContent=`Choose ${scheduledDay} workout`;}else delete choose.dataset.day;
        return;
      }
      const summary=W.planDaySummary(state.plan,state.day),equipment=[...new Set(items.map(item=>exercise(item.exerciseId).equipment||"Unspecified"))];
      $("planStatus").textContent=state.day===W.today()?"Scheduled in your weekly plan.":"From your weekly plan.";
      start.textContent="Start workout";
      brief.innerHTML=`<div><span>Exercises</span><strong>${summary.movements}</strong></div><div><span>Working sets</span><strong>${summary.workingSets}</strong></div><div><span>Estimated duration</span><strong>${insights.estimateMinutes(items)} min</strong></div><div class="brief-equipment"><span>Equipment</span><strong>${esc(equipment.join(" · "))}</strong></div>`;
      $("planPreview").innerHTML=view.planPreview(items);
      $("startHint").textContent=state.historyLoadError?"":state.historyBusy||!state.historyLoaded?"Checking for a workout in progress…":"Duration is a planning estimate based on sets, rest, and transitions.";
    }
    async function resume(){
      if(state.blocked||state.detailBusy||state.historyBusy)return;
      const active=activeWorkout(state);if(!active)return;
      const index=state.recoveries.findIndex(record=>record.dirty&&record.workout.id===active.id);
      if(index>=0)await recover(index);else await openDetail(active.id);
    }
    function focusPrimary(){
      ["resumeWorkout","startWorkout","chooseScheduledDay","openPlannerFromEmpty"].map($).find(element=>!element.hidden&&!element.disabled)?.focus();
    }
    return{render,resume,focusPrimary};
  }
  return{activeWorkout,create};
});
