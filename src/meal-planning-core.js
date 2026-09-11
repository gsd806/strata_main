// @ts-check
"use strict";

const {createHash}=require("node:crypto");

const DIETARY_PATTERNS=Object.freeze(["omnivore","pescatarian","vegetarian","vegan"]);
const DIETARY_REQUIREMENTS=Object.freeze(["gluten_free","dairy_free"]);
const TOP_9_ALLERGENS=Object.freeze(["milk","egg","fish","crustacean_shellfish","tree_nuts","peanuts","wheat","soy","sesame"]);
const FAVORITE_FOODS=Object.freeze(["beans","beef","chicken","eggs","fish","fruit","grains","lentils","nuts","pasta","potatoes","rice","shellfish","tofu","turkey","vegetables","yogurt"]);
const SAFETY_DISCLAIMER="Food suggestions are planning ideas, not medical nutrition therapy or a guarantee that a product is allergen-free. Check every label, preparation surface, and cross-contact warning; ask a qualified clinician or dietitian when allergy safety is uncertain.";
const COST_DISCLAIMER="Costs are rough USD ingredient estimates, not live store prices. Brand, portion, season, location, tax, delivery, and waste can change the amount.";
const NUTRITION_PROVENANCE=Object.freeze({source:"USDA FoodData Central",url:"https://fdc.nal.usda.gov/",method:"STRATA editorial recipe estimates informed by generic FoodData Central values; no live lookup is performed, and values are not branded-product measurements."});

