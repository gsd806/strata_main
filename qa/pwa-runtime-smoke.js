"use strict";

const assert=require("node:assert/strict");
const {spawn}=require("node:child_process");
const {mkdirSync,mkdtempSync,rmSync}=require("node:fs");
const {join}=require("node:path");

const ROOT=join(__dirname,"..");
const BUILD=require("../package.json").version;
const runtimeRoot=join(ROOT,"test-runtime");
mkdirSync(runtimeRoot,{recursive:true});
const runtimeDir=mkdtempSync(join(runtimeRoot,"pwa-smoke-"));
let child;

function startServer() {
  child=spawn(process.execPath,["server.js"],{
    cwd:ROOT,
    env:{...process.env,PORT:"0",HOST:"127.0.0.1",NODE_ENV:"test",TURSO_DATABASE_URL:"",TURSO_AUTH_TOKEN:"",STRATA_DATA_DIR:runtimeDir},
    stdio:["ignore","pipe","pipe"]
  });
  return new Promise((resolve,reject)=>{
    let output="",settled=false;
    const timer=setTimeout(()=>finish(new Error("PWA smoke server startup timed out")),5000);
    function finish(error,value) {
      if(settled)return;
      settled=true;
      clearTimeout(timer);
      if(error)reject(error);else resolve(value);
    }
    child.stdout.on("data",(chunk)=>{
      output=(output+chunk.toString()).slice(-4096);
      const match=output.match(/Strata running at http:\/\/127\.0\.0\.1:(\d+)/);
      if(match)finish(null,`http://127.0.0.1:${match[1]}`);
    });
    child.stderr.on("data",(chunk)=>process.stderr.write(chunk));
    child.once("error",finish);
    child.once("exit",(code,signal)=>finish(new Error(`PWA smoke server exited before startup (${code??signal??"unknown"})`)));
  });
}

async function stopServer() {
  if(child&&child.exitCode===null&&child.signalCode===null) {
    await new Promise((resolve)=>{
      let timer;
      child.once("exit",()=>{clearTimeout(timer);resolve();});
      child.kill("SIGTERM");
      timer=setTimeout(()=>child.kill("SIGKILL"),2000);
    });
  }
  rmSync(runtimeDir,{recursive:true,force:true});
}

async function main() {
  const base=await startServer();
  const get=async(path)=>{
    const response=await fetch(`${base}${path}`,{redirect:"manual"});
    return {response,body:await response.arrayBuffer()};
  };

  const install=await get("/install");
  const installText=Buffer.from(install.body).toString("utf8");
  assert.equal(install.response.status,200);
  assert.match(install.response.headers.get("content-type"),/^text\/html/);
  assert.match(install.response.headers.get("cache-control"),/no-cache/);
  assert.match(installText,/PUT STRATA/);
  assert.match(installText,/data-platform="ios"/);
  assert.match(installText,/data-platform="android"/);

  const manifestResponse=await get("/manifest.webmanifest");
  const manifest=JSON.parse(Buffer.from(manifestResponse.body).toString("utf8"));
  assert.equal(manifestResponse.response.status,200);
  assert.match(manifestResponse.response.headers.get("content-type"),/^application\/manifest\+json/);
  assert.match(manifestResponse.response.headers.get("cache-control"),/no-cache/);
  assert.equal(manifest.start_url,"/");
  assert.equal(manifest.display,"standalone");

  const worker=await get("/service-worker.js");
  const workerText=Buffer.from(worker.body).toString("utf8");
  assert.equal(worker.response.status,200);
  assert.match(worker.response.headers.get("content-type"),/^text\/javascript/);
  assert.equal(worker.response.headers.get("service-worker-allowed"),"/");
  assert.match(worker.response.headers.get("cache-control"),/no-cache/);
  assert.match(workerText,/pathname\.startsWith\("\/api\/"\)/);
  assert.match(workerText,/pathname\.startsWith\("\/auth\/"\)/);
  assert.match(workerText,/pathname==="\/healthz"/);

  for(const [url,size] of [["/icons/strata-192.png",192],["/icons/strata-512.png",512],["/icons/strata-maskable-512.png",512],["/icons/apple-touch-icon.png",180]]) {
    const icon=await get(url),body=Buffer.from(icon.body);
    assert.equal(icon.response.status,200,url);
    assert.equal(icon.response.headers.get("content-type"),"image/png",url);
    assert.equal(body.readUInt32BE(16),size,url);
    assert.equal(body.readUInt32BE(20),size,url);
  }

  const home=await get("/");
  const homeText=Buffer.from(home.body).toString("utf8");
  assert.equal(home.response.headers.get("cache-control"),"private, no-store");
  assert.match(home.response.headers.get("content-security-policy"),/worker-src 'self'/);
  assert.match(home.response.headers.get("content-security-policy"),/manifest-src 'self'/);
  assert.match(homeText,/href="\/manifest\.webmanifest"/);
  assert.match(homeText,/href="\/install\.html"/);

  const protectedPage=await get("/planner.html");
  assert.equal(protectedPage.response.status,302);
  assert.match(protectedPage.response.headers.get("location"),/^\/account\.html\?/);

  for(const route of ["/forgot-password","/reset-password","/delete-account"]) {
    const page=await get(route);
    const pageText=Buffer.from(page.body).toString("utf8");
    assert.equal(page.response.status,200,route);
    assert.equal(page.response.headers.get("cache-control"),"private, no-store",route);
    assert.match(pageText,new RegExp(`Build ${BUILD.replace(/\./g,"\\.")}`),route);
  }

  const status=await fetch(`${base}/api/status`).then((response)=>response.json());
  assert.equal(status.ok,true);
  assert.equal(status.build,BUILD);
  assert.equal(typeof status.passwordResetEnabled,"boolean");
  assert.equal(typeof status.accountDeletionEnabled,"boolean");

  console.log(JSON.stringify({
    installGuide:true,
    manifest:true,
    serviceWorker:true,
    icons:true,
    privatePagesRemainNetworkOnly:true,
    accountRecoveryPages:true,
    build:BUILD
  },null,2));
}

main().catch((error)=>{console.error(error);process.exitCode=1;}).finally(stopServer);
