"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {CATALOG,CATALOG_FINGERPRINT,DIETARY_PATTERNS,DIETARY_REQUIREMENTS,FAVORITE_FOODS,NUTRITION_PROVENANCE,TOP_9_ALLERGENS,generateRemainingDayFoodOptions,sanitizeMealPreferences,validateCatalog}=require("../src/meal-planning-core");

function preferences(overrides={}){return {allergyStatus:"none_known",allergens:[],otherAllergies:"",dietaryPattern:"omnivore",dietaryRequirements:[],favoriteFoods:["chicken","rice"],mealsPerDay:3,dailyBudgetCents:1800,...overrides};}
function request(overrides={}){return {mealPreferences:preferences(),target:{calories:2200,proteinG:160,carbsG:250,fatG:70},consumed:{calories:600,proteinG:40,carbsG:70,fatG:18,costCents:400},mealsRemaining:2,seed:"2026-09-14:user-1",...overrides};}

test("meal preferences strictly validate allergy state and bounded choices",()=>{
  assert.deepEqual(sanitizeMealPreferences(preferences()),preferences());
  assert.deepEqual(sanitizeMealPreferences(preferences({allergyStatus:"listed",allergens:["milk","peanuts"],favoriteFoods:[],dailyBudgetCents:null})).allergens,["milk","peanuts"]);
  assert.throws(()=>sanitizeMealPreferences({...preferences(),userId:"untrusted"}),/unsupported fields: userId/);
  assert.throws(()=>sanitizeMealPreferences(preferences({otherAllergies:42})),/must be text/);
  assert.throws(()=>sanitizeMealPreferences(preferences({allergyStatus:"none_known",allergens:["milk"]})),/cannot include/);
  assert.throws(()=>sanitizeMealPreferences(preferences({allergyStatus:"listed",allergens:[]})),/at least one supported/);
  assert.throws(()=>sanitizeMealPreferences(preferences({allergyStatus:"other_or_unsure",otherAllergies:""})),/Describe the other/);
  assert.throws(()=>sanitizeMealPreferences(preferences({allergens:["milk","milk"]})),/invalid or repeated/);
  assert.equal(sanitizeMealPreferences(preferences({mealsPerDay:1})).mealsPerDay,1);
  assert.throws(()=>sanitizeMealPreferences(preferences({mealsPerDay:7})),/1 to 6/);
  assert.throws(()=>sanitizeMealPreferences(preferences({dailyBudgetCents:10.5})),/whole number/);
});

test("unknown allergies fail closed without generating automated suggestions",()=>{
  const result=generateRemainingDayFoodOptions(request({mealPreferences:preferences({allergyStatus:"other_or_unsure",otherAllergies:"Must discuss an uncommon spice reaction"})}));
  assert.equal(result.status,"manual_review");assert.deepEqual(result.options,[]);assert.match(result.reason,/cannot be matched safely/i);assert.match(result.safetyDisclaimer,/not medical nutrition therapy/i);
});

test("hard filters exclude allergens and enforce vegan, gluten-free, and dairy-free requirements",()=>{
  const mealPreferences=preferences({allergyStatus:"listed",allergens:["soy","peanuts","sesame","wheat","milk","egg","fish","crustacean_shellfish","tree_nuts"],dietaryPattern:"vegan",dietaryRequirements:["gluten_free","dairy_free"],favoriteFoods:["tofu","nuts"]});
  const result=generateRemainingDayFoodOptions(request({mealPreferences,mealsRemaining:3}));
  assert.equal(result.status,"ready");assert.equal(result.options.length,3);
  for(const option of result.options)for(const meal of option.meals){
    assert.equal(meal.allergens.length,0);assert.ok(meal.dietTags.includes("gluten_free"));assert.ok(meal.dietTags.includes("dairy_free"));
    assert.equal(meal.favoriteMatches.includes("tofu")||meal.favoriteMatches.includes("nuts"),false);
  }
});

test("remaining-day generation is deterministic, distinct, nutrient-aware, and transparent",()=>{
  const first=generateRemainingDayFoodOptions(request()),replay=generateRemainingDayFoodOptions(request());
  assert.deepEqual(replay,first);assert.equal(first.options.length,3);assert.equal(new Set(first.options.map((option)=>option.id)).size,3);
  assert.deepEqual(first.remaining,{calories:1600,proteinG:120,carbsG:180,fatG:52,budgetCents:1400});
  for(const option of first.options){assert.equal(option.meals.length,2);assert.ok(Math.abs(option.calorieDifference)<=100);assert.ok(option.meals.every((meal)=>meal.ingredients.length&&meal.calories>0&&meal.estimatedCostCents>0));assert.ok(option.macroDifference);}
  assert.match(first.costDisclaimer,/not live store prices/i);assert.equal(first.nutritionProvenance.source,"USDA FoodData Central");assert.match(first.nutritionProvenance.url,/fdc\.nal\.usda\.gov/);
});

