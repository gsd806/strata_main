"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const http=require("node:http");
const {spawn}=require("node:child_process");
const {createHmac}=require("node:crypto");
const {mkdirSync,mkdtempSync,rmSync}=require("node:fs");
const {join}=require("node:path");
const {DatabaseSync}=require("node:sqlite");

const PROJECT_ROOT=join(__dirname,"..");
const PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";
const PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
const CLIENT_TOKEN="live_browser_token_for_account_recovery_test";
const API_KEY="pdl_live_apikey_01accountrecoveryfixture0000_secret_123";
const WEBHOOK_SECRET="pdl_ntfset_live_account_recovery_test_secret";
const EMAIL_API_KEY="re_account_recovery_fixture_key_123456";
const EMAIL_SECRET="account-recovery-test-secret-that-is-long-enough-123";

let resend;
let paddle;
let app;
let resendBase;
let paddleBase;
let base;
let runtimeDir;
let appErrors="";
let transactionSequence=0;
let requestAddressOctet=10;
const deliveries=[];
const paddleRequests=[];
const paddleTransactions=new Map();

function listen(server){
  return new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(0,"127.0.0.1",()=>{
      server.off("error",reject);
      const address=server.address();
      resolve(`http://127.0.0.1:${address.port}`);
    });
  });
}

