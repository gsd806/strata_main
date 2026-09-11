// @ts-check
"use strict";

const {createHash}=require("node:crypto");
const {CATALOG_FINGERPRINT:MEAL_CATALOG_FINGERPRINT,sanitizeMealPreferences}=require("./meal-planning-core");
const {DAYS,EXERCISES}=require("./plans");

const GENERATION_VERSION="coaching-week-v2";
const EQUIPMENT=[...new Set(EXERCISES.map((exercise)=>String(exercise.equipment)))].sort();
const EXERCISE_BY_ID=new Map(EXERCISES.map((exercise)=>[String(exercise.id),exercise]));
const CATALOG_FINGERPRINT=createHash("sha256").update(EXERCISES.map((exercise)=>String(exercise.id)).sort().join("\n")).digest("hex").slice(0,16);
const ACTIVITY_FACTORS=Object.freeze({sedentary:1.2,lightly_active:1.375,moderately_active:1.55,very_active:1.725,extremely_active:1.9});
const MOVEMENT_LIMITATIONS=Object.freeze(["no-overhead","no-deep-knee","no-unsupported-hinge","no-floor","no-unilateral"]);
const SESSION_COUNTS=Object.freeze({30:4,45:5,60:6,75:6,90:7});

/** @param {string} message @param {string} [code] @param {number} [status] */
function coachingError(message,code="INVALID_COACHING_PROFILE",status=400){return Object.assign(new Error(message),{code,status});}
/** @param {unknown} value @param {string} label @returns {Record<string,any>} */
function object(value,label){if(!value||typeof value!=="object"||Array.isArray(value))throw coachingError(`${label} must be an object.`);return value;}
/** @param {Record<string,any>} value @param {string[]} allowed @param {string} label */
function exactKeys(value,allowed,label){const extra=Object.keys(value).filter((key)=>!allowed.includes(key));if(extra.length)throw coachingError(`${label} contains unsupported fields: ${extra.join(", ")}.`);}
/** @param {unknown} value @param {number} min @param {number} max @param {string} label */
function integer(value,min,max,label){if(typeof value!=="number"||!Number.isSafeInteger(value)||value<min||value>max)throw coachingError(`${label} must be a whole number from ${min} to ${max}.`);return value;}
/** @param {unknown} value @param {number} min @param {number} max @param {string} label */
function decimal(value,min,max,label){if(typeof value!=="number"||!Number.isFinite(value)||value<min||value>max)throw coachingError(`${label} must be from ${min} to ${max}.`);return Math.round(value*10)/10;}
/** @template {string} T @param {unknown} value @param {readonly T[]} allowed @param {string} label @returns {T} */
function choice(value,allowed,label){if(typeof value!=="string"||!allowed.includes(/** @type {T} */(value)))throw coachingError(`${label} is invalid.`);return /** @type {T} */(value);}
/** @template {number} T @param {unknown} value @param {readonly T[]} allowed @param {string} label @returns {T} */
function numericChoice(value,allowed,label){if(typeof value!=="number"||!allowed.includes(/** @type {T} */(value)))throw coachingError(`${label} is invalid.`);return /** @type {T} */(value);}
/** @param {unknown} value */
function timezone(value){
  const name=value==null?"UTC":String(value);
  if(name.length<1||name.length>80||/[^A-Za-z0-9_+\-/]/.test(name))throw coachingError("Time zone is invalid.");
  try{new Intl.DateTimeFormat("en",{timeZone:name}).format(0);}catch{throw coachingError("Time zone is invalid.");}
  return name;
}

