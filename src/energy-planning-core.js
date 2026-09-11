// @ts-check
"use strict";

const {createHash}=require("node:crypto");
const {DAYS}=require("./plans");

const MODEL_VERSION="energy-planning-v2";
const ENERGY_SEMANTICS=Object.freeze({LEGACY:"legacy_rmr_activity_multiplier",WHOLE_DAY_EER:"nasem_2023_whole_day_eer"});
const LEGACY_ACTIVITY_FACTORS=Object.freeze({sedentary:1.2,lightly_active:1.375,moderately_active:1.55,very_active:1.725,extremely_active:1.9});
const ACTIVITY_CATEGORY_MAP=Object.freeze({sedentary:"inactive",lightly_active:"low_active",moderately_active:"active",very_active:"very_active",extremely_active:"very_active"});
const NASEM_EER_COEFFICIENTS=Object.freeze({
  male:Object.freeze({
    inactive:Object.freeze({constant:753.07,age:-10.83,height:6.5,weight:14.1}),
    low_active:Object.freeze({constant:581.47,age:-10.83,height:8.3,weight:14.94}),
    active:Object.freeze({constant:1004.82,age:-10.83,height:6.52,weight:15.91}),
    very_active:Object.freeze({constant:-517.88,age:-10.83,height:15.61,weight:19.11})
  }),
  female:Object.freeze({
    inactive:Object.freeze({constant:584.9,age:-7.01,height:5.72,weight:11.71}),
    low_active:Object.freeze({constant:575.77,age:-7.01,height:6.6,weight:12.14}),
    active:Object.freeze({constant:710.25,age:-7.01,height:6.54,weight:12.34}),
    very_active:Object.freeze({constant:511.83,age:-7.01,height:9.07,weight:12.56})
  })
});
const CALIBRATION_DAYS=21,MIN_COMPLETE_DAYS=18,MIN_WEIGHT_DAYS=12,MIN_WEIGHT_SPAN_DAYS=14;

/** @param {number} value @param {number} [step] */
function rounded(value,step=1){return Math.round(value/step)*step;}
/** @param {number} value @param {number} min @param {number} max */
function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
/** @param {number[]} values */
function mean(values){return values.reduce((sum,value)=>sum+value,0)/values.length;}
/** @param {number[]} values */
function median(values){const sorted=[...values].sort((a,b)=>a-b),middle=Math.floor(sorted.length/2);return sorted.length%2?Number(sorted[middle]):((Number(sorted[middle-1])+Number(sorted[middle]))/2);}
/** @param {string} date @param {number} offset */
function addDays(date,offset){return new Date(Date.parse(`${date}T00:00:00.000Z`)+offset*86400000).toISOString().slice(0,10);}
/** @param {unknown} value */
function isoDate(value){if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return null;const stamp=Date.parse(`${value}T00:00:00.000Z`);return Number.isFinite(stamp)&&new Date(stamp).toISOString().slice(0,10)===value?value:null;}
/** @param {string} date @param {string} origin */
function dayIndex(date,origin){return Math.round((Date.parse(`${date}T00:00:00.000Z`)-Date.parse(`${origin}T00:00:00.000Z`))/86400000);}

/**
 * 2023 National Academies / Health Canada adult EER equation.
 * Height is centimetres and weight is kilograms, matching the published table.
 * @param {{age:number,heightCm:number,weightKg:number,sexForEquation:string,lifestyleActivity:string}} profile
 */
function nasemEer(profile){
  const activityCategories=/** @type {Record<string,string>} */(/** @type {unknown} */(ACTIVITY_CATEGORY_MAP)),tables=/** @type {Record<string,Record<string,{constant:number,age:number,height:number,weight:number}>>} */(/** @type {unknown} */(NASEM_EER_COEFFICIENTS)),activityCategory=activityCategories[profile.lifestyleActivity],bySex=tables[profile.sexForEquation];
  if(profile.age<19||!activityCategory||!bySex)throw new TypeError("The 2023 adult EER equation requires age 19 or older, a published male/female coefficient, and a supported activity category.");
  const coefficients=bySex[activityCategory];
  if(!coefficients)throw new TypeError("The 2023 adult EER activity equation is unavailable.");
  return coefficients.constant+coefficients.age*profile.age+coefficients.height*profile.heightCm+coefficients.weight*profile.weightKg;
}