/** @typedef {{id:string,name:string,ingredients:readonly string[],calories:number,proteinG:number,carbsG:number,fatG:number,costCents:number,allergens:readonly string[],dietTags:readonly string[],patterns:readonly string[],favorites:readonly string[]}} CatalogMeal */
/** @typedef {CatalogMeal&{_favorites:string[],_score:number}} CandidateMeal */
const ALL_PATTERNS=DIETARY_PATTERNS;
/** @type {readonly CatalogMeal[]} */
const CATALOG=Object.freeze([
  {id:"chickpea-quinoa-garden-bowl",name:"Chickpea quinoa garden bowl",ingredients:["1 cup cooked chickpeas","¾ cup cooked quinoa","2 cups tomato, cucumber, and spinach","1 tsp olive oil","lemon to taste"],calories:520,proteinG:20,carbsG:82,fatG:14,costCents:475,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["beans","grains","vegetables"]},
  {id:"lentil-rice-spinach-bowl",name:"Lentil rice and spinach bowl",ingredients:["1 cup cooked lentils","1 cup cooked brown rice","1 cup spinach and tomato","1 tsp olive oil"],calories:560,proteinG:23,carbsG:96,fatG:10,costCents:390,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["lentils","rice","vegetables"]},
  {id:"black-bean-sweet-potato-bowl",name:"Black bean sweet potato bowl",ingredients:["1 cup cooked black beans","200 g cooked sweet potato","⅓ cup corn","1 cup tomato and lettuce","1 tsp olive oil","lime to taste"],calories:530,proteinG:18,carbsG:98,fatG:8,costCents:410,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["beans","potatoes","vegetables"]},
  {id:"white-bean-potato-stew",name:"White bean potato stew",ingredients:["¾ cup cooked white beans","250 g cooked potato","1½ cups carrot, celery, and tomato","1 tsp olive oil"],calories:480,proteinG:20,carbsG:78,fatG:10,costCents:350,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["beans","potatoes","vegetables"]},
  {id:"pea-quinoa-herb-bowl",name:"Green pea quinoa herb bowl",ingredients:["1¼ cups cooked green peas","1 cup cooked quinoa","1 cup spinach and tomato","2 tsp olive oil","lemon and herbs to taste"],calories:500,proteinG:22,carbsG:75,fatG:13,costCents:465,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["grains","vegetables"]},
  {id:"banana-berry-chia-cup",name:"Banana berry chia cup",ingredients:["1 medium banana","1 cup berries","2 tbsp chia seeds","water and cinnamon to taste"],calories:330,proteinG:7,carbsG:57,fatG:10,costCents:340,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["fruit"]},
  {id:"red-lentil-rice-porridge",name:"Red lentil rice porridge",ingredients:["¾ cup cooked red lentils","¾ cup cooked rice","1½ cups carrot, spinach, and tomato","water as needed"],calories:410,proteinG:19,carbsG:75,fatG:4,costCents:285,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["lentils","rice","vegetables"]},
  {id:"chicken-rice-broccoli",name:"Chicken rice and broccoli",ingredients:["150 g cooked chicken breast","1 cup cooked rice","1½ cups broccoli","1 tsp olive oil","lemon to taste"],calories:600,proteinG:48,carbsG:70,fatG:14,costCents:575,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:["omnivore"],favorites:["chicken","rice","vegetables"]},
  {id:"turkey-potato-greens",name:"Turkey potato and greens plate",ingredients:["150 g cooked turkey breast","300 g cooked potato","1 cup green beans","2 tsp olive oil"],calories:560,proteinG:45,carbsG:65,fatG:13,costCents:610,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:["omnivore"],favorites:["turkey","potatoes","vegetables"]},
  {id:"beef-quinoa-peppers",name:"Beef quinoa and pepper bowl",ingredients:["150 g cooked lean beef","1 cup cooked quinoa","1½ cups bell pepper and spinach","1 tsp olive oil"],calories:610,proteinG:43,carbsG:59,fatG:22,costCents:725,allergens:[],dietTags:["gluten_free","dairy_free"],patterns:["omnivore"],favorites:["beef","grains","vegetables"]},
  {id:"salmon-potato-peas",name:"Salmon potato and peas",ingredients:["150 g cooked salmon","225 g cooked potato","¾ cup cooked green peas","lemon to taste"],calories:590,proteinG:42,carbsG:56,fatG:22,costCents:790,allergens:["fish"],dietTags:["gluten_free","dairy_free"],patterns:["omnivore","pescatarian"],favorites:["fish","potatoes","vegetables"]},
  {id:"tuna-rice-cucumber",name:"Tuna rice and cucumber bowl",ingredients:["150 g drained tuna","1¼ cups cooked rice","1½ cups cucumber and tomato","1 tsp olive oil"],calories:510,proteinG:39,carbsG:66,fatG:10,costCents:550,allergens:["fish"],dietTags:["gluten_free","dairy_free"],patterns:["omnivore","pescatarian"],favorites:["fish","rice","vegetables"]},
  {id:"shrimp-rice-vegetables",name:"Shrimp rice and vegetable bowl",ingredients:["170 g cooked shrimp","1½ cups cooked rice","1½ cups zucchini and bell pepper","1 tsp olive oil"],calories:540,proteinG:38,carbsG:72,fatG:11,costCents:700,allergens:["crustacean_shellfish"],dietTags:["gluten_free","dairy_free"],patterns:["omnivore","pescatarian"],favorites:["shellfish","rice","vegetables"]},
  {id:"egg-potato-spinach",name:"Egg potato and spinach plate",ingredients:["3 large eggs","250 g cooked potato","1½ cups spinach and tomato","1 tsp olive oil"],calories:500,proteinG:25,carbsG:52,fatG:22,costCents:450,allergens:["egg"],dietTags:["gluten_free","dairy_free"],patterns:["omnivore","pescatarian","vegetarian"],favorites:["eggs","potatoes","vegetables"]},
  {id:"yogurt-oats-fruit",name:"Yogurt oats and fruit bowl",ingredients:["1 cup plain Greek yogurt","½ cup dry oats","1 medium banana","½ cup berries"],calories:430,proteinG:28,carbsG:66,fatG:7,costCents:425,allergens:["milk"],dietTags:[],patterns:["omnivore","pescatarian","vegetarian"],favorites:["yogurt","grains","fruit"]},
  {id:"tofu-rice-vegetables",name:"Tofu rice and vegetable bowl",ingredients:["150 g firm tofu","1¼ cups cooked rice","2 cups broccoli and carrot","lime to taste"],calories:550,proteinG:27,carbsG:77,fatG:15,costCents:500,allergens:["soy"],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["tofu","rice","vegetables"]},
  {id:"peanut-oat-banana-bowl",name:"Peanut oat and banana bowl",ingredients:["½ cup dry oats","2 tbsp peanut butter","1 medium banana","½ cup berries","water as needed"],calories:490,proteinG:17,carbsG:70,fatG:18,costCents:330,allergens:["peanuts"],dietTags:["dairy_free"],patterns:ALL_PATTERNS,favorites:["nuts","grains","fruit"]},
  {id:"whole-wheat-tomato-pasta",name:"Whole-wheat tomato and bean pasta",ingredients:["2 cups cooked whole-wheat pasta","½ cup cooked white beans","1½ cups tomato and spinach","1 tsp olive oil"],calories:570,proteinG:24,carbsG:91,fatG:13,costCents:390,allergens:["wheat"],dietTags:["dairy_free"],patterns:ALL_PATTERNS,favorites:["pasta","beans","vegetables"]},
  {id:"sesame-chickpea-rice",name:"Sesame chickpea rice bowl",ingredients:["¾ cup cooked chickpeas","1 cup cooked rice","1½ cups cucumber and carrot","2 tbsp sesame seeds"],calories:560,proteinG:19,carbsG:87,fatG:16,costCents:420,allergens:["sesame"],dietTags:["gluten_free","dairy_free"],patterns:ALL_PATTERNS,favorites:["beans","rice","vegetables"]}
].map((meal)=>Object.freeze({...meal,ingredients:Object.freeze([...meal.ingredients]),allergens:Object.freeze([...meal.allergens]),dietTags:Object.freeze([...meal.dietTags]),patterns:Object.freeze([...meal.patterns]),favorites:Object.freeze([...meal.favorites])})));

