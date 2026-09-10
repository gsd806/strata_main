"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");
const Charts=require("../public/scripts/planner-charts");

function harness({reducedMotion=false,library}={}){
  const instances=[],host={hidden:true,innerHTML:"",replaceChildren(){this.innerHTML="";}},shell={hidden:true};
  class FakeChart{
    constructor(element,options){assert.equal(element.hidden,false,"the host must be measurable before chart construction");assert.equal(shell.hidden,false,"the frame must be visible before chart construction");this.element=element;this.options=options;this.updates=[];this.destroyCalls=0;instances.push(this);}
    update(data,options){this.updates.push({data,options});}
    destroy(){this.destroyCalls+=1;}
    resize(){this.resizeCalls=(this.resizeCalls||0)+1;}
  }
  const controller=Charts.createMuscleChart({host,shell,library:library===undefined?{ParticleChart:FakeChart}:library,reducedMotion:()=>reducedMotion});
  return{controller,host,instances,shell};
}

test("planner muscle chart preserves exact PlanInsights set counts and caps the visual at eight groups",()=>{
  const entries=Array.from({length:10},(_,index)=>({label:`Muscle ${index+1}`,sets:index+1,days:["Monday"]})),before=structuredClone(entries);
  const view=harness(),result=view.controller.render(entries);
  assert.deepEqual(entries,before,"rendering must not mutate PlanInsights analysis");
  assert.equal(result.muscles.length,Charts.MAX_MUSCLES);
  assert.deepEqual(result.data.labels,entries.slice(0,8).map(({label})=>label));
  assert.deepEqual(result.data.series[0].data,[1,2,3,4,5,6,7,8]);
  assert.equal(view.instances.length,1);
  assert.equal(view.host.hidden,false);
  assert.equal(view.shell.hidden,false);
  assert.equal(view.instances[0].options.type,"bar");
  assert.equal(view.instances[0].options.bar.horizontal,true);
  assert.equal(view.instances[0].options.theme,"dark");
  assert.equal(view.instances[0].options.particle.color,"#9fce32");
  assert.equal(view.instances[0].options.particle.density,4);
  assert.equal(view.instances[0].options.particle.max,8000);
  assert.equal(view.instances[0].options.particle.jitter,0);
  assert.equal(view.instances[0].options.axis.format(3),"3 sets");
});

test("planner muscle chart updates one instance, destroys on empty state, and honors reduced motion",()=>{
  const view=harness({reducedMotion:true});
  view.controller.render([{label:"Chest",sets:6}]);
  const instance=view.instances[0];
  assert.equal(instance.options.animate,false);
  view.controller.render([{label:"Back",sets:9}]);
  assert.equal(view.instances.length,1,"plan edits must update rather than duplicate the chart");
  assert.deepEqual(instance.updates[0].data.labels,["Back"]);
  assert.equal(view.controller.resize(),true);
  assert.equal(instance.resizeCalls,1);
  const empty=view.controller.render([]);
  assert.equal(empty.rendered,false);
  assert.equal(instance.destroyCalls,1);
  assert.equal(view.host.hidden,true);
  assert.equal(view.shell.hidden,true);
  view.controller.destroy();
  assert.equal(instance.destroyCalls,1,"destroy remains idempotent after the empty state");
});

test("planner chart is a privacy-preserving optional enhancement over exact DOM rows",()=>{
  const missing=harness({library:{}}),result=missing.controller.render([{label:"Core",sets:4}]);
  assert.equal(result.rendered,false);
  assert.equal(missing.shell.hidden,true);
  const root=join(__dirname,"..");
  const source=readFileSync(join(root,"public","scripts","planner-charts.js"),"utf8");
  const html=readFileSync(join(root,"public","pages","planner.html"),"utf8");
  assert.doesNotMatch(source,/\b(?:fetch|localStorage|sessionStorage|indexedDB)\b|document\.cookie/);
  assert.doesNotMatch(source,/\b(?:userId|accountId|email)\b/i);
  assert.match(html,/id="plannerMuscleChartShell" aria-hidden="true" hidden/);
  assert.match(html,/id="insightMuscles"/,"the exact text distribution must remain present outside the visual-only chart");
});
