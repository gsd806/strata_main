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
      adherenceDetail:planned.length?`${completedDays.size} of ${planned.length} currently planned days have a completed workout this calendar week. Some sets may be unfinished.`:`${weekSessions.length} completed ${weekSessions.length===1?"workout":"workouts"} this week; no weekly plan is set.`,
      volume:volumeLabel,volumeDetail:volumes.size?"External load × repetitions from completed sets this calendar week.":"Only completed sets with an external load contribute to this measure.",
      consistency:`${fourWeekConsistency(completed,days,now)} / 4 weeks`,consistencyDetail:"Calendar weeks with at least one completed workout in the last four calendar weeks.",
      sessions:`${completed.length}${hasMore?"+":""}`,sessionsDetail:hasMore?`${completed.length} completed in the 100 most recent workouts. Older history is available in the workout log.`:`${weekSessions.length} completed this week · in-progress workouts are excluded.`
    };
  }

  return{compactNumber,completedThisWeek,completedWorkouts,formatDuration,fourWeekConsistency,progressRecords,safeWorkoutList,scheduledDays,snapshot,summaryKey,summaryMetric,weekContext};
});