/** @param {{age:number,heightCm:number,weightKg:number,sexForEquation:string|null}} profile */
function mifflinRmr(profile){if(!profile.sexForEquation)return null;return 10*profile.weightKg+6.25*profile.heightCm-5*profile.age+(profile.sexForEquation==="male"?5:-161);}
/** @param {{weightKg:number,bodyFatPercent:number|null}} profile */
function cunninghamRmr(profile){return profile.bodyFatPercent==null?null:370+21.6*profile.weightKg*(1-profile.bodyFatPercent/100);}

/** @param {any} profile */
function baselineFor(profile){
  const factors=/** @type {Record<string,number>} */(LEGACY_ACTIVITY_FACTORS),categories=/** @type {Record<string,string>} */(/** @type {unknown} */(ACTIVITY_CATEGORY_MAP)),activityFactor=factors[profile.lifestyleActivity],activityCategory=categories[profile.lifestyleActivity],mifflin=mifflinRmr(profile),cunningham=cunninghamRmr(profile);
  if(!activityFactor||!activityCategory)throw new TypeError("A supported legacy activity value is required.");
  const energySemantics=profile.version===3?ENERGY_SEMANTICS.WHOLE_DAY_EER:ENERGY_SEMANTICS.LEGACY;
  let raw,primaryEquation,equation,explanation,rmrKcal,rmrEquation,bandRate=.125,minimumBand=250;
  if(energySemantics===ENERGY_SEMANTICS.WHOLE_DAY_EER&&profile.age>=19&&profile.sexForEquation){
    raw=nasemEer(profile);primaryEquation="nasem_2023_eer";equation="nasem_2023_eer";
    rmrKcal=mifflin==null?null:rounded(mifflin);rmrEquation=mifflin==null?null:"mifflin_st_jeor";
    explanation=`The starting estimate uses the 2023 adult EER ${activityCategory.replaceAll("_"," ")} equation. It is a population estimate, not a metabolic measurement.`;
  }else if(energySemantics===ENERGY_SEMANTICS.LEGACY&&cunningham!=null){
    raw=cunningham*activityFactor;primaryEquation="legacy_cunningham_activity_fallback";equation="cunningham_1991";bandRate=.175;minimumBand=350;
    rmrKcal=rounded(cunningham);rmrEquation="cunningham_1991";
    explanation="This saved profile predates whole-day EER activity categories, so STRATA preserves its Cunningham lean-mass estimate × original activity multiplier until the profile is reviewed and saved. Body-fat estimates can be noisy.";
  }else if(energySemantics===ENERGY_SEMANTICS.LEGACY&&mifflin!=null){
    raw=mifflin*activityFactor;primaryEquation="legacy_mifflin_activity_fallback";equation="mifflin_st_jeor";bandRate=.15;minimumBand=300;
    rmrKcal=rounded(mifflin);rmrEquation="mifflin_st_jeor";
    explanation="This saved profile predates whole-day EER activity categories, so STRATA preserves its Mifflin–St Jeor estimate × original activity multiplier until the profile is reviewed and saved.";
  }else throw new TypeError("No compatible energy equation is available.");
  const targetKcal=rounded(raw,25),band=rounded(Math.max(minimumBand,targetKcal*bandRate),25);
  return {targetKcal,rawKcal:Math.round(raw*10)/10,equation,primaryEquation,energySemantics,activityCategory,activityFactor:primaryEquation==="nasem_2023_eer"?null:activityFactor,legacyActivityFactor:activityFactor,rmrKcal,rmrEquation,bodyFatCrossCheck:cunningham==null||primaryEquation==="legacy_cunningham_activity_fallback"?null:{equation:"cunningham_1991",rmrKcal:rounded(cunningham),role:"secondary_cross_check"},planningBandKcal:band,explanation};
}

