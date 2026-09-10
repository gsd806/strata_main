"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=["pricing-logic.js","pricing-state.js","pricing-api.js","pricing-render.js","pricing-events.js","pricing.js"]
  .map(name=>fs.readFileSync(path.join(__dirname,"../public/scripts",name),"utf8")).join("\n");
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
const response=(status,data)=>({ok:status<400,status,json:async()=>data});
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function runtime({activeTrial=false,checkoutFailure=false,configFailure=false,userOverride=null,meResponse=null,trialResponse=null,checkoutResponse=null}={}){
  const nodes=new Map(),listeners={},documentListeners={},checkout={};
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:"",innerHTML:"",attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},focus(){},addEventListener(type,fn){this[type]=fn;}});
    return nodes.get(id);
  };
  let accountUser=userOverride||{id:"member",discovery:{active:activeTrial,accessType:activeTrial?"trial":"none",trial:{eligible:!activeTrial,active:activeTrial,expiresAt:Date.now()+7*86400000}}};
  let accountResponder=meResponse;
  const config={enabled:true,environment:"live",clientToken:"live_fixture",productId:`pro_${"a".repeat(26)}`,priceId:`pri_${"b".repeat(26)}`,price:{amount:"0.99",currency:"USD",interval:"month",frequency:1}};
  const document={visibilityState:"visible",getElementById:node,addEventListener(type,fn){documentListeners[type]=fn;}};
  const context={document,location:{search:"",assign(){}},navigator:{onLine:true},URLSearchParams,requestAnimationFrame:fn=>fn(),setTimeout,
    window:{addEventListener:(type,fn)=>{listeners[type]=fn;}},Paddle:{Initialize(options){checkout.event=options.eventCallback;},Checkout:{open(){checkout.open=true;},close(){checkout.open=false;checkout.closeCalls=(checkout.closeCalls||0)+1;}}},
    fetch:async url=>{
      let data,status=200;
      if(url==="/api/me"&&accountResponder)return accountResponder();
      if(url==="/api/me"){status=accountUser?200:401;data=accountUser?{user:accountUser,csrfToken:"csrf"}:{error:"Not signed in."};}
      else if(url==="/api/billing/config"){status=configFailure?503:200;data=configFailure?{error:"Checkout temporarily unavailable."}:config;}
      else if(url==="/api/discovery/trial"&&trialResponse)return trialResponse();
      else if(url==="/api/discovery/trial")data={user:{...accountUser,discovery:{...accountUser.discovery,active:true,accessType:"trial",trial:{eligible:false,active:true,expiresAt:Date.now()+7*86400000}}}};
      else if(url==="/api/billing/checkout"&&checkoutResponse)return checkoutResponse();
      else if(url==="/api/billing/checkout"){status=checkoutFailure?503:200;data=checkoutFailure?{error:"Payment provider unavailable. Try again."}:{transactionId:`txn_${"c".repeat(26)}`};}
      else throw new Error(`Unexpected request ${url}`);
      return response(status,data);
    }};
  vm.runInNewContext(source,context,{filename:"pricing.js"});
  return{
    node,listeners,checkout,
    emitVisibility(value){document.visibilityState=value;documentListeners.visibilitychange?.();},
    emitWindow(type,event={}){listeners[type]?.(event);},
    setAccountUser(user){accountResponder=null;accountUser=user;}
  };
}
for(const activeTrial of [false,true]){
  test(`checkout failures remain visible after render for ${activeTrial?"active":"eligible"} trial members`,async()=>{
    const r=runtime({activeTrial,checkoutFailure:true});await flush();
    r.node("buyDiscovery").click();await flush();
    assert.match(r.node("purchaseStatus").textContent,/Payment provider unavailable/);
    assert.equal(r.node("purchaseStatus").attrs.role,"alert");
    r.listeners.online();
    assert.match(r.node("purchaseStatus").textContent,/Payment provider unavailable/);
  });
}
test("an open checkout disables trial activation and provider errors are announced",async()=>{
  const r=runtime();await flush();r.node("buyDiscovery").click();await flush();
  assert.equal(r.checkout.open,true);
  assert.equal(r.node("trialDiscovery").disabled,true);
  assert.match(r.node("purchaseStatus").textContent,/checkout is open/);
  r.checkout.event({name:"checkout.error"});await flush();
  assert.match(r.node("purchaseStatus").textContent,/Paddle could not complete checkout/);
  assert.equal(r.node("trialDiscovery").disabled,false);
});
test("checkout completion cannot confirm access from a different signed-in account",async()=>{
  const r=runtime({activeTrial:true});await flush();r.node("buyDiscovery").click();await flush();
  r.setAccountUser({id:"other-member",discovery:{active:true,accessType:"subscription",subscription:{id:"sub_other",active:true,status:"active"},trial:{eligible:false,active:false}}});
  r.emitWindow("focus");await flush();
  r.checkout.event({name:"checkout.completed",data:{transaction_id:`txn_${"c".repeat(26)}`}});await flush();
  assert.match(r.node("purchaseStatus").textContent,/no longer signed in to that account/i);
  assert.doesNotMatch(r.node("purchaseStatus").textContent,/Subscription confirmed|now unlocked/i);
  assert.equal(r.node("purchaseStatus").attrs.role,"status");
});

