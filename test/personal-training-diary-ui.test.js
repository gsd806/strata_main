"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const Diary=require("../public/scripts/personal-training-diary-ui"),Ui=require("../public/scripts/personal-training-ui-core"),{createRenderer,projectionSvg}=require("../public/scripts/discover-coaching-render"),{createController}=require("../public/scripts/discover-coaching"),{assertAccountResponse}=require("../public/scripts/discover-api");
const week={weekStart:"2026-09-14",weekEnd:"2026-09-20",diaryStartDate:"2026-08-05",diaryEndDate:"2026-09-16",logTargets:[{date:"2026-09-07",day:"Monday",calories:null},{date:"2026-09-15",day:"Tuesday",calories:2100,kind:"daily"},{date:"2026-09-16",day:"Wednesday",calories:2200,kind:"daily"}],nutrition:{dailyTargets:[{date:"2026-09-16",day:"Wednesday",calories:2200}]}};
function elements(){const nodes=new Map();return id=>{if(!nodes.has(id))nodes.set(id,{id,value:"",textContent:"",innerHTML:"",checked:false,hidden:false,disabled:false,dataset:{},listeners:{},attributes:{},children:[],addEventListener(type,handler){this.listeners[type]=handler;},setAttribute(name,value){this.attributes[name]=value;},getAttribute(name){return this.attributes[name]||null;},removeAttribute(name){delete this.attributes[name];},focus(){},reset(){},querySelector(){return null;}});return nodes.get(id);};}
function controllerFixture(api){
  const el=elements(),state={user:{id:"member"},csrfToken:"csrf",exercises:[],preferences:{}},rendered=[],synced=[],document={querySelectorAll:()=>[],querySelector:()=>null},renderer={renderDashboard(...args){rendered.push(args);},clearPrivate(){},show(){},showProgressSetup(){},renderLog(){}};
  const controller=createController({document,element:el,api,state,ui:Ui,diaryUi:Diary,meals:{sync(value){synced.push(value);},clearPrivate(){},fillPreferences(){}},assertAccountResponse,renderFactory:()=>renderer,saveRetryMessage:error=>error.message,showToast(){}});
  Object.assign(controller.state,{profile:{macroPreference:null,measurementSystem:"metric"},week,logs:[{date:"2026-09-07",calories:1500,proteinG:100,carbsG:180,fatG:50,revision:4}]});
  el("coachingLogDate").value="2026-09-07";el("coachingCaloriesEaten").value="1800";el("coachingMorningWeight").value="80";el("coachingDayComplete").checked=true;
  return{el,state,controller,rendered,synced,save:()=>el("coachingLogForm").listeners.submit({currentTarget:{id:"coachingLogForm"},preventDefault(){}})};
}

test("historical target lookup never substitutes this week's calories for a missing saved target",()=>{
  assert.equal(Diary.context(week,[],"2026-09-07").target,null);assert.equal(Diary.context(week,[],"2026-09-15").target.calories,2100);assert.equal(Diary.context(week,[],"2026-09-17"),null);
  assert.equal(Diary.selectedDate(week,"2026-09-07","2026-09-16"),"2026-09-07");assert.equal(Diary.selectedDate(week,"2026-09-17","2026-09-16"),"2026-09-16");assert.deepEqual(Diary.targetsFor({logTargets:[{date:"2026-99-99"},{date:"2026-02-30"}]}),[]);
});

test("historical diary renders intake without inventing a remaining target",()=>{
  const el=elements(),render=createRenderer({element:el,ui:Ui,diaryUi:Diary});render.renderLog({macroPreference:null,measurementSystem:"imperial"},week,[{date:"2026-09-07",calories:1800,morningWeightKg:300,complete:true}],"2026-09-07");
  for(const prefix of ["coaching","progressCoaching"]){const summary=el(prefix==="coaching"?"coachingProgressSummary":"progressCoachingSummary").innerHTML;assert.match(summary,/1,800 kcal/);assert.match(summary,/No target was saved/);assert.doesNotMatch(summary,/2,200|400 kcal/);assert.equal(el(`${prefix}LogDate`).value,"2026-09-07");assert.equal(el(`${prefix}MorningWeight`).value,661.4);assert.equal(el(`${prefix}MorningWeight`).max,"661.4");}
});

test("a historical save uses the original revision and omits hidden macros",async()=>{
  let payload;const fixture=controllerFixture(async(_url,options)=>{payload=JSON.parse(options.body);return{csrfToken:"csrf",log:{date:"2026-09-07",...payload.log,proteinG:100,carbsG:180,fatG:50,revision:5}};});await fixture.save();
  assert.equal(payload.expectedRevision,4);assert.equal(payload.expectedUserId,"member");assert.deepEqual(payload.log,{calories:1800,morningWeightKg:80,complete:true});assert.equal(fixture.controller.state.logs[0].proteinG,100);assert.equal(fixture.rendered[0][3],"2026-09-07");
});

test("a delayed save preserves a changed date and newer draft values",async()=>{
  let resolveResponse;const pending=new Promise(resolve=>{resolveResponse=resolve;}),fixture=controllerFixture(()=>pending),saving=fixture.save();fixture.el("coachingLogDate").value="2026-09-16";fixture.el("coachingCaloriesEaten").value="975";
  resolveResponse({csrfToken:"csrf",log:{date:"2026-09-07",calories:1800,morningWeightKg:80,complete:true,revision:5}});await saving;
  assert.equal(fixture.rendered.length,0);assert.equal(fixture.el("coachingLogDate").value,"2026-09-16");assert.equal(fixture.el("coachingCaloriesEaten").value,"975");assert.equal(fixture.synced.at(-1).date,"2026-09-16");assert.match(fixture.el("coachingLogStatus").textContent,/newer entries.*not saved/i);
});

