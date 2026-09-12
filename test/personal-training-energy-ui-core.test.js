"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const EnergyUi=require("../public/scripts/personal-training-energy-ui-core");

test("profile v4 energy activity inputs stay separate and bounded",()=>{
  const result=EnergyUi.profileDraftToEnergy({dailyMovement:"on_feet",additionalActivityMinutesPerWeek:"360",additionalActivityIntensity:"vigorous"});
  assert.deepEqual(result,{ok:true,payload:{dailyMovement:"on_feet",additionalActivityMinutesPerWeek:360,additionalActivityIntensity:"vigorous"},errors:[]});
  assert.equal(Object.isFrozen(EnergyUi),true);
});

test("zero extra activity is optional while positive minutes require intensity",()=>{
  assert.deepEqual(EnergyUi.profileDraftToEnergy({dailyMovement:"mostly_seated",additionalActivityMinutesPerWeek:"",additionalActivityIntensity:""}).payload,{dailyMovement:"mostly_seated",additionalActivityMinutesPerWeek:0,additionalActivityIntensity:"moderate"});
  const missing=EnergyUi.profileDraftToEnergy({dailyMovement:"lightly_moving",additionalActivityMinutesPerWeek:"30",additionalActivityIntensity:""});
  assert.equal(missing.ok,false);assert.ok(missing.errors.some(({field})=>field==="additionalActivityIntensity"));
  for(const minutes of [-1,1.5,1261])assert.ok(EnergyUi.profileDraftToEnergy({dailyMovement:"on_feet",additionalActivityMinutesPerWeek:minutes,additionalActivityIntensity:"light"}).errors.some(({field})=>field==="additionalActivityMinutesPerWeek"));
});

test("earlier profiles force a fresh movement review without copying legacy activity",()=>{
  const legacy=EnergyUi.profileEnergyToDraft({version:3,lifestyleActivity:"very_active",additionalActivityMinutesPerWeek:900,additionalActivityIntensity:"vigorous"});
  assert.deepEqual(legacy,{dailyMovement:"",additionalActivityMinutesPerWeek:0,additionalActivityIntensity:"moderate"});
  const current=EnergyUi.profileEnergyToDraft({version:4,dailyMovement:"physically_demanding",additionalActivityMinutesPerWeek:180,additionalActivityIntensity:"light"});
  assert.deepEqual(current,{dailyMovement:"physically_demanding",additionalActivityMinutesPerWeek:180,additionalActivityIntensity:"light"});
});