test("favorites and budget rank options but never weaken hard filters",()=>{
  const chicken=generateRemainingDayFoodOptions(request({mealPreferences:preferences({favoriteFoods:["chicken"],dailyBudgetCents:null}),consumed:{calories:0},mealsRemaining:2,seed:"favorite"}));
  assert.ok(chicken.options[0].meals.some((meal)=>meal.favoriteMatches.includes("chicken")));
  const budget=generateRemainingDayFoodOptions(request({mealPreferences:preferences({favoriteFoods:[],dailyBudgetCents:700}),consumed:{calories:0,costCents:0},mealsRemaining:2,seed:"budget"}));
  assert.equal(typeof budget.options[0].withinEnteredBudget,"boolean");assert.equal(typeof budget.options[0].budgetDifferenceCents,"number");
  const scaledBudget=generateRemainingDayFoodOptions(request({mealPreferences:preferences({favoriteFoods:[],mealsPerDay:2,dailyBudgetCents:700}),target:{calories:1200},consumed:{calories:0,costCents:0},mealsRemaining:2,seed:"budget"}));
  assert.equal(scaledBudget.options[0].totals.estimatedCostCents,Math.min(...scaledBudget.options.map((option)=>option.totals.estimatedCostCents)));
});

test("all requested macros influence menu ranking",()=>{
  const mealPreferences=preferences({favoriteFoods:[],dailyBudgetCents:null}),base={mealPreferences,consumed:{calories:0},mealsRemaining:3,seed:"macro-ranking"};
  const highProtein=generateRemainingDayFoodOptions({...base,target:{calories:1800,proteinG:240,carbsG:120,fatG:40}}).options[0].totals;
  const highCarb=generateRemainingDayFoodOptions({...base,target:{calories:1800,proteinG:60,carbsG:320,fatG:30}}).options[0].totals;
  const highFat=generateRemainingDayFoodOptions({...base,target:{calories:1800,proteinG:80,carbsG:100,fatG:120}}).options[0].totals;
  assert.ok(highProtein.proteinG>highCarb.proteinG);assert.ok(highCarb.carbsG>highProtein.carbsG);assert.ok(highFat.fatG>highCarb.fatG);
});

test("met targets stop suggestions and catalog metadata remains stable and complete",()=>{
  const met=generateRemainingDayFoodOptions(request({target:{calories:1000},consumed:{calories:1100},mealsRemaining:2}));assert.equal(met.status,"target_met");assert.deepEqual(met.options,[]);
  assert.match(CATALOG_FINGERPRINT,/^[a-f0-9]{16}$/);assert.equal(NUTRITION_PROVENANCE.source,"USDA FoodData Central");assert.ok(CATALOG.length>=18);
  assert.ok(Object.isFrozen(CATALOG)&&CATALOG.every((meal)=>Object.isFrozen(meal)&&Object.isFrozen(meal.allergens)));
  for(const meal of CATALOG){assert.match(meal.id,/^[a-z0-9]+(?:-[a-z0-9]+)*$/);assert.ok(meal.ingredients.length);assert.match(meal.ingredients.join(" "),/[0-9½¾⅓¼]/,`${meal.id} needs an approximate base amount`);assert.ok(meal.allergens.every((value)=>TOP_9_ALLERGENS.includes(value)));assert.ok(meal.dietTags.every((value)=>DIETARY_REQUIREMENTS.includes(value)));assert.ok(meal.patterns.every((value)=>DIETARY_PATTERNS.includes(value)));assert.ok(meal.favorites.every((value)=>FAVORITE_FOODS.includes(value)));assert.ok(meal.calories===meal.proteinG*4+meal.carbsG*4+meal.fatG*9||Math.abs(meal.calories-(meal.proteinG*4+meal.carbsG*4+meal.fatG*9))<=75,meal.id);}
  assert.throws(()=>validateCatalog([{...CATALOG[0],allergens:["milkk"]}]),/metadata is invalid/);
});

test("extreme remaining targets never claim a close menu fit",()=>{
  const result=generateRemainingDayFoodOptions(request({mealPreferences:preferences({mealsPerDay:2,dailyBudgetCents:null}),target:{calories:8500},consumed:{calories:0},mealsRemaining:2,seed:"extreme-target"}));
  assert.equal(result.status,"limited");assert.match(result.reason,/cannot closely match/i);assert.ok(result.options.length>0);assert.ok(result.options.every((option)=>!option.withinCalorieFit&&Math.abs(option.calorieDifference)>option.calorieFitTolerance));
});
