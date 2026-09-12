"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {buildTraining,CATALOG_FINGERPRINT,MODEL_VERSION}=require("../src/coaching-training-core");
const {exerciseFormat,estimatedSeconds,prepareEvidence,startingPrescription,withPerformance}=require("../src/coaching-prescription-core");
const {DAYS,EXERCISES}=require("../src/plans");

const WEEK="2026-09-14";
function profile(overrides={}){return {experience:"intermediate",trainingGoal:"balanced",sessionsPerWeek:3,workoutDays:["Monday","Wednesday","Friday"],sessionMinutes:60,usualExercises:[],availableEquipment:[],movementLimitations:[],preferredLoadUnit:"kg",timeZone:"UTC",...overrides};}
function prescription(id="flat-dumbbell-press",overrides={}){
  const exercise=EXERCISES.find(item=>item.id===id),p=profile(overrides),format=exerciseFormat(exercise,p.preferredLoadUnit);
  return {exerciseId:id,name:exercise.name,group:exercise.group,...format,...startingPrescription(p,exercise,format)};
}
function workout(item,date="2026-09-11",overrides={}){
  const sets=Array.from({length:item.sets},()=>({completed:true,reps:item.measurement==="reps"?item.range.high:null,seconds:item.measurement==="timed"?item.range.high:null,weight:item.loadType==="bodyweight"?null:40,effort:null}));
  return {id:`workout-${date}`,date,status:"completed",startedAt:Date.parse(`${date}T12:00:00Z`),completedAt:Date.parse(`${date}T13:00:00Z`),entries:[{id:`entry-${date}`,exerciseId:item.exerciseId,measurement:item.measurement,loadType:item.loadType,unit:item.unit,prescribedReps:item.reps,effortType:"rir",sets}],...overrides};
}
function recommend(item,workouts,extra={}){return withPerformance(item,prepareEvidence({workouts,...extra},WEEK,"UTC"),WEEK);}
function pair(item){return [workout(item),workout(item,"2026-09-04")];}
function anchors(plan){return plan.sessions.map(session=>session.exercises.filter(item=>["knee","posterior","push","pull"].includes(item.role)).map(item=>item.exerciseId));}

test("training retains repeatable main exercises across weeks and respects previous anchors",()=>{
  const p=profile(),first=buildTraining(p,WEEK),copy=structuredClone(p);
  assert.deepEqual(buildTraining(p,WEEK),first);assert.deepEqual(p,copy);
  for(const week of ["2026-09-21","2026-09-28","2026-10-05"]){assert.deepEqual(anchors(buildTraining(p,week)),anchors(first));}
  const previous=structuredClone(first),press=previous.sessions[0].exercises.find(item=>item.role==="push");press.exerciseId="flat-dumbbell-press";
  assert.equal(buildTraining(p,"2026-09-21",{previousWeek:{training:previous}}).sessions[0].exercises.find(item=>item.role==="push").exerciseId,"flat-dumbbell-press");
  assert.equal(first.modelVersion,MODEL_VERSION);assert.match(CATALOG_FINGERPRINT,/^[a-f0-9]{16}$/);
});

test("short workouts preserve push, pull, knee and posterior work with truthful direct set coverage",()=>{
  const week=buildTraining(profile({sessionMinutes:30}),WEEK),items=week.sessions.flatMap(session=>session.exercises);
  for(const session of week.sessions){assert.deepEqual(session.exercises.map(item=>item.role),["knee","push","pull","posterior"]);assert.ok(session.estimatedDurationMinutes<=30);}
  assert.ok(week.summary.muscles.find(row=>row.muscle==="Hamstrings").workingSets>0);
  for(const row of week.summary.groups){assert.equal(row.workingSets,items.filter(item=>item.group===row.group).reduce((sum,item)=>sum+item.sets,0));assert.equal(row.frequency,week.sessions.filter(session=>session.exercises.some(item=>item.group===row.group)).length);}
  assert.equal(week.summary.workingSets,items.reduce((sum,item)=>sum+item.sets,0));
  assert.ok(week.summary.coverageGaps.includes("calves"));assert.match(week.summary.coverageBasis,/not double-counted/);
});

