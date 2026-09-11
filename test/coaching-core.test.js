"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {EXERCISES}=require("../src/plans");
const {addDays,currentWeekStart,generateCoachingWeek,sanitizeCoachingProfile,sanitizeDailyLog,weekStartForDate}=require("../src/coaching-core");

function profile(overrides={}){
  return {version:1,measurementSystem:"metric",preferredLoadUnit:"kg",age:32,heightCm:178,weightKg:82,bodyFatPercent:null,sexForEquation:"male",goal:"maintenance",goalPace:"moderate",experience:"intermediate",lifestyleActivity:"moderately_active",workoutDays:["Monday","Wednesday","Friday"],sessionMinutes:60,usualExercises:[{exerciseId:"flat-dumbbell-press",maxSets:4,maxReps:10,maxWeightKg:32}],availableEquipment:[],movementLimitations:[],caloriePattern:"zigzag",flexibleDay:null,macroPreference:"balanced",timeZone:"Asia/Dubai",...overrides};
}

test("coaching profiles strictly validate adult energy and training boundaries",()=>{
  const clean=sanitizeCoachingProfile(profile());
  assert.equal(clean.sessionsPerWeek,3);assert.equal(clean.timeZone,"Asia/Dubai");assert.equal(clean.goalPace,"moderate");
  assert.throws(()=>sanitizeCoachingProfile(profile({sexForEquation:null})),/Sex used by the energy equation/);
  assert.equal(sanitizeCoachingProfile(profile({bodyFatPercent:20,sexForEquation:null})).sexForEquation,null);
  assert.throws(()=>sanitizeCoachingProfile(profile({age:17})),/18 to 80/);
  assert.throws(()=>sanitizeCoachingProfile({...profile(),userId:"untrusted"}),/unsupported fields: userId/);
  assert.throws(()=>sanitizeCoachingProfile(profile({workoutDays:["Monday","Monday"]})),/valid and unique/);
  assert.throws(()=>sanitizeCoachingProfile(profile({usualExercises:[profile().usualExercises[0],profile().usualExercises[0]]})),/only be entered once/);
  assert.throws(()=>sanitizeCoachingProfile(profile({timeZone:"Mars/Olympus"})),/Time zone is invalid/);
});

test("daily logs require bounded calories and either zero or all three macros",()=>{
  assert.deepEqual(sanitizeDailyLog({calories:2100}),{calories:2100,proteinG:null,carbsG:null,fatG:null});
  assert.deepEqual(sanitizeDailyLog({calories:2100,proteinG:150,carbsG:225,fatG:65}),{calories:2100,proteinG:150,carbsG:225,fatG:65});
  assert.throws(()=>sanitizeDailyLog({calories:2100,proteinG:150}),/together/);
  assert.throws(()=>sanitizeDailyLog({calories:-1}),/0 to 20000/);
  assert.throws(()=>sanitizeDailyLog({calories:1000,note:"private"}),/unsupported fields: note/);
});

test("ISO weeks use the profile time zone and reject impossible dates",()=>{
  assert.equal(weekStartForDate("2026-09-11"),"2026-09-07");
  assert.equal(currentWeekStart(Date.parse("2026-09-13T21:30:00Z"),"Asia/Dubai"),"2026-09-14");
  assert.throws(()=>weekStartForDate("2026-02-30"),/invalid/);
});