/** @param {readonly string[]} values @param {readonly string[]} allowed @param {boolean} [required] */
function validTags(values,allowed,required=false){return (!required||values.length>0)&&new Set(values).size===values.length&&values.every((value)=>allowed.includes(value));}
/** Fail closed if an edited catalog contains an unknown or ambiguous safety tag. @param {readonly CatalogMeal[]} catalog */
function validateCatalog(catalog){
  const ids=new Set();
  for(const meal of catalog){
    if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meal.id)||ids.has(meal.id))throw new TypeError(`Meal catalog ID is invalid or repeated: ${meal.id}.`);ids.add(meal.id);
    if(!meal.name||!meal.ingredients.length||!Number.isSafeInteger(meal.calories)||meal.calories<1||!Number.isSafeInteger(meal.costCents)||meal.costCents<0)throw new TypeError(`Meal catalog entry is incomplete: ${meal.id}.`);
    if(!validTags(meal.allergens,TOP_9_ALLERGENS)||!validTags(meal.dietTags,DIETARY_REQUIREMENTS)||!validTags(meal.patterns,DIETARY_PATTERNS,true)||!validTags(meal.favorites,FAVORITE_FOODS))throw new TypeError(`Meal catalog safety or preference metadata is invalid: ${meal.id}.`);
  }
}
validateCatalog(CATALOG);

const CATALOG_FINGERPRINT=createHash("sha256").update(JSON.stringify(CATALOG)).digest("hex").slice(0,16);

/** @param {string} message @param {string} [code] */
function mealError(message,code="INVALID_MEAL_PREFERENCES"){return Object.assign(new Error(message),{status:400,code});}
/** @param {unknown} value @param {string} label @returns {Record<string,any>} */
function record(value,label){if(!value||typeof value!=="object"||Array.isArray(value))throw mealError(`${label} must be an object.`);return value;}
/** @param {Record<string,any>} value @param {string[]} keys @param {string} label */
function exactKeys(value,keys,label){const extra=Object.keys(value).filter((key)=>!keys.includes(key));if(extra.length)throw mealError(`${label} contains unsupported fields: ${extra.join(", ")}.`);}
/** @template {string} T @param {unknown} value @param {readonly T[]} allowed @param {string} label @returns {T} */
function choice(value,allowed,label){if(typeof value!=="string"||!allowed.includes(/** @type {T} */(value)))throw mealError(`${label} is invalid.`);return /** @type {T} */(value);}
/** @param {unknown} value @param {readonly string[]} allowed @param {string} label */
function choices(value,allowed,label){if(!Array.isArray(value)||value.some((item)=>typeof item!=="string"||!allowed.includes(item))||new Set(value).size!==value.length)throw mealError(`${label} contains an invalid or repeated option.`);return allowed.filter((item)=>value.includes(item));}
/** @param {unknown} value @param {number} min @param {number} max @param {string} label */
function integer(value,min,max,label){if(typeof value!=="number"||!Number.isSafeInteger(value)||value<min||value>max)throw mealError(`${label} must be a whole number from ${min} to ${max}.`);return value;}

