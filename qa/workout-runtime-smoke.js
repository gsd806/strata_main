"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const ROOT=join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(join(ROOT,"public",...parts),"utf8");
const html=read("pages","workout.html"),sources=["workout-state.js","workout-api.js","workout-calendar.js","workout-render.js","workout-guidance.js","particle-chart-core.js","workout-chart.js","workout-history.js","workout-events.js","workout.js"].map((name)=>[name,read("scripts",name)]),catalog=JSON.parse(read("data","exercises.json"));
const Workout=require(join(ROOT,"public/scripts/workout-core")),Discovery=require(join(ROOT,"public/scripts/discovery-core"));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);

class Element{
  constructor(id){this.id=id;this.value="";this.textContent="";this.innerHTML="";this.hidden=false;this.disabled=false;this.checked=id==="autoRest";this.dataset={};this.style={};this.attributes={};this.listeners={};this.classList={add(){},remove(){}};this.rootCount=0;this.canvas=null;}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  querySelector(selector){return selector==="canvas"?this.canvas:null;}
  querySelectorAll(){return[];}
  replaceChildren(){this.innerHTML="";this.rootCount=0;this.canvas=null;}
  focus(){}
  scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;for(const handler of this.listeners.close||[])handler();}
}

const elements=new Map(ids.map((id)=>[id,new Element(id)]));
for(const id of ids){const tag=html.match(new RegExp(`<[^>]+id="${id}"[^>]*>`))?.[0]||"";elements.get(id).hidden=/\shidden(?:\s|>|=)/u.test(tag);}
elements.get("restDuration").value="90";
const first=catalog.find((item)=>item.equipment==="Barbell / Smith"&&!/seconds|sec|min/i.test(item.reps));
const second=catalog.find((item)=>item.id!==first.id&&item.equipment!=="Bodyweight"&&!/seconds|sec|min/i.test(item.reps));
const plan={version:1,restDay:"Sunday",restDays:["Sunday"],days:Object.fromEntries(Workout.DAYS.map((day)=>[day,day==="Monday"?[{instanceId:"runtime-first",exerciseId:first.id,sets:2,reps:"8–12"},{instanceId:"runtime-second",exerciseId:second.id,sets:1,reps:"8–12"}]:[]]))};
const completed=(id,startedAt,date,weight)=>{const item=Workout.createWorkout(plan,"Monday",catalog,startedAt);item.id=id;item.date=date;item.status="completed";item.completedAt=item.startedAt+1000;item.elapsedSeconds=1;item.entries[0].sets[0]={reps:10,weight,seconds:null,completed:true,effort:null};return Workout.summary(item);};
const history=[completed("runtime-history",1_700_000_000_000,"2026-08-31",42.5),completed("runtime-older",1_690_000_000_000,"2026-07-17",37.5)];
const storage=new Map();
const previewDetails=new Element("planPreviewDetails"),documentListeners={},windowListeners={},document={visibilityState:"visible",body:new Element("body"),getElementById:(id)=>elements.get(id)||null,querySelector:(selector)=>selector===".plan-preview-details"?previewDetails:null,addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);}};
const location={search:"?day=Monday",hash:"",href:"http://strata.test/workout.html?day=Monday",reload(){}};
const chartInstances=[];
class ParticleChart{
  constructor(host,options){assert.equal(host.id,"performanceChartCanvas");assert.equal(elements.get("performanceChartFrame").hidden,false);assert.ok(host.offsetWidth>0);this.host=host;this.options=options;this.updates=[];this.destroyCalls=0;this.resizeCalls=0;host.rootCount+=1;host.innerHTML='<div data-particle-chart-root="true"><canvas></canvas></div>';host.canvas=new Element("runtime-chart-canvas");chartInstances.push(this);}
  update(data,options){this.updates.push({data,options});this.options={...options,data};}
  destroy(){this.destroyCalls+=1;}
  resize(){this.resizeCalls+=1;}
}
Object.defineProperty(elements.get("performanceChartCanvas"),"offsetWidth",{get:()=>640});
let identityUserId="runtime-user",identityUnavailable=false;
const context={
  console,document,location,history:{replaceState(){}},URL,URLSearchParams,AbortController,Blob,
  globalThis:null,StrataWorkout:Workout,StrataDiscovery:Discovery,ParticleCharts:{ParticleChart},
  matchMedia:()=>({matches:true}),
  crypto:{randomUUID:()=>`runtime-${Math.random().toString(16).slice(2)}`},
  localStorage:{get length(){return storage.size;},key:(index)=>[...storage.keys()][index]||null,getItem:(key)=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:(key)=>storage.delete(key)},
  fetch:async(path)=>{
    if(path==="/api/me"){if(identityUnavailable)throw new Error("identity unavailable");return{ok:true,status:200,json:async()=>({user:{id:identityUserId,name:"Runtime",discovery:{active:true}},csrfToken:"runtime-csrf"})};}
    if(path==="/exercises.json")return{ok:true,status:200,json:async()=>catalog};
    if(path==="/api/plan")return{ok:true,status:200,json:async()=>({plan,planUpdatedAt:100,user:{id:"runtime-user"},csrfToken:"runtime-csrf"})};
    if(String(path).startsWith("/api/workouts?"))return{ok:true,status:200,json:async()=>({workouts:history,hasMore:false,csrfToken:"runtime-csrf"})};
    throw new Error(`Unexpected runtime request: ${path}`);
  },
  window:{addEventListener(type,handler){(windowListeners[type]||=[]).push(handler);},matchMedia:()=>({matches:true})},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true
};
context.globalThis=context;context.window.document=document;context.window.location=location;
vm.createContext(context);for(const [name,source] of sources)vm.runInContext(source,context,{filename:name});