/** @param {{date:string,weightKg:number}[]} points @param {string} windowStart */
function theilSen(points,windowStart){
  const slopes=[];
  for(let left=0;left<points.length;left+=1)for(let right=left+1;right<points.length;right+=1){const first=points[left],last=points[right];if(!first||!last)continue;const days=dayIndex(last.date,first.date);if(days>0)slopes.push((last.weightKg-first.weightKg)/days);}
  if(!slopes.length)return null;
  const slope=median(slopes),intercepts=points.map((point)=>point.weightKg-slope*dayIndex(point.date,windowStart)),intercept=median(intercepts),residuals=points.map((point)=>Math.abs(point.weightKg-(intercept+slope*dayIndex(point.date,windowStart)))),mad=median(residuals),limit=Math.max(1.5,mad*4);
  const filtered=points.filter((point,index)=>Number(residuals[index])<=limit);
  if(filtered.length===points.length)return {slope,points:filtered,outliers:0};
  if(filtered.length<2)return {slope,points:filtered,outliers:points.length-filtered.length};
  const refined=theilSenWithoutFiltering(filtered);
  return {slope:refined,points:filtered,outliers:points.length-filtered.length};
}
/** @param {{date:string,weightKg:number}[]} points */
function theilSenWithoutFiltering(points){const slopes=[];for(let left=0;left<points.length;left+=1)for(let right=left+1;right<points.length;right+=1){const first=points[left],last=points[right];if(!first||!last)continue;const days=dayIndex(last.date,first.date);if(days>0)slopes.push((last.weightKg-first.weightKg)/days);}return median(slopes);}

/** @param {unknown} evidence @param {string} weekStart */
function evidenceFor(evidence,weekStart){
  const input=evidence&&typeof evidence==="object"&&!Array.isArray(evidence)?/** @type {Record<string,any>} */(evidence):{},windowStart=addDays(weekStart,-CALIBRATION_DAYS),windowEnd=addDays(weekStart,-1);
  /** @param {string} date */
  const inside=(date)=>date>=windowStart&&date<=windowEnd;
  const caloriesByDate=new Map(),weightsByDate=new Map();
  for(const row of Array.isArray(input.dailyLogs)?input.dailyLogs:[]){
    const date=isoDate(row?.date);if(!date||!inside(date))continue;
    if(row?.complete===true&&Number.isSafeInteger(row?.calories)&&row.calories>=0&&row.calories<=20000){const values=caloriesByDate.get(date)||[];values.push(Number(row.calories));caloriesByDate.set(date,values);}
    const weight=Number(row?.morningWeightKg);if(row?.morningWeightKg!=null&&Number.isFinite(weight)&&weight>=35&&weight<=300){const values=weightsByDate.get(date)||[];values.push(weight);weightsByDate.set(date,values);}
  }
  const calorieDays=[...caloriesByDate].map(([date,values])=>({date,calories:mean(values)})).sort((a,b)=>a.date.localeCompare(b.date)),rawWeights=[...weightsByDate].map(([date,values])=>({date,weightKg:mean(values)})).sort((a,b)=>a.date.localeCompare(b.date)),trend=rawWeights.length>=2?theilSen(rawWeights,windowStart):null,weights=trend?.points||rawWeights;
  const weightObservationSpanDays=weights.length>=2?dayIndex(String(weights.at(-1)?.date),String(weights[0]?.date)):0,outlierWeightDays=trend?.outliers||0,trendKgPerDay=trend&&weights.length>=2?trend.slope:null;
  const canonical={windowStart,windowEnd,calorieDays,rawWeights,weights,rawWeightDays:rawWeights.length,outlierWeightDays,weightObservationSpanDays,trendKgPerDay};
  return {windowStart,windowEnd,calorieDays,weights,rawWeightDays:rawWeights.length,outlierWeightDays,weightObservationSpanDays,trendKgPerDay,fingerprint:createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0,16)};
}

/**
 * Build a bounded weekly maintenance calibration from the preceding 21 days.
 * @param {{weightKg:number}} profile @param {string} weekStart @param {unknown} evidence @param {ReturnType<typeof baselineFor>} baseline
 */