test("an open Paddle overlay closes when foreground identity changes",async()=>{
  const r=runtime({activeTrial:true});await flush();r.node("buyDiscovery").click();await flush();assert.equal(r.checkout.open,true);
  r.setAccountUser({id:"other-member",discovery:{active:false,accessType:"none",trial:{eligible:true,active:false}}});
  r.emitWindow("focus");await flush();
  assert.equal(r.checkout.open,false);assert.equal(r.checkout.closeCalls,1);
  assert.match(r.node("purchaseStatus").textContent,/checkout belongs to another signed-in session/i);
  assert.equal(r.node("checkAccess").hidden,false,"the original transaction remains available for safe confirmation after signing back into its account");
});

test("a delayed trial response cannot restore its initiating user after an account switch",async()=>{
  const delayed=deferred(),r=runtime({trialResponse:()=>delayed.promise});await flush();
  r.node("trialDiscovery").click();
  r.setAccountUser({id:"other-member",discovery:{active:false,accessType:"none",trial:{eligible:true,active:false}}});
  r.emitWindow("focus");await flush();
  delayed.resolve(response(200,{user:{id:"member",discovery:{active:true,accessType:"trial",trial:{eligible:false,active:true,expiresAt:Date.now()+86400000}}}}));await flush();
  assert.equal(r.node("trialDiscovery").hidden,false,"the switched-to account remains rendered");
  assert.equal(r.node("openDiscovery").hidden,true);
  assert.match(r.node("purchaseStatus").textContent,/trial request belongs to the account that started it/i);
});

test("a delayed checkout response stays pending for its initiator and cannot open for a switched account",async()=>{
  const delayed=deferred(),r=runtime({activeTrial:true,checkoutResponse:()=>delayed.promise});await flush();
  r.node("buyDiscovery").click();
  r.setAccountUser({id:"other-member",discovery:{active:false,accessType:"none",trial:{eligible:false,active:false}}});
  r.emitWindow("focus");await flush();
  delayed.resolve(response(200,{transactionId:`txn_${"c".repeat(26)}`}));await flush();
  assert.equal(r.checkout.open,undefined);
  assert.match(r.node("purchaseStatus").textContent,/checkout belongs to another signed-in session/i);
  assert.equal(r.node("checkAccess").hidden,false,"the A-owned checkout remains pending instead of becoming B's checkout");
});

test("pricing focus clears account UI and restores the same account with one paired recheck",async()=>{
  const same=deferred(),member={id:"member",email:"member@example.test",discovery:{active:true,accessType:"trial",trial:{eligible:false,active:true,expiresAt:Date.now()+86400000}}};
  let calls=0;const responses=[response(200,{user:member,csrfToken:"csrf"}),same.promise];
  const r=runtime({meResponse:()=>{calls+=1;return responses.shift();}});await flush();
  assert.equal(r.node("openDiscovery").hidden,false);
  r.emitWindow("focus");
  r.emitVisibility("visible");
  assert.equal(calls,2,"focus and visibility share one in-flight recheck");
  assert.equal(r.node("purchaseSignup").hidden,false);
  assert.match(r.node("purchaseStatus").textContent,/Checking which account/i);
  same.resolve(response(200,{user:member,csrfToken:"csrf-next"}));await flush();
  assert.equal(r.node("purchaseSignup").hidden,true);
  assert.equal(r.node("openDiscovery").hidden,false);
  assert.match(r.node("purchaseStatus").textContent,/free Strata\+ trial is active/i);
});

test("pricing persisted pageshow revalidates logout but ordinary pageshow does not",async()=>{
  let calls=0;const responses=[response(200,{user:{id:"member",discovery:{active:true,accessType:"paid"}},csrfToken:"csrf"}),response(401,{error:"Not signed in."})];
  const r=runtime({meResponse:()=>{calls+=1;return responses.shift();}});await flush();
  r.emitWindow("pageshow",{persisted:false});await flush();assert.equal(calls,1);
  r.emitWindow("pageshow",{persisted:true});await flush();
  assert.equal(calls,2);assert.equal(r.node("purchaseSignup").hidden,false);assert.match(r.node("purchaseStatus").textContent,/Create an account or sign in/i);
});