async function readBody(req){
  const chunks=[];
  for await(const chunk of req)chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

async function startResend(){
  resend=http.createServer(async(req,res)=>{
    const raw=await readBody(req);
    let body=null;
    try{body=raw?JSON.parse(raw):null;}catch{}
    deliveries.push({method:req.method,url:req.url,headers:{...req.headers},body});
    if(req.method!=="POST"||req.url!=="/emails"){
      res.writeHead(404,{"Content-Type":"application/json"});
      res.end(JSON.stringify({message:"not found"}));
      return;
    }
    res.writeHead(200,{"Content-Type":"application/json"});
    res.end(JSON.stringify({id:`email_${deliveries.length}`}));
  });
  resendBase=await listen(resend);
}

async function startPaddle(){
  paddle=http.createServer(async(req,res)=>{
    const raw=await readBody(req);
    let body=null;
    try{body=raw?JSON.parse(raw):null;}catch{}
    paddleRequests.push({method:req.method,url:req.url,headers:{...req.headers},body});
    if(req.method==="GET"&&/^\/transactions\/txn_[a-z0-9]+$/.test(req.url)){
      const id=req.url.split("/").at(-1),transaction=paddleTransactions.get(id);
      res.writeHead(transaction?200:404,{"Content-Type":"application/json"});
      res.end(JSON.stringify(transaction?{data:{id,...transaction}}:{error:{detail:"not found"}}));
      return;
    }
    if(req.method==="PATCH"&&/^\/transactions\/txn_[a-z0-9]+$/.test(req.url)){
      const id=req.url.split("/").at(-1),transaction=paddleTransactions.get(id);
      if(!transaction||!new Set(["draft","ready"]).has(transaction.status)||body?.status!=="canceled"){
        res.writeHead(409,{"Content-Type":"application/json"});
        res.end(JSON.stringify({error:{detail:"transaction cannot be canceled"}}));
        return;
      }
      transaction.status="canceled";
      res.writeHead(200,{"Content-Type":"application/json"});
      res.end(JSON.stringify({data:{id,status:"canceled"}}));
      return;
    }
    if(req.method!=="POST"||req.url!=="/transactions"){
      res.writeHead(404,{"Content-Type":"application/json"});
      res.end(JSON.stringify({error:{detail:"not found"}}));
      return;
    }
    transactionSequence+=1;
    const id=`txn_${String(transactionSequence).padStart(24,"0")}`;
    paddleTransactions.set(id,{status:"ready"});
    res.writeHead(201,{"Content-Type":"application/json"});
    res.end(JSON.stringify({data:{id,status:"ready"}}));
  });
  paddleBase=await listen(paddle);
}

async function startApp(){
  mkdirSync(join(PROJECT_ROOT,"test-runtime"),{recursive:true});
  runtimeDir=mkdtempSync(join(PROJECT_ROOT,"test-runtime","account-recovery-"));
  app=spawn(process.execPath,["server.js"],{
    cwd:PROJECT_ROOT,
    env:{
      ...process.env,
      PORT:"0",HOST:"127.0.0.1",NODE_ENV:"test",TRUST_PROXY:"true",
      APP_BASE_URL:"http://127.0.0.1",
      TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",STRATA_DATA_DIR:runtimeDir,
      EMAIL_VERIFICATION_ENABLED:"true",RESEND_API_KEY:EMAIL_API_KEY,
      EMAIL_FROM:"STRATA <accounts@auth.stratafitness.online>",
      EMAIL_REPLY_TO:"stratafitness.official@gmail.com",
      EMAIL_VERIFICATION_SECRET:EMAIL_SECRET,RESEND_API_BASE:resendBase,
      PADDLE_PRODUCT_ID:PRODUCT_ID,PADDLE_PRICE_ID:PRICE_ID,
      PADDLE_CLIENT_TOKEN:CLIENT_TOKEN,PADDLE_API_KEY:API_KEY,
      PADDLE_WEBHOOK_SECRET:WEBHOOK_SECRET,PADDLE_CHECKOUT_ENABLED:"true",
      PADDLE_ENFORCE_IP_ALLOWLIST:"false",PADDLE_API_BASE:paddleBase
    },
    stdio:["ignore","pipe","pipe"]
  });
  base=await new Promise((resolve,reject)=>{
    let output="",settled=false;
    const timer=setTimeout(()=>finish(new Error(`Server startup timed out. ${appErrors}`)),5000);
    function finish(error,value){
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      error?reject(error):resolve(value);
    }
    app.stdout.on("data",(chunk)=>{
      output=(output+chunk.toString()).slice(-4096);
      const match=output.match(/Strata running at http:\/\/127\.0\.0\.1:(\d+)/);
      if(match)finish(null,`http://127.0.0.1:${match[1]}`);
    });
    app.stderr.on("data",(chunk)=>{appErrors=(appErrors+chunk.toString()).slice(-8192);});
    app.once("error",finish);
    app.once("exit",(code,signal)=>finish(new Error(`Server exited before startup (${code??signal??"unknown"}). ${appErrors}`)));
  });
}

async function closeServer(server){
  if(!server?.listening)return;
  await new Promise((resolve,reject)=>server.close((error)=>error?reject(error):resolve()));
}

async function stopApp(){
  const child=app;
  app=undefined;
  if(child&&child.exitCode===null&&child.signalCode===null){
    await new Promise((resolve)=>{
      let timer;
      child.once("exit",()=>{clearTimeout(timer);resolve();});
      child.kill("SIGTERM");
      timer=setTimeout(()=>child.kill("SIGKILL"),2000);
    });
  }
}

async function request(path,options={}){
  const response=await fetch(`${base}${path}`,options);
  const contentType=response.headers.get("content-type")||"";
  const data=contentType.includes("json")?await response.json():await response.text();
  return {response,data,setCookie:response.headers.get("set-cookie")||""};
}

function cookieValue(header,name){
  const match=String(header).match(new RegExp(`(?:^|,\\s*)${name}=([^;,]*)`));
  return match?`${name}=${match[1]}`:"";
}

function jsonRequest(path,body,{cookie="",csrf="",method="POST",origin=true}={}){
  requestAddressOctet=requestAddressOctet%240+1;
  const headers={"Content-Type":"application/json","X-Forwarded-For":`198.51.100.${requestAddressOctet}`};
  if(origin)headers.Origin=base;
  if(cookie)headers.Cookie=cookie;
  if(csrf)headers["X-CSRF-Token"]=csrf;
  return request(path,{method,headers,body:JSON.stringify(body)});
}

function verificationCode(delivery){
  const match=String(delivery?.body?.text||"").match(/code is ([0-9]{6})\./i);
  assert.ok(match,"verification delivery must contain a six-digit code");
  return match[1];
}

function actionToken(delivery){
  const match=String(delivery?.body?.text||"").match(/#token=([A-Za-z0-9_-]{43})/);
  assert.ok(match,"account-action delivery must contain a URL-fragment token");
  return match[1];
}

function latestDelivery(subject){
  const delivery=[...deliveries].reverse().find((item)=>item.body?.subject===subject);
  assert.ok(delivery,`expected email with subject: ${subject}`);
  return delivery;
}

async function verifiedSignup({name,email,password}){
  const before=deliveries.length;
  const signup=await jsonRequest("/api/signup",{name,email,password});
  assert.equal(signup.response.status,202);
  assert.equal(deliveries.length,before+1);
  const signupCookie=cookieValue(signup.setCookie,"strata_signup");
  assert.ok(signupCookie);
  const code=verificationCode(deliveries.at(-1));
  const verified=await jsonRequest("/api/verify-email",{code},{cookie:signupCookie});
  assert.equal(verified.response.status,201);
  const cookie=cookieValue(verified.setCookie,"strata_session");
  assert.ok(cookie);
  const me=await request("/api/me",{headers:{Cookie:cookie}});
  assert.equal(me.response.status,200);
  return {cookie,csrfToken:me.data.csrfToken,user:me.data.user,password};
}

async function login(email,password){
  return jsonRequest("/api/login",{email,password});
}

async function accountForCookie(cookie){
  const me=await request("/api/me",{headers:{Cookie:cookie}});
  assert.equal(me.response.status,200);
  return {cookie,csrfToken:me.data.csrfToken,user:me.data.user};
}

async function checkout(account){
  return jsonRequest("/api/billing/checkout",{},
    {cookie:account.cookie,csrf:account.csrfToken});
}

let eventSequence=0;
function eventId(label){
  eventSequence+=1;
  const safe=String(label).toLowerCase().replace(/[^a-z0-9]/g,"").slice(0,8);
  return `evt_${safe}${String(eventSequence).padStart(24-safe.length,"0")}`;
}

function completedEvent(transactionId,userId,label="complete"){
  const occurredAt=new Date(Date.now()+eventSequence).toISOString();
  const id=eventId(label);
  return {
    event_id:id,
    event_type:"transaction.completed",
    occurred_at:occurredAt,
    notification_id:`ntf_${id.slice(4)}`,
    data:{
      id:transactionId,status:"completed",
      customer_id:"ctm_000000000000000000000001",
      subscription_id:null,collection_mode:"automatic",updated_at:occurredAt,
      custom_data:{strata_user_id:userId,strata_version:1},
      items:[{quantity:1,price:{id:PRICE_ID,product_id:PRODUCT_ID,billing_cycle:null}}],
      details:{totals:{subtotal:"599",discount:"0",tax:"0",total:"599"}}
    }
  };
}

function adjustmentEvent(transactionId,label="partial"){
  const id=eventId(label);
  return {
    event_id:id,event_type:"adjustment.created",
    occurred_at:new Date(Date.now()+eventSequence).toISOString(),
    notification_id:`ntf_${id.slice(4)}`,
    data:{
      id:`adj_${String(eventSequence).padStart(24,"0")}`,
      transaction_id:transactionId,action:"refund",type:"partial",status:"approved"
    }
  };
}

async function signedWebhook(event){
  const raw=JSON.stringify(event);
  const timestamp=Math.floor(Date.now()/1000);
  const signature=createHmac("sha256",WEBHOOK_SECRET).update(`${timestamp}:${raw}`).digest("hex");
  return request("/api/paddle/webhook",{
    method:"POST",
    headers:{"Content-Type":"application/json","Paddle-Signature":`ts=${timestamp};h1=${signature}`},
    body:raw
  });
}

function database(options={}){
  return new DatabaseSync(join(runtimeDir,"strata.sqlite"),options);
}

function planFixture(){
  const days={Monday:[],Tuesday:[],Wednesday:[],Thursday:[],Friday:[],Saturday:[],Sunday:[]};
  days.Monday.push({instanceId:"recovery-plan-001",exerciseId:"flat-dumbbell-press",sets:4,reps:"8–12"});
  return {version:1,restDay:"Sunday",days};
}

const ratingFixture={comfort:5,pump:4,enjoyment:5,stability:4,setup:3,overall:5};
const preferencesFixture={
  goal:"strength",level:"Intermediate",days:4,
  equipment:["Dumbbells","Bodyweight"],preferences:["stable"],limitations:[]
};

test.before(async()=>{
  await startResend();
  await startPaddle();
  try{await startApp();}
  catch(error){
    await closeServer(resend);
    await closeServer(paddle);
    throw error;
  }
});

test.after(async()=>{
  await stopApp();
  await closeServer(resend);
  await closeServer(paddle);
  if(runtimeDir)rmSync(runtimeDir,{recursive:true,force:true});
});

test("password recovery is private, preserves account data, and revokes every session",async()=>{
  const originalPassword="original-recovery-password-123";
  const resetPassword="forgotten-flow-password-456";
  const signedInPassword="signed-in-flow-password-789";
  const email="recover-me@example.test";
  const account=await verifiedSignup({name:"Recovery Lifter",email,password:originalPassword});

  const secondLogin=await login(email,originalPassword);
  assert.equal(secondLogin.response.status,200);
  const secondCookie=cookieValue(secondLogin.setCookie,"strata_session");
  assert.ok(secondCookie);

  const prepared=await checkout(account);
  assert.equal(prepared.response.status,201);
  const transactionId=prepared.data.transactionId;
  const completed=await signedWebhook(completedEvent(transactionId,account.user.id,"recover"));
  assert.equal(completed.response.status,200);
  assert.equal(completed.data.outcome,"granted");
  const adjustment=await signedWebhook(adjustmentEvent(transactionId,"recoveradj"));
  assert.equal(adjustment.response.status,200);
  assert.equal(adjustment.data.outcome,"adjustment-recorded");

  const plan=await jsonRequest("/api/plan",{plan:planFixture()},{cookie:account.cookie,method:"PUT"});
  assert.equal(plan.response.status,200);
  const rating=await jsonRequest("/api/ratings/flat-dumbbell-press",{rating:ratingFixture},{cookie:account.cookie,csrf:account.csrfToken,method:"PUT"});
  assert.equal(rating.response.status,200);
  const preferences=await jsonRequest("/api/preferences",{preferences:preferencesFixture},{cookie:account.cookie,method:"PUT"});
  assert.equal(preferences.response.status,200);

  const beforeEmails=deliveries.length;
  const unknown=await jsonRequest("/api/password-reset/request",{email:"nobody-here@example.test"});
  const known=await jsonRequest("/api/password-reset/request",{email});
  assert.equal(unknown.response.status,202);
  assert.equal(known.response.status,202);
  assert.deepEqual(unknown.data,known.data,"forgot-password must not reveal whether an email is registered");
  assert.equal(deliveries.length,beforeEmails+1,"only a registered mailbox should receive a recovery email");
  const recoveryDelivery=latestDelivery("Reset your STRATA password");
  assert.deepEqual(recoveryDelivery.body.to,[email]);
  assert.equal(recoveryDelivery.headers.authorization,`Bearer ${EMAIL_API_KEY}`);
  const token=actionToken(recoveryDelivery);

  const tokenStatus=await jsonRequest("/api/password-reset/status",{token});
  assert.equal(tokenStatus.response.status,200);
  assert.equal(tokenStatus.data.active,true);
  assert.equal(tokenStatus.data.maskedEmail,"r******e@example.test");

  const reset=await jsonRequest("/api/password-reset/complete",{
    token,password:resetPassword,confirmation:resetPassword
  });
  assert.equal(reset.response.status,200);
  assert.equal(reset.data.ok,true);
  assert.match(reset.setCookie,/strata_session=;.*Max-Age=0/i);

  for(const cookie of [account.cookie,secondCookie]){
    const revoked=await request("/api/me",{headers:{Cookie:cookie}});
    assert.equal(revoked.response.status,401,"password reset must revoke every existing session");
  }
  const oldLogin=await login(email,originalPassword);
  assert.equal(oldLogin.response.status,401);
  const newLogin=await login(email,resetPassword);
  assert.equal(newLogin.response.status,200);
  const resetCookie=cookieValue(newLogin.setCookie,"strata_session");
  const resetAccount=await accountForCookie(resetCookie);
  assert.equal(resetAccount.user.id,account.user.id,"password reset must retain the account identity");
  assert.equal(resetAccount.user.discovery.active,true,"password reset must retain Discovery access");

  const restoredPlan=await request("/api/plan",{headers:{Cookie:resetCookie}});
  const restoredDiscovery=await request("/api/discovery",{headers:{Cookie:resetCookie}});
  assert.equal(restoredPlan.response.status,200);
  assert.deepEqual(restoredPlan.data.plan,plan.data.plan);
  assert.equal(restoredDiscovery.response.status,200);
  assert.equal(restoredDiscovery.data.ratings.user.length,1);
  assert.equal(restoredDiscovery.data.ratings.user[0].exercise_id,"flat-dumbbell-press");

  {
    const db=database({readOnly:true});
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM plans WHERE user_id=?").get(account.user.id).count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM preferences WHERE user_id=?").get(account.user.id).count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM ratings WHERE user_id=?").get(account.user.id).count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paddle_purchases WHERE user_id=? AND transaction_id=?").get(account.user.id,transactionId).count,1);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paddle_adjustments WHERE transaction_id=?").get(transactionId).count,1);
    assert.ok(db.prepare("SELECT auth_version FROM users WHERE id=?").get(account.user.id).auth_version>=2);
    db.close();
  }

  const noCsrf=await jsonRequest("/api/account/password-reset/request",{}, {cookie:resetCookie});
  assert.equal(noCsrf.response.status,403);
  assert.equal(noCsrf.data.code,"INVALID_CSRF");
  const wrongCsrf=await jsonRequest("/api/account/password-reset/request",{}, {cookie:resetCookie,csrf:"wrong-token"});
  assert.equal(wrongCsrf.response.status,403);
  assert.equal(wrongCsrf.data.code,"INVALID_CSRF");
  const beforeSignedInEmail=deliveries.length;
  const signedInRequest=await jsonRequest("/api/account/password-reset/request",{},
    {cookie:resetCookie,csrf:resetAccount.csrfToken});
  assert.equal(signedInRequest.response.status,202);
  assert.equal(deliveries.length,beforeSignedInEmail+1);
  const signedInDelivery=deliveries.at(-1);
  assert.equal(signedInDelivery.body.subject,"Reset your STRATA password");
  assert.deepEqual(signedInDelivery.body.to,[email],"signed-in reset must always go to the registered email");

  const signedInToken=actionToken(signedInDelivery);
  const signedInReset=await jsonRequest("/api/password-reset/complete",{
    token:signedInToken,password:signedInPassword,confirmation:signedInPassword
  });
  assert.equal(signedInReset.response.status,200);
  assert.equal((await request("/api/me",{headers:{Cookie:resetCookie}})).response.status,401);
  assert.equal((await login(email,resetPassword)).response.status,401);
  const finalLogin=await login(email,signedInPassword);
  assert.equal(finalLogin.response.status,200);
  assert.equal(finalLogin.data.user.id,account.user.id);
  assert.equal(finalLogin.data.user.discovery.active,true);

  const replayedReset=await jsonRequest("/api/password-reset/complete",{
    token:signedInToken,password:"another-password-123",confirmation:"another-password-123"
  });
  assert.equal(replayedReset.response.status,400,"a recovery link must work only once");
  assert.equal(replayedReset.data.code,"INVALID_RESET_LINK");
});