/** @param {unknown} value */
function sanitizeCoachingProfile(value){
  const input=object(value,"Coaching profile");
  exactKeys(input,["version","measurementSystem","preferredLoadUnit","age","heightCm","weightKg","bodyFatPercent","sexForEquation","goal","goalPace","experience","lifestyleActivity","workoutDays","sessionMinutes","usualExercises","availableEquipment","movementLimitations","caloriePattern","flexibleDay","macroPreference","timeZone","mealPreferences"],"Coaching profile");
  if(input.version!==undefined&&input.version!==1&&input.version!==2)throw coachingError("Coaching profile version is unsupported.");
  if(input.version===1&&input.mealPreferences!=null)throw coachingError("Meal preferences require coaching profile version 2.");
  if(input.version===2&&input.mealPreferences==null)throw coachingError("Coaching profile version 2 requires meal preferences.");
  const measurementSystem=choice(input.measurementSystem,["metric","imperial"],"Measurement system");
  const preferredLoadUnit=choice(input.preferredLoadUnit,["kg","lb"],"Preferred load unit");
  const age=integer(input.age,18,80,"Age"),heightCm=decimal(input.heightCm,120,230,"Height"),weightKg=decimal(input.weightKg,35,300,"Weight");
  const bodyFatPercent=input.bodyFatPercent==null?null:decimal(input.bodyFatPercent,3,65,"Body-fat percentage");
  const sexForEquation=bodyFatPercent==null?choice(input.sexForEquation,["female","male"],"Sex used by the energy equation"):input.sexForEquation==null?null:choice(input.sexForEquation,["female","male"],"Sex used by the energy equation");
  const goal=choice(input.goal,["fat_loss","maintenance","muscle_gain"],"Nutrition goal");
  const goalPace=choice(input.goalPace??"moderate",["gentle","moderate"],"Goal pace");
  const experience=choice(input.experience,["beginner","intermediate","advanced"],"Training experience");
  const lifestyleActivity=/** @type {keyof typeof ACTIVITY_FACTORS} */(choice(input.lifestyleActivity,Object.keys(ACTIVITY_FACTORS),"Lifestyle activity"));
  if(!Array.isArray(input.workoutDays)||input.workoutDays.length<1||input.workoutDays.length>6)throw coachingError("Choose between 1 and 6 workout days.");
  const workoutDays=DAYS.filter((day)=>input.workoutDays.includes(day));
  if(workoutDays.length!==input.workoutDays.length||new Set(input.workoutDays).size!==input.workoutDays.length)throw coachingError("Workout days must be valid and unique.");
  const sessionMinutes=numericChoice(input.sessionMinutes,[30,45,60,75,90],"Session length");
  const rawExercises=input.usualExercises??[];
  if(!Array.isArray(rawExercises)||rawExercises.length>40)throw coachingError("Usual exercises must be a list of at most 40 movements.");
  const seen=new Set();
  const usualExercises=rawExercises.map((raw,index)=>{
    const exercise=object(raw,`Usual exercise ${index+1}`);exactKeys(exercise,["exerciseId","maxSets","maxReps","maxWeightKg"],`Usual exercise ${index+1}`);
    const exerciseId=String(exercise.exerciseId||"");
    if(!EXERCISE_BY_ID.has(exerciseId))throw coachingError(`Usual exercise ${index+1} is not in the exercise library.`);
    if(seen.has(exerciseId))throw coachingError("Each usual exercise may only be entered once.");seen.add(exerciseId);
    return {exerciseId,maxSets:integer(exercise.maxSets,1,20,"Maximum sets"),maxReps:integer(exercise.maxReps,1,100,"Maximum reps"),maxWeightKg:exercise.maxWeightKg==null?null:decimal(exercise.maxWeightKg,0,1000,"Maximum load")};
  });
  const rawEquipment=input.availableEquipment??[];
  if(!Array.isArray(rawEquipment)||rawEquipment.length>20||rawEquipment.some((item)=>typeof item!=="string"||!EQUIPMENT.includes(item))||new Set(rawEquipment).size!==rawEquipment.length)throw coachingError("Available equipment contains an invalid or repeated option.");
  const availableEquipment=EQUIPMENT.filter((item)=>rawEquipment.includes(item));
  const rawLimitations=input.movementLimitations??[];
  if(!Array.isArray(rawLimitations)||rawLimitations.length>MOVEMENT_LIMITATIONS.length||rawLimitations.some((item)=>typeof item!=="string"||!MOVEMENT_LIMITATIONS.includes(item))||new Set(rawLimitations).size!==rawLimitations.length)throw coachingError("Movement limitations contain an invalid or repeated option.");
  const movementLimitations=MOVEMENT_LIMITATIONS.filter((item)=>rawLimitations.includes(item));
  const caloriePattern=choice(input.caloriePattern,["steady","zigzag","flexible_day"],"Calorie pattern");
  const flexibleDay=caloriePattern==="flexible_day"?choice(input.flexibleDay,DAYS,"Flexible day"):null;
  const macroPreference=input.macroPreference==null?null:choice(input.macroPreference,["balanced","higher_protein"],"Macro preference");
  const mealPreferences=input.mealPreferences==null?null:sanitizeMealPreferences(input.mealPreferences);
  return {version:mealPreferences?2:1,measurementSystem,preferredLoadUnit,age,heightCm,weightKg,bodyFatPercent,sexForEquation,goal,goalPace,experience,lifestyleActivity,workoutDays,sessionsPerWeek:workoutDays.length,sessionMinutes,usualExercises,availableEquipment,movementLimitations,caloriePattern,flexibleDay,macroPreference,timeZone:timezone(input.timeZone),mealPreferences};
}

