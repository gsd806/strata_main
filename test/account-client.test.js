"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const vm=require("node:vm");

const html=fs.readFileSync(require.resolve("../public/pages/account.html"),"utf8");
const script=fs.readFileSync(require.resolve("../public/scripts/account.js"),"utf8");

class ClassList{
  constructor(){this.values=new Set();}
  add(...names){names.forEach((name)=>this.values.add(name));}
  remove(...names){names.forEach((name)=>this.values.delete(name));}
  contains(name){return this.values.has(name);}
}

class Element{
  constructor(id){
    this.id=id;this.value="";this.textContent="";this.hidden=false;this.disabled=false;
    this.dataset={};this.attributes={};this.listeners={};this.classList=new ClassList();this.values={};this.focused=false;
  }
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  async emit(type,event={}){for(const handler of this.listeners[type]||[])await handler(event);}
  setAttribute(name,value){this.attributes[name]=String(value);}
  removeAttribute(name){delete this.attributes[name];}
  getAttribute(name){return this.attributes[name]??null;}
  focus(){this.focused=true;}
  scrollIntoView(){this.scrolled=true;}
  prepend(node){this.prepended=node;}
  querySelector(selector){return selector==="span"?this.statusText:null;}
}

function jsonResponse(status,data){
  return {ok:status>=200&&status<300,status,headers:{get:(name)=>name.toLowerCase()==="content-type"?"application/json; charset=utf-8":null},json:async()=>data};
}

function createPage({search="",route}){
  const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map((match)=>match[1]);
  const elements=new Map(ids.map((id)=>[id,new Element(id)]));
  elements.get("accountLoading").hidden=true;
  elements.get("signedInCard").hidden=true;
  elements.get("signupMessage").hidden=true;
  elements.get("loginMessage").hidden=true;
  elements.get("storageState").statusText=new Element("storageText");
  const authGrid=new Element("authGrid"),navigations=[],requests=[],replaced=[];
  const location={search,href:`http://strata.test/account.html${search}`,assign:(path)=>navigations.push(path),replace:(path)=>navigations.push(path)};
  const document={
    getElementById:(id)=>elements.get(id)||null,
    querySelector:(selector)=>selector===".auth-grid"?authGrid:null
  };
  class FakeFormData{
    constructor(form){this.values=form.values;}
    get(name){return this.values[name]??null;}
  }
  const context={
    console,document,location,URL,URLSearchParams,FormData:FakeFormData,
    history:{replaceState:(...args)=>replaced.push(args)},
    requestAnimationFrame:(callback)=>callback(),matchMedia:()=>({matches:false}),
    fetch:async(path,options={})=>{requests.push({path,options});return route(path,options,requests);}
  };
  context.globalThis=context;
  vm.createContext(context);
  vm.runInContext(script,context,{filename:"account.js"});
  return {elements,requests,navigations,replaced};
}

async function settle(){
  for(let count=0;count<5;count+=1)await new Promise(setImmediate);
}

test("native forms remain available without the JavaScript enhancement",()=>{
  assert.match(html,/<form id="signupForm" action="\/auth\/signup" method="post"/);
  assert.match(html,/<form id="loginForm" action="\/auth\/login" method="post"/);
  assert.match(html,/<section class="account-access" id="accountAccess"[^>]*>/);
  assert.doesNotMatch(html,/<section class="account-access" id="accountAccess"[^>]*hidden/);
  assert.doesNotMatch(html,/accountRetry/);
  assert.doesNotMatch(script,/accountRetry/);
});

test("explicit account modes bring the requested form into view on every viewport",async()=>{
  for(const mode of ["signup","login"]){
    const page=createPage({
      search:`?mode=${mode}`,
      route:async(path)=>{
        if(path==="/api/status")return jsonResponse(200,{persistent:true});
        if(path==="/healthz")return jsonResponse(200,{ok:true});
        if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
        throw new Error(`Unexpected route ${path}`);
      }
    });
    await settle();
    assert.equal(page.elements.get(`${mode}Panel`).scrolled,true,`${mode} panel should scroll into view`);
    assert.equal(page.elements.get(`${mode}Title`).focused,true,`${mode} title should receive focus`);
  }
});

