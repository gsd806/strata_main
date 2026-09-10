"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const W=require("../public/scripts/workout-core");
const State=require("../public/scripts/workout-state");
const Api=require("../public/scripts/workout-api");
const Calendar=require("../public/scripts/workout-calendar");
const Render=require("../public/scripts/workout-render");
const Guidance=require("../public/scripts/workout-guidance");
const History=require("../public/scripts/workout-history");
const Events=require("../public/scripts/workout-events");

const ROOT=join(__dirname,"..");
const DAYS=W.DAYS;
const emptyWeek=()=>({version:1,days:Object.fromEntries(DAYS.map((day)=>[day,[]]))});

test("workout state accepts explicit day and start deep links without weakening defaults",()=>{
  assert.equal(State.deepLinkedDay({search:"?day=Thursday",hash:""},W),"Thursday");
  assert.equal(State.deepLinkedDay({search:"?start=Friday",hash:""},W),"Friday");
  assert.equal(State.deepLinkedDay({search:"",hash:"#start=Saturday"},W),"Saturday");
  assert.equal(State.deepLinkedDay({search:"?day=Funday",hash:""},W),W.today());
  const state=State.create(W,{search:"?start=Tuesday",hash:""});
  assert.equal(state.day,"Tuesday");assert.equal(state.workout,null);assert.equal(state.dirty,false);
});

test("workout preferences accept only supported rest durations",()=>{
  assert.deepEqual(State.readPreferences(JSON.stringify({version:1,autoRest:false,restDuration:120})),{autoRest:false,restDuration:120});
  assert.deepEqual(State.readPreferences(JSON.stringify({version:1,autoRest:"yes",restDuration:17})),{});
  assert.deepEqual(JSON.parse(State.writePreferences(true,17)),{version:1,autoRest:true,restDuration:90});
});

test("calendar helper creates a private device calendar file for the next planned day",()=>{
  const plan=emptyWeek();plan.days.Wednesday=[{exerciseId:"press",sets:3},{exerciseId:"row",sets:2}];
  const next=Calendar.nextPlannedSession(plan,DAYS,new Date(2026,8,7,9));
  assert.deepEqual(next,{day:"Wednesday",date:"2026-09-09",movements:2,workingSets:5});
  const event=Calendar.event(next),ics=decodeURIComponent(event.href.split(",").slice(1).join(","));
  assert.equal(event.filename,"strata-2026-09-09-wednesday.ics");
  assert.match(event.href,/^data:text\/calendar;charset=utf-8,/);assert.match(ics,/DTSTART;VALUE=DATE:20260909/);assert.match(ics,/SUMMARY:STRATA · Wednesday workout/);
  assert.equal(Calendar.nextPlannedSession(emptyWeek(),DAYS,new Date(2026,8,7)),null);
});

test("workout renderer keeps the training essentials visible and nests configuration under Exercise tools",()=>{
  const catalog=[{id:"press",name:"Standing Press",equipment:"Barbell / Smith",reps:"8–12",group:"Shoulders",sub:"Front Delts",score:90,metrics:{stability:8}}];
  const plan=emptyWeek();plan.days.Monday=[{instanceId:"press-one",exerciseId:"press",sets:2,reps:"8–12"}];
  const workout=W.createWorkout(plan,"Monday",catalog,1_780_000_000_000),state={catalog,workout,memoryHistory:[],memoryReady:true,memoryError:""};
  const view=Render.create({state,workout:W,discovery:null}),markup=view.renderEntry(workout.entries[0],0);
  assert.match(markup,/aria-label="Previous performance"/);assert.match(markup,/Complete set/);assert.match(markup,/data-actual="weight"/);assert.match(markup,/data-actual="reps"/);
  assert.match(markup,/<details class="exercise-more"><summary><span>Exercise tools<\/span>/);
  assert.ok(markup.indexOf("Complete set")<markup.indexOf("Exercise tools"),"set logging must precede configuration");
  for(const advanced of ["data-open-swap","data-format=","data-entry-note","data-calc-warmup"])assert.ok(markup.indexOf(advanced)>markup.indexOf("Exercise tools"),`${advanced} should stay inside Exercise tools`);
  assert.match(markup,/<details class="set-more">/);assert.match(markup,/Duplicate set/);assert.match(markup,/Remove set/);
});

test("workout API module owns security headers and identity checks",async()=>{
  const calls=[],state={mode:"account",user:{id:"member-1",discovery:{active:true}},csrfToken:"csrf-1"};let identityUpdates=0;
  const fetchImpl=async(path,options)=>{calls.push({path,options});return{ok:true,status:200,json:async()=>path==="/api/me"?{user:{id:"member-1",discovery:{active:true}},csrfToken:"csrf-2"}:{saved:true}};};
  const client=Api.create({state,fetchImpl,onIdentity:()=>identityUpdates++});
  await client.request("/api/workouts",{method:"POST",body:"{}"});
  assert.equal(calls[0].options.headers["X-CSRF-Token"],"csrf-1");assert.equal(calls[0].options.headers["X-Strata-User"],"member-1");
  await client.assertIdentity();assert.equal(state.csrfToken,"csrf-2");assert.equal(identityUpdates,1);
});

