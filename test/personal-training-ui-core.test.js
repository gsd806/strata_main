"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const vm=require("node:vm");
const Ui=require("../public/scripts/personal-training-ui-core");

function validDraft(overrides={}){
  return{
    unitSystem:"metric",age:"31",heightCm:"178",weightKg:"82.4",bodyFatPercent:"18.5",sexForEquation:"",
    activityLevel:"moderate",goal:"deficit",goalPace:"gentle",experience:"intermediate",trainingDaysPerWeek:"3",sessionMinutes:"45",
    availableDays:["Monday","Wednesday","Friday"],equipment:["Dumbbells","Cables"],knownExerciseIds:["flat-dumbbell-press"],
    performanceMaxes:[{exerciseId:"flat-dumbbell-press",maxSets:"4",maxReps:"10",maxWeight:"32.5"}],
    caloriePattern:"training-day",flexibleDay:"",macrosEnabled:true,...overrides
  };
}

test("no-build script exposes the same frozen browser API",()=>{
  const context={Intl};context.globalThis=context;vm.createContext(context);
  vm.runInContext(readFileSync(join(__dirname,"..","public","scripts","personal-training-ui-core.js"),"utf8"),context,{filename:"personal-training-ui-core.js"});
  assert.equal(typeof context.StrataPersonalTrainingUi.profileDraftToMetric,"function");
  assert.equal(Object.isFrozen(context.StrataPersonalTrainingUi),true);
});

test("metric and imperial profile drafts serialize to the same canonical units",()=>{
  const metric=Ui.profileDraftToMetric(validDraft());
  assert.equal(metric.ok,true);
  assert.deepEqual(metric.payload.usualExercises,[{exerciseId:"flat-dumbbell-press",maxSets:4,maxReps:10,maxWeightKg:32.5}]);
  assert.equal(metric.payload.goal,"fat_loss");assert.equal(metric.payload.goalPace,"gentle");assert.equal(metric.payload.lifestyleActivity,"moderately_active");
  assert.deepEqual(metric.payload.workoutDays,["Monday","Wednesday","Friday"]);assert.equal(metric.payload.sessionMinutes,45);
  assert.equal(Object.hasOwn(metric.payload,"revision"),false);
  assert.equal(metric.payload.sexForEquation,null,"sex is unnecessary when body fat supplies lean-mass input");
  const imperial=Ui.profileDraftToMetric(validDraft({
    unitSystem:"imperial",heightCm:"",heightFeet:"5",heightInches:"10.1",weightKg:"",weightLb:"181.66",
    performanceMaxes:[{exerciseId:"flat-dumbbell-press",maxSets:"4",maxReps:"10",maxWeight:"71.65"}]
  }));
  assert.equal(imperial.ok,true);
  assert.ok(Math.abs(imperial.payload.heightCm-metric.payload.heightCm)<0.2);
  assert.ok(Math.abs(imperial.payload.weightKg-metric.payload.weightKg)<0.1);
  assert.ok(Math.abs(imperial.payload.usualExercises[0].maxWeightKg-32.5)<0.1);
});

test("Mifflin equation input is required only when body fat is omitted",()=>{
  const missing=Ui.profileDraftToMetric(validDraft({bodyFatPercent:"",sexForEquation:""}));
  assert.equal(missing.ok,false);
  assert.ok(missing.errors.some(({field})=>field==="sexForEquation"));
  const supplied=Ui.profileDraftToMetric(validDraft({bodyFatPercent:"",sexForEquation:"female"}));
  assert.equal(supplied.ok,true);
  assert.equal(supplied.payload.sexForEquation,"female");
});

test("profile validation gives field-specific adult, measurement, schedule, and flexible-day errors",()=>{
  const result=Ui.profileDraftToMetric(validDraft({
    age:"17",heightCm:"99",weightKg:"900",bodyFatPercent:"80",activityLevel:"unknown",goal:"cut",experience:"expert",
    trainingDaysPerWeek:"4",availableDays:["Monday","Monday","Funday"],caloriePattern:"flexible-day",flexibleDay:""
  }));
  assert.equal(result.ok,false);
  for(const field of ["age","height","weight","bodyFatPercent","activityLevel","goal","experience","trainingDays","flexibleDay"]){
    assert.ok(result.errors.some((error)=>error.field===field),field);
  }
});

test("usual exercise rows are normalized without duplicates or incomplete maxima",()=>{
  const result=Ui.profileDraftToMetric(validDraft({
    performanceMaxes:[
      {exerciseId:"incline-curl",maxSets:"3",maxReps:"12",maxWeight:"14"},
      {exerciseId:"incline-curl",maxSets:"3",maxReps:"12",maxWeight:"15"},
      {exerciseId:"dead-bug",maxSets:"",maxReps:"",maxWeight:""}
    ]
  }));
  assert.equal(result.ok,false);
  assert.ok(result.errors.some(({message})=>/once/.test(message)));
  assert.ok(result.errors.some(({message})=>/1–20 sets/.test(message)));
  assert.deepEqual(result.payload.usualExercises,[{exerciseId:"incline-curl",maxSets:3,maxReps:12,maxWeightKg:14}]);
});

