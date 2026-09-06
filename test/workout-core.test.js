"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const W=require("../public/scripts/workout-core.js");
const realCatalog=require("../public/data/exercises.json");

const catalog=[{id:"press",name:"Press",equipment:"Dumbbells",reps:"8–12"},{id:"push-up",name:"Push-up",equipment:"Bodyweight",reps:"8–15"},{id:"plank",name:"Plank",equipment:"Bodyweight",reps:"30–60 sec"},{id:"assisted-pull-up",name:"Assisted Pull-up",equipment:"Machine",reps:"6–10"}];
function makeWorkout(){
  const plan={days:{Monday:[{exerciseId:"press",sets:2,reps:"8–12"},{exerciseId:"push-up",sets:1,reps:"8–15"},{exerciseId:"plank",sets:1,reps:"30–60 sec"},{exerciseId:"assisted-pull-up",sets:1,reps:"6–10"}]}};
  return W.createWorkout(plan,"Monday",catalog,Date.UTC(2026,8,7,10));
}
function complete(workout){
  workout.entries[0].sets[0]={reps:8,weight:25,seconds:null,completed:true};
  workout.entries[0].sets[1]={reps:100,weight:1000,seconds:null,completed:false};
  workout.entries[1].sets[0]={reps:12,weight:null,seconds:null,completed:true};
  workout.entries[2].sets[0]={reps:null,weight:null,seconds:45,completed:true};
  workout.entries[3].sets[0]={reps:10,weight:40,seconds:null,completed:true};
  workout.status="completed";workout.completedAt=workout.startedAt+600000;workout.elapsedSeconds=600;
  return workout;
}

test("workout starts from a snapshot, infers explicit formats and never invents actual results",()=>{
  const workout=makeWorkout();
  assert.equal(workout.status,"active");
  assert.deepEqual(W.progress(workout),{total:5,completed:0,percent:0});
  assert.equal(workout.entries[0].loadType,"external");
  assert.equal(workout.entries[1].loadType,"bodyweight");
  assert.equal(workout.entries[2].measurement,"timed");
  assert.equal(workout.entries[3].loadType,"assisted");
  for(const entry of workout.entries)for(const set of entry.sets)assert.deepEqual(set,{reps:null,weight:null,seconds:null,completed:false});
  assert.throws(()=>W.createWorkout({days:{Monday:[]}},"Monday",catalog),/Add exercises/);
  assert.throws(()=>W.createWorkout({days:{Monday:[{exerciseId:"unknown",sets:3}]}},"Monday",catalog),/unavailable/);
});

test("workout guidance summarizes a plan day and identifies the next unfinished set",()=>{
  const workout=makeWorkout();
  assert.deepEqual(W.planDaySummary({days:{Monday:[{sets:3},{sets:2}]}},"Monday"),{day:"Monday",movements:2,workingSets:5});
  assert.deepEqual(W.planDaySummary({days:{Monday:[]}},"Funday"),{day:null,movements:0,workingSets:0});
  assert.deepEqual(W.nextIncompleteSet(workout),{entryIndex:0,setIndex:0,entryId:workout.entries[0].id,exerciseId:"press",remaining:5});
  workout.entries[0].sets.forEach((set)=>{set.completed=true;});
  assert.deepEqual(W.nextIncompleteSet(workout),{entryIndex:1,setIndex:0,entryId:workout.entries[1].id,exerciseId:"push-up",remaining:3});
  workout.entries.forEach((entry)=>entry.sets.forEach((set)=>{set.completed=true;}));
  assert.equal(W.nextIncompleteSet(workout),null);
});