test("all supported training frequencies and experience levels fit the estimated time budget",()=>{
  for(const experience of ["beginner","intermediate","advanced"])for(const sessionsPerWeek of [1,2,3,4,5,6])for(const sessionMinutes of [30,45,60,90]){
    const result=buildTraining(profile({experience,sessionsPerWeek,sessionMinutes,workoutDays:DAYS.slice(0,sessionsPerWeek)}),WEEK);
    assert.equal(result.sessions.length,sessionsPerWeek);
    for(const session of result.sessions){assert.ok(session.estimatedDurationMinutes<=sessionMinutes);assert.equal(session.workingSets,session.exercises.reduce((sum,item)=>sum+item.sets,0));assert.ok(session.exercises.every(item=>item.sets>=1&&item.sets<=3&&item.restSeconds>=75));}
  }
  const one=buildTraining(profile({sessionsPerWeek:1,workoutDays:["Sunday"]}),WEEK);assert.match(one.frequencyCaveat,/at least two days/);assert.equal(one.sessions[0].date,"2026-09-20");
  assert.match(buildTraining(profile({sessionsPerWeek:2,workoutDays:["Sunday","Monday"]}),WEEK).summary.schedulingNote,/consecutive/);
});

test("equipment, experience and movement restrictions override previous exercise preferences",()=>{
  const before=buildTraining(profile(),WEEK),p=profile({experience:"beginner",sessionMinutes:30,availableEquipment:["Machine","Cable"],movementLimitations:["no-floor","no-overhead"]});
  const result=buildTraining(p,WEEK,{previousWeek:before});
  for(const item of result.sessions.flatMap(session=>session.exercises)){
    const catalog=EXERCISES.find(exercise=>exercise.id===item.exerciseId);assert.equal(catalog.level,"Beginner");assert.ok(p.availableEquipment.includes(catalog.equipment));assert.ok(!catalog.traits.includes("floor")&&!catalog.traits.includes("overhead"));
  }
  assert.throws(()=>buildTraining(profile({availableEquipment:["Resistance band"],movementLimitations:["no-floor","no-overhead","no-deep-knee","no-unilateral"]}),WEEK),{code:"COACHING_PLAN_CONSTRAINTS",status:422});
  const bodyweight=buildTraining(profile({sessionsPerWeek:4,workoutDays:["Monday","Tuesday","Thursday","Friday"],availableEquipment:["Bodyweight"]}),WEEK);
  assert.ok(bodyweight.sessions.every(session=>session.exercises.length>=2));
  assert.throws(()=>buildTraining(profile({experience:"beginner",availableEquipment:["Bodyweight"]}),WEEK),/Keep your actual experience level and movement limits/);
});

test("strength and hypertrophy change practical prescriptions independently of calorie goals",()=>{
  const strength=prescription("flat-dumbbell-press",{trainingGoal:"strength"}),hypertrophy=prescription("flat-dumbbell-press",{trainingGoal:"hypertrophy"});
  assert.equal(strength.reps,"6–8");assert.equal(strength.restSeconds,180);assert.equal(hypertrophy.reps,"8–12");assert.equal(hypertrophy.restSeconds,120);
  assert.deepEqual(buildTraining(profile({goal:"fat_loss"}),WEEK),buildTraining(profile({goal:"muscle_gain"}),WEEK));
});

test("timed, unilateral and distance prescriptions retain their actual units",()=>{
  const front=prescription("front-plank"),side=prescription("side-plank"),carry=prescription("dumbbell-farmers-carry");
  assert.equal(front.measurement,"timed");assert.equal(front.reps,"20–60 s");assert.equal(side.reps,"20–45 s / side");assert.equal(side.perSide,true);
  assert.equal(carry.measurement,"distance");assert.equal(carry.reps,"20–40 m");assert.match(carry.loadingGuidance,/manual tracking/);assert.equal(recommend(carry,[]).performance.status,"manual_distance");
  assert.ok(estimatedSeconds(side)>estimatedSeconds({...side,perSide:false}));
  assert.equal(exerciseFormat({reps:"AMRAP"},"kg"),null);assert.equal(exerciseFormat({reps:"60–20 s"},"kg"),null);
});

