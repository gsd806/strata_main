"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {mkdirSync,mkdtempSync,rmSync}=require("node:fs");
const {join}=require("node:path");
const {DatabaseSync}=require("node:sqlite");

const ROOT=join(__dirname,"..");
let child,base,directory;

async function launch(){
  mkdirSync(join(ROOT,"test-runtime"),{recursive:true});
  directory=mkdtempSync(join(ROOT,"test-runtime","product-signals-http-"));
  child=spawn(process.execPath,["server.js"],{
    cwd:ROOT,
    env:{...process.env,PORT:"0",HOST:"127.0.0.1",NODE_ENV:"test",STRATA_DATA_DIR:directory,TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",ADMIN_EMAIL:"",EMAIL_VERIFICATION_ENABLED:"false",ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS:"true",PADDLE_CHECKOUT_ENABLED:"false",PADDLE_CLIENT_TOKEN:"",PADDLE_API_KEY:"",PADDLE_WEBHOOK_SECRET:"",PADDLE_PRODUCT_ID:"",PADDLE_PRICE_ID:""},
    stdio:["ignore","pipe","pipe"]
  });
  base=await new Promise((resolve,reject)=>{
    let output="",errors="";
    const timer=setTimeout(()=>reject(new Error(`Server startup timed out. ${errors}`)),6000);
    child.stdout.on("data",(chunk)=>{
      output=(output+chunk.toString()).slice(-4096);
      const match=output.match(/Strata running at http:\/\/127\.0\.0\.1:(\d+)/);
      if(match){clearTimeout(timer);resolve(`http://127.0.0.1:${match[1]}`);}
    });
    child.stderr.on("data",(chunk)=>{errors=(errors+chunk.toString()).slice(-4096);});
    child.once("error",reject);
    child.once("exit",(code)=>reject(new Error(`Server exited during startup (${code}). ${errors}`)));
  });
}

async function stop(){
  if(child&&child.exitCode===null&&child.signalCode===null){
    await new Promise((resolve)=>{let timer;child.once("exit",()=>{clearTimeout(timer);resolve();});child.kill("SIGTERM");timer=setTimeout(()=>child.kill("SIGKILL"),2000);});
  }
  if(directory)rmSync(directory,{recursive:true,force:true});
}

async function request(path,options={}){
  const response=await fetch(`${base}${path}`,options);
  const data=await response.json();
  return {response,data};
}

test.before(launch);
test.after(stop);

test("the production route accepts consented same-origin counts without creating identity records",async()=>{
  const missingOrigin=await request("/api/product-signals",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({event:"preview_generated"})});
  assert.equal(missingOrigin.response.status,403);
  assert.equal(missingOrigin.data.code,"PRODUCT_SIGNAL_ORIGIN_REQUIRED");

  const extraDetail=await request("/api/product-signals",{method:"POST",headers:{Origin:base,"Content-Type":"application/json"},body:JSON.stringify({event:"preview_generated",url:"/private",exerciseId:"private"})});
  assert.equal(extraDetail.response.status,400);
  assert.equal(extraDetail.data.code,"PRODUCT_SIGNAL_INVALID");

  for(const event of ["preview_generated","preview_generated","recommendation_feedback_useful"]){
    const accepted=await request("/api/product-signals",{method:"POST",headers:{Origin:base,"Content-Type":"application/json",Cookie:"strata_session=irrelevant"},body:JSON.stringify({event})});
    assert.equal(accepted.response.status,202);
    assert.deepEqual(accepted.data,{accepted:true});
    assert.equal(accepted.response.headers.get("set-cookie"),null);
    assert.equal(accepted.response.headers.get("cache-control"),"no-store");
  }

  const database=new DatabaseSync(join(directory,"strata.sqlite"),{readOnly:true});
  try{
    const columns=database.prepare("PRAGMA table_info(product_signal_counts)").all().map((row)=>row.name);
    assert.deepEqual(columns,["event_day","event_name","event_count"]);
    const rows=database.prepare("SELECT event_name,event_count FROM product_signal_counts ORDER BY event_name").all().map((row)=>({...row}));
    assert.deepEqual(rows,[
      {event_name:"preview_generated",event_count:2},
      {event_name:"recommendation_feedback_useful",event_count:1}
    ]);
  }finally{database.close();}
});

test("aggregate readout is admin-only and methods stay narrow",async()=>{
  const denied=await request("/api/admin/product-signals?days=30");
  assert.equal(denied.response.status,401);

  const publicRead=await request("/api/product-signals");
  assert.equal(publicRead.response.status,405);
  assert.equal(publicRead.response.headers.get("allow"),"POST");

  const wrongType=await request("/api/product-signals",{method:"POST",headers:{Origin:base,"Content-Type":"text/plain"},body:"preview_generated"});
  assert.equal(wrongType.response.status,415);
  assert.equal(wrongType.data.code,"JSON_REQUIRED");
});