test("actual catalog timed prescriptions and compact seconds shorthand infer timed logging",()=>{
  const timedIds=["superman-hold","prone-cobra","planche-lean","wall-external-rotation-isometric","copenhagen-plank","calf-isometric-hold","seated-calf-isometric-machine","side-plank","front-plank","hollow-body-hold"];
  for(const exerciseId of timedIds){
    const exercise=realCatalog.find((item)=>item.id===exerciseId);
    assert.ok(exercise,`${exerciseId} exists in the real catalog`);
    assert.equal(W.inferFormat(exercise).measurement,"timed",`${exerciseId}: ${exercise.reps}`);
    assert.equal(W.inferFormat(exercise,"15–30s / side").measurement,"timed");
    const plan={days:{Monday:[{exerciseId,sets:2,reps:exercise.reps}]}};
    const entry=W.createWorkout(plan,"Monday",realCatalog).entries[0];
    assert.equal(entry.measurement,"timed");
    assert.equal(entry.sets[0].seconds,null);assert.equal(entry.sets[0].reps,null);
  }
  for(const prescription of ["30 s","30s","15–30sec","20 seconds","1min","2 minutes"]){
    assert.equal(W.inferFormat(catalog[0],prescription).measurement,"timed",prescription);
  }
  assert.equal(W.inferFormat(catalog[0],"8–12 / side").measurement,"reps");
  assert.equal(W.inferFormat(catalog[0],"3 sets").measurement,"reps");
});

test("support-only bench exercises default to bodyweight without hiding the external-load option",()=>{
  for(const exerciseId of ["bench-reverse-crunch","decline-bench-crunch","calf-isometric-hold"]){
    const exercise=realCatalog.find((item)=>item.id===exerciseId);
    assert.equal(W.inferFormat(exercise).loadType,"bodyweight",exerciseId);
  }
  assert.equal(W.inferFormat(realCatalog.find((item)=>item.id==="seated-calf-isometric-machine")).loadType,"external");
});

test("a requested planner day survives guest selection and reload; missing or invalid days use today",()=>{
  const sunday=new Date(2026,8,6,12);
  assert.equal(W.today(sunday),"Sunday");
  const initial=new URL("https://strata.example/workout.html?day=Monday");
  assert.equal(W.dayFromSearch(initial.search,sunday),"Monday");
  initial.searchParams.set("guest","1");
  assert.equal(W.dayFromSearch(initial.search,sunday),"Monday");
  assert.equal(W.dayFromSearch(new URL(initial.href).search,sunday),"Monday");
  initial.searchParams.set("day","Friday");
  assert.equal(W.dayFromSearch(new URL(initial.href).search,sunday),"Friday");
  assert.equal(W.dayFromSearch("",sunday),"Sunday");
  assert.equal(W.dayFromSearch("?guest=1&day=Someday",sunday),"Sunday");
  assert.equal(W.dayFromSearch("?day=monday",sunday),"Sunday");
});

test("complete sets require actual positive reps or seconds and an explicit external or assisted load",()=>{
  const [external,bodyweight,timed,assisted]=makeWorkout().entries;
  assert.match(W.actualError(external,{reps:null,weight:null}),/repetitions/);
  assert.match(W.actualError(external,{reps:8,weight:null}),/explicit load/);
  assert.equal(W.actualError(external,{reps:8,weight:0}),"");
  assert.match(W.actualError(external,{reps:8,weight:2.555}),/decimal places/);
  assert.match(W.actualError(external,{reps:8.5,weight:20}),/repetitions/);
  assert.equal(W.actualError(bodyweight,{reps:12,weight:null}),"");
  assert.equal(W.actualError(timed,{seconds:60,weight:null}),"");
  assert.match(W.actualError(timed,{seconds:0,weight:null}),/actual time/);
  assert.match(W.actualError(assisted,{reps:10,weight:null}),/explicit load/);
  assert.equal(W.actualError(assisted,{reps:10,weight:40}),"");
});

test("history counts only checked sets and excludes assisted/bodyweight/timed fake volume",()=>{
  const workout=complete(makeWorkout()),summary=W.summary(workout);
  assert.equal(summary.totalSets,5);assert.equal(summary.completedSets,4);
  const [external,bodyweight,timed,assisted]=summary.exerciseSummaries;
  assert.equal(external.totalReps,8);assert.equal(external.maxWeight,25);assert.equal(external.volume,200);
  assert.equal(bodyweight.totalReps,12);assert.equal(bodyweight.volume,0);assert.equal(bodyweight.maxWeight,null);
  assert.equal(timed.totalReps,0);assert.equal(timed.totalSeconds,45);assert.equal(timed.volume,0);assert.equal(timed.maxReps,null);
  assert.equal(assisted.totalReps,10);assert.equal(assisted.volume,0);assert.equal(assisted.maxWeight,null);
  assert.equal(W.metrics(assisted).some((metric)=>metric.key==="volume"||metric.key==="maxWeight"),false);
  assert.equal(W.metrics(timed).some((metric)=>metric.key==="volume"||metric.key==="maxWeight"),false);
});

