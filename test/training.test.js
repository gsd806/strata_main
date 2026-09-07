"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {adaptationForFeedback,planWithAdaptation,progressionForWorkout,sanitizeCheckIn,sanitizeTrainingBlock}=require("../src/training");
const {defaultPlan}=require("../src/plans");
const {summarizeWorkout}=require("../src/workouts");
const {workoutFixture}=require("./support/workout-fixtures");

function completed(id,startedAt,reps=10,weight=20) {
  const workout=workoutFixture(id);
  workout.startedAt=startedAt;workout.status="completed";workout.completedAt=startedAt+60000;
  workout.entries[0].sets[0]={reps,weight,seconds:null,completed:true};
  return workout;
}
function timed(id,startedAt,seconds=40) {
  const workout=completed(id,startedAt);workout.entries[0].measurement="timed";workout.entries[0].loadType="bodyweight";workout.entries[0].prescribedReps="30–45 sec";
  workout.entries[0].sets[0]={reps:null,weight:null,seconds,completed:true};return workout;
}
function assisted(id,startedAt,reps=12,weight=40) {
  const workout=completed(id,startedAt,reps,weight);workout.entries[0].loadType="assisted";return workout;
}

test("post-workout check-ins and 4–8 week block state use bounded explicit fields",()=>{
  assert.deepEqual(sanitizeCheckIn({difficulty:3,energy:4,comfort:5,enjoyment:4}),{difficulty:3,energy:4,comfort:5,enjoyment:4});
  for (const input of [null,{}, {difficulty:0,energy:4,comfort:5,enjoyment:4},{difficulty:3,energy:4,comfort:5,enjoyment:4.5}]) {
    assert.throws(()=>sanitizeCheckIn(input));
  }
  const block=sanitizeTrainingBlock({title:"Strength foundation",goal:"strength",weeks:6,currentWeek:1,lightWeek:5,startDate:"2026-09-07",status:"active",progressionRule:"reps-then-load"});
  assert.equal(block.weeks,6);assert.equal(block.lightWeek,5);assert.deepEqual(block.milestones.map((item)=>item.week),[1,5,6]);
  assert.throws(()=>sanitizeTrainingBlock({...block,weeks:3}),/4 to 8/);
  assert.throws(()=>sanitizeTrainingBlock({...block,status:"completed"}),/final week/);
  assert.throws(()=>sanitizeTrainingBlock({...block,milestones:[{week:2,label:"A"},{week:2,label:"B"}]}),/different week/);
});

test("progression establishes a baseline until a prior comparable session and explicit acceptable check-in exist",()=>{
  const current=completed("current",2000,10),prior=completed("prior",1000,9),priorSummary=summarizeWorkout(prior);
  const first=progressionForWorkout(current,[],{difficulty:3,energy:4,comfort:4,enjoyment:4}).suggestions[0];
  assert.equal(first.action,"repeat");assert.equal(first.basis,"baseline");assert.match(first.explanation,/baseline/i);
  const noCheckIn=progressionForWorkout(current,[priorSummary],null).suggestions[0];
  assert.equal(noCheckIn.action,"repeat");assert.equal(noCheckIn.basis,"check-in-needed");assert.match(noCheckIn.explanation,/check-in/i);
  for (const checkIn of [
    {difficulty:3,energy:4,comfort:2,enjoyment:4},
    {difficulty:3,energy:2,comfort:4,enjoyment:4},
    {difficulty:5,energy:4,comfort:4,enjoyment:4}
  ]) {
    const held=progressionForWorkout(current,[priorSummary],checkIn).suggestions[0];
    assert.equal(held.action,"repeat");assert.equal(held.basis,"hold");
  }
  const increase=progressionForWorkout(current,[priorSummary],{difficulty:3,energy:4,comfort:4,enjoyment:4}).suggestions[0];
  assert.equal(increase.action,"increase_reps");assert.equal(increase.target.reps,11);assert.equal(increase.basis,"comparable-progression");
  const top=completed("top",3000,12),topPrior=summarizeWorkout(completed("top-prior",2000,12));
  const load=progressionForWorkout(top,[topPrior],{difficulty:3,energy:4,comfort:4,enjoyment:4}).suggestions[0];
  assert.equal(load.action,"increase_load");assert.equal(load.target.weight,22.5);assert.equal(load.target.reps,8);
  const lighterWeek=progressionForWorkout(top,[topPrior],{difficulty:3,energy:4,comfort:4,enjoyment:4},"reps-then-load",true).suggestions[0];
  assert.equal(lighterWeek.action,"repeat");assert.equal(lighterWeek.basis,"lighter-week");assert.match(lighterWeek.explanation,/lighter week/i);assert.match(lighterWeek.explanation,/review/i);
  const repsOnly=progressionForWorkout(top,[topPrior],{difficulty:3,energy:4,comfort:4,enjoyment:4},"reps-only");
  assert.equal(repsOnly.progressionRule,"reps-only");assert.equal(repsOnly.suggestions[0].action,"increase_reps");assert.equal(repsOnly.suggestions[0].target.reps,13);
  const timedRule=progressionForWorkout(current,[priorSummary],{difficulty:3,energy:4,comfort:4,enjoyment:4},"time").suggestions[0];
  assert.equal(timedRule.action,"repeat");assert.equal(timedRule.basis,"block-rule");
  const time=progressionForWorkout(timed("timed",5000),[summarizeWorkout(timed("timed-prior",4000))],{difficulty:3,energy:4,comfort:4,enjoyment:4},"time").suggestions[0];
  assert.equal(time.action,"increase_time");assert.equal(time.target.seconds,45);
  const belowPrior=progressionForWorkout(completed("below",3000,8),[summarizeWorkout(current)],{difficulty:3,energy:4,comfort:4,enjoyment:4}).suggestions[0];
  assert.equal(belowPrior.action,"repeat");assert.equal(belowPrior.basis,"repeat-comparable");
});