(async()=>{
  for(let index=0;index<10;index++)await new Promise(setImmediate);
  assert.equal(chartInstances.length,1,"two exact completed sessions should construct one chart");
  assert.deepEqual(Array.from(chartInstances[0].options.data.labels),["2026-07-17","2026-08-31"]);
  assert.deepEqual(Array.from(chartInstances[0].options.data.series[0].data),[37.5,42.5]);
  assert.equal(chartInstances[0].options.animate,false,"runtime honors the reduced-motion media query");
  assert.equal(elements.get("performanceChartCanvas").rootCount,1);assert.equal(elements.get("performanceChartFrame").hidden,false);
  assert.match(elements.get("chartTableBody").innerHTML,/2026-07-17/);assert.match(elements.get("chartTableBody").innerHTML,/2026-08-31/);assert.doesNotMatch(elements.get("chartTableBody").innerHTML,/<svg\b/);
  assert.match(elements.get("performanceChartCanvas").canvas.attributes["aria-label"],/exact matching completed sessions/);
  assert.equal(elements.get("performanceChartCanvas").canvas.attributes["aria-describedby"],"chartStatus chartScope");
  elements.get("chartMetric").value="volume";for(const handler of elements.get("chartMetric").listeners.change||[])handler({});
  assert.equal(chartInstances.length,1,"metric changes must update instead of duplicating the chart");assert.equal(chartInstances[0].updates.length,1);assert.equal(elements.get("performanceChartCanvas").rootCount,1);
  assert.match(elements.get("planPreview").innerHTML,/runtime-first|Setup, cues/);
  const startHandlers=elements.get("startWorkout").listeners.click||[];assert.equal(startHandlers.length,1);
  startHandlers[0]();
  const markup=elements.get("sessionEntries").innerHTML;
  assert.match(markup,/Previous performance/);
  assert.match(markup,/data-use-last/);assert.match(markup,/data-apply-target/);
  assert.match(markup,/data-add-set/);assert.match(markup,/data-duplicate-set/);assert.match(markup,/data-remove-set/);
  assert.match(markup,/data-entry-note/);assert.match(markup,/Effort \(optional\)/);
  assert.match(markup,/More options/);assert.match(markup,/Warm-ups &amp; plate calculator/);assert.match(markup,/data-calc-warmup/);assert.match(markup,/data-calc-plates/);
  assert.match(markup,/Complete set/);
  assert.match(markup,/data-toggle-superset/);assert.match(markup,/data-open-swap/);
  assert.match(html,/No workout or Plan changes until/);assert.match(html,/Approve Plan &amp; workout change/);
  identityUnavailable=true;for(const handler of documentListeners.visibilitychange||[])handler();
  assert.equal(chartInstances[0].destroyCalls,1,"foreground preflight must destroy its chart before the identity promise settles");
  assert.equal(elements.get("performanceChartCanvas").rootCount,0);assert.equal(elements.get("performanceChartCanvas").innerHTML,"");
  assert.equal(elements.get("chartExercise").innerHTML,"");assert.equal(elements.get("chartMetric").innerHTML,"");assert.equal(elements.get("chartTableBody").innerHTML,"");
  for(const id of ["chartBestValue","chartBestUnit","chartBestLabel","chartStatus","chartTableCaption","chartTableMetric","chartScope"])assert.equal(elements.get(id).textContent,"",`${id} must be purged before identity revalidation`);
  assert.equal(elements.get("chartControls").hidden,true);assert.equal(elements.get("historySection").hidden,true);assert.equal(elements.get("trainingRoom").hidden,true);
  for(let index=0;index<4;index++)await new Promise(setImmediate);
  assert.equal(elements.get("historySection").hidden,true,"a failed identity check must not reveal private history");assert.equal(elements.get("performanceChartCanvas").rootCount,0);assert.equal(elements.get("loadError").hidden,false);assert.match(elements.get("loadErrorMessage").textContent,/details stay hidden/i);

  identityUnavailable=false;for(const handler of documentListeners.visibilitychange||[])handler();for(let index=0;index<4;index++)await new Promise(setImmediate);
  assert.equal(elements.get("historySection").hidden,false,"the same verified account may reveal its history again");assert.equal(elements.get("trainingRoom").hidden,false);assert.equal(chartInstances.length,2,"successful revalidation rebuilds one fresh chart after secure teardown");

  identityUserId="runtime-other";for(const handler of documentListeners.visibilitychange||[])handler();
  assert.equal(chartInstances[1].destroyCalls,1,"an account-change preflight must destroy its chart before awaiting identity");assert.equal(elements.get("historySection").hidden,true);assert.equal(elements.get("performanceChartCanvas").rootCount,0);
  for(let index=0;index<4;index++)await new Promise(setImmediate);
  assert.equal(elements.get("chartExercise").innerHTML,"");assert.equal(elements.get("chartMetric").innerHTML,"");assert.equal(elements.get("chartTableBody").innerHTML,"");assert.equal(elements.get("historySection").hidden,true);
  assert.equal((windowListeners.pageshow||[]).length,1,"BFCache restoration must use the same private preflight boundary");
  console.log("Workout runtime smoke passed: exact chart comparison, in-place update, logging controls, and synchronous identity preflight teardown verified.");
})().catch((error)=>{console.error(error);process.exitCode=1;});
