(function(root,factory){
  "use strict";
  const core=factory();
  if(typeof module==="object"&&module.exports)module.exports=core;
  else root.StrataWorkout=core;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";
  const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
  function copy(value){return JSON.parse(JSON.stringify(value));}
  function localDate(now=new Date()){
    return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,"0")}-${String(now.getDate()).padStart(2,"0")}`;
  }
  function today(now=new Date()){return DAYS[(now.getDay()+6)%7];}
  function dayFromSearch(search,now=new Date()){
    const requested=new URLSearchParams(search).get("day");
    return DAYS.includes(requested)?requested:today(now);
  }
  function id(){return globalThis.crypto?.randomUUID?.()||`workout-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
  function inferFormat(exercise,prescribedReps=""){
    const timed=/(?:\b|\d\s*)(?:s|secs?|seconds?|mins?|minutes?)\b/i.test(prescribedReps||exercise.reps||"");
    const assisted=/\bassisted\b/i.test(exercise.name||"");
    // A bench supports these catalog movements; it does not imply added resistance.
    const bodyweight=["Bodyweight","Bench"].includes(exercise.equipment);
    return{measurement:timed?"timed":"reps",loadType:assisted?"assisted":bodyweight?"bodyweight":"external",unit:"kg"};
  }
  function createWorkout(plan,day,catalog,now=Date.now()){
    const prescriptions=plan?.days?.[day];
    if(!DAYS.includes(day)||!Array.isArray(prescriptions)||!prescriptions.length)throw new Error("Add exercises to this day in Plan Studio first.");
    if(prescriptions.length>30)throw new Error("This day has more than 30 exercises. Adjust it in Plan Studio before starting.");
    const byId=new Map(catalog.map((exercise)=>[exercise.id,exercise]));
    return{id:id(),title:`${day} workout`,planDay:day,date:localDate(new Date(now)),status:"active",startedAt:now,completedAt:null,elapsedSeconds:0,restEndsAt:null,entries:prescriptions.map((item)=>{
      const exercise=byId.get(item.exerciseId);
      if(!exercise)throw new Error("This plan contains an unavailable exercise. Review it in Plan Studio.");
      if(!Number.isInteger(item.sets)||item.sets<1||item.sets>10)throw new Error("Each exercise needs 1–10 sets. Review this day in Plan Studio.");
      return{id:id(),exerciseId:item.exerciseId,...inferFormat(exercise,item.reps),prescribedReps:String(item.reps||exercise.reps||"").trim().slice(0,40),sets:Array.from({length:item.sets},()=>({reps:null,weight:null,seconds:null,completed:false}))};
    })};
  }
  function actualError(entry,set){
    if(entry.measurement==="timed"){
      if(!Number.isInteger(set.seconds)||set.seconds<1||set.seconds>3600)return "Enter actual time from 1 to 3,600 whole seconds.";
    }else if(!Number.isInteger(set.reps)||set.reps<1||set.reps>1000)return "Enter actual repetitions from 1 to 1,000.";
    if(entry.loadType!=="bodyweight"&&(typeof set.weight!=="number"||!Number.isFinite(set.weight)||set.weight<0||set.weight>1000||Math.abs(set.weight*100-Math.round(set.weight*100))>0.000001))return "Enter an explicit load from 0 to 1,000, using at most 2 decimal places.";
    return "";
  }
  function progress(workout){
    const sets=(workout?.entries||[]).flatMap((entry)=>entry.sets);
    const completed=sets.filter((set)=>set.completed===true).length;
    return{total:sets.length,completed,percent:sets.length?Math.round(completed/sets.length*100):0};
  }
  function remainingSeconds(deadline,now=Date.now()){
    return Number.isFinite(deadline)?Math.max(0,Math.ceil((deadline-now)/1000)):0;
  }
  function duration(seconds){
    const safe=Math.max(0,Math.floor(Number(seconds)||0));
    return safe>=3600?`${Math.floor(safe/3600)}:${String(Math.floor(safe%3600/60)).padStart(2,"0")}:${String(safe%60).padStart(2,"0")}`:`${Math.floor(safe/60)}:${String(safe%60).padStart(2,"0")}`;
  }
  function formatKey(entry){return JSON.stringify([entry.exerciseId,entry.measurement,entry.loadType,entry.unit]);}
  function summary(workout){
    const groups=new Map();
    for(const entry of workout.entries){
      const key=formatKey(entry);
      if(!groups.has(key))groups.set(key,{exerciseId:entry.exerciseId,measurement:entry.measurement,loadType:entry.loadType,unit:entry.unit,completedSets:0,totalReps:0,maxReps:null,maxWeight:null,volume:0,totalSeconds:0,maxSeconds:null});
      const group=groups.get(key);
      for(const set of entry.sets){
        if(!set.completed||actualError(entry,set))continue;
        group.completedSets++;
        if(entry.measurement==="reps"){
          group.totalReps+=set.reps;
          group.maxReps=Math.max(group.maxReps,set.reps);
          if(entry.loadType==="external"){
            group.maxWeight=Math.max(group.maxWeight,set.weight);
            group.volume+=set.reps*set.weight;
          }
        }else{
          group.totalSeconds+=set.seconds;
          group.maxSeconds=Math.max(group.maxSeconds,set.seconds);
        }
        if(entry.loadType==="external")group.maxWeight=Math.max(group.maxWeight,set.weight);
      }
      group.volume=Math.round(group.volume*100)/100;
    }
    const {total,completed}=progress(workout);
    return{id:workout.id,title:workout.title,planDay:workout.planDay,date:workout.date,status:workout.status,startedAt:workout.startedAt,completedAt:workout.completedAt,elapsedSeconds:workout.elapsedSeconds,revision:workout.revision,updatedAt:workout.updatedAt,totalSets:total,completedSets:completed,exerciseCount:workout.entries.length,exerciseSummaries:[...groups.values()]};
  }
  function metrics(entry){
    if(entry.measurement==="timed")return[{key:"maxSeconds",label:"Longest set",unit:"seconds"},{key:"totalSeconds",label:"Total time",unit:"seconds"}];
    if(entry.loadType==="external")return[{key:"maxWeight",label:"Heaviest completed set",unit:entry.unit},{key:"volume",label:"External load × reps",unit:`${entry.unit}·reps`},{key:"maxReps",label:"Most reps in one set",unit:"reps"}];
    return[{key:"maxReps",label:"Most reps in one set",unit:"reps"},{key:"totalReps",label:"Total repetitions",unit:"reps"}];
  }
  function series(workouts,key,metric){
    return workouts.filter((workout)=>workout.status==="completed").flatMap((workout)=>{
      const groups=workout.exerciseSummaries.filter((entry)=>formatKey(entry)===key&&entry.completedSets>0);
      if(!groups.length)return[];
      const entry=groups[0];
      if(!metrics(entry).some((item)=>item.key===metric))return[];
      const values=groups.map((group)=>group[metric]).filter((value)=>Number.isFinite(value)&&value>=0);
      if(!values.length)return[];
      const value=metric.startsWith("max")?Math.max(...values):values.reduce((total,current)=>total+current,0);
      return[{id:workout.id,date:workout.date,startedAt:workout.startedAt,value:Math.round(value*100)/100}];
    }).sort((a,b)=>a.startedAt-b.startedAt||a.id.localeCompare(b.id));
  }
  function bestInWindow(points){return points.length?Math.max(...points.map((point)=>point.value)):null;}
  function payload(workout){
    const fields=["id","title","planDay","date","status","startedAt","completedAt","elapsedSeconds","restEndsAt","entries"];
    const result=Object.fromEntries(fields.map((field)=>[field,copy(workout[field])]));
    result.entries=workout.entries.map((entry)=>({id:entry.id,exerciseId:entry.exerciseId,measurement:entry.measurement,loadType:entry.loadType,unit:entry.unit,prescribedReps:entry.prescribedReps,sets:entry.sets.map((set)=>({reps:set.reps,weight:set.weight,seconds:set.seconds,completed:set.completed}))}));
    return result;
  }
  function matches(saved,snapshot){
    try{return JSON.stringify(payload(saved))===JSON.stringify(payload(snapshot));}catch{return false;}
  }
  function draftPrefix(ownerId){
    if(typeof ownerId!=="string"||!ownerId)throw new Error("An explicit storage owner is required.");
    return `strata_workout_draft_v1:${encodeURIComponent(ownerId)}:`;
  }
  function readDraft(raw,ownerId){
    try{
      const record=JSON.parse(raw);
      const workout=record.workout;
      if(record.ownerId!==ownerId||!workout||typeof workout.id!=="string"||!/^[a-zA-Z0-9_-]{8,100}$/.test(workout.id)||!Array.isArray(workout.entries)||workout.entries.length<1||workout.entries.length>30)return null;
      if(!["active","completed"].includes(workout.status)||!Number.isFinite(workout.startedAt)||!/^\d{4}-\d{2}-\d{2}$/.test(workout.date))return null;
      for(const entry of workout.entries){
        if(typeof entry.id!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.id)||typeof entry.exerciseId!=="string"||!/^[a-zA-Z0-9_-]{1,100}$/.test(entry.exerciseId)||!["reps","timed"].includes(entry.measurement)||!["external","bodyweight","assisted"].includes(entry.loadType)||!["kg","lb"].includes(entry.unit)||!Array.isArray(entry.sets)||entry.sets.length<1||entry.sets.length>10)return null;
        if(entry.sets.some((set)=>!set||typeof set.completed!=="boolean"||set.completed&&actualError(entry,set)||["reps","seconds","weight"].some((field)=>set[field]!==null&&(typeof set[field]!=="number"||!Number.isFinite(set[field])||set[field]<0))||set.reps!==null&&(!Number.isInteger(set.reps)||set.reps>1000)||set.seconds!==null&&(!Number.isInteger(set.seconds)||set.seconds>3600)||set.weight!==null&&set.weight>1000))return null;
      }
      return record;
    }catch{return null;}
  }
  return{DAYS,copy,localDate,today,dayFromSearch,id,inferFormat,createWorkout,actualError,progress,remainingSeconds,duration,formatKey,summary,metrics,series,bestInWindow,payload,matches,draftPrefix,readDraft};
});