test("login accepts existing password lengths while new passwords keep the stronger minimum",()=>{
  const signupPassword=html.match(/<input\b[^>]*id="signupPassword"[^>]*>/)?.[0]||"";
  const loginPassword=html.match(/<input\b[^>]*id="loginPassword"[^>]*>/)?.[0]||"";
  assert.match(signupPassword,/minlength="10"/);
  assert.doesNotMatch(loginPassword,/minlength=/,"login must not reject a valid legacy password in browser validation");
  assert.match(loginPassword,/maxlength="128"/);
});

test("password visibility controls expose state without changing form behavior",async()=>{
  assert.match(html,/id="signupPasswordToggle"[^>]*type="button"[^>]*aria-controls="signupPassword"[^>]*aria-pressed="false"/);
  assert.match(html,/id="loginPasswordToggle"[^>]*type="button"[^>]*aria-controls="loginPassword"[^>]*aria-pressed="false"/);
  const page=createPage({route:async(path)=>{
    if(path==="/api/status")return jsonResponse(200,{persistent:true});
    if(path==="/healthz")return jsonResponse(200,{ok:true});
    if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
    throw new Error(`Unexpected route ${path}`);
  }});
  await settle();
  const input=page.elements.get("signupPassword"),button=page.elements.get("signupPasswordToggle");
  await button.emit("click");
  assert.equal(input.type,"text");
  assert.equal(button.getAttribute("aria-pressed"),"true");
  assert.equal(button.textContent,"Hide");
  await button.emit("click");
  assert.equal(input.type,"password");
  assert.equal(button.getAttribute("aria-pressed"),"false");
  assert.equal(button.textContent,"Show");
});

test("auth submit buttons communicate progress and restore after failure",async()=>{
  let finishLogin;
  const pendingLogin=new Promise((resolve)=>{finishLogin=resolve;});
  const page=createPage({route:async(path)=>{
    if(path==="/api/status")return jsonResponse(200,{persistent:true});
    if(path==="/healthz")return jsonResponse(200,{ok:true});
    if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
    if(path==="/api/login")return pendingLogin;
    throw new Error(`Unexpected route ${path}`);
  }});
  await settle();
  const form=page.elements.get("loginForm"),button=page.elements.get("loginSubmit");
  form.values={email:"returning@example.test",password:"existing-password"};
  const pending=form.emit("submit",{preventDefault(){}});
  await new Promise(setImmediate);
  assert.equal(button.dataset.busy,"true");
  assert.match(button.getAttribute("aria-label"),/signing in/i);
  finishLogin(jsonResponse(401,{error:"Email or password is incorrect."}));
  await pending;
  assert.equal(button.dataset.busy,undefined);
  assert.equal(button.getAttribute("aria-label"),null);
  assert.equal(button.disabled,false);
});

test("failed storage probes are advisory and a login error stays scoped",async()=>{
  const page=createPage({
    search:"?mode=login&error=Email%20or%20password%20is%20incorrect.",
    route:async(path)=>{
      if(path==="/api/status")return jsonResponse(200,{persistent:true});
      if(path==="/healthz")throw new Error("health unavailable");
      if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
      throw new Error(`Unexpected route ${path}`);
    }
  });
  await settle();
  const {elements}=page;
  assert.equal(elements.get("signupSubmit").disabled,false);
  assert.equal(elements.get("storageState").dataset.persistence,"persistent");
  assert.equal(elements.get("storageState").dataset.health,"unavailable");
  assert.match(elements.get("storageState").statusText.textContent,/retry/i);
  assert.equal(elements.get("loginMessage").hidden,false);
  assert.equal(elements.get("loginMessage").textContent,"Email or password is incorrect.");
  assert.equal(elements.get("signupMessage").hidden,true);
  await elements.get("signupForm").emit("input");
  assert.equal(elements.get("loginMessage").hidden,true);
});

