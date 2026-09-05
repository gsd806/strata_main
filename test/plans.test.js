"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {
  DAYS,
  EXERCISES,
  EXERCISE_IDS,
  defaultPlan,
  defaultPreferences,
  planStats,
  sanitizePreferences,
  sanitizeRating,
  sanitizePlan,
  sanitizeCommunityPlanInput,
  communityPlanId,
  communityPlanPayload,
  communityRevision,
  expectedPlanRevision,
  communityPagination,
  sanitizeMonthlyPlan
}=require("../src/plans");

function weeklyPlan() {
  const plan=defaultPlan();
  plan.days.Monday.push({instanceId:"weekly-item-1",exerciseId:"flat-dumbbell-press",sets:3,reps:"8–12"});
  return plan;
}

function monthlyPlan() {
  const startDate="2026-01-05";
  const schedule=Object.fromEntries(DAYS.map((day)=>{
    const rest=day==="Sunday";
    return [day,{rest,targets:rest?[]:["chest","triceps"],sourceItems:[]}];
  }));
  const start=new Date(`${startDate}T00:00:00.000Z`);
  const weekdays=["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
  const days=Array.from({length:31},(_,index)=>{
    const date=new Date(start.getTime()+index*86400000);
    const weekday=weekdays[date.getUTCDay()];
    const rest=schedule[weekday].rest;
    return {
      dayNumber:index+1,
      date:date.toISOString().slice(0,10),
      weekday,
      rest,
      targets:schedule[weekday].targets,
      exercises:rest?[]:[
        {exerciseId:"flat-dumbbell-press",sets:3,reps:"8–12"},
        {exerciseId:"machine-chest-press",sets:3,reps:"8–12"},
        {exerciseId:"pressdown",sets:3,reps:"10–15"},
        {exerciseId:"overhead-triceps",sets:3,reps:"10–15"}
      ]
    };
  });
  return {version:1,title:"January training",source:"muscle-schedule",startDate,exercisesPerTarget:2,schedule,days,generatedAt:1};
}

test("plan domain owns the catalog and returns isolated defaults",()=>{
  assert.ok(EXERCISES.length>100);
  assert.ok(EXERCISE_IDS.has("flat-dumbbell-press"));
  const first=defaultPlan(),second=defaultPlan();
  first.days.Monday.push({exerciseId:"flat-dumbbell-press"});
  assert.deepEqual(second.days.Monday,[]);
  assert.equal(defaultPreferences().equipment.length>0,true);
});

test("weekly plans, preferences, and ratings keep their existing validation contracts",()=>{
  const plan=weeklyPlan();
  assert.deepEqual(planStats(plan),{planCount:1,workoutDays:1});
  assert.deepEqual(sanitizePlan(plan),plan);

  const damaged=structuredClone(plan);
  damaged.days.Tuesday.push({instanceId:"weekly-item-1",exerciseId:"not-in-catalog",sets:0,reps:""});
  assert.throws(()=>sanitizePlan(damaged),/unknown exercise/);
  const repaired=sanitizePlan(damaged,{repair:true});
  assert.deepEqual(repaired.days.Tuesday,[]);

  const preferences=sanitizePreferences({goal:"strength",level:"Advanced",days:8,equipment:[defaultPreferences().equipment[0]],preferences:["stable","stable"],limitations:["no-floor"]});
  assert.equal(preferences.days,7);
  assert.deepEqual(preferences.preferences,["stable"]);
  assert.throws(()=>sanitizePreferences({equipment:[]}),/at least one/);
  assert.deepEqual(sanitizeRating({comfort:1,pump:2,enjoyment:3,stability:4,setup:5,overall:4}),{comfort:1,pump:2,enjoyment:3,stability:4,setup:5,overall:4});
  assert.throws(()=>sanitizeRating({}),/whole number/);
});

test("community plan helpers sanitize public payloads and revisions",()=>{
  const plan=weeklyPlan();
  const input=sanitizeCommunityPlanInput({title:"  Push   week  ",description:"  Simple   plan ",published:true},plan);
  assert.equal(input.title,"Push week");
  assert.equal(input.description,"Simple plan");
  assert.throws(()=>sanitizeCommunityPlanInput({title:"Push week",plan},plan),(error)=>error.code==="COMMUNITY_PLAN_BODY_NOT_ALLOWED");

  const id="123e4567-e89b-42d3-a456-426614174000";
  assert.equal(communityPlanId(id.toUpperCase()),id);
  assert.equal(communityPlanId("not-an-id"),"");
  assert.equal(communityRevision(1,"Plan"),1);
  assert.equal(expectedPlanRevision(0),0);
  assert.throws(()=>communityRevision(0,"Plan"),(error)=>error.code==="INVALID_COMMUNITY_REVISION");

  const payload=communityPlanPayload({id,title:"Push week",description:"",author_name:"  STRATA   Lifter  ",plan_json:JSON.stringify(plan),created_at:"10",updated_at:"20",is_published:1},{owner:true});
  assert.equal(payload.authorName,"STRATA Lifter");
  assert.equal(payload.published,true);
  assert.equal(communityPlanPayload({...payload,plan_json:"{}"}),null);

  assert.deepEqual(communityPagination(new URL("https://example.test/community?limit=24&offset=2")),{limit:24,offset:2});
  assert.throws(()=>communityPagination(new URL("https://example.test/community?limit=25")),(error)=>error.code==="INVALID_PAGINATION");
});

test("31-day plan validation remains deterministic at the module boundary",()=>{
  const input=monthlyPlan();
  const clean=sanitizeMonthlyPlan(input,{generatedAt:123});
  assert.equal(clean.days.length,31);
  assert.equal(clean.generatedAt,123);
  assert.equal(clean.days[6].rest,true);

  const unknown=structuredClone(input);
  unknown.days[0].exercises[0].exerciseId="not-in-catalog";
  assert.throws(()=>sanitizeMonthlyPlan(unknown),(error)=>error.code==="INVALID_MONTHLY_PLAN"&&/unknown exercise/.test(error.message));
});
