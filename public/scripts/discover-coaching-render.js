/* global module */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscoverCoachingRender=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  const number=(value)=>Math.round(Number(value)||0).toLocaleString();
  const dateLabel=(value)=>{const date=new Date(`${value}T12:00:00`);return Number.isNaN(date.getTime())?String(value||""):new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(date);};
  const localDate=()=>{const date=new Date();return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;};
  const goalLabel=(goal)=>({fat_loss:"Fat-loss target",maintenance:"Maintenance target",muscle_gain:"Muscle-gain target"}[goal]||"Selected target");
  const equationLabel=(equation)=>equation==="katch_mcardle"?"Katch–McArdle · body-fat input":"Mifflin–St Jeor · age, height, weight, equation coefficient";
  const escape=(value)=>String(value??"").replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[character]));

  function projectionSvg(profile,scenarios,displayWeight){
    const points=[{weeks:0,weightKg:Number(profile.weightKg),rangeKg:[Number(profile.weightKg),Number(profile.weightKg)]},...(Array.isArray(scenarios)?scenarios:[])].filter((item)=>Number.isFinite(Number(item.weightKg))&&Array.isArray(item.rangeKg));
    if(points.length<2)return '<p class="coaching-field-intro">A projection appears after a complete energy estimate is available.</p>';
    const width=720,height=210,pad={left:54,right:18,top:18,bottom:38},weeks=Math.max(...points.map((item)=>Number(item.weeks))),values=points.flatMap((item)=>[Number(item.weightKg),...item.rangeKg.map(Number)]),low=Math.min(...values)-.5,high=Math.max(...values)+.5,span=Math.max(1,high-low);
    const x=(week)=>pad.left+(Number(week)/weeks)*(width-pad.left-pad.right),y=(weight)=>pad.top+(high-Number(weight))/span*(height-pad.top-pad.bottom);
    const line=points.map((item,index)=>`${index?"L":"M"}${x(item.weeks).toFixed(1)},${y(item.weightKg).toFixed(1)}`).join(" ");
    const range=[...points.map((item)=>`${x(item.weeks).toFixed(1)},${y(Math.max(...item.rangeKg)).toFixed(1)}`),...points.slice().reverse().map((item)=>`${x(item.weeks).toFixed(1)},${y(Math.min(...item.rangeKg)).toFixed(1)}`)].join(" ");
    const grids=points.map((item)=>`<line class="projection-grid" x1="${x(item.weeks)}" y1="${pad.top}" x2="${x(item.weeks)}" y2="${height-pad.bottom}"/><text x="${x(item.weeks)}" y="${height-13}" text-anchor="middle">${item.weeks?`${item.weeks} wk`:"Now"}</text>`).join("");
    const labels=points.slice(1).map((item)=>`<circle cx="${x(item.weeks)}" cy="${y(item.weightKg)}" r="4" fill="#657a22"/><text x="${x(item.weeks)}" y="${Math.max(12,y(item.weightKg)-10)}" text-anchor="middle">${escape(displayWeight(item.weightKg))}</text>`).join("");
    const valuesList=points.slice(1).map((item)=>`<div><dt>${number(item.weeks)} weeks</dt><dd><strong>${escape(displayWeight(item.weightKg))}</strong><span>Scenario range ${escape(displayWeight(Math.min(...item.rangeKg)))}–${escape(displayWeight(Math.max(...item.rangeKg)))}</span></dd></div>`).join("");
    return `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Estimated weight scenario over ${weeks} weeks"><polygon class="projection-range" points="${range}"/><g>${grids}</g><path class="projection-line" d="${line}"/>${labels}</svg><dl class="coaching-projection-data">${valuesList}</dl>`;
  }

  function createRenderer({element,ui}){
    const el=element;
    function show(state){el("coachingLoading").hidden=state!=="loading";el("coachingError").hidden=state!=="error";el("coachingSetup").hidden=state!=="setup";el("coachingDashboard").hidden=state!=="dashboard";}
    function error(message){el("coachingErrorMessage").textContent=message||"Check your connection, then try again.";show("error");}
    function showProgressSetup(enabled){el("progressCalorieSetup").hidden=!enabled;el("progressCalorieCard").hidden=enabled;}
    function clearPrivate(){
      for(const id of ["coachingWeekGrid","coachingCalorieWeek","coachingProjectionChart","coachingMethodList","coachingProgressSummary","coachingGoalComparison","progressCoachingSummary"])el(id).textContent="";
      for(const id of ["coachingLogDate","progressCoachingLogDate"])el(id).textContent="";
      for(const id of ["coachingCaloriesEaten","coachingProteinEaten","coachingCarbsEaten","coachingFatEaten","progressCoachingCaloriesEaten","progressCoachingProteinEaten","progressCoachingCarbsEaten","progressCoachingFatEaten"])el(id).value="";
      el("progressCalorieCard").hidden=true;el("progressCalorieSetup").hidden=true;show("loading");
    }
    function renderDashboard(profile,week,logs,selectedDate){
      const nutrition=week.nutrition,targets=nutrition.dailyTargets||[],targetValues=targets.map((item)=>Number(item.calories)||0),maintenance=nutrition.maintenance?.estimateRangeKcal||[],displayWeight=(kg)=>ui.displayWeight(kg,profile.measurementSystem,{projection:true});
      el("coachingWeekLabel").textContent=`${dateLabel(week.weekStart)}–${dateLabel(week.weekEnd)} · ${profile.sessionsPerWeek} workout${profile.sessionsPerWeek===1?"":"s"}`;
      el("coachingWeekExplanation").textContent=`Built from your ${profile.experience} experience, ${profile.sessionMinutes}-minute sessions, ${profile.lifestyleActivity.replaceAll("_"," ")} typical total activity, and ${profile.usualExercises.length} known exercise${profile.usualExercises.length===1?"":"s"}.`;
      el("coachingBmr").textContent=`${number(nutrition.rmrKcal)} kcal`;el("coachingBmrMethod").textContent=equationLabel(nutrition.equation);
      el("coachingTdee").textContent=maintenance.length===2?`${number(maintenance[0])}–${number(maintenance[1])} kcal`:`${number(nutrition.maintenance?.targetKcal)} kcal`;
      el("coachingGoalLabel").textContent=goalLabel(nutrition.selectedGoal);el("coachingTarget").textContent=`${number(Math.min(...targetValues))}–${number(Math.max(...targetValues))}`;el("coachingTargetDetail").textContent=`kcal by day · ${String(nutrition.goalPace||profile.goalPace).replaceAll("_"," ")} pace`;
      el("coachingWeeklyCalories").textContent=`${number(nutrition.weeklyTargetKcal)} kcal`;
      const estimates=[{goal:"fat_loss",label:"Deficit",value:nutrition.deficit?.targetKcal,detail:nutrition.deficit?.policy||"Review required"},{goal:"maintenance",label:"Maintain",value:nutrition.maintenance?.targetKcal,detail:"Estimated daily midpoint"},{goal:"muscle_gain",label:"Build",value:nutrition.bulk?.targetKcal,detail:nutrition.bulk?.policy||"Conservative surplus"}];
      el("coachingGoalComparison").innerHTML=estimates.map((item)=>`<article class="coaching-goal-option${nutrition.selectedGoal===item.goal?" is-selected":""}"${nutrition.selectedGoal===item.goal?' aria-current="true"':""}><span>${escape(item.label)}</span><strong>${item.value==null?"Review":`${number(item.value)} kcal`}</strong><small>${escape(item.detail)}</small></article>`).join("");
      el("coachingRotationLabel").textContent=`Rotation ${String(week.planKey||"").slice(0,6).toUpperCase()}`;el("coachingNextWeek").textContent=`Next plan ${dateLabel(week.nextWeekStart)}`;
      const sessions=new Map((week.training?.sessions||[]).map((session)=>[session.day,session]));
      el("coachingWeekGrid").innerHTML=DAYS.map((day,index)=>{
        const session=sessions.get(day),target=targets.find((item)=>item.day===day),date=target?.date||session?.date||"";
        if(!session)return `<article class="coaching-day-card is-rest"><header><span>${escape(day)}</span><time datetime="${escape(date)}">${escape(dateLabel(date))}</time></header><h5>Recovery day</h5><p>No programmed lifting. Normal daily movement can continue if it feels appropriate.</p></article>`;
        const exercises=(session.exercises||[]).map((exercise)=>`<li><strong>${escape(exercise.name)}</strong><span>${number(exercise.sets)} × ${escape(exercise.reps)} · ${escape(exercise.rest)}</span><span>${escape(exercise.loadingGuidance||"Use a controlled load and repeatable form.")}</span>${exercise.enteredCapability?`<span>Your reference: ${number(exercise.enteredCapability.maxSets)} × ${number(exercise.enteredCapability.maxReps)}${exercise.enteredCapability.maxWeightKg==null?"":` · ${escape(displayWeight(exercise.enteredCapability.maxWeightKg))}`}</span>`:""}</li>`).join("");
        return `<article class="coaching-day-card is-training"><header><span>${String(index+1).padStart(2,"0")} · ${escape(day)}</span><time datetime="${escape(date)}">${escape(dateLabel(date))}</time></header><h5>${escape(session.label)}</h5><p>${escape(session.rationale)}</p><ol>${exercises}</ol></article>`;
      }).join("");
      el("coachingPlanMethod").textContent=[week.training?.frequencyCaveat,week.training?.progression||"Progress gradually from repeatable, controlled work.","Every choice respects your saved equipment and movement constraints."].filter(Boolean).join(" ");
      const today=localDate(),logMap=new Map((logs||[]).map((log)=>[log.date,log]));
      el("coachingCalorieWeek").innerHTML=targets.map((target)=>{
        const macros=target.macros,kind=target.kind==="flexible_day"?"Flexible day":target.kind==="higher_training_day"?"Training fuel":target.kind==="lower_rest_day"?"Rest-day target":"Daily target";
        return `<article class="coaching-calorie-card${target.date===today?" is-today":""}${target.kind==="flexible_day"?" is-flexible":""}"><span>${escape(target.day)} · ${escape(kind)}</span><strong>${number(target.calories)} kcal</strong><small>${logMap.has(target.date)?`${number(logMap.get(target.date).calories)} kcal logged`:dateLabel(target.date)}</small>${macros?`<dl><div><dt>Protein</dt><dd>${number(macros.proteinG)} g</dd></div><div><dt>Carbs</dt><dd>${number(macros.carbsG)} g</dd></div><div><dt>Fat</dt><dd>${number(macros.fatG)} g</dd></div></dl>`:""}</article>`;
      }).join("");
      const patternText={steady:"Steady targets keep each day nearly equal.",zigzag:"Training-day zigzag moves more calories to workout days while preserving the weekly total.",flexible_day:`${profile.flexibleDay} has a higher flexible budget, balanced by the other six days.`},effective=nutrition.effectivePattern||profile.caloriePattern;el("coachingPatternExplanation").textContent=[patternText[effective]||"Each day contributes to one weekly target.",nutrition.patternFallback].filter(Boolean).join(" ");
      el("coachingProjectionChart").innerHTML=projectionSvg(profile,nutrition.weightScenarios,displayWeight);el("coachingProjectionNote").textContent="These are broad energy-balance scenarios—not promised outcomes. Water, glycogen, digestion, adherence, medication, and individual metabolism can move scale weight differently.";
      const references=(week.methodology?.references||[]).filter((item)=>/^https:\/\//.test(String(item?.url||""))).map((item)=>`<li><a href="${escape(item.url)}" rel="noreferrer" target="_blank">${escape(item.label||"Method source")} <span aria-hidden="true">↗</span></a></li>`);el("coachingMethodList").innerHTML=[...(week.methodology?.formulaSources||[]),...(week.methodology?.assumptions||[]),...(week.methodology?.cautions||[])].map((item)=>`<li>${escape(item)}</li>`).concat(references).join("");
      const keep=selectedDate&&targets.some((item)=>item.date===selectedDate)?selectedDate:(targets.find((item)=>item.date===today)?.date||targets[0]?.date||"");
      for(const id of ["coachingLogDate","progressCoachingLogDate"]){const select=el(id);select.innerHTML=targets.map((target)=>`<option value="${escape(target.date)}"${target.date===keep?" selected":""}>${escape(target.day)} · ${escape(dateLabel(target.date))} · ${number(target.calories)} kcal</option>`).join("");}
      document.querySelectorAll(".coaching-macro-log,.progress-coaching-macro").forEach((node)=>node.hidden=!profile.macroPreference);showProgressSetup(false);renderLog(profile,week,logs,keep);show("dashboard");return keep;
    }
    function renderLog(profile,week,logs,date){
      const target=(week.nutrition?.dailyTargets||[]).find((item)=>item.date===date),log=(logs||[]).find((item)=>item.date===date)||null;if(!target)return;
      el("coachingProgressTitle").textContent=`WHAT’S LEFT FOR ${target.day.toUpperCase()}.`;el("progressCalorieTitle").textContent=`LOG ${target.day.toUpperCase()}’S TOTAL.`;
      const progress=ui.calorieProgress(target.calories,log?.calories||0),label=progress.status==="over"?"Above planning target":"Remaining";
      const summary=`<div class="coaching-progress-stat"><span>Logged</span><strong>${number(progress.consumedCalories)} kcal</strong><small>${log?"Saved for this day":"Nothing logged yet"}</small></div><div class="coaching-progress-stat"><span>Day target</span><strong>${number(progress.targetCalories)} kcal</strong><small>${escape(target.kind.replaceAll("_"," "))}</small></div><div class="coaching-progress-stat"><span>${label}</span><strong>${number(progress.status==="over"?progress.overByCalories:progress.remainingCalories)} kcal</strong><small>${escape(progress.summary)}</small></div>`;
      const macrosEnabled=Boolean(profile.macroPreference);
      for(const scope of [{prefix:"coaching",summary:"coachingProgressSummary"},{prefix:"progressCoaching",summary:"progressCoachingSummary"}]){el(scope.summary).innerHTML=summary;el(`${scope.prefix}CaloriesEaten`).value=log?.calories??"";el(`${scope.prefix}ProteinEaten`).value=macrosEnabled?log?.proteinG??"":"";el(`${scope.prefix}CarbsEaten`).value=macrosEnabled?log?.carbsG??"":"";el(`${scope.prefix}FatEaten`).value=macrosEnabled?log?.fatG??"":"";el(`${scope.prefix}LogStatus`).textContent=log?`Saved for ${target.day}. Edit the totals and save again if the day changes.`:`No intake saved for ${target.day} yet.`;el(`${scope.prefix}LogDate`).value=date;}
    }
    return{clearPrivate,error,renderDashboard,renderLog,show,showProgressSetup};
  }
  return{createRenderer,dateLabel,equationLabel,goalLabel,projectionSvg};
});
