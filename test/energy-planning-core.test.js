"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {ACTIVITY_CATEGORY_MAP,baselineFor,calibrateMaintenance,nasemEer,nutritionFor}=require("../src/energy-planning-core");

function profile(overrides={}){return {version:3,age:40,heightCm:175,weightKg:75,bodyFatPercent:null,sexForEquation:"male",goal:"maintenance",goalPace:"moderate",lifestyleActivity:"moderately_active",workoutDays:["Monday","Wednesday","Friday"],caloriePattern:"steady",flexibleDay:null,macroPreference:"balanced",...overrides};}
function date(offset){return new Date(Date.parse("2026-08-17T00:00:00.000Z")+offset*86400000).toISOString().slice(0,10);}
function completeEvidence({calories=3000,weightStart=75,weeklyChange=0,outlier=false}={}){
  const weights=new Map(Array.from({length:13},(_,index)=>{const day=Math.round(index*20/12),weightKg=weightStart+weeklyChange*day/7;return [day,outlier&&index===6?weightKg+12:weightKg];}));
  return {dailyLogs:Array.from({length:21},(_,index)=>({date:date(index),calories,complete:true,morningWeightKg:weights.get(index)??null}))};
}

test("the official 2023 adult EER example rounds to 2,275 kcal",()=>{
  const input=profile({age:22,heightCm:165,weightKg:63,sexForEquation:"female",lifestyleActivity:"lightly_active"});
  assert.equal(Math.round(nasemEer(input)),2275);
  const baseline=baselineFor(input);assert.equal(baseline.targetKcal,2275);assert.equal(baseline.primaryEquation,"nasem_2023_eer");assert.equal(baseline.activityCategory,"low_active");
});

test("all adult sex and activity equations use the published coefficients",()=>{
  const expected={male:{sedentary:2514.87,lightly_active:2721.27,moderately_active:2905.87,very_active:3213.92,extremely_active:3213.92},female:{sedentary:2183.75,lightly_active:2360.87,moderately_active:2499.85,very_active:2760.68,extremely_active:2760.68}};
  for(const [sex,activities] of Object.entries(expected))for(const [activity,value] of Object.entries(activities))assert.equal(Math.round(nasemEer(profile({sexForEquation:sex,lifestyleActivity:activity}))*100)/100,value,`${sex} ${activity}`);
  assert.deepEqual(ACTIVITY_CATEGORY_MAP,{sedentary:"inactive",lightly_active:"low_active",moderately_active:"active",very_active:"very_active",extremely_active:"very_active"});
});

test("version 1–2 profiles preserve the exact legacy equation choice and do not calibrate before review",()=>{
  const mifflin=baselineFor(profile({version:1,age:18}));
  assert.equal(mifflin.primaryEquation,"legacy_mifflin_activity_fallback");assert.equal(mifflin.targetKcal,2725);assert.equal(mifflin.activityFactor,1.55);assert.match(mifflin.explanation,/original activity multiplier/);
  const cunningham=baselineFor(profile({version:2,bodyFatPercent:20}));
  assert.equal(cunningham.primaryEquation,"legacy_cunningham_activity_fallback");assert.equal(cunningham.targetKcal,2575);assert.equal(cunningham.bodyFatCrossCheck,null,"a legacy primary must not also render as its own cross-check");
  const noSex=baselineFor(profile({version:1,bodyFatPercent:20,sexForEquation:null}));assert.equal(noSex.primaryEquation,"legacy_cunningham_activity_fallback");
  const held=calibrateMaintenance(profile({version:1}),"2026-09-07",completeEvidence({calories:3600}));assert.equal(held.status,"legacy_profile");assert.equal(held.appliedAdjustmentKcal,0);assert.equal(held.targetKcal,held.baselineKcal);
});

test("body-fat data is a secondary cross-check and cannot silently replace the adult EER target",()=>{
  const without=baselineFor(profile()),withBodyFat=baselineFor(profile({bodyFatPercent:12}));
  assert.equal(withBodyFat.primaryEquation,"nasem_2023_eer");assert.equal(withBodyFat.targetKcal,without.targetKcal);assert.equal(withBodyFat.bodyFatCrossCheck.role,"secondary_cross_check");assert.equal(without.bodyFatCrossCheck,null);
});