/** @param {unknown} value */
function sanitizeMealPreferences(value){
  const input=record(value,"Meal preferences");
  exactKeys(input,["allergyStatus","allergens","otherAllergies","dietaryPattern","dietaryRequirements","favoriteFoods","mealsPerDay","dailyBudgetCents"],"Meal preferences");
  if(typeof input.otherAllergies!=="string")throw mealError("Other allergy details must be text.");
  const allergyStatus=choice(input.allergyStatus,["none_known","listed","other_or_unsure"],"Allergy status"),allergens=choices(input.allergens,TOP_9_ALLERGENS,"Allergens"),otherAllergies=input.otherAllergies.trim();
  if(otherAllergies.length>200)throw mealError("Other allergy details must be 200 characters or fewer.");
  if(allergyStatus==="none_known"&&(allergens.length||otherAllergies))throw mealError("No-known-allergy status cannot include listed allergy details.");
  if(allergyStatus==="listed"&&(!allergens.length||otherAllergies))throw mealError("Listed allergy status requires at least one supported allergen and no unreviewed allergy text.");
  if(allergyStatus==="other_or_unsure"&&!otherAllergies)throw mealError("Describe the other or uncertain allergy so STRATA can fail closed.");
  return {allergyStatus,allergens,otherAllergies,dietaryPattern:choice(input.dietaryPattern,DIETARY_PATTERNS,"Dietary pattern"),dietaryRequirements:choices(input.dietaryRequirements,DIETARY_REQUIREMENTS,"Dietary requirements"),favoriteFoods:choices(input.favoriteFoods,FAVORITE_FOODS,"Favorite foods"),mealsPerDay:integer(input.mealsPerDay,1,6,"Meals per day"),dailyBudgetCents:input.dailyBudgetCents==null?null:integer(input.dailyBudgetCents,0,100000,"Daily food budget")};
}