test("training guidance keeps labels and explicit targets predictable",()=>{
  assert.equal(Guidance.actionLabel("hold_steady"),"Hold Steady");
  assert.equal(Guidance.actionLabel("reduce-load"),"Reduce Load");
  assert.equal(Guidance.suggestionTarget({target:{weight:42.5,reps:8},unit:"kg"},String),"42.5 kg · 8 reps");
  assert.equal(Guidance.suggestionTarget({target:{}},String),"Keep the current logged target");
  assert.equal(typeof Guidance.create,"function");assert.equal(typeof History.create,"function");
});

test("workout entry point is a bounded coordinator over dedicated modules",()=>{
  const main=readFileSync(join(ROOT,"public/scripts/workout.js"),"utf8"),html=readFileSync(join(ROOT,"public/pages/workout.html"),"utf8");
  const ordered=["workout-state.js","workout-api.js","workout-calendar.js","workout-render.js","workout-guidance.js","workout-history.js","workout-events.js","plan-insights-core.js","workout-context.js","workout.js"];
  assert.ok(main.trimEnd().split("\n").length<=430,`workout.js coordinator is still too large: ${main.trimEnd().split("\n").length} lines`);
  for(const [file,globalName] of [["workout-state.js","StrataWorkoutState"],["workout-api.js","StrataWorkoutApi"],["workout-calendar.js","StrataWorkoutCalendar"],["workout-render.js","StrataWorkoutRender"],["workout-guidance.js","StrataWorkoutGuidance"],["workout-history.js","StrataWorkoutHistory"],["workout-events.js","StrataWorkoutEvents"],["workout-context.js","StrataWorkoutContext"]]){
    const source=readFileSync(join(ROOT,"public/scripts",file),"utf8");assert.ok(Buffer.byteLength(source)<18_000,`${file} should remain focused`);assert.match(source,new RegExp(globalName));
  }
  for(let index=1;index<ordered.length;index++)assert.ok(html.indexOf(`/${ordered[index-1]}`)<html.indexOf(`/${ordered[index]}`),`${ordered[index-1]} must load before ${ordered[index]}`);
  assert.match(main,/S\.create\(W,location\)/);assert.match(main,/A\.create\(/);assert.match(main,/R\.create\(/);assert.match(main,/Q\.create\(/);assert.match(main,/H\.create\(/);assert.match(main,/E\.bind\(/);assert.equal(typeof Events.bind,"function");
});


test("Train context distinguishes missing week, empty selected day, scheduled work, and an active draft",async()=>{
  const Context=require("../public/scripts/workout-context"),Insights=require("../public/scripts/plan-insights-core");
  const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{hidden:false,disabled:false,innerHTML:"",textContent:"",dataset:{},focus(){this.focused=true;}});return elements.get(id);};
  const state={plan:emptyWeek(),day:"Monday",workout:null,history:[],recoveries:[],historyLoaded:true,historyBusy:false,blocked:false,catalog:[]};
  const calls=[],view={planPreview:items=>`${items.length} preview exercises`};
  const context=Context.create({$,state,workout:{...W,today:()=>"Monday"},insights:Insights,view,esc:Render.esc,exercise:()=>({equipment:"Dumbbells"}),openDetail:async id=>calls.push(["open",id]),recover:async index=>calls.push(["recover",index])});
  context.render();assert.equal($("planStatus").textContent,"You have not built a weekly plan yet.");assert.equal($("openPlannerFromEmpty").hidden,false);assert.equal($("planDayField").hidden,true);assert.equal($("differentWorkout").hidden,true);
  state.plan.days.Wednesday=[{exerciseId:"press",sets:3,reps:"8–12"}];context.render();assert.equal($("planStatus").textContent,"Nothing is scheduled for today.");assert.equal($("chooseScheduledDay").dataset.day,"Wednesday");assert.equal($("openPlannerFromEmpty").hidden,true);assert.equal($("planPreviewDetails").hidden,true);
  state.day="Wednesday";context.render();assert.equal($("startWorkout").hidden,false);assert.equal($("startWorkout").disabled,false);assert.match($("planBrief").innerHTML,/Estimated duration/);assert.match($("planBrief").innerHTML,/15 min/);assert.match($("planBrief").innerHTML,/Dumbbells/);assert.equal($("differentWorkout").hidden,false);
  state.historyLoadError="Unavailable";context.render();assert.equal($("startWorkout").disabled,true);assert.equal($("trainHistoryNotice").hidden,false);state.historyLoadError="";
  state.history=[{id:"active",title:"Existing workout",status:"active",date:"2026-09-10",completedSets:1,totalSets:3}];context.render();assert.equal($("resumeWorkout").hidden,false);assert.equal($("startWorkout").hidden,true);assert.equal($("planDayField").hidden,true);assert.equal($("planBrief").hidden,true);assert.equal($("differentWorkout").hidden,true);context.focusPrimary();assert.equal($("resumeWorkout").focused,true);await context.resume();
  state.recoveries=[{dirty:true,workout:{...state.history[0]}}];await context.resume();assert.deepEqual(calls,[["open","active"],["recover",0]]);
});