/** @param {unknown} value */
function validDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))throw coachingError("Log date must use YYYY-MM-DD.","INVALID_COACHING_DATE");
  const date=new Date(`${value}T00:00:00.000Z`);
  if(!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getUTCFullYear()<2000||date.getUTCFullYear()>2200)throw coachingError("Log date is invalid.","INVALID_COACHING_DATE");
  return value;
}
/** @param {unknown} value */
function sanitizeDailyLog(value){
  const input=object(value,"Calorie log");exactKeys(input,["calories","proteinG","carbsG","fatG"],"Calorie log");
  const values=[input.proteinG,input.carbsG,input.fatG],provided=values.filter((item)=>item!=null).length;
  if(provided!==0&&provided!==3)throw coachingError("Enter protein, carbohydrates, and fat together, or leave all macros blank.","INVALID_COACHING_LOG");
  return {calories:integer(input.calories,0,20000,"Calories"),proteinG:provided?integer(input.proteinG,0,2000,"Protein"):null,carbsG:provided?integer(input.carbsG,0,3000,"Carbohydrates"):null,fatG:provided?integer(input.fatG,0,1000,"Fat"):null};
}

/** @param {number} timestamp @param {string} timeZone */
function localDate(timestamp,timeZone){
  const parts=new Intl.DateTimeFormat("en-CA",{timeZone,year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date(timestamp));
  /** @param {string} type */
  const part=(type)=>parts.find((entry)=>entry.type===type)?.value||"";
  return `${part("year")}-${part("month")}-${part("day")}`;
}
/** @param {string} date */
function weekStartForDate(date){const valid=validDate(date),stamp=Date.parse(`${valid}T00:00:00.000Z`),day=new Date(stamp).getUTCDay(),monday=stamp-((day+6)%7)*86400000;return new Date(monday).toISOString().slice(0,10);}
/** @param {number} timestamp @param {string} timeZone */
function currentWeekStart(timestamp,timeZone){return weekStartForDate(localDate(timestamp,timeZone));}
/** @param {string} date @param {number} offset */
function addDays(date,offset){return new Date(Date.parse(`${date}T00:00:00.000Z`)+offset*86400000).toISOString().slice(0,10);}
/** @param {number} value @param {number} step */
function rounded(value,step=1){return Math.round(value/step)*step;}

/** Preserve an exact weekly calorie budget while distributing daily weights. @param {number} target @param {number[]} weights */
function distribute(target,weights){
  const total=rounded(target)*7,sum=weights.reduce((value,weight)=>value+weight,0),raw=weights.map((weight)=>total*weight/sum),days=raw.map(Math.floor);
  for(let remaining=total-days.reduce((a,b)=>a+b,0),index=0;remaining>0;remaining-=1,index=(index+1)%7)days[index]=(days[index]??0)+1;
  return days;
}
/** @param {number} calories @param {number} weightKg @param {string|null} preference @param {string} goal */
function macroTarget(calories,weightKg,preference,goal){
  if(!preference)return null;
  const requestedRate=preference==="higher_protein"?2:goal==="fat_loss"?1.8:1.6,protein=rounded(Math.min(weightKg*requestedRate,calories*.3/4));
  const fat=rounded(calories*.25/9),carbs=Math.max(0,rounded((calories-protein*4-fat*9)/4));
  return {proteinG:protein,carbsG:carbs,fatG:fat,proteinBasis:`${requestedRate} g/kg, capped at 30% of energy`,fatBasis:"approximately 25% of energy",carbohydrateBasis:"remaining energy (at least approximately 45%)"};
}
/** @param {number} weightKg @param {number} dailyCalorieDelta @param {number} weeks */
function weightScenario(weightKg,dailyCalorieDelta,weeks){
  const days=weeks*7,changeLb=dailyCalorieDelta/10*(1-Math.exp(-Math.log(2)*days/365)),changeKg=changeLb*.45359237,center=Math.max(0,weightKg+changeKg),uncertainty=Math.max(.5,Math.abs(changeKg)*.4);
  return {center,uncertainty};
}
/** @param {number} weightKg @param {number} dailyCalorieDelta */
function weightScenarios(weightKg,dailyCalorieDelta){return [4,8,12].map((weeks)=>{const {center,uncertainty}=weightScenario(weightKg,dailyCalorieDelta,weeks);return {weeks,weightKg:Math.round(center*10)/10,rangeKg:[Math.round(Math.max(0,center-uncertainty)*10)/10,Math.round((center+uncertainty)*10)/10]};});}

/** @param {ReturnType<typeof sanitizeCoachingProfile>} profile @param {string} weekStart */
function nutritionFor(profile,weekStart){
  const leanMass=profile.bodyFatPercent==null?null:profile.weightKg*(1-profile.bodyFatPercent/100);
  const equation=leanMass==null?"mifflin_st_jeor":"katch_mcardle";
  const rmr=leanMass==null?10*profile.weightKg+6.25*profile.heightCm-5*profile.age+(profile.sexForEquation==="male"?5:-161):370+21.6*leanMass;
  const activityFactor=ACTIVITY_FACTORS[profile.lifestyleActivity],maintenance=rounded(rmr*activityFactor,25),maintenanceLow=rounded(maintenance*.95,25),maintenanceHigh=rounded(maintenance*1.05,25);
  const heightM=profile.heightCm/100,rawBmi=profile.weightKg/heightM**2,bmi=Math.round(rawBmi*10)/10,deficitRate=profile.goalPace==="gentle"?.1:.15,surplusRate=profile.goalPace==="gentle"?.05:.075;
  const deficitDelta=Math.min(500,rounded(maintenance*deficitRate,25)),surplusDelta=Math.min(250,Math.max(100,rounded(maintenance*surplusRate,25)));
  const candidateDeficit=Math.max(1200,maintenance-deficitDelta),minimumSafeWeight=18.5*heightM**2,candidateDelta=candidateDeficit-maintenance;
  const deficitAllowed=rawBmi>=18.5&&maintenance>1200&&[4,8,12].every((weeks)=>{const {center,uncertainty}=weightScenario(profile.weightKg,candidateDelta,weeks),lower=Math.max(0,center-uncertainty),displayedLower=Math.round(lower*10)/10;return lower>=minimumSafeWeight&&displayedLower>=minimumSafeWeight;}),deficit=deficitAllowed?candidateDeficit:null,bulk=maintenance+surplusDelta;
  const selected=profile.goal==="fat_loss"?deficit:profile.goal==="muscle_gain"?bulk:maintenance;
  if(selected==null)throw coachingError("A calorie deficit cannot be generated within the reviewed BMI and calorie-floor limits. Choose maintenance and speak with a qualified clinician.","DEFICIT_REQUIRES_REVIEW",422);
  if(selected<1200)throw coachingError("An automated calorie target cannot be generated above the conservative 1,200 kcal review floor. Speak with a qualified clinician.","CALORIE_TARGET_REQUIRES_REVIEW",422);
  let weights=Array(7).fill(1),effectivePattern=profile.caloriePattern,patternFallback=null;
  if(profile.caloriePattern==="zigzag")weights=DAYS.map((day)=>profile.workoutDays.includes(day)?1.075:.925);
  if(profile.caloriePattern==="flexible_day")weights=DAYS.map((day)=>day===profile.flexibleDay?1.15:0.975);
  let calories=distribute(selected,weights);
  if(Math.min(...calories)<1200){calories=distribute(selected,Array(7).fill(1));effectivePattern="steady";patternFallback="The requested variation would create a day below the conservative 1,200 kcal floor, so this week uses steady targets.";}
  const dailyTargets=DAYS.map((day,index)=>{const dailyCalories=calories[index]??selected;return {day,date:addDays(weekStart,index),calories:dailyCalories,macros:macroTarget(dailyCalories,profile.weightKg,profile.macroPreference,profile.goal),kind:effectivePattern==="zigzag"?(profile.workoutDays.includes(day)?"higher_training_day":"lower_rest_day"):effectivePattern==="flexible_day"&&day===profile.flexibleDay?"flexible_day":"standard"};});
  const projections=weightScenarios(profile.weightKg,selected-maintenance);
  return {bmi,equation,rmrKcal:rounded(rmr),activityFactor,activityFactorBasis:"reported typical total activity, including planned training",maintenance:{targetKcal:maintenance,estimateRangeKcal:[maintenanceLow,maintenanceHigh]},deficit:{targetKcal:deficit,policy:`${Math.round(deficitRate*100)}% below estimated maintenance, capped at 500 kcal/day and never below 1,200 kcal/day`},bulk:{targetKcal:bulk,policy:`About ${surplusRate*100}% above estimated maintenance, bounded to 100–250 kcal/day`},selectedGoal:profile.goal,goalPace:profile.goalPace,requestedPattern:profile.caloriePattern,effectivePattern,patternFallback,weeklyTargetKcal:calories.reduce((a,b)=>a+b,0),dailyTargets,weightScenarios:projections};
}

const SPLITS=Object.freeze({
  1:[{label:"Full body",targets:["legs","chest","back","shoulders","core"]}],
  2:[{label:"Full body A",targets:["legs","chest","back","shoulders","core"]},{label:"Full body B",targets:["glutes","back","chest","arms","core"]}],
  3:[{label:"Full body A",targets:["legs","chest","back","shoulders","core"]},{label:"Full body B",targets:["glutes","back","chest","arms","core"]},{label:"Full body C",targets:["legs","chest","back","calves","core"]}],
  4:[{label:"Upper A",targets:["chest","back","shoulders","biceps","triceps"]},{label:"Lower A",targets:["legs","glutes","calves","core","legs"]},{label:"Upper B",targets:["back","chest","shoulders","biceps","triceps"]},{label:"Lower B",targets:["glutes","legs","calves","core","legs"]}],
  5:[{label:"Push",targets:["chest","shoulders","triceps","chest","triceps"]},{label:"Pull",targets:["back","biceps","back","biceps","forearms"]},{label:"Lower A",targets:["legs","glutes","calves","core","legs"]},{label:"Upper",targets:["chest","back","shoulders","biceps","triceps"]},{label:"Lower B",targets:["glutes","legs","calves","core","legs"]}],
  6:[{label:"Push A",targets:["chest","shoulders","triceps","chest","triceps"]},{label:"Pull A",targets:["back","biceps","back","biceps","forearms"]},{label:"Lower A",targets:["legs","glutes","calves","core","legs"]},{label:"Push B",targets:["chest","shoulders","triceps","shoulders","chest"]},{label:"Pull B",targets:["back","biceps","back","forearms","biceps"]},{label:"Lower B",targets:["glutes","legs","calves","core","legs"]}]
});
/** @param {any} exercise @param {string} target */
function matchesTarget(exercise,target){const group=String(exercise.group).toLowerCase(),sub=String(exercise.sub||"").toLowerCase();if(["biceps","triceps","forearms"].includes(target))return group==="arms"&&sub.includes(target.slice(0,-1));return group===target;}
/** @param {any} exercise @param {string[]} limitations */
function excludedByLimitations(exercise,limitations){return (limitations.includes("no-overhead")&&exercise.traits?.includes("overhead"))||(limitations.includes("no-deep-knee")&&exercise.traits?.includes("deep-knee"))||(limitations.includes("no-unsupported-hinge")&&exercise.traits?.includes("unsupported-hinge"))||(limitations.includes("no-floor")&&exercise.traits?.includes("floor"))||(limitations.includes("no-unilateral")&&exercise.traits?.includes("unilateral"));}
/** Rotate adjacent ISO weeks while keeping every replay stable. @param {string} seed */
function offset(seed){
  const separator=seed.indexOf("\0"),weekStart=separator<0?"1970-01-05":seed.slice(0,separator),stableSeed=separator<0?seed:seed.slice(separator+1);
  const weekIndex=Math.floor(Date.parse(`${weekStart}T00:00:00.000Z`)/604800000);
  return weekIndex+Number.parseInt(createHash("sha256").update(stableSeed).digest("hex").slice(0,8),16);
}
/** @param {ReturnType<typeof sanitizeCoachingProfile>} profile @param {string} target @param {Set<string>} used @param {string} seed */
function selectExercise(profile,target,used,seed){
  const known=new Set(profile.usualExercises.map((item)=>item.exerciseId)),level=/** @type {Record<string,number>} */({Beginner:0,Intermediate:1,Advanced:2}),userLevels=/** @type {Record<string,number>} */({beginner:0,intermediate:1,advanced:2}),userLevel=userLevels[profile.experience]??0;
  const candidates=EXERCISES.filter((exercise)=>matchesTarget(exercise,target)&&!used.has(String(exercise.id))&&!excludedByLimitations(exercise,profile.movementLimitations)&&(profile.availableEquipment.length===0||profile.availableEquipment.includes(String(exercise.equipment)))&&(level[String(exercise.level)]??99)<=userLevel);
  candidates.sort((a,b)=>(known.has(String(b.id))?500:0)-(known.has(String(a.id))?500:0)+Number(b.score)-Number(a.score)||String(a.id).localeCompare(String(b.id)));
  const window=candidates.slice(0,Math.min(6,candidates.length));return window.length?window[offset(seed)%window.length]:null;
}
/** @param {ReturnType<typeof sanitizeCoachingProfile>} profile @param {boolean} compound @param {{maxSets:number,maxReps:number,maxWeightKg:number|null}|null} baseline */
function prescriptionFor(profile,compound,baseline){
  const defaultSets=profile.experience==="beginner"?2:profile.experience==="advanced"&&compound?4:3,defaultLow=profile.experience==="beginner"?8:compound?6:10,defaultHigh=profile.experience==="beginner"?12:compound?10:15;
  if(!baseline)return {sets:defaultSets,reps:`${defaultLow}–${defaultHigh}`,suggestedStartingLoad:null,loadingGuidance:"Choose a controlled load that leaves about 2–3 good repetitions in reserve."};
  const sets=Math.min(defaultSets,baseline.maxSets),high=Math.min(defaultHigh,Math.max(1,baseline.maxReps-2)),low=Math.min(defaultLow,high),maxWeightKg=baseline.maxWeightKg;
  if(maxWeightKg==null||maxWeightKg<=0)return {sets,reps:low===high?String(low):`${low}–${high}`,suggestedStartingLoad:null,loadingGuidance:`The entered ${baseline.maxSets}-set / ${baseline.maxReps}-rep result caps this first-week prescription. Keep about 2–3 good repetitions in reserve.`};
  const kg=Math.max(.5,Math.floor(maxWeightKg*.7*2)/2),unit=profile.preferredLoadUnit,value=unit==="lb"?Math.floor(kg*2.2046226218*2)/2:kg;
  const suggestedStartingLoad={value,unit,kg,basis:"No more than 70% of the entered load, rounded down; the entry is not treated as a tested 1RM."};
  return {sets,reps:low===high?String(low):`${low}–${high}`,suggestedStartingLoad,loadingGuidance:`Start no higher than ${value} ${unit} and leave about 2–3 good repetitions in reserve. This is a conservative first-week ceiling from the entered ${baseline.maxSets}-set / ${baseline.maxReps}-rep / ${maxWeightKg} kg result, not a 1RM percentage.`};
}
/** @param {ReturnType<typeof sanitizeCoachingProfile>} profile @param {string} weekStart */
function trainingFor(profile,weekStart){
  const splitMap=/** @type {Record<number,{label:string,targets:string[]}[]>} */(SPLITS),split=splitMap[profile.sessionsPerWeek]??[],knownById=new Map(profile.usualExercises.map((item)=>[item.exerciseId,item])),sessionCounts=/** @type {Record<number,number>} */(SESSION_COUNTS),experienceCaps=/** @type {Record<string,number>} */({beginner:5,intermediate:6,advanced:7});
  return split.map((template,index)=>{
    const used=new Set(),exercises=[],experienceCap=experienceCaps[profile.experience]??5,count=Math.min(sessionCounts[profile.sessionMinutes]??5,experienceCap),targets=Array.from({length:count},(_,slot)=>template.targets[slot%template.targets.length]??"");
    for(const [slot,target] of targets.entries()){
      const exercise=selectExercise(profile,target,used,`${weekStart}\0${index}\0${slot}\0${target}`);if(!exercise)continue;used.add(String(exercise.id));
      const compound=Array.isArray(exercise.traits)&&exercise.traits.includes("compound"),baseline=knownById.get(String(exercise.id))||null,prescription=prescriptionFor(profile,compound,baseline);
      exercises.push({exerciseId:String(exercise.id),name:String(exercise.name),group:String(exercise.group),...prescription,rest:compound?"2–3 min":"60–90 sec",enteredCapability:baseline});
    }
    if(exercises.length!==count)throw coachingError("No complete plan fits the selected equipment, experience, and movement limitations. Add compatible equipment or review a limitation.","COACHING_PLAN_CONSTRAINTS",422);
    const day=profile.workoutDays[index];if(!day)throw coachingError("Workout-day setup is incomplete.","COACHING_PLAN_CONSTRAINTS",422);
    return {day,date:addDays(weekStart,DAYS.indexOf(day)),label:template.label,rationale:`${template.label} distributes major-muscle work across ${profile.sessionsPerWeek} weekly session${profile.sessionsPerWeek===1?"":"s"}.`,exercises};
  });
}

/** @param {ReturnType<typeof sanitizeCoachingProfile>} profile @param {number} profileRevision @param {string} weekStart @param {number} generatedAt */
function generateCoachingWeek(profile,profileRevision,weekStart,generatedAt){
  validDate(weekStart);integer(profileRevision,1,Number.MAX_SAFE_INTEGER,"Profile revision");integer(generatedAt,1,Number.MAX_SAFE_INTEGER,"Generation timestamp");
  const canonical=JSON.stringify(profile),planKey=createHash("sha256").update(`${GENERATION_VERSION}\0${CATALOG_FINGERPRINT}\0${MEAL_CATALOG_FINGERPRINT}\0${weekStart}\0${profileRevision}\0${canonical}`).digest("hex");
  return {schemaVersion:2,generationVersion:GENERATION_VERSION,catalogFingerprint:CATALOG_FINGERPRINT,mealCatalogFingerprint:MEAL_CATALOG_FINGERPRINT,weekStart,weekEnd:addDays(weekStart,6),nextWeekStart:addDays(weekStart,7),planKey,profileRevision,generatedAt,inputs:profile,training:{sessions:trainingFor(profile,weekStart),progression:"Use reps first. When every set reaches the top of the range with clean, comfortable form in two consecutive sessions, add about 2–5% for upper-body or 5–10% for lower-body work.",frequencyCaveat:profile.sessionsPerWeek<2?"General adult guidance recommends strengthening every major muscle group on at least two days each week; this plan reflects the single day selected.":null},nutrition:nutritionFor(profile,weekStart),methodology:{formulaSources:["Mifflin–St Jeor (1990) when body-fat percentage is absent","Katch–McArdle when body-fat percentage is supplied","Hall dynamic weight-change approximation for scenarios"],references:[{label:"Mifflin–St Jeor resting-energy study",url:"https://pubmed.ncbi.nlm.nih.gov/2305711/"},{label:"Lean-mass resting-energy synthesis",url:"https://pubmed.ncbi.nlm.nih.gov/1957828/"},{label:"Hall dynamic weight-change approximation",url:"https://pmc.ncbi.nlm.nih.gov/articles/PMC3880593/"},{label:"US Physical Activity Guidelines",url:"https://odphp.health.gov/our-work/nutrition-physical-activity/physical-activity-guidelines/current-guidelines"},{label:"ACSM progression position stand",url:"https://pubmed.ncbi.nlm.nih.gov/19204579/"},{label:"ISSN protein position stand",url:"https://pubmed.ncbi.nlm.nih.gov/28642676/"},{label:"USDA FoodData Central",url:"https://fdc.nal.usda.gov/"},{label:"FDA food-allergy guidance",url:"https://www.fda.gov/food/nutrition-food-labeling-and-critical-foods/food-allergies"}],assumptions:["Energy equations estimate resting needs; the activity multiplier represents reported typical total activity and is not a measurement.","Entered exercise capabilities are context, not verified one-repetition maximums.","The seven daily calorie targets preserve the selected weekly energy budget.","Food nutrition and USD cost figures are rounded planning estimates, not live product or store data."],cautions:["Adults 18–80 only. Not for pregnancy, eating-disorder care, or medical/injury-specific prescription.","Weight figures are broad scenario bands using an average-overweight-adult approximation, not predictions or confidence intervals. It is especially uncertain for lean users and muscle gain; adjust from a multi-week observed trend.","Food suggestions cannot guarantee allergen safety; verify every label and cross-contact risk.","Stop or modify movements that cause pain and seek qualified care when appropriate."]}};
}

module.exports={ACTIVITY_FACTORS,CATALOG_FINGERPRINT,EQUIPMENT,GENERATION_VERSION,MEAL_CATALOG_FINGERPRINT,MOVEMENT_LIMITATIONS,SESSION_COUNTS,addDays,currentWeekStart,generateCoachingWeek,sanitizeCoachingProfile,sanitizeDailyLog,validDate,weekStartForDate};