function calibrateMaintenance(profile,weekStart,evidence,baseline=baselineFor(profile)){
  const observed=evidenceFor(evidence,weekStart),completeCalorieDays=observed.calorieDays.length,morningWeightDays=observed.weights.length,weightObservationSpanDays=observed.weightObservationSpanDays,counts={completeCalorieDays,morningWeightDays,rawMorningWeightDays:observed.rawWeightDays,outlierWeightDays:observed.outlierWeightDays,weightObservationSpanDays,requiredCompleteCalorieDays:MIN_COMPLETE_DAYS,requiredMorningWeightDays:MIN_WEIGHT_DAYS,requiredWeightObservationSpanDays:MIN_WEIGHT_SPAN_DAYS};
  const common={modelVersion:MODEL_VERSION,windowStart:observed.windowStart,windowEnd:observed.windowEnd,evidenceFingerprint:observed.fingerprint,evidence:counts,thresholdBasis:"STRATA heuristic safeguards; not validated clinical thresholds, measurement-error bounds, or confidence criteria.",baselineKcal:baseline.targetKcal,observedMaintenanceKcal:null,trendKgPerWeek:null,appliedAdjustmentKcal:0,targetKcal:baseline.targetKcal,limitations:["Logged intake is self-reported and can be incomplete or systematically under-reported.","Scale trends can move with hydration, glycogen, digestion, medication, illness, and measurement conditions.","Evidence minimums and rejection boundaries are conservative STRATA heuristics, not clinical cutoffs or validated confidence criteria.","This signal is an estimate for planning, not measured energy expenditure or a confidence interval."]};
  if(baseline.energySemantics===ENERGY_SEMANTICS.LEGACY)return {...common,status:"legacy_profile",explanation:"This saved profile keeps its original resting-energy × activity-multiplier estimate. Review the whole-day activity category and save the profile before STRATA uses the 2023 EER baseline or trend calibration."};
  if(completeCalorieDays===0&&observed.rawWeightDays===0)return {...common,status:"starting",explanation:"Start logging complete calorie days and morning body weight. Trend calibration uses only the 21 days before a new coaching week."};
  if(completeCalorieDays<MIN_COMPLETE_DAYS||morningWeightDays<MIN_WEIGHT_DAYS||weightObservationSpanDays<MIN_WEIGHT_SPAN_DAYS||observed.trendKgPerDay==null)return {...common,status:"calibrating",explanation:`STRATA's heuristic calibration rule needs at least ${MIN_COMPLETE_DAYS} explicitly complete calorie days, ${MIN_WEIGHT_DAYS} valid morning weights, and ${MIN_WEIGHT_SPAN_DAYS} days between the first and last usable weight inside one 21-day window.`};
  const representativeWeight=median(observed.weights.map((row)=>row.weightKg)),trendKgPerWeek=observed.trendKgPerDay*7,averageCalories=mean(observed.calorieDays.map((row)=>row.calories)),observedMaintenance=averageCalories-observed.trendKgPerDay*7700,relativeTrend=Math.abs(trendKgPerWeek)/representativeWeight,relativeGap=Math.abs(observedMaintenance-baseline.targetKcal)/baseline.targetKcal;
  const signal={...common,trendKgPerWeek:Math.round(trendKgPerWeek*1000)/1000,observedMaintenanceKcal:rounded(observedMaintenance),averageCompleteCaloriesKcal:rounded(averageCalories)};
  if(relativeTrend>.015)return {...signal,status:"calibrating",explanation:"The observed scale trend exceeds STRATA's heuristic 1.5% body-weight-per-week boundary, so STRATA did not use it to change calorie targets."};
  if(observedMaintenance<1000||observedMaintenance>6000)return {...signal,status:"calibrating",explanation:"The intake-and-weight signal falls outside STRATA's heuristic 1,000–6,000 kcal/day range, so STRATA kept the equation starting point."};
  if(relativeGap>.4)return {...signal,status:"calibrating",explanation:"The intake-and-weight signal differs from the equation starting point by more than STRATA's heuristic 40% boundary, so STRATA kept the starting point rather than applying a potentially misleading correction."};
  const requestedAdjustment=(observedMaintenance-baseline.targetKcal)*.35,cappedAdjustment=clamp(requestedAdjustment,-150,150),targetKcal=rounded(baseline.targetKcal+cappedAdjustment,25),appliedAdjustmentKcal=targetKcal-baseline.targetKcal;
  return {...signal,status:"trend_informed",targetKcal,appliedAdjustmentKcal,explanation:`The estimate uses a 35% correction toward the preceding 21-day intake-and-weight signal, capped at 150 kcal per day and rounded to 25 kcal. ${observed.outlierWeightDays?`${observed.outlierWeightDays} isolated weight ${observed.outlierWeightDays===1?"outlier was":"outliers were"} excluded.`:""}`.trim()};
}

