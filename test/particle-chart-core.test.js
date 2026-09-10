"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const Core=require("../public/scripts/particle-chart-core");

function host(){return{clears:0,innerHTML:"stale",replaceChildren(){this.clears+=1;this.innerHTML="";}};}

test("shared chart options pin effective nested STRATA theme and performance limits",()=>{
  const standard=Core.options({unit:"sets",type:"bar",theme:"light",horizontal:true});
  assert.deepEqual(standard.particle,{color:"#9fce32",size:.85,sizeJitter:0,density:4,max:8000,bloom:.24,opacity:.78,jitter:0,speed:.085});
  assert.equal(standard.axis.color,"rgba(16,17,15,.32)");
  assert.equal(standard.axis.gridColor,"rgba(16,17,15,.1)");
  assert.equal(standard.axis.textColor,"#60635d");
  assert.equal(standard.axis.crosshairColor,"rgba(200,56,26,.38)");
  assert.match(standard.axis.fontFamily,/DM Mono/);
  assert.equal(standard.axis.fontSize,11);
  assert.equal(standard.axis.ticks,4);
  assert.equal(standard.axis.beginAtZero,true);
  assert.equal(standard.axis.format(12),"12 sets");
  assert.deepEqual(standard.line,{curve:"smooth",width:3,points:true});
  assert.equal(standard.showPoints,true,"the upstream compatibility alias must agree with nested line.points");
  assert.equal(standard.bar.horizontal,true);
  assert.equal(standard.maxDpr,1.5);
  assert.equal(standard.pauseWhenHidden,true);
  assert.equal(standard.animate,true);
  const reduced=Core.options({reducedMotion:true});
  assert.equal(reduced.animate,false);
  assert.equal(reduced.duration,0);
  assert.equal(reduced.stagger,0);
  assert.equal(reduced.particle.speed,0);
});

test("shared chart lifecycle creates once, updates in place, and clears safely",()=>{
  const instances=[];
  class FakeChart{
    constructor(element,config){this.element=element;this.config=config;this.updates=[];this.destroyed=0;instances.push(this);}
    update(data,options){this.updates.push({data,options});}
    destroy(){this.destroyed+=1;}
    resize(){this.resized=true;}
  }
  const element=host(),options=Core.options(),firstData={labels:["A"],series:[{data:[1]}]};
  let chart=Core.upsert(null,element,firstData,options,{ParticleChart:FakeChart});
  assert.equal(instances.length,1);
  assert.equal(instances[0].config.data,firstData);
  const nextData={labels:["A"],series:[{data:[2]}]};
  chart=Core.upsert(chart,element,nextData,options,{ParticleChart:FakeChart});
  assert.equal(chart,instances[0]);
  assert.equal(instances.length,1,"an update must not append another chart instance");
  assert.deepEqual(chart.updates,[{data:nextData,options}]);
  assert.equal(Core.resize(chart),true);
  assert.equal(chart.resized,true);
  chart=Core.destroy(chart,element);
  assert.equal(chart,null);
  assert.equal(instances[0].destroyed,1);
  assert.equal(element.innerHTML,"");
});

test("shared chart lifecycle degrades without throwing when canvas or the library fails",()=>{
  const element=host();
  class ThrowingChart{constructor(){throw new Error("canvas unavailable");}}
  assert.equal(Core.upsert(null,element,{labels:[],series:[]},Core.options(),{}),null);
  assert.equal(Core.upsert(null,element,{labels:["A"],series:[{data:[1]}]},Core.options(),{ParticleChart:ThrowingChart}),null);
  assert.equal(Core.resize({resize(){throw new Error("detached");}}),false);
});
