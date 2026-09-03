"use strict";

const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const BUILD=require(join(PROJECT_ROOT,"package.json")).version;
const CATALOG_URL=`/exercises.json?v=${BUILD}`;
const readPublic=(...parts)=>fs.readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const html=readPublic("pages","index.html");
const catalog=JSON.parse(readPublic("data","exercises.json"));
const appSource=readPublic("scripts","app.js");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  toggle(name,force){const enabled=force===undefined?!this.values.has(name):Boolean(force);if(enabled)this.values.add(name);else this.values.delete(name);return enabled;}
  contains(name){return this.values.has(name);}
}
class Element{
  constructor(id){this.id=id;this.value="";this.innerHTML="";this.textContent="";this.hidden=false;this.open=false;this.disabled=false;this.dataset={};this.attributes={};this.classList=new ClassList();this.listeners={};this.parentElement={classList:new ClassList()};}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  getAttribute(name){return this.attributes[name]??null;}
  showModal(){this.open=true;}
  close(){this.open=false;}
  querySelector(){return null;}
  getBoundingClientRect(){return {left:0,right:1000,top:0,bottom:1000};}
}
const elements=new Map(ids.map((id)=>[id,new Element(id)])),documentListeners={};
const document={
  getElementById(id){return elements.get(id)||null;},
  addEventListener(type,handler){(documentListeners[type]||=[]).push(handler);},
  querySelectorAll(){return [];}
};
const navigations=[];
const fetches=[];
const context={
  console,document,location:{search:""},history:{replaceState(){}},requestAnimationFrame:(callback)=>callback(),setTimeout,clearTimeout,URLSearchParams,
  window:{location:{assign:(path)=>navigations.push(path)}},
  FormData:class{constructor(form){this.values=form.values||{};}get(key){return this.values[key]||null;}},
  fetch:async(path)=>{
    fetches.push(path);
    if(path==="/api/me")return {ok:true,json:async()=>({user:{id:"u1",name:"Account Audit",email:"audit@example.test",planCount:2,workoutDays:1}})};
    if(path===CATALOG_URL)return {ok:true,json:async()=>catalog};
    return {ok:false,json:async()=>({error:"Not found"})};
  }
};
context.globalThis=context;
vm.createContext(context);
vm.runInContext(appSource,context,{filename:"app.js"});

(async()=>{
  await new Promise(setImmediate);
  const result={
    accountFetch:fetches.filter((path)=>path==="/api/me").length===1,
    catalogFetch:fetches.filter((path)=>path===CATALOG_URL).length===1,
    canonicalCatalogRendered:elements.get("exerciseList").innerHTML.includes("Incline Smith Press"),
    signupIsNativeLink:/id="signupButton" href="\/account\.html\?mode=signup"/.test(html),
    loginIsNativeLink:/id="accountButton" href="\/account\.html\?mode=login"/.test(html),
    noModalDependency:!html.includes('id="authDialog"'),
    signedInProfileLabel:elements.get("accountButton").textContent==="Account profile",
    signedInProfileLink:elements.get("accountButton").href==="/account.html",
    signupHiddenWhenSignedIn:elements.get("signupButton").hidden===true,
    plannerLinkWhenSignedIn:elements.get("planButton").href==="/planner.html",
    planCountUpdated:elements.get("planCount").textContent===2,
    noBrowserTokenDependency:!appSource.includes("csrfToken")
  };
  for(const [key,value] of Object.entries(result))assert.equal(value,true,key);
  console.log(JSON.stringify(result,null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