/** Preserve an exact weekly calorie budget while distributing daily weights. @param {number} target @param {number[]} weights */
function distribute(target,weights){const total=rounded(target)*7,sum=weights.reduce((value,weight)=>value+weight,0),raw=weights.map((weight)=>total*weight/sum),days=raw.map(Math.floor);for(let remaining=total-days.reduce((a,b)=>a+b,0),index=0;remaining>0;remaining-=1,index=(index+1)%7)days[index]=(days[index]??0)+1;return days;}
/** @param {number} calories @param {number} weightKg @param {string|null} preference @param {string} goal */
function macroTarget(calories,weightKg,preference,goal){if(!preference)return null;const requestedRate=preference==="higher_protein"?2:goal==="fat_loss"?1.8:1.6,protein=rounded(Math.min(weightKg*requestedRate,calories*.3/4)),fat=rounded(calories*.25/9),carbs=Math.max(0,rounded((calories-protein*4-fat*9)/4));return {proteinG:protein,carbsG:carbs,fatG:fat,proteinBasis:`${requestedRate} g/kg, capped at 30% of energy`,fatBasis:"approximately 25% of energy",carbohydrateBasis:"remaining energy (at least approximately 45%)"};}
/** @param {number} weightKg @param {number} dailyCalorieDelta @param {number} weeks */
function weightScenario(weightKg,dailyCalorieDelta,weeks){const days=weeks*7,changeLb=dailyCalorieDelta/10*(1-Math.exp(-Math.log(2)*days/365)),changeKg=changeLb*.45359237,center=Math.max(0,weightKg+changeKg),uncertainty=Math.max(.5,Math.abs(changeKg)*.4);return {center,uncertainty};}
/** @param {number} weightKg @param {number} dailyCalorieDelta */
function weightScenarios(weightKg,dailyCalorieDelta){return [4,8,12].map((weeks)=>{const {center,uncertainty}=weightScenario(weightKg,dailyCalorieDelta,weeks);return {weeks,weightKg:Math.round(center*10)/10,rangeKg:[Math.round(Math.max(0,center-uncertainty)*10)/10,Math.round((center+uncertainty)*10)/10]};});}

