"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");

const Chart=require("../public/scripts/discover-chart");

function workout(id,startedAt,date,maxWeight,volume=maxWeight*8){
  return{
    id,status:"completed",startedAt,date,
    exerciseSummaries:[{
      exerciseId:"press",measurement:"reps",loadType:"external",unit:"kg",
      completedSets:3,maxWeight,maxReps:8,totalReps:24,volume
    }]
  };
}

function chartHistory(){
  return[
    workout("later",200,"2026-09-08",65,520),
    workout("earlier",100,"2026-09-01",60,480)
  ];
}

function node(id){
  return{
    id,hidden:false,innerHTML:"",textContent:"",value:"",attributes:{},
    setAttribute(name,value){this.attributes[name]=String(value);},
    getAttribute(name){return this.attributes[name]??null;}
  };
}

function harness({library,reducedMotion=false}={}){
  const ids=[
    "trainingMemoryTrend","trainingMemoryTrendControls","trainingMemoryMovement","trainingMemoryMetric",
    "trainingMemoryChartFrame","trainingMemoryChart","trainingMemoryTrendStatus","trainingMemoryTrendScope",
    "trainingMemoryTrendEmpty","trainingMemoryTrendEmptyTitle","trainingMemoryTrendEmptyDetail",
    "trainingMemoryExact","trainingMemoryExactValues"
  ];
  const nodes=new Map(ids.map((id)=>[id,node(id)]));
  const canvas=node("canvas");
  nodes.get("trainingMemoryChart").querySelector=(selector)=>selector==="canvas"?canvas:null;
  const instances=[];
  class FakeParticleChart{
    constructor(host,options){
      this.host=host;this.options=options;this.updates=[];this.destroyCalls=0;this.resizeCalls=0;
      instances.push(this);
    }
    update(data,options){this.updates.push({data,options});}
    destroy(){this.destroyCalls+=1;}
    resize(){this.resizeCalls+=1;}
  }
  const state={progressChartKey:"",progressChartMetric:""};
  const controller=Chart.createProgressChart({
    element:(id)=>nodes.get(id)||null,state,
    exerciseName:(id)=>id==="press"?"Bench press":id,
    readableDate:(date)=>date,
    escapeHtml:(value)=>String(value).replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;"),
    library:library===undefined?{ParticleChart:FakeParticleChart}:library,
    reducedMotion:()=>reducedMotion
  });
  return{canvas,controller,instances,nodes,state};
}

test("progress chart constructs once, updates in place, and exposes exact accessible values",()=>{
  const view=harness();
  const first=view.controller.render({workouts:chartHistory(),historyAvailable:true});

  assert.equal(view.instances.length,1);
  assert.equal(first.entry.exerciseId,"press");
  assert.equal(first.metric.key,"maxWeight");
  assert.deepEqual(first.points.map((point)=>point.value),[60,65]);
  assert.deepEqual(view.instances[0].options.data.labels,["2026-09-01","2026-09-08"]);
  assert.deepEqual(view.instances[0].options.data.series[0].data,[60,65]);
  assert.equal(view.nodes.get("trainingMemoryChartFrame").hidden,false);
  assert.equal(view.nodes.get("trainingMemoryTrendEmpty").hidden,true);
  assert.match(view.nodes.get("trainingMemoryExactValues").innerHTML,/<caption>Heaviest completed set by completed session<\/caption>/);
  assert.match(view.nodes.get("trainingMemoryExactValues").innerHTML,/<th scope="col">Session<\/th>/);
  assert.match(view.nodes.get("trainingMemoryExactValues").innerHTML,/<th scope="row">2026-09-01<\/th><td>60 kg<\/td>/);
  assert.match(view.canvas.getAttribute("aria-label"),/Bench press: Heaviest completed set across 2 matching completed sessions/);
  assert.equal(view.canvas.getAttribute("aria-describedby"),"trainingMemoryTrendStatus");

  view.state.progressChartMetric="volume";
  const second=view.controller.render({workouts:chartHistory(),historyAvailable:true});
  assert.equal(view.instances.length,1,"rerendering must not create a second canvas controller");
  assert.equal(view.instances[0].updates.length,1);
  assert.equal(second.metric.key,"volume");
  assert.deepEqual(view.instances[0].updates[0].data.series[0].data,[480,520]);
  assert.equal(view.nodes.get("trainingMemoryMetric").value,"volume");
});

