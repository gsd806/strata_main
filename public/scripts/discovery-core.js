(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataDiscovery=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  const FACTOR_KEYS=["stimulus","range","stability","progression","fatigue"];
  const TRAIT_KEYS=["compound","isolation","unilateral","overhead","deep-knee","unsupported-hinge","floor"];
  const ISOLATION=new Set(["cable-fly","cable-serratus-punch","cable-lateral-raise","reverse-pec-deck","leanaway-lateral","face-pull","external-rotation","incline-curl","preacher-curl","hammer-curl","overhead-triceps","pressdown","reverse-curl","seated-leg-curl","adductor-machine","cable-kickback","hip-abduction","standing-calf","seated-calf","legpress-calf","singleleg-calf","bent-knee-calf","tibialis-raise","cable-crunch","pallof-press"]);
  const UNILATERAL=new Set(["one-arm-cable-row","leanaway-lateral","bulgarian-split","long-stride-split","cable-kickback","lateral-stepup","singleleg-calf","side-plank"]);
  const OVERHEAD=new Set(["neutral-pulldown","pullup","machine-shoulder-press","overhead-triceps","hanging-knee","ab-wheel"]);
  const DEEP_KNEE=new Set(["hack-squat","leg-press","bulgarian-split","long-stride-split","lateral-stepup"]);
  const UNSUPPORTED_HINGE=new Set(["romanian-deadlift"]);
  const FLOOR=new Set(["deficit-pushup","cable-crunch","ab-wheel","side-plank","dead-bug"]);
  const LEGACY_TRAIT_SETS={isolation:ISOLATION,unilateral:UNILATERAL,overhead:OVERHEAD,"deep-knee":DEEP_KNEE,"unsupported-hinge":UNSUPPORTED_HINGE,floor:FLOOR};
  const GOAL_WEIGHTS={
    hypertrophy:{stimulus:.35,range:.25,stability:.15,progression:.15,fatigue:.10},
    strength:{stimulus:.20,range:.10,stability:.25,progression:.35,fatigue:.10},
    balanced:{stimulus:.30,range:.20,stability:.20,progression:.20,fatigue:.10},
    "time-efficient":{stimulus:.20,range:.10,stability:.20,progression:.10,fatigue:.20,setup:.20}
  };

  function round(value,digits=0){const scale=10**digits;return Math.round((Number(value)||0)*scale)/scale;}
  function clamp(value,min,max){return Math.min(max,Math.max(min,value));}
  function levelNumber(level){return {Beginner:1,Intermediate:2,Advanced:3}[level]||2;}
  function averageMetric(exercise){return FACTOR_KEYS.reduce((sum,key)=>sum+Number(exercise.metrics[key]||0),0)/FACTOR_KEYS.length;}
  function hasTrait(exercise,trait){return Array.isArray(exercise?.traits)?exercise.traits.includes(trait):Boolean(LEGACY_TRAIT_SETS[trait]?.has(exercise?.id));}
  function movementClass(exercise){if(!Array.isArray(exercise?.traits))return ISOLATION.has(exercise?.id)?"isolation":"compound";return hasTrait(exercise,"isolation")?"isolation":hasTrait(exercise,"compound")?"compound":"accessory";}
  function setupScore(exercise){const base={Machine:94,Cables:82,Bodyweight:88,"Resistance band":90,Dumbbells:78,"Barbell / Smith":72,Bench:78}[exercise.equipment]||75;return clamp(base+(hasTrait(exercise,"unilateral")?-9:0)+(exercise.level==="Beginner"?4:exercise.level==="Advanced"?-4:0),55,98);}
  function setupLabel(exercise){const score=setupScore(exercise);return score>=90?"Very simple":score>=80?"Simple":score>=70?"Moderate":"More involved";}
  function resistanceProfile(exercise){if(exercise.equipment==="Cables")return "Cable-defined tension";if(exercise.equipment==="Machine")return "Machine-defined path";if(exercise.equipment==="Resistance band")return "Band tension curve";if(exercise.equipment==="Barbell / Smith")return exercise.name.includes("Smith")?"Guided gravity curve":"Free-weight gravity curve";if(exercise.equipment==="Dumbbells")return "Free-weight gravity curve";if(exercise.equipment==="Bodyweight")return "Bodyweight / leverage curve";if(exercise.equipment==="Bench")return "Bench-supported leverage";return "Equipment-defined resistance";}
  function practicality(exercise){return round(Number(exercise.metrics.fatigue||0)*.55+setupScore(exercise)*.45);}
  function factorWeights(methodology){return Object.fromEntries(methodology.factors.map((factor)=>[factor.key,Number(factor.weight)]));}
  function weightedBaseline(exercise,methodology){const weights=factorWeights(methodology);return FACTOR_KEYS.reduce((sum,key)=>sum+Number(exercise.metrics[key]||0)*(weights[key]||0)/100,0);}
  function scoreAdjustment(exercise,methodology){return round(Number(exercise.score)-weightedBaseline(exercise,methodology),1);}
  function excludedByLimitations(exercise,limitations=[]){return (limitations.includes("no-overhead")&&hasTrait(exercise,"overhead"))||(limitations.includes("no-deep-knee")&&hasTrait(exercise,"deep-knee"))||(limitations.includes("no-unsupported-hinge")&&hasTrait(exercise,"unsupported-hinge"))||(limitations.includes("no-floor")&&hasTrait(exercise,"floor"))||(limitations.includes("no-unilateral")&&hasTrait(exercise,"unilateral"));}

  function personalResult(exercise,preferences){
    const weights=GOAL_WEIGHTS[preferences.goal]||GOAL_WEIGHTS.hypertrophy;
    let raw=FACTOR_KEYS.reduce((sum,key)=>sum+Number(exercise.metrics[key]||0)*(weights[key]||0),0)+(weights.setup||0)*setupScore(exercise);
    const reasons=[],selected=Array.isArray(preferences.preferences)?preferences.preferences:[];
    if(selected.includes("stable")){raw+=(exercise.metrics.stability-75)*.08;if(exercise.metrics.stability>=90)reasons.push("highly stable setup");}
    if(selected.includes("long-range")){raw+=(exercise.metrics.range-75)*.08;if(exercise.metrics.range>=90)reasons.push("strong effective-range score");}
    if(selected.includes("simple-setup")){raw+=(setupScore(exercise)-75)*.09;if(setupScore(exercise)>=88)reasons.push("simple setup");}
    const classification=movementClass(exercise);
    if(selected.includes("compound")){raw+=classification==="compound"?5:classification==="isolation"?-5:0;if(classification==="compound")reasons.push("compound pattern preference");}
    if(selected.includes("isolation")){raw+=classification==="isolation"?5:classification==="compound"?-5:0;if(classification==="isolation")reasons.push("isolation preference");}
    const userLevel=levelNumber(preferences.level),exerciseLevel=levelNumber(exercise.level);
    if(exerciseLevel>userLevel){raw-=8*(exerciseLevel-userLevel);reasons.push("higher skill demand");}
    else if(exerciseLevel===userLevel)reasons.push("experience match");
    if(Number(preferences.days)<=3&&practicality(exercise)>=86){raw+=2;reasons.push("efficient for a shorter week");}
    const available=(preferences.equipment||[]).includes(exercise.equipment),constrained=excludedByLimitations(exercise,preferences.limitations||[]);
    if(!available)reasons.unshift(`${exercise.equipment.toLowerCase()} unavailable`);
    if(constrained)reasons.unshift("excluded by a saved movement constraint");
    return {match:round(clamp(raw,40,99)),eligible:available&&!constrained,reasons:[...new Set(reasons)].slice(0,3)};
  }

  function similarity(reference,candidate){
    let score=0;
    if(reference.group===candidate.group)score+=28;
    if(reference.sub===candidate.sub)score+=24;else if(reference.group===candidate.group)score+=7;
    if(reference.pattern===candidate.pattern)score+=13;
    if(resistanceProfile(reference)===resistanceProfile(candidate))score+=8;
    if(reference.equipment===candidate.equipment)score+=5;
    score+=Math.max(0,15-Math.abs(averageMetric(reference)-averageMetric(candidate))*.8);
    score+=Math.max(0,7-Math.abs(levelNumber(reference.level)-levelNumber(candidate.level))*3.5);
    return round(clamp(score,0,99));
  }

  function targetsCompatible(reference,candidate){
    return Boolean(reference&&candidate&&reference.group===candidate.group&&reference.sub===candidate.sub);
  }

  function alternativesFor(reference,exercises,preferences,limit=4){
    return exercises.filter((candidate)=>candidate.id!==reference.id&&targetsCompatible(reference,candidate)).map((exercise)=>({exercise,match:similarity(reference,exercise),personal:personalResult(exercise,preferences)})).filter((item)=>item.personal.eligible).sort((a,b)=>b.match-a.match||b.personal.match-a.personal.match||b.exercise.score-a.exercise.score).slice(0,limit);
  }

  function gainsAndLosses(reference,candidate,methodology){
    const labels=Object.fromEntries(methodology.factors.map((factor)=>[factor.key,factor.label]));
    const diffs=FACTOR_KEYS.map((key)=>({key,label:labels[key]||key,diff:Number(candidate.metrics[key])-Number(reference.metrics[key])})).sort((a,b)=>Math.abs(b.diff)-Math.abs(a.diff));
    const gain=diffs.find((item)=>item.diff>0),loss=diffs.find((item)=>item.diff<0);
    return {gain:gain?`+${gain.diff} ${gain.label.toLowerCase()}`:"similar factor profile",loss:loss?`${loss.diff} ${loss.label.toLowerCase()}`:"no major factor loss"};
  }

  function filterExercises(exercises,filters,preferences,aggregateFor){
    const query=String(filters.query||"").trim().toLowerCase();
    const collection=(exercise)=>{
      if(filters.collection==="top-chest")return exercise.group==="chest"&&exercise.score>=90;
      if(filters.collection==="dumbbells")return exercise.equipment==="Dumbbells"&&exercise.score>=84;
      if(filters.collection==="bodyweight")return exercise.equipment==="Bodyweight";
      if(filters.collection==="beginner")return exercise.level==="Beginner";
      if(filters.collection==="community")return Number(aggregateFor(exercise.id)?.rating_count||0)>0;
      return true;
    };
    const items=exercises.filter(collection).filter((exercise)=>filters.group==="all"||exercise.group===filters.group).filter((exercise)=>filters.equipment==="all"||exercise.equipment===filters.equipment).filter((exercise)=>filters.pattern==="all"||exercise.pattern===filters.pattern).filter((exercise)=>filters.level==="all"||exercise.level===filters.level).filter((exercise)=>!query||`${exercise.name} ${exercise.group} ${exercise.sub} ${exercise.equipment} ${exercise.pattern} ${exercise.level} ${exercise.why}`.toLowerCase().includes(query));
    return items.sort((a,b)=>{
      if(filters.sort==="score")return b.score-a.score;
      if(filters.sort==="community")return Number(aggregateFor(b.id)?.overall||0)-Number(aggregateFor(a.id)?.overall||0)||Number(aggregateFor(b.id)?.rating_count||0)-Number(aggregateFor(a.id)?.rating_count||0)||b.score-a.score;
      if(filters.sort==="practicality")return practicality(b)-practicality(a)||b.score-a.score;
      if(filters.sort==="difficulty")return levelNumber(a.level)-levelNumber(b.level)||b.score-a.score;
      const aResult=personalResult(a,preferences),bResult=personalResult(b,preferences);return Number(bResult.eligible)-Number(aResult.eligible)||bResult.match-aResult.match||b.score-a.score;
    });
  }

  function comparisonRecommendation(exercises,preferences){
    if(!Array.isArray(exercises)||exercises.length<2||exercises.length>4)return {winner:null,error:"Choose between two and four exercises."};
    if(!exercises.every((exercise)=>targetsCompatible(exercise,exercises[0])))return {winner:null,reason:"These movements target different muscles or training roles, so there is no honest universal winner. Compare how each one fits into the week instead."};
    const eligible=exercises.filter((exercise)=>personalResult(exercise,preferences).eligible);
    if(!eligible.length)return {winner:null,reason:"None of these movements matches your saved equipment and movement constraints. Update the selection or your profile before choosing a winner."};
    const ranked=eligible.map((exercise)=>({exercise,value:personalResult(exercise,preferences).match*.55+exercise.score*.45})).sort((a,b)=>b.value-a.value);
    const goal={hypertrophy:"hypertrophy selection",strength:"strength skill",balanced:"balanced selection","time-efficient":"time-efficient selection"}[preferences.goal]||"saved selection";
    const winner=ranked[0].exercise,match=personalResult(winner,preferences).match;
    return {winner,reason:`${winner.name} is the best fit for your ${goal} rules among these choices. It combines a ${match}% personal match with a ${winner.score} official FitScore. The recommendation can change when your equipment, constraints, or goal changes.`};
  }

  return {FACTOR_KEYS,TRAIT_KEYS,ISOLATION,UNILATERAL,OVERHEAD,DEEP_KNEE,UNSUPPORTED_HINGE,FLOOR,hasTrait,movementClass,round,clamp,levelNumber,averageMetric,setupScore,setupLabel,resistanceProfile,practicality,factorWeights,weightedBaseline,scoreAdjustment,excludedByLimitations,personalResult,similarity,targetsCompatible,alternativesFor,gainsAndLosses,filterExercises,comparisonRecommendation};
});