test("account deletion requires email confirmation, supports cancel, blocks pending checkout, and cannot be undone by a late webhook",async()=>{
  const abandoned=await verifiedSignup({
    name:"Abandoned Checkout",email:"abandoned-checkout@example.test",password:"abandoned-checkout-password-123"
  });
  const abandonedCheckout=await checkout(abandoned);
  assert.equal(abandonedCheckout.response.status,201);
  {
    const db=database();
    db.prepare("UPDATE paddle_purchases SET updated_at=? WHERE transaction_id=?").run(Date.now()-31*60*1000,abandonedCheckout.data.transactionId);
    db.close();
  }
  const paddleBefore=paddleRequests.length;
  const abandonedDeleteRequest=await jsonRequest("/api/account/delete/request",{},
    {cookie:abandoned.cookie,csrf:abandoned.csrfToken});
  assert.equal(abandonedDeleteRequest.response.status,202);
  assert.equal(paddleRequests.length,paddleBefore,"requesting a deletion email must not mutate a Paddle checkout");
  const abandonedDeleteToken=actionToken(latestDelivery("Confirm deletion of your STRATA account"));
  const abandonedDeleted=await jsonRequest("/api/account/delete/complete",{token:abandonedDeleteToken,confirmation:"DELETE"});
  assert.equal(abandonedDeleted.response.status,200,"a confirmed deletion should close an abandoned checkout instead of blocking forever");
  assert.deepEqual(paddleRequests.slice(paddleBefore).map((entry)=>entry.method),["GET","PATCH"]);
  assert.equal(paddleTransactions.get(abandonedCheckout.data.transactionId).status,"canceled");

  const repaired=await verifiedSignup({
    name:"Recovered Checkout",email:"recovered-checkout@example.test",password:"recovered-checkout-password-123"
  });
  const repairedCheckout=await checkout(repaired);
  assert.equal(repairedCheckout.response.status,201);
  const repairedEvent=completedEvent(repairedCheckout.data.transactionId,repaired.user.id,"missed-webhook");
  paddleTransactions.set(repairedCheckout.data.transactionId,{...repairedEvent.data,status:"completed"});
  {
    const db=database();
    db.prepare("UPDATE paddle_purchases SET paddle_status='completed',completed_at=NULL,updated_at=? WHERE transaction_id=?")
      .run(Date.now()-31*60*1000,repairedCheckout.data.transactionId);
    db.close();
  }
  const repairedDeleteRequest=await jsonRequest("/api/account/delete/request",{},
    {cookie:repaired.cookie,csrf:repaired.csrfToken});
  assert.equal(repairedDeleteRequest.response.status,202);
  const repairedToken=actionToken(latestDelivery("Confirm deletion of your STRATA account"));
  const repairedDelete=await jsonRequest("/api/account/delete/complete",{token:repairedToken,confirmation:"DELETE"});
  assert.equal(repairedDelete.response.status,200,"a valid remotely completed checkout should be repaired before confirmed deletion");

  const email="delete-me@example.test";
  const account=await verifiedSignup({
    name:"Deletion Lifter",email,password:"deletion-password-123"
  });

  const firstRequest=await jsonRequest("/api/account/delete/request",{},
    {cookie:account.cookie,csrf:account.csrfToken});
  assert.equal(firstRequest.response.status,202);
  const firstDelivery=latestDelivery("Confirm deletion of your STRATA account");
  assert.deepEqual(firstDelivery.body.to,[email]);
  const firstToken=actionToken(firstDelivery);
  const firstStatus=await jsonRequest("/api/account/delete/status",{token:firstToken});
  assert.equal(firstStatus.response.status,200);
  assert.equal(firstStatus.data.active,true);
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).data.user.accountDeletion.pending,true);

  const canceled=await jsonRequest("/api/account/delete/cancel",{},
    {cookie:account.cookie,csrf:account.csrfToken});
  assert.equal(canceled.response.status,200);
  assert.equal(canceled.data.ok,true);
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).data.user.accountDeletion.pending,false);
  const canceledStatus=await jsonRequest("/api/account/delete/status",{token:firstToken});
  assert.equal(canceledStatus.data.active,false);
  const canceledCompletion=await jsonRequest("/api/account/delete/complete",{token:firstToken,confirmation:"DELETE"});
  assert.equal(canceledCompletion.response.status,400);
  assert.equal(canceledCompletion.data.code,"INVALID_DELETE_LINK");
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).response.status,200);

  const pending=await checkout(account);
  assert.equal(pending.response.status,201);
  const transactionId=pending.data.transactionId;
  const pendingDeleteRequest=await jsonRequest("/api/account/delete/request",{},
    {cookie:account.cookie,csrf:account.csrfToken});
  assert.equal(pendingDeleteRequest.response.status,202,"requesting an email is safe while checkout is pending");
  const pendingDeleteToken=actionToken(latestDelivery("Confirm deletion of your STRATA account"));
  const blocked=await jsonRequest("/api/account/delete/complete",{token:pendingDeleteToken,confirmation:"DELETE"});
  assert.equal(blocked.response.status,409,"a fresh pending checkout must block final deletion");
  assert.equal(blocked.data.code,"PURCHASE_PENDING");

  const granted=await signedWebhook(completedEvent(transactionId,account.user.id,"delete"));
  assert.equal(granted.response.status,200);
  assert.equal(granted.data.outcome,"granted");
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).data.user.discovery.active,true);

  const savedPlan=await jsonRequest("/api/plan",{plan:planFixture()},{cookie:account.cookie,method:"PUT"});
  const savedPreferences=await jsonRequest("/api/preferences",{preferences:preferencesFixture},{cookie:account.cookie,method:"PUT"});
  const savedRating=await jsonRequest("/api/ratings/flat-dumbbell-press",{rating:ratingFixture},{cookie:account.cookie,csrf:account.csrfToken,method:"PUT"});
  assert.equal(savedPlan.response.status,200);
  assert.equal(savedPreferences.response.status,200);
  assert.equal(savedRating.response.status,200);

  const deleteToken=pendingDeleteToken;
  let verificationChallengeIds;
  {
    const db=database({readOnly:true});
    verificationChallengeIds=db.prepare("SELECT challenge_id FROM signup_verifications WHERE user_id=?").all(account.user.id).map((row)=>row.challenge_id);
    assert.ok(verificationChallengeIds.length>0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM account_action_sends WHERE purpose='account_delete'").get().count,2);
    db.close();
  }

  const wrongConfirmation=await jsonRequest("/api/account/delete/complete",{
    token:deleteToken,confirmation:"delete"
  });
  assert.equal(wrongConfirmation.response.status,400);
  assert.equal(wrongConfirmation.data.code,"DELETE_CONFIRMATION_REQUIRED");
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).response.status,200);

  const deleted=await jsonRequest("/api/account/delete/complete",{
    token:deleteToken,confirmation:"DELETE"
  });
  assert.equal(deleted.response.status,200);
  assert.equal(deleted.data.ok,true);
  assert.match(deleted.setCookie,/strata_session=;.*Max-Age=0/i);
  assert.equal((await request("/api/me",{headers:{Cookie:account.cookie}})).response.status,401);
  assert.equal((await login(email,"deletion-password-123")).response.status,401);

  {
    const db=database({readOnly:true});
    for(const table of ["users","sessions","plans","preferences","ratings","paddle_purchases","account_action_requests","signup_verifications"]){
      const column=table==="users"?"id":table==="signup_verifications"?"user_id":"user_id";
      assert.equal(db.prepare(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column}=?`).get(account.user.id).count,0,`${table} should not retain deleted account data`);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paddle_adjustments WHERE transaction_id=?").get(transactionId).count,0);
    for(const challengeId of verificationChallengeIds){
      assert.equal(db.prepare("SELECT COUNT(*) AS count FROM email_verification_sends WHERE challenge_id=?").get(challengeId).count,0);
    }
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM account_action_sends WHERE purpose='account_delete'").get().count,0);
    db.close();
  }

  const lateEvent=completedEvent(transactionId,account.user.id,"late");
  const late=await signedWebhook(lateEvent);
  assert.equal(late.response.status,200);
  assert.equal(late.data.outcome,"ignored:unknown-transaction");
  {
    const db=database({readOnly:true});
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM users WHERE id=?").get(account.user.id).count,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paddle_purchases WHERE transaction_id=?").get(transactionId).count,0);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM paddle_webhook_events WHERE event_id=?").get(lateEvent.event_id).count,1);
    db.close();
  }
});