test("a delayed coaching write cannot repopulate a reset account view",async()=>{
  let resolveResponse;const pending=new Promise(resolve=>{resolveResponse=resolve;}),fixture=controllerFixture(()=>pending),saving=fixture.save();fixture.controller.reset();resolveResponse({csrfToken:"csrf",log:{date:"2026-09-07",calories:1800,revision:5}});await saving;
  assert.deepEqual(fixture.controller.state.logs,[]);assert.equal(fixture.rendered.length,0);assert.equal(fixture.synced.length,0);
});

test("weight scenarios begin at their dated engine weight basis",()=>{
  const markup=projectionSvg({weightKg:100},[{weeks:4,startWeightKg:80,weightKg:79,rangeKg:[77,83]}],kg=>`${kg} kg`);
  assert.match(markup,/Start/);assert.match(markup,/77 kg–83 kg/);assert.doesNotMatch(markup,/100 kg/);
});


test("a delayed conflict cannot restore an earlier account's diary after reset",async()=>{
  let rejectResponse;const pending=new Promise((_resolve,reject)=>{rejectResponse=reject;}),fixture=controllerFixture(()=>pending),saving=fixture.save();fixture.controller.reset();rejectResponse(Object.assign(new Error("Changed"),{code:"COACHING_LOG_CHANGED",payload:{log:{date:"2026-09-07",calories:1900,revision:6}}}));await saving;
  assert.deepEqual(fixture.controller.state.logs,[]);assert.equal(fixture.el("coachingSaveLog").disabled,false);assert.equal(fixture.rendered.length,0);
});

test("switching the maximum body weight back to metric retains a valid endpoint",()=>{
  const fixture=controllerFixture(async()=>({}));fixture.el("coachingWeight").value="661.4";fixture.el("coachingWeight").dataset.unit="lb";fixture.el("coachingWeightUnit").value="kg";fixture.el("coachingWeightUnit").listeners.change();assert.equal(fixture.el("coachingWeight").value,300);assert.equal(fixture.el("coachingWeight").max,"300");
});

test("dashboard shows aligned evidence and exercise-specific units without inventing timed repetitions",()=>{
  const previous=globalThis.document;globalThis.document={querySelectorAll:()=>[]};
  try{
    const el=elements(),render=createRenderer({element:el,ui:Ui,diaryUi:Diary}),profile={version:3,measurementSystem:"metric",preferredLoadUnit:"lb",weightKg:82,experience:"intermediate",sessionMinutes:45,sessionsPerWeek:1,lifestyleActivity:"moderately_active",usualExercises:[],trainingGoal:"strength"};
    const model={...week,modelUpdateAvailable:true,nextWeekStart:"2026-09-21",training:{sessions:[{day:"Wednesday",label:"Full body",workingSets:3,estimatedDurationMinutes:12,exercises:[{name:"Plank",sets:3,reps:"20–30 s",rest:"75 sec",measurement:"timed",loadType:"bodyweight",unit:"kg",enteredCapability:{maxSets:3,maxReps:12,maxWeightKg:null},performance:{sourceDate:"2026-09-12",status:"repeat"},targetSets:[{seconds:25,reps:null,weight:null}]}]}]},nutrition:{...week.nutrition,weightBasis:{weightKg:80,date:"2026-09-13",source:"recent_morning_weights"},maintenance:{targetKcal:2300,calibration:{status:"trend_informed",windowStart:"2026-08-03",windowEnd:"2026-09-13",evidence:{completeCalorieDays:20,alignedIntakeDays:18,morningWeightDays:9,weightObservationSpanDays:18},interval:{start:"2026-08-24",lastIntakeDate:"2026-09-10",end:"2026-09-11"},quality:{label:"usable"},sensitivity:{rangeKcal:[2000,2600],basis:"Not a confidence interval."}}},weightScenarios:[{weeks:4,startWeightKg:80,weightKg:79,rangeKg:[77,83],includesGainAndLoss:true,caveat:"Scenario envelope, not a prediction interval."}]}};
    render.renderDashboard(profile,model,[],"2026-09-16");assert.match(el("coachingWeekGrid").innerHTML,/3 working sets · about 12 minutes/);assert.match(el("coachingWeekGrid").innerHTML,/Optional set targets: 25 s/);assert.match(el("coachingWeekGrid").innerHTML,/Entered repetition reference; not a time or distance target: 3 sets × 12 reps/);assert.doesNotMatch(el("coachingWeekGrid").innerHTML,/null reps|25 reps|25 s · 0 kg/);assert.match(el("coachingCalibrationIntake").textContent,/20 logged · 18 aligned/);assert.match(el("coachingCalibrationAlignment").textContent,/final date is excluded/);assert.match(el("coachingCalibrationSensitivity").textContent,/2,000–2,600.*Not a confidence interval/);assert.match(el("coachingWeightBasis").textContent,/80 kg · recent morning weights/);assert.equal(el("coachingModelUpdate").hidden,false);assert.match(el("coachingProjectionNote").textContent,/both weight gain and weight loss/);
  }finally{if(previous===undefined)delete globalThis.document;else globalThis.document=previous;}
});
