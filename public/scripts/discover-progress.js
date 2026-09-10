/* global module */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscoverProgress=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function localNoon(date,offset=0){return new Date(date.getFullYear(),date.getMonth(),date.getDate()+offset,12);}
  function localDateKey(date){return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,"0")}-${String(date.getDate()).padStart(2,"0")}`;}
  function weekContext(now=new Date(),days=[]){
    const today=localNoon(now),todayIndex=(today.getDay()+6)%7,monday=localNoon(today,-todayIndex),dates=days.map((day,index)=>({day,date:localNoon(monday,index)}));
    return{today,todayIndex,monday,dates,dateKeys:new Set(dates.map(({date})=>localDateKey(date)))};
  }
  function safeWorkoutList(value){return Array.isArray(value)?value.filter((workout)=>workout&&typeof workout==="object"&&typeof workout.id==="string"&&["active","completed"].includes(workout.status)&&Array.isArray(workout.exerciseSummaries)):[];}
  function completedWorkouts(workouts){return safeWorkoutList(workouts).filter((workout)=>workout.status==="completed").sort((a,b)=>Number(b.startedAt||0)-Number(a.startedAt||0));}
  function completedThisWeek(workouts,days,now=new Date()){const week=weekContext(now,days);return completedWorkouts(workouts).filter((workout)=>week.dateKeys.has(String(workout.date||"")));}
  function scheduledDays(plan,days){return days.filter((day)=>Array.isArray(plan?.days?.[day])&&plan.days[day].length);}
  function formatDuration(seconds){
    const safe=Math.max(0,Math.round(Number(seconds)||0));
    if(safe<60)return `${safe} sec`;
    const minutes=Math.floor(safe/60),remainder=safe%60;
    return remainder?`${minutes}m ${remainder}s`:`${minutes} min`;
  }
  function compactNumber(value){
    const number=Math.round((Number(value)||0)*10)/10;
    return new Intl.NumberFormat(undefined,{maximumFractionDigits:1,notation:Math.abs(number)>=10_000?"compact":"standard"}).format(number);
  }
  function summaryMetric(summary){
    if(!summary||Number(summary.completedSets)<=0)return null;
    if(summary.measurement==="timed"&&Number(summary.maxSeconds)>0)return{key:"time",value:Number(summary.maxSeconds),label:"Longest set",formatted:formatDuration(summary.maxSeconds),higher:true};
    if(summary.loadType==="external"&&Number(summary.maxWeight)>0){const unit=summary.unit==="lb"?"lb":"kg";return{key:`load:${unit}`,value:Number(summary.maxWeight),label:"Top load",formatted:`${compactNumber(summary.maxWeight)} ${unit}`,higher:true};}
    if(summary.loadType==="assisted"&&summary.minAssistance!=null&&Number(summary.maxReps)>0){const unit=summary.unit==="lb"?"lb":"kg";return{key:`assistance:${unit}`,value:Number(summary.minAssistance),label:"Assistance",formatted:`${compactNumber(summary.minAssistance)} ${unit} assistance`,higher:false};}
    if(Number(summary.maxReps)>0)return{key:"reps",value:Number(summary.maxReps),label:"Most reps",formatted:`${compactNumber(summary.maxReps)} reps`,higher:true};
    return null;
  }
  function summaryKey(summary,metric){return `${String(summary.exerciseId||"")}:${String(summary.measurement||"")}:${String(summary.loadType||"")}:${String(summary.unit||"")}:${metric.key}`;}
  function chartFormatKey(summary){
    if(!summary||typeof summary.exerciseId!=="string"||!summary.exerciseId.trim()||!["reps","timed"].includes(summary.measurement)||!["external","bodyweight","assisted"].includes(summary.loadType)||!["kg","lb"].includes(summary.unit))return"";
    return JSON.stringify([summary.exerciseId,summary.measurement,summary.loadType,summary.unit]);
  }
  function chartFormatLabel(summary){
    if(!chartFormatKey(summary))return"";
    const measurement=summary.measurement==="timed"?"Timed":"Repetitions",load=summary.loadType==="external"?"External load":summary.loadType==="assisted"?"Assisted":"Bodyweight";
    return `${measurement} · ${load}${summary.loadType==="bodyweight"?"":` · ${summary.unit}`}`;
  }
  function chartMetrics(summary){
    if(!chartFormatKey(summary))return[];
    if(summary.measurement==="timed")return[{key:"maxSeconds",label:"Longest set",unit:"seconds"},{key:"totalSeconds",label:"Total time",unit:"seconds"}];
    if(summary.loadType==="external")return[{key:"maxWeight",label:"Heaviest completed set",unit:summary.unit},{key:"volume",label:"External load × reps",unit:`${summary.unit}·reps`},{key:"maxReps",label:"Most reps in one set",unit:"reps"}];
    if(summary.loadType==="assisted")return[{key:"minAssistance",label:"Least assistance",unit:`${summary.unit} assistance`},{key:"maxReps",label:"Most reps in one set",unit:"reps"},{key:"totalReps",label:"Total repetitions",unit:"reps"}];
    return[{key:"maxReps",label:"Most reps in one set",unit:"reps"},{key:"totalReps",label:"Total repetitions",unit:"reps"}];
  }
  function chartSeries(workouts,key,metric,limit=12){
    const bounded=Math.max(1,Math.min(24,Math.round(Number(limit)||12))),points=[];
    for(const workout of completedWorkouts(workouts).slice().reverse()){
      const startedAt=Number(workout.startedAt),date=String(workout.date||""),parsed=Date.parse(`${date}T00:00:00Z`);if(!Number.isFinite(startedAt)||startedAt<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed)||new Date(parsed).toISOString().slice(0,10)!==date)continue;
      const matches=workout.exerciseSummaries.filter((summary)=>chartFormatKey(summary)===key&&Number(summary.completedSets)>0),sample=matches[0];
      if(!sample||!chartMetrics(sample).some((item)=>item.key===metric))continue;
      const values=matches.map((summary)=>Number(summary[metric])).filter((value)=>Number.isFinite(value)&&value>=0);if(!values.length)continue;
      const value=metric.startsWith("max")||metric==="minAssistance"?(metric==="minAssistance"?Math.min(...values):Math.max(...values)):values.reduce((total,current)=>total+current,0);
      points.push({id:workout.id,date,startedAt,value:Math.round(value*100)/100});
    }
    return points.slice(-bounded);
  }
  function chartEntries(workouts){
    const summaries=new Map();
    for(const workout of completedWorkouts(workouts))for(const summary of workout.exerciseSummaries){const key=chartFormatKey(summary);if(key&&!summaries.has(key)&&Number(summary.completedSets)>0)summaries.set(key,summary);}
    return[...summaries].map(([key,summary])=>{
      const metrics=chartMetrics(summary).map((metric)=>({...metric,points:chartSeries(workouts,key,metric.key)})).filter((metric)=>metric.points.length);
      const lastStartedAt=Math.max(0,...metrics.flatMap((metric)=>metric.points.map((point)=>point.startedAt)));
      return{key,exerciseId:summary.exerciseId,format:chartFormatLabel(summary),lastStartedAt,metrics,pointCount:Math.max(0,...metrics.map((metric)=>metric.points.length))};
    }).filter((entry)=>entry.metrics.length).sort((a,b)=>b.lastStartedAt-a.lastStartedAt||a.key.localeCompare(b.key));
  }
  function preferredChartEntry(entries,currentKey=""){
    const safe=Array.isArray(entries)?entries:[];return safe.find((entry)=>entry.key===currentKey)||safe.find((entry)=>entry.pointCount>=2)||safe[0]||null;
  }
  function preferredChartMetric(entry,currentMetric=""){
    const metrics=Array.isArray(entry?.metrics)?entry.metrics:[];return metrics.find((metric)=>metric.key===currentMetric)||metrics.find((metric)=>metric.points.length>=2)||metrics[0]||null;
  }
  function progressRecords(workouts){
    const chronological=completedWorkouts(workouts).slice().reverse(),previous=new Map(),improvements=[],bests=new Map();
    for(const workout of chronological)for(const summary of workout.exerciseSummaries){
      const metric=summaryMetric(summary);if(!metric)continue;
      const key=summaryKey(summary,metric),earlier=previous.get(key),better=earlier!==undefined&&(metric.higher?metric.value>earlier.value:metric.value<earlier.value);
      if(better)improvements.push({key,exerciseId:summary.exerciseId,metric,previous:earlier.metric,workout});
      if(earlier===undefined||(metric.higher?metric.value>earlier.value:metric.value<earlier.value))previous.set(key,{value:metric.value,metric});
      const best=bests.get(key);if(!best||(metric.higher?metric.value>best.metric.value:metric.value<best.metric.value))bests.set(key,{key,exerciseId:summary.exerciseId,metric,workout});
    }
    const latestImprovements=new Map();for(const item of improvements.slice().reverse())if(!latestImprovements.has(item.key))latestImprovements.set(item.key,item);
    return{improvements:[...latestImprovements.values()].slice(0,4),bests:[...bests.values()].sort((a,b)=>Number(b.workout.startedAt||0)-Number(a.workout.startedAt||0)).slice(0,4)};
  }
  function fourWeekConsistency(workouts,days,now=new Date()){
    const currentMonday=weekContext(now,days).monday.getTime(),weekMilliseconds=7*24*60*60*1000,weeks=new Set();
    for(const workout of workouts){
      const date=typeof workout.date==="string"&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(workout.date)?new Date(`${workout.date}T12:00:00`):new Date(Number(workout.completedAt||workout.startedAt||0));
      if(Number.isNaN(date.getTime()))continue;
      const index=Math.floor((currentMonday-weekContext(date,days).monday.getTime())/weekMilliseconds);if(index>=0&&index<4)weeks.add(index);
    }
    return weeks.size;
  }
  function snapshot({workouts,weeklyPlan,days,now=new Date(),hasMore=false}){
    const completed=completedWorkouts(workouts),weekSessions=completedThisWeek(completed,days,now),planned=scheduledDays(weeklyPlan,days),completedDays=new Set(weekSessions.map((workout)=>String(workout.planDay||"")).filter((day)=>planned.includes(day))),volumes=new Map();
    for(const workout of weekSessions)for(const summary of workout.exerciseSummaries){if(summary.loadType!=="external"||!(Number(summary.volume)>0))continue;const unit=summary.unit==="lb"?"lb":"kg";volumes.set(unit,(volumes.get(unit)||0)+Number(summary.volume));}
    const volumeLabel=[...volumes].map(([unit,value])=>`${compactNumber(value)} ${unit}·reps`).join(" + ")||"No load logged";
    return{
      completed,weekSessions,planned,records:progressRecords(completed),
      adherence:planned.length?`${completedDays.size} / ${planned.length}`:`${weekSessions.length}`,
      adherenceDetail:planned.length?`${completedDays.size} planned ${completedDays.size===1?"day":"days"} completed out of ${planned.length} this calendar week.`:`${weekSessions.length} completed ${weekSessions.length===1?"session":"sessions"} this week; no weekly plan is set.`,
      volume:volumeLabel,volumeDetail:volumes.size?"External load × repetitions from completed sets this calendar week.":"Only completed sets with an external load contribute to this measure.",
      consistency:`${fourWeekConsistency(completed,days,now)} / 4 weeks`,consistencyDetail:"Calendar weeks with at least one completed, saved session.",
      sessions:`${completed.length}${hasMore?"+":""}`,sessionsDetail:hasMore?`${completed.length} completed in the 100 most recent sessions. Older history is available in the workout log.`:`${weekSessions.length} completed this week · in-progress sessions are excluded.`
    };
  }

  return{chartEntries,chartFormatKey,chartFormatLabel,chartMetrics,chartSeries,compactNumber,completedThisWeek,completedWorkouts,formatDuration,fourWeekConsistency,preferredChartEntry,preferredChartMetric,progressRecords,safeWorkoutList,scheduledDays,snapshot,summaryKey,summaryMetric,weekContext};
});