test("weekly coaching is deterministic, rotates by week, and preserves its calorie budget",()=>{
  const clean=sanitizeCoachingProfile(profile({usualExercises:[]})),first=generateCoachingWeek(clean,1,"2026-09-07",1_000),replay=generateCoachingWeek(clean,1,"2026-09-07",1_000),next=generateCoachingWeek(clean,1,"2026-09-14",2_000);
  assert.deepEqual(replay,first);assert.notEqual(next.planKey,first.planKey);assert.equal(first.nextWeekStart,"2026-09-14");
  assert.ok(first.training.sessions.some((session,index)=>session.exercises.some((exercise,exerciseIndex)=>exercise.exerciseId!==next.training.sessions[index].exercises[exerciseIndex].exerciseId)),"an adjacent week must visibly rotate at least one unconstrained movement");
  assert.equal(first.training.sessions.length,3);assert.ok(first.training.sessions.every((session)=>session.exercises.length===6));
  assert.equal(first.nutrition.weeklyTargetKcal,first.nutrition.dailyTargets.reduce((sum,day)=>sum+day.calories,0));
  assert.equal(first.nutrition.weeklyTargetKcal,first.nutrition.maintenance.targetKcal*7);
  assert.equal(first.nutrition.equation,"mifflin_st_jeor");assert.equal(first.nutrition.activityFactor,1.55);
  for(const day of first.nutrition.dailyTargets){
    const macros=day.macros,total=macros.proteinG*4+macros.carbsG*4+macros.fatG*9;
    assert.ok(macros.carbsG*4/total>=.44,"rounding keeps carbohydrates near or above the 45% AMDR floor");
  }
  assert.match(first.methodology.cautions.join(" "),/not predictions/i);
});

test("entered exercise capability conservatively caps first-week sets, reps, and load",()=>{
  const input=profile({usualExercises:[{exerciseId:"flat-dumbbell-press",maxSets:2,maxReps:8,maxWeightKg:32}]}),clean=sanitizeCoachingProfile(input);
  let press;
  for(let offset=0;offset<6&&!press;offset+=1){const week=generateCoachingWeek(clean,1,addDays("2026-09-07",offset*7),1_000+offset);press=week.training.sessions.flatMap((session)=>session.exercises).find((exercise)=>exercise.exerciseId==="flat-dumbbell-press");}
  assert.ok(press);assert.equal(press.sets,2);assert.equal(press.reps,"6");
  assert.deepEqual(press.suggestedStartingLoad,{value:22,unit:"kg",kg:22,basis:"No more than 70% of the entered load, rounded down; the entry is not treated as a tested 1RM."});
  assert.match(press.loadingGuidance,/22 kg/);assert.match(press.loadingGuidance,/not a 1RM percentage/);
});

test("known exercise capabilities participate in deterministic adjacent-week rotation",()=>{
  const knownIds=["hack-squat","seated-leg-curl","incline-smith-press","neutral-pulldown","cable-lateral-raise","cable-crunch","hip-thrust","cable-reverse-lunge","overhead-triceps","seated-calf"];
  const usualExercises=knownIds.map((exerciseId)=>({exerciseId,maxSets:4,maxReps:10,maxWeightKg:40})),clean=sanitizeCoachingProfile(profile({usualExercises}));
  const first=generateCoachingWeek(clean,1,"2026-09-07",1_000),replay=generateCoachingWeek(clean,1,"2026-09-07",1_000),next=generateCoachingWeek(clean,1,"2026-09-14",2_000);
  const ids=(week)=>week.training.sessions.map((session)=>session.exercises.map((exercise)=>exercise.exerciseId));
  assert.deepEqual(ids(replay),ids(first));assert.notDeepEqual(ids(next),ids(first));
  assert.ok(first.training.sessions.flatMap((session)=>session.exercises).some((exercise)=>knownIds.includes(exercise.exerciseId)),"known exercises remain in the preferred rotation window");
});

test("body-fat input selects Katch–McArdle and goal pace changes conservative targets",()=>{
  const gentle=generateCoachingWeek(sanitizeCoachingProfile(profile({bodyFatPercent:20,sexForEquation:null,goal:"fat_loss",goalPace:"gentle"})),1,"2026-09-07",1_000);
  const moderate=generateCoachingWeek(sanitizeCoachingProfile(profile({bodyFatPercent:20,sexForEquation:null,goal:"fat_loss",goalPace:"moderate"})),1,"2026-09-07",1_000);
  assert.equal(gentle.nutrition.equation,"katch_mcardle");assert.ok(gentle.nutrition.deficit.targetKcal>moderate.nutrition.deficit.targetKcal);
  assert.equal(gentle.nutrition.weightScenarios.length,3);assert.ok(gentle.nutrition.weightScenarios.every((item)=>item.rangeKg[0]<=item.weightKg&&item.weightKg<=item.rangeKg[1]));
});