test("enhanced signup reports an inline error, recovers, and retries",async()=>{
  let signupAttempts=0;
  const page=createPage({
    route:async(path)=>{
      if(path==="/api/status")return jsonResponse(200,{persistent:true});
      if(path==="/healthz")return jsonResponse(200,{ok:true});
      if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
      if(path==="/api/signup"){
        signupAttempts+=1;
        return signupAttempts===1
          ?jsonResponse(409,{error:"An account with that email already exists."})
          :jsonResponse(201,{user:{id:"user-1"}});
      }
      throw new Error(`Unexpected route ${path}`);
    }
  });
  await settle();
  const form=page.elements.get("signupForm");
  form.values={name:"New Lifter",email:"lifter@example.test",password:"secure-password-123"};
  let prevented=false;
  await form.emit("submit",{preventDefault(){prevented=true;}});
  assert.equal(prevented,true);
  const firstRequest=page.requests.find((request)=>request.path==="/api/signup");
  assert.equal(firstRequest.options.method,"POST");
  assert.equal(firstRequest.options.credentials,"same-origin");
  assert.equal(firstRequest.options.headers["Content-Type"],"application/json");
  assert.deepEqual(JSON.parse(firstRequest.options.body),{email:"lifter@example.test",password:"secure-password-123",name:"New Lifter"});
  assert.equal(page.elements.get("signupMessage").textContent,"An account with that email already exists.");
  assert.equal(page.elements.get("loginMessage").hidden,true);
  assert.equal(page.elements.get("signupSubmit").disabled,false);
  await form.emit("input");
  assert.equal(page.elements.get("signupMessage").hidden,true);
  await form.emit("submit",{preventDefault(){}});
  assert.equal(signupAttempts,2);
  assert.deepEqual(page.navigations,["/planner.html"]);
});

test("enhanced login uses its own endpoint and keeps failures retryable",async()=>{
  const page=createPage({
    search:"?mode=login&next=planner&add=flat-dumbbell-press",
    route:async(path)=>{
      if(path==="/api/status")return jsonResponse(200,{persistent:true});
      if(path==="/healthz")return jsonResponse(200,{ok:true});
      if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
      if(path==="/api/login")return jsonResponse(401,{error:"Email or password is incorrect."});
      throw new Error(`Unexpected route ${path}`);
    }
  });
  await settle();
  const form=page.elements.get("loginForm");
  form.values={email:"returning@example.test",password:"incorrect-password"};
  await form.emit("submit",{preventDefault(){}});
  const loginRequest=page.requests.find((request)=>request.path==="/api/login");
  assert.deepEqual(JSON.parse(loginRequest.options.body),{email:"returning@example.test",password:"incorrect-password"});
  assert.equal(page.elements.get("loginMessage").hidden,false);
  assert.equal(page.elements.get("signupMessage").hidden,true);
  assert.equal(page.elements.get("loginSubmit").disabled,false);
  assert.equal(form.getAttribute("aria-busy"),null);
  assert.deepEqual(page.navigations,[]);
});

test("enhanced login and verification preserve only exact workout and onboarding destinations",async()=>{
  const destinations=[
    ["workout","/workout.html"],["/workout.html","/workout.html"],
    ["onboarding","/onboarding.html"],["/onboarding.html","/onboarding.html"],
    ["https://outside.test/workout.html","/planner.html"],["//outside.test/onboarding.html","/planner.html"],
    ["/workout.html?day=Monday","/workout.html?day=Monday"],["/workout.html?day=Funday","/planner.html"],["/workout.html?day=Monday&next=//outside.test","/planner.html"],
    ["/workout.html?next=https://outside.test","/planner.html"],["/onboarding.html/../../outside","/planner.html"]
  ];
  for(const [requested,destination] of destinations)for(const verify of [false,true]){
    const page=createPage({search:`?mode=login&next=${encodeURIComponent(requested)}`,route:async(path)=>{
      if(path==="/api/status")return jsonResponse(200,{persistent:true});
      if(path==="/healthz")return jsonResponse(200,{ok:true});
      if(path==="/api/me")return jsonResponse(401,{error:"Not signed in."});
      if(path==="/api/login")return verify?jsonResponse(202,{verificationRequired:true,purpose:"login",maskedEmail:"r***@example.test"}):jsonResponse(200,{user:{id:"returning"}});
      throw new Error(`Unexpected route ${path}`);
    }});
    await settle();
    assert.equal(page.elements.get("loginNext").value,destination);
    const form=page.elements.get("loginForm");form.values={email:"returning@example.test",password:"existing-password"};
    await form.emit("submit",{preventDefault(){}});
    assert.deepEqual(page.navigations,[verify?`/verify-email.html?${new URLSearchParams({next:destination.includes("?")?destination:destination.slice(1,-5),purpose:"login"})}`:destination]);
  }
});