test("chart comparisons isolate exercise, measurement, load type and unit, and exclude active sessions",()=>{
  const base=complete(makeWorkout()),higher=W.copy(base),pounds=W.copy(base),active=W.copy(base),assisted=W.copy(base);
  higher.id="higher-session";higher.startedAt+=86400000;higher.entries[0].sets[0].weight=30;
  pounds.id="pounds-session";pounds.entries[0].unit="lb";pounds.entries[0].sets[0].weight=100;
  active.id="active-session";active.status="active";active.entries[0].sets[0].weight=200;
  assisted.id="assisted-session";assisted.entries[0].loadType="assisted";assisted.entries[0].sets[0].weight=300;
  const points=W.series([pounds,active,higher,assisted,base].map(W.summary),W.formatKey(base.entries[0]),"maxWeight");
  assert.deepEqual(points.map((point)=>point.value),[25,30]);
  assert.equal(W.bestInWindow(points),30);
  assert.equal(W.bestInWindow([]),null);
  assert.deepEqual(W.series([W.summary(assisted)],W.formatKey(assisted.entries[0]),"volume"),[]);
});

test("repeated exercise entries aggregate correctly without duplicate session chart points",()=>{
  const workout=complete(makeWorkout()),entry=W.copy(workout.entries[0]);
  entry.id="second-press";entry.sets=[{reps:6,weight:30,seconds:null,completed:true}];workout.entries.push(entry);
  const summary=W.summary(workout),press=summary.exerciseSummaries.find((item)=>item.exerciseId==="press");
  assert.equal(press.completedSets,2);assert.equal(press.totalReps,14);assert.equal(press.volume,380);
  assert.equal(press.maxWeight,30);
  assert.equal(W.series([summary],W.formatKey(entry),"volume").length,1);
});

test("absolute rest deadlines survive delayed ticks and background time without drift",()=>{
  const started=1000000,deadline=started+90000;
  assert.equal(W.remainingSeconds(deadline,started),90);
  assert.equal(W.remainingSeconds(deadline,started+40500),50);
  assert.equal(W.remainingSeconds(deadline,started+90001),0);
  assert.equal(W.remainingSeconds(null,started),0);
  const paused=W.remainingSeconds(deadline,started+30000),resumedDeadline=started+500000+paused*1000;
  assert.equal(W.remainingSeconds(resumedDeadline,started+500000),60);
  assert.equal(W.duration(3661),"1:01:01");assert.equal(W.duration(-1),"0:00");
});

test("draft recovery requires the exact account owner and rejects malformed numeric payloads",()=>{
  const workout=makeWorkout(),record={ownerId:"account:42",workout,dirty:true};
  assert.ok(W.readDraft(JSON.stringify(record),"account:42"));
  assert.equal(W.readDraft(JSON.stringify(record),"account:43"),null);
  assert.equal(W.readDraft(JSON.stringify(record),"guest"),null);
  assert.notEqual(W.draftPrefix("account:42"),W.draftPrefix("account:43"));
  assert.notEqual(W.draftPrefix("account:42"),W.draftPrefix("guest"));
  assert.throws(()=>W.draftPrefix(""),/explicit storage owner/);
  workout.entries[0].sets[0].weight='" autofocus onfocus="bad';
  assert.equal(W.readDraft(JSON.stringify(record),"account:42"),null);
  assert.equal(W.readDraft("not json","account:42"),null);
});

test("save confirmation compares canonical semantic fields and detects an old POST replay result",()=>{
  const original=makeWorkout(),saved={...W.copy(original),revision:1,updatedAt:2000000};
  saved.entries[0].sets[0]={completed:false,seconds:null,weight:null,reps:null};
  assert.equal(W.matches(saved,original),true);
  saved.entries[0].sets[0]={reps:10,weight:25,seconds:null,completed:true};
  saved.revision=2;
  assert.equal(W.matches(saved,original),false);
  assert.equal(Object.hasOwn(W.payload(saved),"revision"),false);
  assert.equal(Object.hasOwn(W.payload(saved),"updatedAt"),false);
});
