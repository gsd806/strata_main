"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const W=require("../public/scripts/workout-core");
const WorkoutChart=require("../public/scripts/workout-chart");

function summary(id,startedAt,date,maxWeight,{status="completed",unit="kg",loadType="external",measurement="reps",exerciseId="press",completedSets=1}={}){
  return{
    id,title:id,status,startedAt,date,completedSets,totalSets:1,
    exerciseSummaries:[{exerciseId,measurement,loadType,unit,completedSets,maxWeight,maxReps:8,totalReps:8,volume:loadType==="external"?maxWeight*8:0}]
  };
}

function element(id){
  return{id,hidden:false,value:"",innerHTML:"",textContent:"",attributes:{},setAttribute(name,value){this.attributes[name]=String(value);},getAttribute(name){return this.attributes[name]??null;}};
}

function harness({history,hasMore=false,reducedMotion=false,library}={}){
  const ids=["chartEmpty","chartControls","chartExercise","chartMetric","performanceChart","performanceChartFrame","performanceChartCanvas","chartBestValue","chartBestUnit","chartBestLabel","chartBaseline","chartStatus","chartData","chartTableCaption","chartTableMetric","chartTableBody","chartScope"];
  const elements=new Map(ids.map((id)=>[id,element(id)])),canvas=element("canvas"),instances=[];let measured=false;
  for(const id of ["chartControls","performanceChart","performanceChartFrame","chartBaseline","chartData"])elements.get(id).hidden=true;
  const host=elements.get("performanceChartCanvas");Object.defineProperty(host,"offsetWidth",{get(){measured=true;return 600;}});
  host.querySelector=(selector)=>selector==="canvas"?canvas:null;
  class FakeParticleChart{
    constructor(chartHost,options){this.host=chartHost;this.options=options;this.updates=[];this.destroyCalls=0;this.resizeCalls=0;this.measuredBeforeConstruct=measured;this.frameVisibleBeforeConstruct=!elements.get("performanceChartFrame").hidden;instances.push(this);}
    update(data,options){this.updates.push({data,options});}
    destroy(){this.destroyCalls+=1;}
    resize(){this.resizeCalls+=1;}
  }
  const state={history:history||[],hasMore},controller=WorkoutChart.create({
    $:(id)=>elements.get(id),state,workout:W,
    exercise:(id)=>({id,name:id==="press"?"Bench press":id}),
    formatLabel:(entry)=>`${entry.measurement} · ${entry.loadType} · ${entry.unit}`,
    esc:(value)=>String(value).replace(/[&<>'"]/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[character])),
    number:(value)=>String(Number(value)),
    library:library===undefined?{ParticleChart:FakeParticleChart}:library,
    reducedMotion:()=>reducedMotion
  });
  return{canvas,controller,elements,instances,state};
}

test("Workout History constructs one shared-theme particle chart for exact repeated sessions and updates it in place",()=>{
  const history=[
    summary("new",300,"2026-09-03",45),
    summary("wrong-unit",250,"2026-09-02",100,{unit:"lb"}),
    summary("active",400,"2026-09-04",999,{status:"active"}),
    summary("invalid-date",275,"2026-02-30",500),
    summary("invalid-time",0,"2026-09-02",600),
    summary("nonfinite-time",Number.NaN,"2026-09-02",700),
    summary("bad-measurement",280,"2026-09-02",800,{measurement:"distance"}),
    summary("bad-load",285,"2026-09-02",810,{loadType:"machine"}),
    summary("bad-unit",290,"2026-09-02",820,{unit:"stone"}),
    summary("missing-exercise",295,"2026-09-02",830,{exerciseId:" "}),
    summary("bad-count",297,"2026-09-02",840,{completedSets:Number.NaN}),
    summary("old",100,"2026-09-01",40)
  ],view=harness({history,hasMore:true}),result=view.controller.renderControls();

  assert.equal(view.instances.length,1);
  assert.equal(view.controller.entries().length,2,"unsupported formats and malformed points must not create chart choices");
  assert.equal(result.item.key,W.formatKey(history[0].exerciseSummaries[0]));
  assert.deepEqual(result.points.map(({id,date,value})=>({id,date,value})),[{id:"old",date:"2026-09-01",value:40},{id:"new",date:"2026-09-03",value:45}]);
  assert.deepEqual(view.instances[0].options.data.labels,["2026-09-01","2026-09-03"]);
  assert.deepEqual(view.instances[0].options.data.series[0].data,[40,45]);
  assert.equal(view.instances[0].options.particle.max,8000,"Workout History must consume the bounded shared chart options");
  assert.equal(view.instances[0].options.particle.density,4);
  assert.equal(view.instances[0].options.pauseWhenHidden,true);
  assert.equal(view.instances[0].measuredBeforeConstruct,true,"the visible chart host must be measured before Particle Charts initializes");
  assert.equal(view.instances[0].frameVisibleBeforeConstruct,true);
  assert.equal(view.elements.get("chartBestValue").textContent,"45");
  assert.equal(view.elements.get("chartBestUnit").textContent,"kg");
  assert.match(view.elements.get("chartScope").textContent,/2 exact matching completed sessions in 12 loaded sessions; load more/);
  assert.match(view.elements.get("chartTableBody").innerHTML,/<th scope="row">2026-09-01<\/th><td>40 kg<\/td>/);
  assert.doesNotMatch(view.elements.get("chartTableBody").innerHTML,/2026-02-30|500|600|700|800|810|820|830|840/);
  assert.match(view.canvas.getAttribute("aria-label"),/Bench press: Heaviest completed set across 2 exact matching completed sessions/);
  assert.equal(view.canvas.getAttribute("aria-describedby"),"chartStatus chartScope");

  view.elements.get("chartMetric").value="volume";
  const updated=view.controller.render();
  assert.equal(view.instances.length,1,"metric changes must not append another chart root");
  assert.equal(view.instances[0].updates.length,1);
  assert.equal(updated.metric.key,"volume");
  assert.deepEqual(view.instances[0].updates[0].data.series[0].data,[320,360]);
});

test("Workout History keeps one point as an exact baseline without constructing a particle chart",()=>{
  const view=harness({history:[summary("baseline",100,"2026-09-01",40)]}),result=view.controller.renderControls();

  assert.equal(result.points.length,1);assert.equal(result.chart,null);assert.equal(view.instances.length,0);
  assert.equal(view.elements.get("performanceChart").hidden,false);
  assert.equal(view.elements.get("performanceChartFrame").hidden,true);
  assert.equal(view.elements.get("chartBaseline").hidden,false);
  assert.match(view.elements.get("chartBaseline").textContent,/Baseline recorded/);
  assert.equal(view.elements.get("chartData").hidden,false);
  assert.match(view.elements.get("chartTableBody").innerHTML,/40 kg/);
});

test("Workout History preserves exact values when the particle library is unavailable",()=>{
  const view=harness({history:[summary("old",100,"2026-09-01",40),summary("new",200,"2026-09-02",45)],library:{}});
  assert.doesNotThrow(()=>view.controller.renderControls());
  assert.equal(view.elements.get("performanceChartFrame").hidden,true);
  assert.equal(view.elements.get("chartData").hidden,false);
  assert.match(view.elements.get("chartStatus").textContent,/Animated comparison unavailable/);
  assert.match(view.elements.get("chartTableBody").innerHTML,/40 kg/);
});

test("Workout History preserves exact values when Particle Charts throws during construction",()=>{
  class ThrowingParticleChart{constructor(){throw new Error("canvas unavailable");}}
  const view=harness({history:[summary("old",100,"2026-09-01",40),summary("new",200,"2026-09-02",45)],library:{ParticleChart:ThrowingParticleChart}});
  assert.doesNotThrow(()=>view.controller.renderControls());
  assert.equal(view.elements.get("performanceChartFrame").hidden,true);
  assert.match(view.elements.get("chartStatus").textContent,/Animated comparison unavailable/);
  assert.match(view.elements.get("chartTableBody").innerHTML,/40 kg/);
});

test("Workout History clear synchronously destroys once and purges private chart DOM and controls",()=>{
  const view=harness({history:[summary("old",100,"2026-09-01",40),summary("new",200,"2026-09-02",45)]});
  view.controller.renderControls();const instance=view.instances[0];view.controller.resize();assert.equal(instance.resizeCalls,1);view.elements.get("chartData").open=true;

  view.controller.clear();view.controller.clear();
  assert.equal(instance.destroyCalls,1,"clearing an already-destroyed chart must stay idempotent");
  for(const id of ["chartExercise","chartMetric"]){assert.equal(view.elements.get(id).innerHTML,"");assert.equal(view.elements.get(id).value,"");}
  for(const id of ["chartBestValue","chartBestUnit","chartBestLabel","chartStatus","chartTableCaption","chartTableMetric","chartScope"])assert.equal(view.elements.get(id).textContent,"",id);
  assert.equal(view.elements.get("chartTableBody").innerHTML,"");
  assert.equal(view.elements.get("performanceChartCanvas").innerHTML,"");
  assert.equal(view.elements.get("performanceChart").hidden,true);
  assert.equal(view.elements.get("chartControls").hidden,true);
  assert.equal(view.elements.get("chartData").open,false);
});

test("Workout History honors reduced motion and exposes a truthful no-history state",()=>{
  const reduced=harness({history:[summary("old",100,"2026-09-01",40),summary("new",200,"2026-09-02",45)],reducedMotion:true});
  reduced.controller.renderControls();assert.equal(reduced.instances[0].options.animate,false);

  const empty=harness({history:[]});assert.equal(empty.controller.renderControls(),null);
  assert.equal(empty.elements.get("chartEmpty").hidden,false);assert.equal(empty.elements.get("chartControls").hidden,true);
  assert.match(empty.elements.get("chartEmpty").textContent,/Complete a session/);
  assert.match(empty.elements.get("chartScope").textContent,/Only completed sets/);
});
