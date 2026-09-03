"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { spawn } = require("node:child_process");
const { createHmac } = require("node:crypto");
const { mkdirSync,mkdtempSync,rmSync } = require("node:fs");
const { join } = require("node:path");
const { DatabaseSync } = require("node:sqlite");

const PROJECT_ROOT=join(__dirname,"..");

const PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";
const PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
const CLIENT_TOKEN="live_browser_token_for_server_payment_test";
const API_KEY="pdl_live_apikey_01serverpaymentfixture0000_fixture_secret_123";
const WEBHOOK_SECRET="pdl_ntfset_live_server_payment_test_secret";

let app;
let fakePaddle;
let runtimeDir;
let BASE;
let PADDLE_BASE;
let transactionSequence=0;
const paddleRequests=[];

function listen(server) {
  return new Promise((resolve,reject) => {
    server.once("error",reject);
    server.listen(0,"127.0.0.1",() => {
      server.off("error",reject);
      const address=server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function readRequest(req) {
  const chunks=[];
  for await (const chunk of req) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function startFakePaddle() {
  fakePaddle=http.createServer(async(req,res) => {
    const raw=await readRequest(req);
    let body=null;
    try { body=raw?JSON.parse(raw):null; } catch { body=null; }
    if (req.method==="GET"&&req.url==="/ips") {
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({data:{ipv4_cidrs:["34.232.58.13/32"]}}));
      return;
    }
    paddleRequests.push({method:req.method,url:req.url,headers:{...req.headers},body,raw});
    if (req.method!=="POST"||req.url!=="/transactions") {
      res.writeHead(404,{"Content-Type":"application/json"});
      res.end(JSON.stringify({error:{detail:"not found"}}));
      return;
    }
    transactionSequence+=1;
    const id=`txn_${String(transactionSequence).padStart(24,"0")}`;
    res.writeHead(201,{"Content-Type":"application/json"});
    res.end(JSON.stringify({data:{id,status:"ready"}}));
  });
  PADDLE_BASE=await listen(fakePaddle);
}

async function stopHttpServer(server) {
  if (!server?.listening) return;
  await new Promise((resolve,reject) => server.close((error) => error?reject(error):resolve()));
}

async function startApp() {
  mkdirSync(join(PROJECT_ROOT,"test-runtime"),{recursive:true});
  runtimeDir=mkdtempSync(join(PROJECT_ROOT,"test-runtime","server-payments-"));
  app=spawn(process.execPath,["server.js"],{
    cwd:PROJECT_ROOT,
    env:{
      ...process.env,
      PORT:"0",
      HOST:"127.0.0.1",
      NODE_ENV:"test",
      ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",
      TRUST_PROXY:"true",
      TURSO_DATABASE_URL:"",
      TURSO_AUTH_TOKEN:"",
      STRATA_DATA_DIR:runtimeDir,
      PADDLE_PRODUCT_ID:PRODUCT_ID,
      PADDLE_PRICE_ID:PRICE_ID,
      PADDLE_CLIENT_TOKEN:CLIENT_TOKEN,
      PADDLE_API_KEY:API_KEY,
      PADDLE_WEBHOOK_SECRET:WEBHOOK_SECRET,
      PADDLE_CHECKOUT_ENABLED:"true",
      PADDLE_ENFORCE_IP_ALLOWLIST:"true",
      PADDLE_API_BASE:PADDLE_BASE
    },
    stdio:["ignore","pipe","pipe"]
  });
  BASE=await new Promise((resolve,reject) => {
    let output="";
    let errors="";
    let settled=false;
    const timer=setTimeout(() => finish(new Error(`Server startup timed out. ${errors}`)),5000);
    function finish(error,value) {
      if (settled) return;
      settled=true;
      clearTimeout(timer);
      if (error) reject(error); else resolve(value);
    }
    app.stdout.on("data",(chunk) => {
      output=(output+chunk.toString()).slice(-4096);
      const match=output.match(/Strata running at http:\/\/127\.0\.0\.1:(\d+)/);
      if (match) finish(null,`http://127.0.0.1:${match[1]}`);
    });
    app.stderr.on("data",(chunk) => { errors=(errors+chunk.toString()).slice(-4096); });
    app.once("error",finish);
    app.once("exit",(code,signal) => finish(new Error(`Server exited before startup (${code??signal??"unknown"}). ${errors}`)));
  });
}

async function stopApp() {
  const child=app;
  app=undefined;
  if (child&&child.exitCode===null&&child.signalCode===null) {
    await new Promise((resolve) => {
      let timer;
      child.once("exit",() => { clearTimeout(timer); resolve(); });
      child.kill("SIGTERM");
      timer=setTimeout(() => child.kill("SIGKILL"),2000);
    });
  }
}

async function request(path,options={}) {
  const response=await fetch(`${BASE}${path}`,options);
  const contentType=response.headers.get("content-type")||"";
  const data=contentType.includes("application/json")?await response.json():await response.text();
  return {
    response,
    data,
    cookie:response.headers.get("set-cookie")?.split(";")[0]||""
  };
}

async function signup({name,email,password}) {
  const result=await request("/api/signup",{
    method:"POST",
    headers:{Origin:BASE,"Content-Type":"application/json"},
    body:JSON.stringify({name,email,password})
  });
  assert.equal(result.response.status,201);
  assert.ok(result.cookie.startsWith("strata_session="));
  const me=await request("/api/me",{headers:{Cookie:result.cookie}});
  assert.equal(me.response.status,200);
  assert.ok(me.data.csrfToken);
  return {cookie:result.cookie,user:me.data.user,csrfToken:me.data.csrfToken};
}

async function checkout(account) {
  return request("/api/billing/checkout",{
    method:"POST",
    headers:{
      Cookie:account.cookie,
      Origin:BASE,
      "X-CSRF-Token":account.csrfToken,
      "Content-Type":"application/json"
    },
    body:"{}"
  });
}

function eventId(label,sequence) {
  const safe=String(label).toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  return `evt_${safe}${String(sequence).padStart(24-safe.length,"0")}`;
}

function completedEvent({id,transactionId,userId}) {
  const occurredAt=new Date().toISOString();
  return {
    event_id:id,
    event_type:"transaction.completed",
    occurred_at:occurredAt,
    notification_id:`ntf_${id.slice(4)}`,
    data:{
      id:transactionId,
      status:"completed",
      customer_id:"ctm_000000000000000000000001",
      subscription_id:null,
      collection_mode:"automatic",
      updated_at:occurredAt,
      custom_data:{strata_user_id:userId,strata_version:1},
      items:[{
        quantity:1,
        price:{id:PRICE_ID,product_id:PRODUCT_ID,billing_cycle:null}
      }],
      details:{totals:{subtotal:"599",discount:"599",tax:"0",total:"0"}}
    }
  };
}

function adjustmentEvent({id,adjustmentId,transactionId,type,status,sequence}) {
  return {
    event_id:id,
    event_type:sequence%2===0?"adjustment.updated":"adjustment.created",
    occurred_at:new Date(Date.now()+sequence).toISOString(),
    notification_id:`ntf_${id.slice(4)}`,
    data:{
      id:adjustmentId,
      transaction_id:transactionId,
      action:"refund",
      type,
      status
    }
  };
}

function signedWebhook(event,{signature,source="34.232.58.13"}={}) {
  const raw=JSON.stringify(event);
  const timestamp=Math.floor(Date.now()/1000);
  const digest=createHmac("sha256",WEBHOOK_SECRET).update(`${timestamp}:${raw}`).digest("hex");
  return request("/api/paddle/webhook",{
    method:"POST",
    headers:{
      "Content-Type":"application/json",
      "Paddle-Signature":`ts=${timestamp};h1=${signature??digest}`,
      "X-Forwarded-For":source
    },
    body:raw
  });
}

test.before(async() => {
  await startFakePaddle();
  try { await startApp(); }
  catch(error) {
    await stopHttpServer(fakePaddle);
    throw error;
  }
});

test.after(async() => {
  await stopApp();
  await stopHttpServer(fakePaddle);
  if (runtimeDir) rmSync(runtimeDir,{recursive:true,force:true});
});

test("live one-time checkout grants and revokes the Discovery entitlement securely",async() => {
  const pricing=await request("/pricing");
  assert.equal(pricing.response.status,200);
  const csp=pricing.response.headers.get("content-security-policy")||"";
  assert.match(csp,/script-src[^;]*https:\/\/cdn\.paddle\.com/);
  assert.match(csp,/connect-src[^;]*https:\/\/\*\.paddle\.com/);
  assert.match(csp,/frame-src[^;]*https:\/\/\*\.paddle\.com/);

  const status=await request("/api/status");
  assert.equal(status.response.status,200);
  assert.equal(status.data.paymentsConfigured,true);
  assert.equal(status.data.checkoutEnabled,true);
  assert.equal(status.data.webhookIpAllowlist,true);
  const config=await request("/api/billing/config");
  assert.equal(config.response.status,200);
  assert.deepEqual(config.data,{
    enabled:true,
    configured:true,
    productId:PRODUCT_ID,
    priceId:PRICE_ID,
    clientToken:CLIENT_TOKEN,
    price:{amount:"5.99",currency:"USD"}
  });
  for (const publicValue of [pricing.data,JSON.stringify(status.data),JSON.stringify(config.data)]) {
    assert.doesNotMatch(publicValue,new RegExp(API_KEY));
    assert.doesNotMatch(publicValue,new RegExp(WEBHOOK_SECRET));
    assert.doesNotMatch(publicValue,/PADDLE_API_KEY|PADDLE_WEBHOOK_SECRET/);
  }

  const account=await signup({
    name:"Live Payment Tester",
    email:"live-payments@example.test",
    password:"live-payment-password-123"
  });
  assert.equal(account.user.discovery.active,false);

  const unpaidPage=await request("/discover.html",{headers:{Cookie:account.cookie},redirect:"manual"});
  assert.equal(unpaidPage.response.status,302);
  assert.equal(unpaidPage.response.headers.get("location"),"/pricing?reason=discovery-required");
  const unpaidApi=await request("/api/discovery",{headers:{Cookie:account.cookie}});
  assert.equal(unpaidApi.response.status,402);
  assert.equal(unpaidApi.data.code,"DISCOVERY_ACCESS_REQUIRED");
  const plannerPage=await request("/planner.html",{headers:{Cookie:account.cookie}});
  assert.equal(plannerPage.response.status,200,"the planner remains free for signed-in accounts");
  const plannerApi=await request("/api/plan",{headers:{Cookie:account.cookie}});
  assert.equal(plannerApi.response.status,200);

  const noCsrf=await request("/api/billing/checkout",{
    method:"POST",
    headers:{Cookie:account.cookie,Origin:BASE,"Content-Type":"application/json"},
    body:"{}"
  });
  assert.equal(noCsrf.response.status,403);
  assert.equal(noCsrf.data.code,"INVALID_CSRF");
  const wrongCsrf=await request("/api/billing/checkout",{
    method:"POST",
    headers:{Cookie:account.cookie,Origin:BASE,"X-CSRF-Token":"wrong-token","Content-Type":"application/json"},
    body:"{}"
  });
  assert.equal(wrongCsrf.response.status,403);
  assert.equal(paddleRequests.length,0,"invalid CSRF must not call Paddle");

  const prepared=await checkout(account);
  assert.equal(prepared.response.status,201);
  assert.match(prepared.data.transactionId,/^txn_[a-z0-9]{20,}$/);
  assert.equal(paddleRequests.length,1);
  const paddleRequest=paddleRequests[0];
  assert.equal(paddleRequest.method,"POST");
  assert.equal(paddleRequest.url,"/transactions");
  assert.equal(paddleRequest.headers.authorization,`Bearer ${API_KEY}`);
  assert.equal(paddleRequest.body.collection_mode,"automatic");
  assert.deepEqual(paddleRequest.body.items,[{price_id:PRICE_ID,quantity:1}]);
  assert.deepEqual(paddleRequest.body.custom_data,{strata_user_id:account.user.id,strata_version:1});

  const reused=await checkout(account);
  assert.equal(reused.response.status,200);
  assert.equal(reused.data.transactionId,prepared.data.transactionId);
  assert.equal(reused.data.reused,true);
  assert.equal(paddleRequests.length,1,"a fresh pending transaction should be reused");

  const completion=completedEvent({
    id:eventId("completed",1),
    transactionId:prepared.data.transactionId,
    userId:account.user.id
  });
  assert.equal(completion.data.details.totals.total,"0","fixture exercises a real 100%-discount checkout");
  const rejectedSource=await signedWebhook(completion,{source:"203.0.113.9"});
  assert.equal(rejectedSource.response.status,403);
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).data.user.discovery.active,false);
  const granted=await signedWebhook(completion);
  assert.equal(granted.response.status,200);
  assert.equal(granted.data.outcome,"granted");

  const unlocked=await request("/api/discovery",{headers:{Cookie:account.cookie}});
  assert.equal(unlocked.response.status,200);
  const unlockedPage=await request("/discover.html",{headers:{Cookie:account.cookie},redirect:"manual"});
  assert.equal(unlockedPage.response.status,200);

  const secondDevice=await request("/api/login",{
    method:"POST",
    headers:{Origin:BASE,"Content-Type":"application/json"},
    body:JSON.stringify({email:"live-payments@example.test",password:"live-payment-password-123"})
  });
  assert.equal(secondDevice.response.status,200);
  assert.notEqual(secondDevice.cookie,account.cookie);
  const secondDeviceMe=await request("/api/me",{headers:{Cookie:secondDevice.cookie}});
  assert.equal(secondDeviceMe.response.status,200);
  assert.equal(secondDeviceMe.data.user.discovery.active,true,"the Turso/SQLite entitlement belongs to the account, not one browser session");
  const secondDeviceDiscovery=await request("/api/discovery",{headers:{Cookie:secondDevice.cookie}});
  assert.equal(secondDeviceDiscovery.response.status,200);

  const replay=await signedWebhook(completion);
  assert.equal(replay.response.status,200);
  assert.equal(replay.data.outcome,"replayed");
  const database=new DatabaseSync(join(runtimeDir,"strata.sqlite"),{readOnly:true});
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM paddle_webhook_events WHERE event_id=?").get(completion.event_id).count,1);
  assert.equal(database.prepare("SELECT COUNT(*) AS count FROM paddle_purchases WHERE transaction_id=?").get(prepared.data.transactionId).count,1);
  database.close();

  const invalidAccount=await signup({
    name:"Invalid Signature Tester",
    email:"invalid-signature@example.test",
    password:"invalid-signature-password-123"
  });
  const invalidPrepared=await checkout(invalidAccount);
  assert.equal(invalidPrepared.response.status,201);
  const invalidCompletion=completedEvent({
    id:eventId("invalid",2),
    transactionId:invalidPrepared.data.transactionId,
    userId:invalidAccount.user.id
  });
  const invalidSignature=await signedWebhook(invalidCompletion,{signature:"0".repeat(64)});
  assert.equal(invalidSignature.response.status,400);
  const stillLocked=await request("/api/discovery",{headers:{Cookie:invalidAccount.cookie}});
  assert.equal(stillLocked.response.status,402,"an unverified notification must never grant access");

  const pendingRefund=adjustmentEvent({
    id:eventId("pending",3),
    adjustmentId:"adj_000000000000000000000003",
    transactionId:prepared.data.transactionId,
    type:"full",
    status:"pending_approval",
    sequence:3
  });
  const pendingResult=await signedWebhook(pendingRefund);
  assert.equal(pendingResult.response.status,200);
  assert.equal(pendingResult.data.outcome,"adjustment-recorded");
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).data.user.discovery.active,true);

  const partialRefund=adjustmentEvent({
    id:eventId("partial",4),
    adjustmentId:"adj_000000000000000000000004",
    transactionId:prepared.data.transactionId,
    type:"partial",
    status:"approved",
    sequence:4
  });
  const partialResult=await signedWebhook(partialRefund);
  assert.equal(partialResult.response.status,200);
  assert.equal(partialResult.data.outcome,"adjustment-recorded");
  assert.equal((await request("/api/me",{headers:{Cookie:secondDevice.cookie}})).data.user.discovery.active,true);

  const fullRefund=adjustmentEvent({
    id:eventId("full",5),
    adjustmentId:"adj_000000000000000000000005",
    transactionId:prepared.data.transactionId,
    type:"full",
    status:"approved",
    sequence:5
  });
  const revoked=await signedWebhook(fullRefund);
  assert.equal(revoked.response.status,200);
  assert.equal(revoked.data.outcome,"revoked");
  const revokedMe=await request("/api/me",{headers:{Cookie:account.cookie}});
  assert.equal(revokedMe.response.status,200);
  assert.equal(revokedMe.data.user.discovery.active,false);
  const revokedFirstDevice=await request("/api/discovery",{headers:{Cookie:account.cookie}});
  const revokedSecondDevice=await request("/api/discovery",{headers:{Cookie:secondDevice.cookie}});
  assert.equal(revokedFirstDevice.response.status,402);
  assert.equal(revokedSecondDevice.response.status,402);
});
