"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const source=fs.readFileSync(path.join(__dirname,"../public/scripts/pricing.js"),"utf8");
const flush=async()=>{for(let i=0;i<5;i++)await new Promise(setImmediate);};
function runtime({activeTrial=false,checkoutFailure=false,configFailure=false,userOverride=null}={}){
  const nodes=new Map(),listeners={},checkout={};
  const node=id=>{
    if(!nodes.has(id))nodes.set(id,{hidden:false,disabled:false,textContent:"",innerHTML:"",attrs:{},classList:{toggle(){}},setAttribute(k,v){this.attrs[k]=v;},focus(){},addEventListener(type,fn){this[type]=fn;}});
    return nodes.get(id);
  };
  const user=userOverride||{id:"member",discovery:{active:activeTrial,accessType:activeTrial?"trial":"none",trial:{eligible:!activeTrial,active:activeTrial,expiresAt:Date.now()+7*86400000}}};
  const config={enabled:true,environment:"live",clientToken:"live_fixture",productId:`pro_${"a".repeat(26)}`,priceId:`pri_${"b".repeat(26)}`,price:{amount:"0.99",currency:"USD",interval:"month",frequency:1}};
  const context={document:{getElementById:node},location:{search:"",assign(){}},navigator:{onLine:true},URLSearchParams,requestAnimationFrame:fn=>fn(),setTimeout,
    window:{addEventListener:(type,fn)=>{listeners[type]=fn;}},Paddle:{Initialize(options){checkout.event=options.eventCallback;},Checkout:{open(){checkout.open=true;}}},
    fetch:async url=>{
      let data,status=200;
      if(url==="/api/me")data={user,csrfToken:"csrf"};
      else if(url==="/api/billing/config"){status=configFailure?503:200;data=configFailure?{error:"Checkout temporarily unavailable."}:config;}
      else if(url==="/api/billing/checkout"){status=checkoutFailure?503:200;data=checkoutFailure?{error:"Payment provider unavailable. Try again."}:{transactionId:`txn_${"c".repeat(26)}`};}
      else throw new Error(`Unexpected request ${url}`);
      return{ok:status<400,status,json:async()=>data};
    }};
  vm.runInNewContext(source,context,{filename:"pricing.js"});
  return{node,listeners,checkout};
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