/** @param {unknown} value @param {string} label @param {boolean} requireCalories */
function nutrientSet(value,label,requireCalories){
  const input=value==null?{}:record(value,label);exactKeys(input,["calories","proteinG","carbsG","fatG","costCents"],label);
  const calories=input.calories==null&&!requireCalories?0:integer(input.calories,requireCalories?1:0,20000,`${label} calories`),macroValues=[input.proteinG,input.carbsG,input.fatG],provided=macroValues.filter((item)=>item!=null).length;
  if(provided!==0&&provided!==3)throw mealError(`${label} must include protein, carbohydrates, and fat together or omit all three.`,"INVALID_MEAL_TARGET");
  return {calories,proteinG:provided?integer(input.proteinG,0,2000,`${label} protein`):null,carbsG:provided?integer(input.carbsG,0,3000,`${label} carbohydrates`):null,fatG:provided?integer(input.fatG,0,1000,`${label} fat`):null,costCents:input.costCents==null?0:integer(input.costCents,0,100000,`${label} cost`)};
}
/** @param {number} value */
function rounded(value){return Math.max(0,Math.round(value));}
/** @param {string} value */
function hash(value){return Number.parseInt(createHash("sha256").update(value).digest("hex").slice(0,8),16);}
/** @param {CatalogMeal} meal @param {ReturnType<typeof sanitizeMealPreferences>} preferences */
function eligible(meal,preferences){return meal.patterns.includes(preferences.dietaryPattern)&&preferences.allergens.every((allergen)=>!meal.allergens.includes(allergen))&&preferences.dietaryRequirements.every((requirement)=>meal.dietTags.includes(requirement));}
/** @param {number} calorieShare @param {number} calories */
function servingsFor(calorieShare,calories){return Math.max(.25,Math.min(3.5,Math.round(calorieShare/calories*20)/20));}
/** @param {CatalogMeal} meal @param {ReturnType<typeof sanitizeMealPreferences>} preferences @param {any} target @param {number} budgetPerMeal @param {number} calorieShare */
function baseScore(meal,preferences,target,budgetPerMeal,calorieShare){
  const servings=servingsFor(calorieShare,meal.calories),calorieDensity=Math.abs(meal.calories*servings-calorieShare)/10,favoriteBoost=meal.favorites.filter((tag)=>preferences.favoriteFoods.includes(tag)).length*80,budgetPenalty=Number.isFinite(budgetPerMeal)?Math.max(0,meal.costCents*servings-budgetPerMeal)/2:0;
  if(target.proteinG==null)return calorieDensity+budgetPenalty-favoriteBoost;
  const macroGap=Math.abs(meal.proteinG/meal.calories-target.proteinG/target.calories)*1000+Math.abs(meal.carbsG/meal.calories-target.carbsG/target.calories)*600+Math.abs(meal.fatG/meal.calories-target.fatG/target.calories)*1800;
  return calorieDensity+macroGap+budgetPenalty-favoriteBoost;
}
/** @param {CandidateMeal} meal @param {number} calorieShare */
function portion(meal,calorieShare){
  const servings=servingsFor(calorieShare,meal.calories);
  return {id:meal.id,name:meal.name,servings,portion:`${servings.toFixed(servings%1?2:0)} × base meal`,servingBasis:"One base meal is the complete listed ingredient combination represented by the catalog nutrition estimate.",calories:rounded(meal.calories*servings),proteinG:rounded(meal.proteinG*servings),carbsG:rounded(meal.carbsG*servings),fatG:rounded(meal.fatG*servings),estimatedCostCents:rounded(meal.costCents*servings),ingredients:[...meal.ingredients],allergens:[...meal.allergens],dietTags:[...meal.dietTags],favoriteMatches:[...meal.favorites.filter((tag)=>meal._favorites?.includes(tag))]};
}
/** @param {number} count */
function shares(count){const presets=/** @type {Record<number,number[]>} */({2:[.45,.55],3:[.25,.35,.4],4:[.2,.3,.15,.35],5:[.2,.25,.15,.25,.15],6:[.17,.2,.13,.2,.13,.17]});return presets[count]||Array(count).fill(1/count);}
/** @param {any[]} meals */
function totals(meals){return meals.reduce((sum,meal)=>({calories:sum.calories+meal.calories,proteinG:sum.proteinG+meal.proteinG,carbsG:sum.carbsG+meal.carbsG,fatG:sum.fatG+meal.fatG,estimatedCostCents:sum.estimatedCostCents+meal.estimatedCostCents}),{calories:0,proteinG:0,carbsG:0,fatG:0,estimatedCostCents:0});}

/**
 * Generate deterministic alternatives for the unconsumed part of one day.
 * Allergies and dietary rules filter before ranking; favorites and price only rank.
 * @param {unknown} value
 */
