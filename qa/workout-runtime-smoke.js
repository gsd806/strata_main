"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const ROOT=join(__dirname,"..");
const read=(...parts)=>fs.readFileSync(join(ROOT,"public",...parts),"utf8");
const html=read("pages","workout.html"),source=read("scripts","workout.js"),catalog=JSON.parse(read("data","exercises.json"));
const Workout=require(join(ROOT,"public/scripts/workout-core")),Discovery=require(join(ROOT,"public/scripts/discovery-core"));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);

class Element{
  constructor(id){this.id=id;this.value="";this.textContent="";this.innerHTML="";this.hidden=false;this.disabled=false;this.checked=id==="autoRest";this.dataset={};this.style={};this.attributes={};this.listeners={};this.classList={add(){},remove(){}};}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  querySelector(){return null;}
  querySelectorAll(){return[];}
  focus(){}
  scrollIntoView(){}
  showModal(){this.open=true;}
  close(){this.open=false;for(const handler of this.listeners.close||[])handler();}
}

const elements=new Map(ids.map((id)=>[id,new Element(id)]));
elements.get("restDuration").value="90";
const first=catalog.find((item)=>item.equipment==="Barbell / Smith"&&!/seconds|sec|min/i.test(item.reps));
const second=catalog.find((item)=>item.id!==first.id&&item.equipment!=="Bodyweight"&&!/seconds|sec|min/i.test(item.reps));
const plan={version:1,restDay:"Sunday",restDays:["Sunday"],days:Object.fromEntries(Workout.DAYS.map((day)=>[day,day==="Monday"?[{instanceId:"runtime-first",exerciseId:first.id,sets:2,reps:"8–12"},{instanceId:"runtime-second",exerciseId:second.id,sets:1,reps:"8–12"}]:[]]))};
const past=Workout.createWorkout(plan,"Monday",catalog,1_700_000_000_000);past.id="runtime-history";past.date="2026-08-31";past.status="completed";past.completedAt=past.startedAt+1000;past.elapsedSeconds=1;past.entries[0].sets[0]={reps:10,weight:42.5,seconds:null,completed:true,effort:null};
const history=[Workout.summary(past)];
const storage=new Map();
const document={visibilityState:"visible",getElementById:(id)=>elements.get(id)||null,addEventListener(){}};
const location={search:"?day=Monday",hash:"",href:"http://strata.test/workout.html?day=Monday",reload(){}};
const context={
  console,document,location,history:{replaceState(){}},URL,URLSearchParams,AbortController,Blob,
  globalThis:null,StrataWorkout:Workout,StrataDiscovery:Discovery,
  crypto:{randomUUID:()=>`runtime-${Math.random().toString(16).slice(2)}`},
  localStorage:{get length(){return storage.size;},key:(index)=>[...storage.keys()][index]||null,getItem:(key)=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,value),removeItem:(key)=>storage.delete(key)},
  fetch:async(path)=>{
    if(path==="/api/me")return{ok:true,status:200,json:async()=>({user:{id:"runtime-user",name:"Runtime",discovery:{active:true}},csrfToken:"runtime-csrf"})};
    if(path==="/exercises.json")return{ok:true,status:200,json:async()=>catalog};
    if(path==="/api/plan")return{ok:true,status:200,json:async()=>({plan,planUpdatedAt:100,user:{id:"runtime-user"},csrfToken:"runtime-csrf"})};
    if(String(path).startsWith("/api/workouts?"))return{ok:true,status:200,json:async()=>({workouts:history,hasMore:false,csrfToken:"runtime-csrf"})};
    throw new Error(`Unexpected runtime request: ${path}`);
  },
  window:{addEventListener(){},matchMedia:()=>({matches:true})},
  setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,confirm:()=>true
};
context.globalThis=context;context.window.document=document;context.window.location=location;
vm.createContext(context);vm.runInContext(source,context,{filename:"workout.js"});

(async()=>{
  for(let index=0;index<8&&!elements.get("trainingRoom").hidden;index++)await new Promise(setImmediate);
  await new Promise(setImmediate);
  assert.match(elements.get("planPreview").innerHTML,/runtime-first|Setup, cues/);
  const startHandlers=elements.get("startWorkout").listeners.click||[];assert.equal(startHandlers.length,1);
  startHandlers[0]();
  const markup=elements.get("sessionEntries").innerHTML;
  assert.match(markup,/Training memory and suggested target/);
  assert.match(markup,/data-use-last/);assert.match(markup,/data-apply-target/);
  assert.match(markup,/data-add-set/);assert.match(markup,/data-duplicate-set/);assert.match(markup,/data-remove-set/);
  assert.match(markup,/data-entry-note/);assert.match(markup,/Effort \(optional\)/);
  assert.match(markup,/Advanced · warm-ups &amp; plates/);assert.match(markup,/data-calc-warmup/);assert.match(markup,/data-calc-plates/);
  assert.match(markup,/data-toggle-superset/);assert.match(markup,/data-open-swap/);
  assert.match(html,/No workout or Plan changes until/);assert.match(html,/Approve Plan &amp; workout change/);
  console.log("Workout Memory runtime smoke passed: explicit memory, logging, calculator, superset, and replacement controls rendered.");
})().catch((error)=>{console.error(error);process.exitCode=1;});