test("saved metric profiles round-trip through imperial form values",()=>{
  const source=Ui.profileDraftToMetric(validDraft()).payload,form=Ui.profileMetricToDraft(source,"imperial"),roundTrip=Ui.profileDraftToMetric(form);
  assert.equal(roundTrip.ok,true);
  assert.ok(Math.abs(roundTrip.payload.heightCm-source.heightCm)<0.2);
  assert.ok(Math.abs(roundTrip.payload.weightKg-source.weightKg)<0.1);
  assert.ok(Math.abs(roundTrip.payload.usualExercises[0].maxWeightKg-source.usualExercises[0].maxWeightKg)<0.1);
  assert.equal(Ui.profileDraftToMetric(source).ok,true,"a canonical profile can be validated again without converting its metric storage fields as imperial input");
  form.trainingDays=["Tuesday","Thursday"];form.frequency=2;form.performanceMaxes[0].reps=8;form.macrosEnabled=false;
  const edited=Ui.profileDraftToMetric(form);
  assert.deepEqual(edited.payload.workoutDays,["Tuesday","Thursday"]);assert.equal(edited.payload.usualExercises[0].maxReps,8);assert.equal(edited.payload.macroPreference,null);
});

test("discover form aliases map to the strict coaching API contract",()=>{
  const result=Ui.profileDraftToMetric({
    height:"70",heightUnit:"in",weight:"180",weightUnit:"lb",age:"28",bodyFatPercent:"",sexForEquation:"male",
    goal:"surplus",goalPace:"moderate",activityLevel:"high",experience:"advanced",frequency:"2",sessionMinutes:"60",
    trainingDays:["Tuesday","Saturday"],equipment:["Dumbbells"],limitations:["no-overhead"],
    performanceMaxes:[{exerciseId:"incline-curl",sets:"3",reps:"10",load:"30",unit:"lb"}],
    caloriePattern:"flexible_day",flexibleDay:"Saturday",macrosEnabled:true,timeZone:"Asia/Dubai"
  });
  assert.equal(result.ok,true);
  assert.deepEqual(result.payload,{
    version:1,measurementSystem:"imperial",preferredLoadUnit:"lb",age:28,heightCm:177.8,weightKg:81.6,bodyFatPercent:null,sexForEquation:"male",
    goal:"muscle_gain",goalPace:"moderate",experience:"advanced",lifestyleActivity:"very_active",workoutDays:["Tuesday","Saturday"],sessionMinutes:60,
    usualExercises:[{exerciseId:"incline-curl",maxSets:3,maxReps:10,maxWeightKg:13.6}],availableEquipment:["Dumbbells"],movementLimitations:["no-overhead"],
    caloriePattern:"flexible_day",flexibleDay:"Saturday",macroPreference:"balanced",timeZone:"Asia/Dubai"
  });
});

test("daily progress keeps remaining and over-target amounts distinct",()=>{
  assert.deepEqual(Ui.calorieProgress(2200,1750),{
    targetCalories:2200,consumedCalories:1750,remainingCalories:450,overByCalories:0,status:"remaining",progressPercent:80,summary:"450 kcal remaining for the selected day"
  });
  const over=Ui.calorieProgress(2200,2350);
  assert.equal(over.remainingCalories,0);assert.equal(over.overByCalories,150);assert.equal(over.status,"over");assert.equal(over.progressPercent,100);
  assert.throws(()=>Ui.calorieProgress(0,10),/positive daily/);
  assert.throws(()=>Ui.calorieProgress(1000,-1),/zero or a positive/);
});

test("optional macro progress and seven-day totals remain transparent",()=>{
  assert.equal(Ui.macroProgress(null,{proteinGrams:20}),null);
  const macros=Ui.macroProgress({proteinGrams:150,fatGrams:70,carbGrams:250},{proteinGrams:90,fatGrams:72,carbGrams:100});
  assert.deepEqual(macros.protein,{targetGrams:150,consumedGrams:90,remainingGrams:60,overByGrams:0,progressPercent:60});
  assert.equal(macros.fat.overByGrams,2);
  assert.equal(Ui.macroProgress({proteinG:150,fatG:70,carbsG:250},{proteinG:90,fatG:72,carbsG:100}).carbs.remainingGrams,150);
  const week=Ui.weeklyCalorieProgress(Ui.DAYS.map((day,index)=>({day,targetCalories:index===5?2600:2100,consumedCalories:2000})));
  assert.equal(week.complete,true);assert.equal(week.targetCalories,15_200);assert.equal(week.consumedCalories,14_000);assert.equal(week.remainingCalories,1_200);
});

test("projection display rounds deliberately and always carries uncertainty language",()=>{
  const metric=Ui.projectionDisplay({startWeightKg:82.37,projectedWeightKg:79.73,lowWeightKg:78.91,highWeightKg:81.04,weeks:12},"metric");
  assert.deepEqual({start:metric.start,expected:metric.expected,range:metric.range,weeks:metric.weeks},{start:"82.5 kg",expected:"79.5 kg",range:"79 kg–81 kg",weeks:12});
  assert.match(metric.caveat,/not a promise/i);
  const imperial=Ui.projectionDisplay({startWeightKg:82.37,expectedWeightKg:79.73,lowWeightKg:78.91,highWeightKg:81.04,horizonWeeks:12,caveat:"Estimate only."},"imperial");
  assert.equal(imperial.start,"182 lb");assert.equal(imperial.expected,"176 lb");assert.equal(imperial.caveat,"Estimate only.");
  assert.equal(Ui.projectionDisplay({startWeightKg:82.37,weightKg:79.73,rangeKg:[78.91,81.04],weeks:12},"metric").expected,"79.5 kg");
  assert.equal(Ui.projectionDisplay({startWeightKg:80},"metric"),null);
});