test("manual capability never fabricates starting loads or changes holds into repetitions",()=>{
  for(const id of ["flat-dumbbell-press","bodyweight-crunch","front-plank","side-plank","assisted-pull-up-machine"]){
    const item=prescription(id,{usualExercises:[{exerciseId:id,maxSets:2,maxReps:8,maxWeightKg:0.1}]});
    assert.equal(item.suggestedStartingLoad,null);assert.equal(item.sets,2);
    if(item.measurement==="timed"){assert.match(item.reps,/ s/);assert.ok(item.range.high>8);}else assert.ok(item.range.high<=8);
  }
  assert.equal(prescription("bodyweight-crunch").loadType,"bodyweight");assert.equal(prescription("assisted-pull-up-machine").loadType,"assisted");
  assert.match(prescription("assisted-pull-up-machine").loadingGuidance,/More assistance makes the movement easier/);
});

test("two complete comparable workouts provide exact per-set optional next targets",()=>{
  const item=prescription(),workouts=pair(item),input=structuredClone(workouts),result=recommend(item,workouts);
  assert.equal(result.performance.status,"progression");assert.equal(result.performance.sourceDate,"2026-09-11");assert.equal(result.suggestedStartingLoad.value,42.5);
  assert.deepEqual(result.targetSets,Array.from({length:3},()=>({reps:6,weight:42.5,seconds:null,effort:null})));assert.deepEqual(workouts,input);
  assert.match(result.loadingGuidance,/If reps felt controlled/);
  const generated=buildTraining(profile({sessionMinutes:90,usualExercises:[{exerciseId:item.exerciseId,maxSets:3,maxReps:12,maxWeightKg:40}]}),WEEK,{workouts});
  assert.ok(generated.summary.historyBasedExercises>0);assert.ok(generated.sessions.flatMap(session=>session.exercises).some(exercise=>exercise.performance.sourceDate==="2026-09-11"&&exercise.targetSets));
});

test("one workout repeats recorded values, while matched sub-ceiling sets advance only the weakest set",()=>{
  const item=prescription(),source=workout(item);
  assert.equal(recommend(item,[source]).performance.status,"repeat");assert.equal(recommend(item,[source]).suggestedStartingLoad.value,40);
  const workouts=pair(item);for(const session of workouts)session.entries[0].sets.forEach((set,index)=>{set.reps=index===1?8:10;});
  const result=recommend(item,workouts);assert.deepEqual(result.targetSets.map(set=>set.reps),[10,9,10]);assert.ok(result.targetSets.every(set=>set.weight===40));
});

test("effort, adverse feedback, underperformance, mixed loads and small available increments hold progression",()=>{
  const item=prescription();
  for(const scenario of ["effort","checkin","underperformance","mixed","small"]){
    const workouts=pair(item),extra={};
    if(scenario==="effort")workouts[1].entries[0].sets[2].effort=1;
    if(scenario==="checkin")extra.checkIns=[{workoutId:workouts[1].id,difficulty:3,energy:4,comfort:1,enjoyment:4}];
    if(scenario==="underperformance")workouts[0].entries[0].sets[1].reps=11;
    if(scenario==="mixed")workouts[0].entries[0].sets[2].weight=30;
    if(scenario==="small")for(const session of workouts)for(const set of session.entries[0].sets)set.weight=20;
    const result=recommend(item,workouts,extra);assert.equal(result.performance.status,"repeat",scenario);assert.deepEqual(result.targetSets.map(set=>set.weight),workouts[0].entries[0].sets.map(set=>set.weight));
  }
});

test("unchecked drafts, duplicate entries and invalid sets never become automatic targets",()=>{
  const item=prescription();
  for(const scenario of ["unchecked","duplicate","invalid"]){
    const workouts=pair(item);
    if(scenario==="unchecked")Object.assign(workouts[0].entries[0].sets[1],{completed:false,reps:999,weight:999});
    if(scenario==="duplicate")workouts[0].entries.push(structuredClone(workouts[0].entries[0]));
    if(scenario==="invalid")workouts[0].entries[0].sets[0].weight=Infinity;
    const result=recommend(item,workouts);assert.equal(result.targetSets,null,scenario);assert.equal(result.suggestedStartingLoad,null,scenario);
  }
});