/** @param {any} profile @param {string} weekStart @param {unknown} [evidence] */
function nutritionFor(profile,weekStart,evidence=null){
  const baseline=baselineFor(profile),calibration=calibrateMaintenance(profile,weekStart,evidence,baseline),maintenance=calibration.targetKcal,band=baseline.planningBandKcal,maintenanceLow=rounded(Math.max(0,maintenance-band),25),maintenanceHigh=rounded(maintenance+band,25),heightM=profile.heightCm/100,rawBmi=profile.weightKg/heightM**2,bmi=Math.round(rawBmi*10)/10,deficitRate=profile.goalPace==="gentle"?.1:.15,surplusRate=profile.goalPace==="gentle"?.05:.075;
  const deficitDelta=Math.min(500,rounded(maintenance*deficitRate,25)),surplusDelta=Math.min(250,Math.max(100,rounded(maintenance*surplusRate,25))),candidateDeficit=Math.max(1200,maintenance-deficitDelta),minimumSafeWeight=18.5*heightM**2,candidateDelta=candidateDeficit-maintenance;
  const deficitAllowed=rawBmi>=18.5&&maintenance>1200&&[4,8,12].every((weeks)=>{const {center,uncertainty}=weightScenario(profile.weightKg,candidateDelta,weeks),lower=Math.max(0,center-uncertainty),displayedLower=Math.round(lower*10)/10;return lower>=minimumSafeWeight&&displayedLower>=minimumSafeWeight;}),deficit=deficitAllowed?candidateDeficit:null,bulk=maintenance+surplusDelta,selected=profile.goal==="fat_loss"?deficit:profile.goal==="muscle_gain"?bulk:maintenance;
  if(selected==null)throw Object.assign(new Error("A calorie deficit cannot be generated within the reviewed BMI and calorie-floor limits. Choose maintenance and speak with a qualified clinician."),{code:"DEFICIT_REQUIRES_REVIEW",status:422});
  if(selected<1200)throw Object.assign(new Error("An automated calorie target cannot be generated above the conservative 1,200 kcal review floor. Speak with a qualified clinician."),{code:"CALORIE_TARGET_REQUIRES_REVIEW",status:422});
  let weights=Array(7).fill(1),effectivePattern=profile.caloriePattern,patternFallback=null;if(profile.caloriePattern==="zigzag")weights=DAYS.map((day)=>profile.workoutDays.includes(day)?1.075:.925);if(profile.caloriePattern==="flexible_day")weights=DAYS.map((day)=>day===profile.flexibleDay?1.15:.975);let calories=distribute(selected,weights);
  if(Math.min(...calories)<1200){calories=distribute(selected,Array(7).fill(1));effectivePattern="steady";patternFallback="The requested variation would create a day below the conservative 1,200 kcal floor, so this week uses steady targets.";}
  const dailyTargets=DAYS.map((day,index)=>{const dailyCalories=calories[index]??selected;return {day,date:addDays(weekStart,index),calories:dailyCalories,macros:macroTarget(dailyCalories,profile.weightKg,profile.macroPreference,profile.goal),kind:effectivePattern==="zigzag"?(profile.workoutDays.includes(day)?"higher_training_day":"lower_rest_day"):effectivePattern==="flexible_day"&&day===profile.flexibleDay?"flexible_day":"standard"};});
  const activityFactorBasis=baseline.primaryEquation==="nasem_2023_eer"?"The reviewed profile activity value selects a 2023 whole-day EER category. No resting-energy multiplier is applied; legacyActivityFactor is supplied only to explain old snapshots.":"This unreviewed legacy profile preserves its original resting-energy × activityFactor interpretation and uses a broader planning band.";
  return {bmi,equation:baseline.equation,primaryEquation:baseline.primaryEquation,energySemantics:baseline.energySemantics,rmrKcal:baseline.rmrKcal,rmrEquation:baseline.rmrEquation,bodyFatCrossCheck:baseline.bodyFatCrossCheck,activityFactor:baseline.activityFactor,legacyActivityFactor:baseline.legacyActivityFactor,activityCategory:baseline.activityCategory,activityFactorBasis,maintenance:{targetKcal:maintenance,baselineKcal:baseline.targetKcal,rawBaselineKcal:baseline.rawKcal,estimateRangeKcal:[maintenanceLow,maintenanceHigh],planningRangeKcal:[maintenanceLow,maintenanceHigh],rangeLabel:"Conservative STRATA planning band; not a confidence interval or measured expenditure.",equationExplanation:baseline.explanation,calibration},deficit:{targetKcal:deficit,policy:`${Math.round(deficitRate*100)}% below estimated maintenance, capped at 500 kcal/day and never below 1,200 kcal/day`},bulk:{targetKcal:bulk,policy:`About ${surplusRate*100}% above estimated maintenance, bounded to 100–250 kcal/day`},selectedGoal:profile.goal,goalPace:profile.goalPace,requestedPattern:profile.caloriePattern,effectivePattern,patternFallback,weeklyTargetKcal:calories.reduce((a,b)=>a+b,0),dailyTargets,weightScenarios:weightScenarios(profile.weightKg,selected-maintenance)};
}

module.exports={ACTIVITY_CATEGORY_MAP,CALIBRATION_DAYS,ENERGY_SEMANTICS,LEGACY_ACTIVITY_FACTORS,MIN_COMPLETE_DAYS,MIN_WEIGHT_DAYS,MIN_WEIGHT_SPAN_DAYS,MODEL_VERSION,NASEM_EER_COEFFICIENTS,baselineFor,calibrateMaintenance,nasemEer,nutritionFor};