test("saved equipment, experience, and movement limitations are hard constraints",()=>{
  const clean=sanitizeCoachingProfile(profile({experience:"beginner",sessionMinutes:30,movementLimitations:["no-floor","no-overhead"]})),week=generateCoachingWeek(clean,1,"2026-09-07",1_000),byId=new Map(EXERCISES.map((exercise)=>[exercise.id,exercise]));
  for(const session of week.training.sessions)for(const item of session.exercises){
    const exercise=byId.get(item.exerciseId);assert.ok(exercise);assert.equal(exercise.level,"Beginner");assert.ok(!exercise.traits.includes("floor"));assert.ok(!exercise.traits.includes("overhead"));
  }
  assert.ok(week.training.sessions.every((session)=>session.exercises.length===4));
  assert.throws(()=>generateCoachingWeek(sanitizeCoachingProfile(profile({availableEquipment:["Resistance band"],movementLimitations:["no-floor","no-overhead","no-deep-knee","no-unilateral"]})),1,"2026-09-07",1_000),{code:"COACHING_PLAN_CONSTRAINTS"});
});

test("unsafe automated deficits fail closed and low-energy variations disclose a steady fallback",()=>{
  const lowBmi=sanitizeCoachingProfile(profile({heightCm:190,weightKg:50,goal:"fat_loss"}));
  assert.throws(()=>generateCoachingWeek(lowBmi,1,"2026-09-07",1_000),{code:"DEFICIT_REQUIRES_REVIEW"});
  const roundedUpUnderweight=sanitizeCoachingProfile(profile({heightCm:180,weightKg:59.8,goal:"fat_loss"}));
  assert.throws(()=>generateCoachingWeek(roundedUpUnderweight,1,"2026-09-07",1_000),{code:"DEFICIT_REQUIRES_REVIEW"});
  const roundedUpMaintenance=generateCoachingWeek(sanitizeCoachingProfile(profile({heightCm:180,weightKg:59.8,goal:"maintenance"})),1,"2026-09-07",1_000);
  assert.equal(roundedUpMaintenance.nutrition.bmi,18.5);assert.equal(roundedUpMaintenance.nutrition.deficit.targetKcal,null);
  const projectedUnderweight=sanitizeCoachingProfile(profile({heightCm:180,weightKg:60.1,goal:"fat_loss"}));
  assert.throws(()=>generateCoachingWeek(projectedUnderweight,1,"2026-09-07",1_000),{code:"DEFICIT_REQUIRES_REVIEW"});
  const projectedMaintenance=generateCoachingWeek(sanitizeCoachingProfile(profile({heightCm:180,weightKg:60.1,goal:"maintenance"})),1,"2026-09-07",1_000);
  assert.ok(60.1/1.8**2>18.5);assert.equal(projectedMaintenance.nutrition.deficit.targetKcal,null);
  const safeDeficit=generateCoachingWeek(sanitizeCoachingProfile(profile({goal:"fat_loss"})),1,"2026-09-07",1_000),minimumSafeWeight=18.5*(safeDeficit.inputs.heightCm/100)**2;
  assert.ok(safeDeficit.nutrition.weightScenarios.every((scenario)=>scenario.rangeKg[0]>=minimumSafeWeight));
  const lowEnergy=generateCoachingWeek(sanitizeCoachingProfile(profile({age:80,heightCm:150,weightKg:65,sexForEquation:"female",lifestyleActivity:"sedentary",caloriePattern:"zigzag",macroPreference:null})),1,"2026-09-07",1_000);
  assert.equal(lowEnergy.nutrition.requestedPattern,"zigzag");assert.equal(lowEnergy.nutrition.effectivePattern,"steady");assert.match(lowEnergy.nutrition.patternFallback,/1,200/);
  assert.throws(()=>generateCoachingWeek(sanitizeCoachingProfile(profile({age:80,heightCm:150,weightKg:45,sexForEquation:"female",lifestyleActivity:"sedentary",caloriePattern:"steady",macroPreference:null})),1,"2026-09-07",1_000),{code:"CALORIE_TARGET_REQUIRES_REVIEW"});
});