test("calibration uses exactly the preceding 21 calendar days and ignores incomplete or future rows",()=>{
  const evidence=completeEvidence();
  evidence.dailyLogs.push({date:"2026-08-16",calories:1,complete:true,morningWeightKg:200},{date:"2026-09-07",calories:1,complete:true,morningWeightKg:200},{date:"2026-08-20",calories:1,complete:false,morningWeightKg:null});
  const result=calibrateMaintenance(profile(),"2026-09-07",evidence);
  assert.equal(result.windowStart,"2026-08-17");assert.equal(result.windowEnd,"2026-09-06");assert.equal(result.evidence.completeCalorieDays,21);assert.equal(result.evidence.rawMorningWeightDays,13);assert.equal(result.status,"trend_informed");
});

test("sparse and incomplete evidence reports progress without changing the equation baseline",()=>{
  const starting=calibrateMaintenance(profile(),"2026-09-07",null);assert.equal(starting.status,"starting");assert.equal(starting.appliedAdjustmentKcal,0);
  const evidence=completeEvidence();evidence.dailyLogs=evidence.dailyLogs.slice(0,17);let kept=0;for(const row of evidence.dailyLogs)if(row.morningWeightKg!=null){kept+=1;if(kept>11)row.morningWeightKg=null;}
  const calibrating=calibrateMaintenance(profile(),"2026-09-07",evidence);assert.equal(calibrating.status,"calibrating");assert.equal(calibrating.targetKcal,calibrating.baselineKcal);assert.match(calibrating.explanation,/18 explicitly complete/);
});

test("Theil-Sen calibration is deterministic, rejects an isolated weight outlier, and caps correction",()=>{
  const input=completeEvidence({calories:3600,outlier:true}),snapshot=structuredClone(input),first=calibrateMaintenance(profile(),"2026-09-07",input),reordered=calibrateMaintenance(profile(),"2026-09-07",{dailyLogs:[...input.dailyLogs].reverse()});
  assert.deepEqual(input,snapshot,"calibration must not mutate caller evidence");assert.deepEqual(reordered,first);assert.equal(first.status,"trend_informed");assert.equal(first.evidence.outlierWeightDays,1);assert.equal(first.appliedAdjustmentKcal,150);assert.equal(first.targetKcal,first.baselineKcal+150);assert.match(first.explanation,/capped at 150/);
});

test("calibration fingerprints all usable raw evidence, including a rejected weight outlier",()=>{
  const clean=completeEvidence({calories:3000}),withOutlier=structuredClone(clean);withOutlier.dailyLogs[1].morningWeightKg=100;
  const first=calibrateMaintenance(profile(),"2026-09-07",clean),second=calibrateMaintenance(profile(),"2026-09-07",withOutlier);
  assert.equal(first.status,"trend_informed");assert.equal(second.status,"trend_informed");assert.equal(second.evidence.outlierWeightDays,1);assert.notEqual(second.evidenceFingerprint,first.evidenceFingerprint);
});

test("trend calibration requires exact evidence counts spread across at least 14 days",()=>{
  const evidence={dailyLogs:Array.from({length:21},(_,index)=>({date:date(index),calories:3000,complete:index<18,morningWeightKg:index<=10||index===14?75:null}))};
  const accepted=calibrateMaintenance(profile(),"2026-09-07",evidence);assert.equal(accepted.status,"trend_informed");assert.deepEqual({calories:accepted.evidence.completeCalorieDays,weights:accepted.evidence.morningWeightDays,span:accepted.evidence.weightObservationSpanDays},{calories:18,weights:12,span:14});assert.match(accepted.thresholdBasis,/STRATA heuristic/);
  evidence.dailyLogs[14].morningWeightKg=null;evidence.dailyLogs[11].morningWeightKg=75;
  const clustered=calibrateMaintenance(profile(),"2026-09-07",evidence);assert.equal(clustered.status,"calibrating");assert.equal(clustered.evidence.morningWeightDays,12);assert.equal(clustered.evidence.weightObservationSpanDays,11);assert.match(clustered.explanation,/14 days/);
});

