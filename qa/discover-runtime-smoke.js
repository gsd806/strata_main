"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const readPrivateData=(name)=>fs.readFileSync(join(PROJECT_ROOT,"src","data",name),"utf8");
const exercises=JSON.parse(readPublic("data","exercises.json"));
const discovery=JSON.parse(readPrivateData("discovery-data.json"));

const html=readPublic("pages","discover.html");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
  contains(name){return this.values.has(name);}
}
class Element{
  constructor(id){this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.open=false;this.dataset={};this.classList=new ClassList();this.parentElement={classList:new ClassList()};this.listeners={};}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  showModal(){this.open=true;}
  close(){this.open=false;}
  scrollIntoView(){}
  append(){}
  querySelector(){return new Element("child");}
  closest(){return null;}
  get selectedOptions(){const labels={hypertrophy:"Hypertrophy selection",strength:"Strength skill",balanced:"Balanced","time-efficient":"Time-efficient setup"};return [{textContent:labels[this.value]||this.value}];}
}
const elements=new Map(ids.map((id)=>[id,new Element(id)]));
const document={
  body:new Element("body"),
  getElementById(id){return elements.get(id)||null;},
  querySelector(){return null;},
  querySelectorAll(selector){if(selector==="dialog")return [elements.get("detailDialog")];return [];},
  addEventListener(){},
  createElement(){return new Element("created");}
};
const response={user:{id:"u1",name:"Runtime Audit",email:"audit@example.test"},csrfToken:"csrf",exercises,methodology:discovery.methodology,sources:discovery.sources,limitedConfidenceExercises:discovery.limitedConfidenceExercises,preferences:{version:1,goal:"hypertrophy",level:"Intermediate",days:4,equipment:[...new Set(exercises.map((exercise)=>exercise.equipment))],preferences:["stable","long-range"],limitations:[]},ratings:{aggregates:[],user:[]}};
const fetches=[];
const context={console,document,window:{location:{replace(){}}},location:{},navigator:{},fetch:async(path)=>{fetches.push(path);return {ok:true,json:async()=>response};},setTimeout,clearTimeout,URL,File:globalThis.File,FormData:class{},globalThis:null};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(readPublic("scripts","discovery-core.js"),context,{filename:"discovery-core.js"});
vm.runInContext(readPublic("scripts","discover.js"),context,{filename:"discover.js"});

(async()=>{
  await new Promise(setImmediate);
  vm.runInContext(`
    globalThis.featureAudit={defaultFeature:state.activeFeature,defaultVisible:!el("recommendations").hidden,defaultHidden:Object.keys(FEATURE_CONFIG).filter((name)=>featurePanel(name).hidden).length};
    activateFeature("explorer");
    featureAudit.explorerFeature=state.activeFeature;featureAudit.explorerVisible=!el("exerciseExplorer").hidden;featureAudit.explorerHidden=Object.keys(FEATURE_CONFIG).filter((name)=>featurePanel(name).hidden).length;
    activateFeature("recommendations");
    state.compare=["flat-dumbbell-press","machine-chest-press","cable-fly"];
    renderCompareTray();
    openComparison();
    openDetail("flat-dumbbell-press");
    globalThis.audit={recommendations:state.recommendations.length,results:discoveryResults().length,renderedResults:(el("exerciseGrid").innerHTML.match(/class="exercise-card"/g)||[]).length,hasLoadMore:/data-load-more-exercises/.test(el("exerciseGrid").innerHTML),compareCount:state.compare.length};
  `,context);
  const result={
    ...context.audit,
    ...context.featureAudit,
    discoveryFetch:fetches.filter((path)=>path==="/api/discovery").length===1,
    battleBuilder:/Flat Dumbbell Press/.test(elements.get("battleSelects").innerHTML),
    battleSlots:(elements.get("battleSelects").innerHTML.match(/data-battle-slot=/g)||[]).length,
    battleTable:/Official FitScore/.test(elements.get("battleResults").innerHTML),
    battleRows:(elements.get("battleResults").innerHTML.match(/<tr>/g)||[]).length,
    battleVisible:!elements.get("battleResults").hidden,
    battleStatus:/Compared 3 exercises/.test(elements.get("battleStatus").textContent),
    detailOpen:elements.get("detailDialog").open,
    bodyLocked:document.body.classList.contains("dialog-open"),
    scoreAudit:/Weighted baseline/.test(elements.get("detailContent").innerHTML),
    evidence:/Does not support/.test(elements.get("detailContent").innerHTML),
    alternatives:/Find an alternative/.test(elements.get("detailContent").innerHTML),
    ratings:/Community score/.test(elements.get("detailContent").innerHTML)
  };
  assert.equal(result.recommendations,8);
  assert.equal(result.results,exercises.length);
  assert.equal(result.renderedResults,Math.min(24,result.results));
  assert.equal(result.hasLoadMore,result.results>24);
  assert.equal(result.compareCount,3);
  assert.equal(result.defaultFeature,"recommendations");
  assert.equal(result.defaultVisible,true);
  assert.equal(result.defaultHidden,4);
  assert.equal(result.explorerFeature,"explorer");
  assert.equal(result.explorerVisible,true);
  assert.equal(result.explorerHidden,4);
  assert.equal(result.battleSlots,4);
  assert.ok(result.battleRows>=10);
  for(const key of ["discoveryFetch","battleBuilder","battleTable","battleVisible","battleStatus","detailOpen","bodyLocked","scoreAudit","evidence","alternatives","ratings"])assert.equal(result[key],true,key);
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