function generateRemainingDayFoodOptions(value){
  const input=record(value,"Meal option request");exactKeys(input,["mealPreferences","target","consumed","mealsRemaining","seed"],"Meal option request");
  const preferences=sanitizeMealPreferences(input.mealPreferences),target=nutrientSet(input.target,"Daily target",true),consumed=nutrientSet(input.consumed,"Consumed intake",false),mealsRemaining=input.mealsRemaining==null?preferences.mealsPerDay:integer(input.mealsRemaining,1,preferences.mealsPerDay,"Meals remaining"),seed=String(input.seed??"");
  if(seed.length>200)throw mealError("Meal option seed must be 200 characters or fewer.","INVALID_MEAL_TARGET");
  const remaining={calories:Math.max(0,target.calories-consumed.calories),proteinG:target.proteinG==null?null:Math.max(0,target.proteinG-(consumed.proteinG||0)),carbsG:target.carbsG==null?null:Math.max(0,target.carbsG-(consumed.carbsG||0)),fatG:target.fatG==null?null:Math.max(0,target.fatG-(consumed.fatG||0)),budgetCents:preferences.dailyBudgetCents==null?null:Math.max(0,preferences.dailyBudgetCents-consumed.costCents)};
  const common={catalogFingerprint:CATALOG_FINGERPRINT,nutritionProvenance:NUTRITION_PROVENANCE,safetyDisclaimer:SAFETY_DISCLAIMER,costDisclaimer:COST_DISCLAIMER,remaining};
  if(preferences.allergyStatus==="other_or_unsure")return {...common,status:"manual_review",reason:"Other or uncertain allergy information cannot be matched safely to STRATA’s supported allergen tags. Review food choices manually with a qualified professional.",options:[]};
  if(remaining.calories===0)return {...common,status:"target_met",reason:"The entered calories already meet or exceed this day’s planning target.",options:[]};
  const budgetPerMeal=remaining.budgetCents==null?Infinity:remaining.budgetCents/mealsRemaining,calorieShare=remaining.calories/mealsRemaining,candidates=/** @type {CandidateMeal[]} */(CATALOG.filter((meal)=>eligible(meal,preferences)).map((meal)=>({...meal,_favorites:preferences.favoriteFoods,_score:baseScore(meal,preferences,remaining,budgetPerMeal,calorieShare)})));
  if(!candidates.length)return {...common,status:"no_compatible_options",reason:"No catalog meal passed every saved allergy and dietary requirement. STRATA did not relax those safety filters.",options:[]};
  candidates.sort((a,b)=>a._score-b._score||hash(`${seed}\0${a.id}`)-hash(`${seed}\0${b.id}`)||a.id.localeCompare(b.id));
  const fallback=candidates[0];if(!fallback)throw mealError("No compatible meal option could be selected.","MEAL_OPTIONS_UNAVAILABLE");
  const weights=shares(mealsRemaining),options=[],keys=new Set();
  for(let variant=0;variant<Math.min(12,candidates.length*3)&&options.length<3;variant+=1){
    const selected=weights.map((weight,index)=>portion(candidates[(variant+index)%candidates.length]||fallback,remaining.calories*weight)),key=selected.map((meal)=>meal.id).sort().join("|");if(keys.has(key))continue;keys.add(key);
    const summary=totals(selected);let macroGap=null;if(remaining.proteinG!=null&&remaining.carbsG!=null&&remaining.fatG!=null)macroGap={proteinG:summary.proteinG-remaining.proteinG,carbsG:summary.carbsG-remaining.carbsG,fatG:summary.fatG-remaining.fatG};
    const calorieDifference=summary.calories-remaining.calories,calorieFitTolerance=Math.max(100,Math.round(remaining.calories*.1));
    options.push({id:createHash("sha256").update(`${CATALOG_FINGERPRINT}\0${seed}\0${key}`).digest("hex").slice(0,16),meals:selected,totals:summary,calorieDifference,calorieFitTolerance,withinCalorieFit:Math.abs(calorieDifference)<=calorieFitTolerance,macroDifference:macroGap,budgetDifferenceCents:remaining.budgetCents==null?null:summary.estimatedCostCents-remaining.budgetCents,withinEnteredBudget:remaining.budgetCents==null?null:summary.estimatedCostCents<=remaining.budgetCents});
  }
  const allFit=options.every((option)=>option.withinCalorieFit),ready=options.length===3&&allFit,reason=!allFit?"The bundled catalog cannot closely match this remaining calorie amount within its reviewed portion range. Treat these as partial ideas and review the portions manually.":options.length===3?null:"Fewer than three distinct menus passed every hard filter; STRATA did not relax those filters.";
  return {...common,status:ready?"ready":"limited",reason,options};
}

module.exports={CATALOG,CATALOG_FINGERPRINT,COST_DISCLAIMER,DIETARY_PATTERNS,DIETARY_REQUIREMENTS,FAVORITE_FOODS,NUTRITION_PROVENANCE,SAFETY_DISCLAIMER,TOP_9_ALLERGENS,generateRemainingDayFoodOptions,sanitizeMealPreferences,validateCatalog};