test("assisted progression lowers assistance only after a comparable top-of-range result",()=>{
  const current=assisted("assisted-current",3000),prior=summarizeWorkout(assisted("assisted-prior",2000));
  const suggestion=progressionForWorkout(current,[prior],{difficulty:3,energy:4,comfort:4,enjoyment:4}).suggestions[0];
  assert.equal(prior.exerciseSummaries[0].minAssistance,40);assert.equal(suggestion.action,"reduce_assistance");assert.equal(suggestion.basis,"comparable-progression");
  assert.deepEqual(suggestion.completed,{reps:12,weight:40,seconds:null});assert.deepEqual(suggestion.previous,{reps:12,weight:40,seconds:null});
  assert.deepEqual(suggestion.target,{reps:8,weight:37.5,seconds:null});assert.ok(suggestion.target.weight<suggestion.completed.weight);
});

test("feedback creates an optional plan proposal without changing the supplied plan",()=>{
  const workout=completed("adapt-source",2000),plan=defaultPlan();
  plan.restDays=[];plan.restDay=null;
  plan.days.Monday=[{instanceId:"monday-press",exerciseId:"flat-dumbbell-press",sets:3,reps:"8–12"}];
  const proposal=adaptationForFeedback({workout,plan,planUpdatedAt:123,checkIn:{difficulty:5,energy:3,comfort:4,enjoyment:3}});
  assert.equal(plan.days.Monday[0].sets,3,"building a proposal must not mutate the active plan");
  assert.equal(proposal.change.fromSets,3);assert.equal(proposal.change.toSets,2);
  assert.equal(Object.hasOwn(proposal,"proposedPlan"),false,"proposal storage must not contain a full plan snapshot");assert.equal(proposal.expectedPlanUpdatedAt,123);
  const applied=planWithAdaptation(plan,proposal);assert.equal(applied.days.Monday[0].sets,2);assert.equal(plan.days.Monday[0].sets,3);
  assert.throws(()=>planWithAdaptation(plan,{...proposal,change:{...proposal.change,fromSets:4,toSets:3}}),/no longer matches/i);
  assert.throws(()=>planWithAdaptation(plan,{...proposal,change:{...proposal.change,toSets:1}}),/invalid/i);
  assert.match(proposal.explanation,/optional/i);assert.match(proposal.explanation,/does not diagnose/i);
  assert.equal(adaptationForFeedback({workout,plan,planUpdatedAt:123,checkIn:{difficulty:3,energy:4,comfort:4,enjoyment:1}}),null);
});