test("implausible trend and observed-maintenance signals are rejected instead of applied",()=>{
  const fast=calibrateMaintenance(profile(),"2026-09-07",completeEvidence({calories:2600,weeklyChange:-1.2}));assert.equal(fast.status,"calibrating");assert.equal(fast.appliedAdjustmentKcal,0);assert.match(fast.explanation,/1.5%/);
  const far=calibrateMaintenance(profile(),"2026-09-07",completeEvidence({calories:1200}));assert.equal(far.status,"calibrating");assert.equal(far.appliedAdjustmentKcal,0);assert.match(far.explanation,/STRATA's heuristic 40%/);
});

test("plausible gain and loss trends adjust maintenance in the correct bounded direction",()=>{
  const baseline=baselineFor(profile()).targetKcal,gain=calibrateMaintenance(profile(),"2026-09-07",completeEvidence({calories:baseline,weeklyChange:.35})),loss=calibrateMaintenance(profile(),"2026-09-07",completeEvidence({calories:baseline,weeklyChange:-.35}));
  assert.equal(gain.status,"trend_informed");assert.ok(gain.trendKgPerWeek>0);assert.ok(gain.appliedAdjustmentKcal<0);assert.ok(gain.observedMaintenanceKcal<baseline);
  assert.equal(loss.status,"trend_informed");assert.ok(loss.trendKgPerWeek<0);assert.ok(loss.appliedAdjustmentKcal>0);assert.ok(loss.observedMaintenanceKcal>baseline);
});

test("daily patterns and weight scenarios preserve their intended ordering",()=>{
  const zigzag=nutritionFor(profile({caloriePattern:"zigzag"}),"2026-09-07"),byKind=(nutrition,kind)=>nutrition.dailyTargets.filter((day)=>day.kind===kind).map((day)=>day.calories);
  assert.ok(Math.min(...byKind(zigzag,"higher_training_day"))>Math.max(...byKind(zigzag,"lower_rest_day")));
  const flexible=nutritionFor(profile({caloriePattern:"flexible_day",flexibleDay:"Saturday"}),"2026-09-07"),flexibleTarget=flexible.dailyTargets.find((day)=>day.kind==="flexible_day").calories,standard=byKind(flexible,"standard");assert.ok(flexibleTarget>Math.max(...standard));
  const deficit=nutritionFor(profile({goal:"fat_loss"}),"2026-09-07"),maintenance=nutritionFor(profile(),"2026-09-07"),surplus=nutritionFor(profile({goal:"muscle_gain"}),"2026-09-07");assert.ok(deficit.deficit.targetKcal<maintenance.maintenance.targetKcal);assert.ok(surplus.bulk.targetKcal>maintenance.maintenance.targetKcal);
  const centers=(nutrition)=>nutrition.weightScenarios.map((item)=>item.weightKg);assert.ok(centers(deficit).every((weight,index,values)=>index===0||weight<=values[index-1]));assert.deepEqual(centers(maintenance),[75,75,75]);assert.ok(centers(surplus).every((weight,index,values)=>index===0||weight>=values[index-1]));
});

test("nutrition output keeps legacy consumer fields while exposing the model, range, and evidence",()=>{
  const evidence=completeEvidence({calories:3000}),snapshot=structuredClone(evidence),nutrition=nutritionFor(profile(),"2026-09-07",evidence);
  assert.deepEqual(evidence,snapshot);assert.equal(nutrition.equation,"nasem_2023_eer");assert.equal(nutrition.rmrEquation,"mifflin_st_jeor");assert.equal(nutrition.activityFactor,null);assert.equal(nutrition.legacyActivityFactor,1.55);assert.equal(nutrition.maintenance.calibration.status,"trend_informed");assert.match(nutrition.activityFactorBasis,/No resting-energy multiplier/);assert.match(nutrition.maintenance.rangeLabel,/not a confidence interval/);assert.equal(nutrition.weeklyTargetKcal,nutrition.dailyTargets.reduce((sum,day)=>sum+day.calories,0));
});
