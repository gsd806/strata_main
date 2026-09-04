"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const BUILD=require(join(PROJECT_ROOT,"package.json")).version;
const CATALOG_URL=`/exercises.json?v=${BUILD}`;
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const html=readPublic("pages","planner.html");
const exercises=JSON.parse(readPublic("data","exercises.json"));
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
}

let focusedSelector="";
class Element{
  constructor(id){
    this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.disabled=false;
    this.dataset={};this.attributes={};this.listeners={};this.classList=new ClassList();this.parentElement={classList:new ClassList()};
  }
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  querySelector(selector){
    if(this.id!=="libraryList")return null;
    return {focus(){focusedSelector=selector;}};
  }
}

const elements=new Map(ids.map((id)=>[id,new Element(id)]));
const documentListeners={};
const document={
  getElementById(id){return elements.get(id)||null;},
  addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);},
  querySelector(){return null;},
  querySelectorAll(){return [];}
};

const plan={version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map((day)=>[day,[]]))};
const fetches=[];
const windowListeners={};
const context={
  console,document,history:{replaceState(){}},location:{search:"",href:"http://strata.test/planner.html",origin:"http://strata.test",assign(){}},
  window:{
    location:{replace(){}},
    matchMedia:()=>({matches:false}),
    addEventListener(type,handler){(windowListeners[type]||=[]).push(handler);}
  },
  fetch:async(path)=>{
    fetches.push(path);
    if(path===CATALOG_URL)return {ok:true,json:async()=>exercises};
    if(path==="/api/plan")return {ok:true,json:async()=>({plan,user:{id:"u1",name:"Planner Audit",email:"audit@example.test"}})};
    return {ok:false,status:404,json:async()=>({error:"Not found"})};
  },
  requestAnimationFrame:(callback)=>callback(),setTimeout,clearTimeout,URL,URLSearchParams
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(readPublic("scripts","planner.js"),context,{filename:"planner.js"});

function renderedIds(){
  return [...elements.get("libraryList").innerHTML.matchAll(/data-library-id="([^"]+)"/g)].map((match)=>match[1]);
}

function clickLoadMore(){
  const target={
    closest(selector){return selector==="[data-load-more-library]"?{dataset:{}}:null;}
  };
  const event={target,defaultPrevented:false,button:0,metaKey:false,ctrlKey:false,shiftKey:false,altKey:false};
  for(const handler of documentListeners.click||[])handler(event);
}

(async()=>{
  await new Promise(setImmediate);

  const initialIds=renderedIds();
  const initialMarkup=elements.get("libraryList").innerHTML;
  assert.equal(initialIds.length,32,"Desktop planner should initially render 32 library cards");
  assert.equal(new Set(initialIds).size,32,"Initial planner page must not contain duplicate cards");
  assert.match(initialMarkup,/data-load-more-library/,"Expanded catalog should expose Load more");
  assert.match(initialMarkup,/Load 32 more/,"Desktop Load more should reveal the next 32 cards");

  clickLoadMore();

  const expandedIds=renderedIds();
  const result={
    catalogFetch:fetches.filter((path)=>path===CATALOG_URL).length===1,
    planFetch:fetches.filter((path)=>path==="/api/plan").length===1,
    initialCards:initialIds.length,
    initialLoadMore:true,
    expandedCards:expandedIds.length,
    uniqueExpandedCards:new Set(expandedIds).size,
    firstPagePreserved:initialIds.every((id,index)=>expandedIds[index]===id),
    loadMoreStillAvailable:/data-load-more-library/.test(elements.get("libraryList").innerHTML),
    focusedFirstNewCard:focusedSelector==='[data-library-index="32"] [data-quick-add]',
    resultStatus:elements.get("libraryResultStatus").textContent
  };

  assert.equal(result.catalogFetch,true);
  assert.equal(result.planFetch,true);
  assert.equal(result.expandedCards,64,"One desktop Load more action should render 64 cards total");
  assert.equal(result.uniqueExpandedCards,64,"Load more must not duplicate library cards");
  assert.equal(result.firstPagePreserved,true,"Load more should preserve the original first page order");
  assert.equal(result.loadMoreStillAvailable,true,"A 200-item library should have more results after 64 cards");
  assert.equal(result.focusedFirstNewCard,true,"Focus should move to the first newly revealed card");
  assert.match(result.resultStatus,/Showing 64 of 200 matching movements\./);
  console.log(JSON.stringify(result,null,2));
})().catch((error)=>{console.error(error);process.exitCode=1;});
