"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const core=require("../public/scripts/onboarding-core"),discovery=require("../public/scripts/discovery-core"),exercises=require("../public/data/exercises.json");
const base={goal:"balanced",level:"Beginner",minutes:35,equipment:[...new Set(exercises.map(e=>e.equipment))],availability:["Monday","Wednesday","Friday"],limitations:[]};
test("first week honors availability, valid plan limits, and distinct session movements",()=>{
  const result=core.buildWeek(base,exercises,discovery);
  assert.equal(result.plan.days.Tuesday.length,0);assert.equal(result.plan.days.Sunday.length,0);
  assert.equal(result.sessions.length,3);
  for(const session of result.sessions)assert.equal(new Set(session.items.map(item=>item.exerciseId)).size,session.items.length);
  const {sanitizePlan}=require("../src/plans");assert.deepEqual(sanitizePlan(result.plan),result.plan);
});
test("first week filters equipment and movement limitations without silently relaxing them",()=>{
  const profile={...base,minutes:20,equipment:["Dumbbells","Bodyweight"],limitations:["no-overhead"]};
  const result=core.buildWeek(profile,exercises,discovery);
  for(const session of result.sessions)for(const item of session.items){assert.ok(profile.equipment.includes(item.exercise.equipment));assert.equal(discovery.personalResult(item.exercise,result.preferences).eligible,true);}
});
test("unavailable movement roles produce actionable errors and never invent exercises",()=>{
  assert.throws(()=>core.buildWeek({...base,equipment:["Nonexistent"]},exercises,discovery),/equipment/);
  assert.throws(()=>core.buildWeek({...base,equipment:["Cable"]},[],discovery),/equipment/);
});
test("availability keeps recovery and rejects invalid profiles",()=>{
  for(const availability of [[],core.DAYS])assert.throws(()=>core.buildWeek({...base,availability},exercises,discovery),/one to six/);
  assert.throws(()=>core.buildWeek({...base,minutes:90},exercises,discovery),/20, 35, or 50/);
  assert.throws(()=>core.buildWeek({...base,level:"Expert"},exercises,discovery),/experience/);
});
test("four-day setup alternates upper and lower and never mutates its inputs",()=>{
  const profile={...base,availability:["Monday","Tuesday","Thursday","Friday"]},before=JSON.stringify(profile);
  const result=core.buildWeek(profile,exercises,discovery);assert.deepEqual(result.sessions.map(s=>s.focus),["upper","lower","upper","lower"]);assert.equal(JSON.stringify(profile),before);
});