test("progress chart destroy, clear, and resize lifecycle remains safe and idempotent",()=>{
  const view=harness();
  view.controller.render({workouts:chartHistory(),historyAvailable:true});
  const instance=view.instances[0];

  view.controller.resize();
  assert.equal(instance.resizeCalls,1);
  view.controller.destroy();
  view.controller.destroy();
  assert.equal(instance.destroyCalls,1,"an already-destroyed chart must not be destroyed twice");
  assert.equal(view.nodes.get("trainingMemoryChart").innerHTML,"");

  view.controller.render({workouts:chartHistory(),historyAvailable:true});
  view.state.progressChartKey="private-format";
  view.state.progressChartMetric="private-measure";
  view.nodes.get("trainingMemoryExactValues").innerHTML="private workout value";
  view.controller.clear({wipe:true});
  assert.equal(view.instances[1].destroyCalls,1);
  assert.deepEqual({key:view.state.progressChartKey,metric:view.state.progressChartMetric},{key:"",metric:""});
  assert.equal(view.nodes.get("trainingMemoryExactValues").innerHTML,"");
  assert.equal(view.nodes.get("trainingMemoryTrend").hidden,true);
});

test("progress chart degrades to exact values when its library is missing or throws",()=>{
  class ThrowingParticleChart{constructor(){throw new Error("canvas unavailable");}}
  for(const library of [{},{ParticleChart:ThrowingParticleChart}]){
    const view=harness({library});
    assert.doesNotThrow(()=>view.controller.render({workouts:chartHistory(),historyAvailable:true}));
    assert.equal(view.nodes.get("trainingMemoryChartFrame").hidden,true);
    assert.equal(view.nodes.get("trainingMemoryTrendEmpty").hidden,false);
    assert.equal(view.nodes.get("trainingMemoryExact").hidden,false,"the non-canvas data table must remain available");
    assert.equal(view.nodes.get("trainingMemoryTrendEmptyTitle").textContent,"ANIMATED VIEW UNAVAILABLE.");
    assert.match(view.nodes.get("trainingMemoryExactValues").innerHTML,/60 kg/);
  }
});

test("progress chart theme is reduced-motion aware and deliberately performance bounded",()=>{
  assert.equal(Object.isFrozen(Chart.THEME),true);
  assert.equal(Chart.THEME.theme,"dark");
  assert.equal(Object.isFrozen(Chart.THEME.particle),true);
  assert.equal(Object.isFrozen(Chart.THEME.axis),true);
  assert.equal(Object.isFrozen(Chart.THEME.line),true);
  assert.equal(Chart.THEME.particle.color,"#9fce32");
  assert.equal(Chart.THEME.axis.textColor,"#b7bcae");
  assert.match(Chart.THEME.axis.fontFamily,/DM Mono/);
  assert.equal(Chart.THEME.showLegend,false);
  assert.equal(Chart.THEME.pauseWhenHidden,true);
  assert.ok(Chart.THEME.maxDpr<=1.5);
  assert.ok(Chart.THEME.particle.density<=5);
  assert.ok(Chart.THEME.particle.max<=10_000);
  assert.equal(Chart.THEME.particle.jitter,0);
  assert.equal(Chart.THEME.particle.sizeJitter,0);
  assert.equal(Chart.THEME.line.points,true);

  const metric={unit:"kg"};
  const standard=Chart.chartOptions(metric,false),reducedOptions=Chart.chartOptions(metric,true);
  assert.equal(standard.animate,true);
  assert.equal(standard.axis.yTitle,"kg");
  assert.equal(standard.axis.format(12.5),"12.5 kg");
  assert.equal(reducedOptions.animate,false);
  const reduced=harness({reducedMotion:true});
  reduced.controller.render({workouts:chartHistory(),historyAvailable:true});
  assert.equal(reduced.instances[0].options.animate,false);
});