test("newest incompatible or incomplete exposure prevents falling back to older success",()=>{
  const item=prescription(),old=workout(item,"2026-09-04"),intervening=workout(item,"2026-09-08"),source=workout(item);
  intervening.entries[0].unit="lb";
  const changedPrior=recommend(item,[old,intervening,source]);assert.equal(changedPrior.performance.status,"repeat");assert.equal(changedPrior.suggestedStartingLoad.value,40);
  source.entries[0].prescribedReps="3–5";assert.equal(recommend(item,[old,source]).targetSets,null);
  const incomplete=pair(item);incomplete[1].entries[0].sets[0].completed=false;assert.equal(recommend(item,incomplete).targetSets,null);
  const empty=workout(item);empty.entries[0].sets=[];assert.equal(recommend(item,[old,empty]).targetSets,null);
});

test("stale and limited evidence cannot authorize load increases",()=>{
  const item=prescription(),stale=workout(item,"2026-08-15");
  assert.equal(recommend(item,[stale]).performance.status,"stale");assert.equal(recommend(item,[stale]).targetSets,null);
  const limited=recommend(item,pair(item),{limited:true});assert.equal(limited.performance.status,"limited_history");assert.equal(limited.targetSets,null);
  assert.equal(recommend(item,[workout(item)],{limited:true}).performance.status,"repeat");
  const invalid=workout(item,"2026-09-10",{completedAt:Number.MAX_SAFE_INTEGER});assert.doesNotThrow(()=>recommend(item,[...pair(item),invalid]));assert.equal(recommend(item,[...pair(item),invalid]).targetSets,null);
});

test("time and bodyweight progression never invent external load, and machine assistance decreases",()=>{
  const timed=prescription("front-plank"),timedWorkouts=pair(timed);for(const session of timedWorkouts)for(const set of session.entries[0].sets)set.seconds=35;
  const timedResult=recommend(timed,timedWorkouts);assert.deepEqual(timedResult.targetSets.map(set=>set.seconds),[40,35,35]);assert.equal(timedResult.suggestedStartingLoad,null);
  const bodyweight=prescription("bodyweight-crunch"),bodyResult=recommend(bodyweight,pair(bodyweight));assert.equal(bodyResult.suggestedStartingLoad,null);assert.ok(bodyResult.targetSets.every(set=>set.weight===null));
  const assisted=prescription("assisted-pull-up-machine"),result=recommend(assisted,pair(assisted));assert.equal(result.performance.action,"reduce_assistance");assert.equal(result.suggestedStartingLoad.value,37.5);assert.match(result.loadingGuidance,/37.5 kg of assistance/);assert.match(result.suggestedStartingLoad.basis,/lower assistance is harder/);
  const side=prescription("side-plank");assert.equal(recommend(side,pair(side)).targetSets,null,"per-side history needs an unambiguous logger format");
});

test("evidence fingerprints are deterministic, bounded by week and changed by actual recorded performance",()=>{
  const item=prescription(),workouts=pair(item),base=prepareEvidence({workouts},WEEK,"UTC");
  assert.equal(prepareEvidence({workouts:[...workouts].reverse()},WEEK,"UTC").fingerprint,base.fingerprint);
  assert.equal(prepareEvidence({workouts:[...workouts,workout(item,"2026-09-15")]},WEEK,"UTC").fingerprint,base.fingerprint);
  const changed=structuredClone(workouts);changed[0].entries[0].sets[0].reps=10;assert.notEqual(prepareEvidence({workouts:changed},WEEK,"UTC").fingerprint,base.fingerprint);
  const laterCompletion=workout(item,"2026-09-13",{startedAt:Date.parse("2026-09-13T19:00:00Z"),completedAt:Date.parse("2026-09-13T21:00:00Z")});
  assert.equal(prepareEvidence({workouts:[laterCompletion]},WEEK,"Asia/Dubai").workouts.length,0);
  const laterCheckin={workoutId:workouts[0].id,difficulty:5,energy:1,comfort:1,enjoyment:1,updatedAt:Date.parse("2026-09-14T00:00:00Z")};
  assert.equal(prepareEvidence({workouts,checkIns:[laterCheckin]},WEEK,"UTC").fingerprint,base.fingerprint);
  const duplicate=prepareEvidence({workouts:[...workouts,workouts[0]]},WEEK,"UTC");assert.equal(duplicate.limited,true);
  assert.doesNotThrow(()=>buildTraining(profile(),WEEK,{previousWeek:{sessions:[null,{day:"Monday",exercises:[null]}]}}));
});