test("pricing ignores a stale initial identity after a newer focus account switch",async()=>{
  const stale=deferred(),fresh=deferred(),responses=[stale.promise,fresh.promise];
  const r=runtime({meResponse:()=>responses.shift()});await flush();
  r.emitWindow("focus");
  fresh.resolve(response(200,{user:{id:"fresh",discovery:{active:false,accessType:"none",trial:{eligible:true,active:false}}},csrfToken:"fresh-csrf"}));await flush();
  stale.resolve(response(200,{user:{id:"stale",discovery:{active:true,accessType:"paid"}},csrfToken:"stale-csrf"}));await flush();
  assert.equal(r.node("trialDiscovery").hidden,false);
  assert.equal(r.node("openDiscovery").hidden,true);
  assert.match(r.node("purchaseStatus").textContent,/eligible for one free 7-day/i);
});

test("checkout completion remains tied to its initiator after logout",async()=>{
  const r=runtime({activeTrial:true});await flush();r.node("buyDiscovery").click();await flush();
  r.setAccountUser(null);
  r.checkout.event({name:"checkout.completed",data:{transaction_id:`txn_${"c".repeat(26)}`}});await flush();
  assert.match(r.node("purchaseStatus").textContent,/account that started checkout/i);
  assert.doesNotMatch(r.node("purchaseStatus").textContent,/Subscription confirmed|now unlocked/i);
});
test("an unavailable checkout explains the problem while preserving the no-card trial",async()=>{
  const r=runtime({configFailure:true});await flush();
  assert.equal(r.node("buyDiscovery").disabled,true);
  assert.equal(r.node("trialDiscovery").disabled,false);
  assert.match(r.node("purchaseStatus").textContent,/Checkout temporarily unavailable[\s\S]*still start your free 7-day trial/);
  const active=runtime({configFailure:true,activeTrial:true});await flush();
  assert.equal(active.node("buyDiscovery").disabled,true);
  assert.equal(active.node("openDiscovery").hidden,false);
  assert.match(active.node("purchaseStatus").textContent,/Checkout temporarily unavailable[\s\S]*keep using your active trial/);
});
test("eligible members see one primary start instead of competing trial and checkout actions",async()=>{
  const r=runtime();await flush();
  assert.equal(r.node("trialDiscovery").hidden,false);
  assert.equal(r.node("buyDiscovery").hidden,true);
  assert.match(r.node("purchaseStatus").textContent,/eligible for one free 7-day Strata\+ trial/i);
});
test("paid members can see a concurrent complimentary grant and continued billing disclosure",async()=>{
  const expiresAt=Date.now()+7*86400000;
  const user={id:"member",discovery:{active:true,accessType:"paid",adminGrant:{active:true,startedAt:Date.now(),expiresAt,revokedAt:null},trial:{eligible:false,active:false,expiresAt:null},subscription:{id:"sub_active",status:"active",active:true,currentPeriodEndsAt:Date.now()+30*86400000}}};
  const r=runtime({userOverride:user});await flush();
  assert.match(r.node("purchaseStatus").textContent,/complimentary Strata\+[\s\S]*monthly subscription remains separate/i);
  assert.equal(r.node("manageSubscription").hidden,false);
});
test("grant-only members are not told to manage nonexistent billing",async()=>{
  const user={id:"member",discovery:{active:true,accessType:"grant",adminGrant:{active:true,startedAt:Date.now(),expiresAt:null,revokedAt:null},trial:{eligible:false,active:false,expiresAt:null},subscription:null}};
  const r=runtime({userOverride:user});await flush();
  assert.match(r.node("purchaseStatus").textContent,/did not create a paid subscription/i);
  assert.doesNotMatch(r.node("purchaseStatus").textContent,/manage it from Account/i);
  assert.equal(r.node("manageSubscription").hidden,true);
});
test("lifetime members can see a concurrent complimentary grant",async()=>{
  const user={id:"member",discovery:{active:true,accessType:"paid",adminGrant:{active:true,startedAt:Date.now(),expiresAt:Date.now()+7*86400000,revokedAt:null},trial:{eligible:false,active:false,expiresAt:null},subscription:null}};
  const r=runtime({userOverride:user});await flush();
  assert.match(r.node("purchaseStatus").textContent,/grandfathered lifetime access remains separate/i);
  assert.equal(r.node("manageSubscription").hidden,true);
});
