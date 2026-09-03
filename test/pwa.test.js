"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");

const PROJECT_ROOT=path.join(__dirname,"..");
const PUBLIC_ROOT=path.join(PROJECT_ROOT,"public");
const read=(name)=>fs.readFileSync(path.join(PUBLIC_ROOT,name),"utf8");
const readProject=(name)=>fs.readFileSync(path.join(PROJECT_ROOT,name),"utf8");
const BUILD=JSON.parse(readProject("package.json")).version;
const escapeRegExp=(value)=>String(value).replace(/[.*+?^${}()|[\]\\]/g,"\\$&");

function pngDimensions(file) {
  const body=fs.readFileSync(path.join(PUBLIC_ROOT,file));
  assert.deepEqual([...body.subarray(0,8)],[137,80,78,71,13,10,26,10],`${file} must be a PNG`);
  assert.equal(body.subarray(12,16).toString("ascii"),"IHDR",`${file} must start with an IHDR chunk`);
  return {width:body.readUInt32BE(16),height:body.readUInt32BE(20)};
}

function serviceWorkerHarness() {
  const listeners={},precache=[],offlineResponse={kind:"offline"},networkResponse={kind:"network"};
  const pageResponses=new Map(["install","pricing","contact","terms","privacy","refunds"].map((name)=>[`/${name}.html`,{kind:name}]));
  let networkFails=false;
  const cache={
    async addAll(urls){precache.push(...urls);},
    async match(request){
      const value=typeof request==="string"?request:new URL(request.url).pathname;
      return value==="/offline.html"?offlineResponse:pageResponses.get(value);
    },
    async put(){}
  };
  const context={
    URL,Response,
    self:{
      location:{origin:"https://strata.test"},
      addEventListener(type,handler){listeners[type]=handler;},
      async skipWaiting(){},
      clients:{async claim(){}}
    },
    caches:{
      async open(){return cache;},
      async match(request){return cache.match(request);},
      async keys(){return [];},
      async delete(){return true;}
    },
    async fetch(){if(networkFails)throw new Error("offline");return networkResponse;}
  };
  vm.createContext(context);
  vm.runInContext(read("service-worker.js"),context,{filename:"service-worker.js"});
  return {listeners,precache,offlineResponse,networkResponse,pageResponses,setOffline(value){networkFails=value;}};
}

function dispatchServiceWorkerFetch(handler,pathName,{method="GET",mode="same-origin",origin="https://strata.test"}={}) {
  let response;
  handler({
    request:{method,mode,url:`${origin}${pathName}`},
    respondWith(value){response=Promise.resolve(value);}
  });
  return response;
}

function browserHarness(scriptName,{userAgent="Mozilla/5.0",maxTouchPoints=0,pwa}={}) {
  const listeners={};
  const window={
    listeners,
    addEventListener(type,handler){(listeners[type]||=[]).push(handler);},
    dispatchEvent(event){for(const handler of listeners[event.type]||[])handler(event);return true;},
    matchMedia(){return {matches:false};}
  };
  const registrations=[];
  const navigator={
    userAgent,maxTouchPoints,standalone:false,
    serviceWorker:{async register(...args){registrations.push(args);return {scope:"https://strata.test/"};}}
  };
  if(pwa)window.StrataPWA=pwa;
  const context={window,navigator,location:{protocol:"https:"},console};
  context.CustomEvent=class CustomEvent{constructor(type,options={}){this.type=type;this.detail=options.detail;}};
  return {context,window,navigator,listeners,registrations,run(){vm.createContext(context);vm.runInContext(read(`scripts/${scriptName}`),context,{filename:scriptName});}};
}

class FakeElement {
  constructor(){this.hidden=true;this.disabled=false;this.textContent="";this.innerHTML="";this.listeners={};this.classList={values:new Set(),add:(name)=>this.classList.values.add(name),contains:(name)=>this.classList.values.has(name)};}
  addEventListener(type,handler){(this.listeners[type]||=[]).push(handler);}
  async emit(type){for(const handler of this.listeners[type]||[])await handler({type});}
}

test("release version, cache keys, asset URLs, and catalog claims stay aligned",()=>{
  const exercises=JSON.parse(read("data/exercises.json"));
  const version=BUILD,versionPattern=escapeRegExp(version);
  const serviceWorker=read("service-worker.js");
  const pages=["index.html","account.html","verify-email.html","planner.html","discover.html","install.html","offline.html","pricing.html","contact.html","terms.html","privacy.html","refunds.html"];

  assert.equal(version,"6.7.1");
  assert.match(serviceWorker,new RegExp(`const BUILD="${versionPattern}";`));
  assert.match(serviceWorker,/const CACHE_PREFIX="strata-static-";/);
  assert.match(serviceWorker,/const STATIC_CACHE=`\$\{CACHE_PREFIX\}\$\{BUILD\}`;/);
  assert.match(serviceWorker,new RegExp(`"/exercises\\.json\\?v=${versionPattern}"`));
  assert.doesNotMatch(serviceWorker,/"\/exercises\.json"/);

  for(const page of pages){
    const html=read(`pages/${page}`);
    assert.match(html,new RegExp(`Build ${versionPattern}`),`${page} visible build label`);
    const localAssets=[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)]
      .map((match)=>new URL(match[1],"https://strata.test"))
      .filter((url)=>url.origin==="https://strata.test");
    assert.ok(localAssets.length>0,`${page} must load a local versioned script or stylesheet`);
    for(const asset of localAssets)assert.equal(asset.searchParams.get("v"),version,`${page} ${asset.pathname} version`);
  }

  for(const entry of [...serviceWorker.matchAll(/"(\/[^"]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map((match)=>match[1])){
    assert.equal(new URL(entry,"https://strata.test").searchParams.get("v"),version,`service-worker precache ${entry}`);
  }
  for(const [file,source] of [["app.js",read("scripts/app.js")],["planner.js",read("scripts/planner.js")]]){
    assert.match(source,new RegExp(`"/exercises\\.json\\?v=${versionPattern}"`),`${file} catalog version`);
    assert.doesNotMatch(source,/"\/exercises\.json"/,`${file} must not request an unversioned catalog`);
  }

  assert.equal(exercises.length,160);
  assert.equal(new Set(exercises.map((exercise)=>exercise.group)).size,8);
  assert.equal(new Set(exercises.map((exercise)=>exercise.sub)).size,26);
  assert.equal(exercises.filter((exercise)=>exercise.equipment==="Bodyweight").length,40);
  const perGroup=Object.values(exercises.reduce((counts,exercise)=>{
    counts[exercise.group]=(counts[exercise.group]||0)+1;
    return counts;
  },{}));
  assert.ok(perGroup.length===8&&perGroup.every((count)=>count===20));

  assert.match(read("pages/index.html"),/ranks 160 resistance exercises across 8 muscle groups and 26 sub-muscle targets/i);
  assert.match(read("pages/index.html"),/id="catalogTotal">160</);
  assert.match(read("pages/discover.html"),/id="catalogTotal">160</);
  assert.match(read("pages/planner.html"),/id="libraryCount">160</);
  assert.match(readProject("README.md"),/160 resistance-training exercises—20 per muscle group, including 40 bodyweight options—across 8 muscle groups and 26 sub-muscle targets/);
});

test("manifest has complete install metadata and correctly sized icons",()=>{
  const manifest=JSON.parse(read("manifest.webmanifest"));
  assert.equal(manifest.id,"/");
  assert.equal(manifest.name,"STRATA Fitness");
  assert.equal(manifest.short_name,"STRATA");
  assert.equal(manifest.start_url,"/");
  assert.equal(manifest.scope,"/");
  assert.match(manifest.display,/^(standalone|fullscreen|minimal-ui)$/);
  assert.match(manifest.theme_color,/^#[0-9a-f]{6}$/i);
  assert.match(manifest.background_color,/^#[0-9a-f]{6}$/i);
  assert.equal(manifest.prefer_related_applications,false);

  const anyIcons=manifest.icons.filter((icon)=>String(icon.purpose||"any").split(/\s+/).includes("any"));
  const maskableIcons=manifest.icons.filter((icon)=>String(icon.purpose||"").split(/\s+/).includes("maskable"));
  const icon192=anyIcons.find((icon)=>icon.sizes.split(/\s+/).includes("192x192"));
  const icon512=anyIcons.find((icon)=>icon.sizes.split(/\s+/).includes("512x512"));
  assert.ok(icon192,"manifest needs a 192×192 any-purpose icon");
  assert.ok(icon512,"manifest needs a 512×512 any-purpose icon");
  assert.ok(maskableIcons.some((icon)=>icon.sizes.split(/\s+/).includes("512x512")),"manifest needs a 512×512 maskable icon");

  for(const icon of manifest.icons) {
    assert.equal(icon.type,"image/png");
    const relative=icon.src.replace(/^\//,"");
    assert.ok(fs.existsSync(path.join(PUBLIC_ROOT,relative)),`${icon.src} must exist`);
    const declared=icon.sizes.match(/^(\d+)x(\d+)$/);
    assert.ok(declared,`${icon.src} must declare one exact size`);
    assert.deepEqual(pngDimensions(relative),{width:Number(declared[1]),height:Number(declared[2])});
  }
  assert.deepEqual(pngDimensions("icons/apple-touch-icon.png"),{width:180,height:180});
});

test("every app page exposes consistent PWA and mobile metadata",()=>{
  const appPages=["index.html","account.html","verify-email.html","planner.html","discover.html","install.html","pricing.html","contact.html","terms.html","privacy.html","refunds.html"];
  for(const page of appPages) {
    const html=read(`pages/${page}`);
    assert.match(html,/<meta\s+name="viewport"\s+content="[^"]*width=device-width[^"]*viewport-fit=cover[^"]*"\s*\/>/i,`${page} viewport`);
    assert.match(html,/<meta\s+name="theme-color"\s+content="#[0-9a-f]{6}"\s*\/>/i,`${page} theme color`);
    assert.match(html,/<meta\s+name="apple-mobile-web-app-capable"\s+content="yes"\s*\/>/i,`${page} iOS app mode`);
    assert.match(html,/<link\s+rel="manifest"\s+href="\/manifest\.webmanifest"\s*\/>/i,`${page} manifest`);
    assert.match(html,/<link\s+rel="apple-touch-icon"\s+href="\/icons\/apple-touch-icon\.png"\s*\/>/i,`${page} Apple icon`);
    assert.match(html,/<script\s+src="\/pwa\.js\?v=[^"]+"><\/script>/i,`${page} PWA registration`);
    if(page!=="install.html")assert.match(html,/href="\/install(?:\.html)?"/,`${page} install guide link`);
  }
  const offline=read("pages/offline.html");
  assert.match(offline,/href="\/manifest\.webmanifest"/);
  assert.match(offline,/Reconnect before signing in, syncing your plan, or saving changes\./);
});

test("service worker precaches only public assets and never handles account APIs",async()=>{
  const harness=serviceWorkerHarness();
  let installPromise;
  harness.listeners.install({waitUntil(value){installPromise=value;}});
  await installPromise;
  assert.ok(harness.precache.includes("/offline.html"));
  assert.ok(harness.precache.includes("/install.html"));
  assert.ok(harness.precache.includes("/manifest.webmanifest"));
  assert.ok(harness.precache.includes(`/exercises.json?v=${BUILD}`));
  for(const page of ["pricing","contact","terms","privacy","refunds"])assert.ok(harness.precache.includes(`/${page}.html`),`${page} must be precached`);
  assert.ok(harness.precache.includes(`/site-info.css?v=${BUILD}`));
  assert.ok(harness.precache.includes(`/pricing.js?v=${BUILD}`));
  assert.ok(harness.precache.some((url)=>url.includes("strata-512.png")));

  const paths=harness.precache.map((entry)=>new URL(entry,"https://strata.test").pathname);
  const privateHtml=["/","/index.html","/account.html","/verify-email","/verify-email.html","/planner.html","/discover.html"];
  for(const forbidden of privateHtml)assert.ok(!paths.includes(forbidden),`${forbidden} must not be precached`);
  assert.ok(!paths.some((entry)=>entry.startsWith("/api/")||entry.startsWith("/auth/")||entry==="/healthz"),"account and health routes must not be precached");

  for(const endpoint of ["/api/status","/api/me","/api/verification-status","/api/verify-email","/api/resend-verification","/api/billing/config","/api/billing/checkout","/api/paddle/webhook","/auth/login","/auth/signup","/auth/verify-email","/auth/resend-verification","/healthz"]) {
    assert.equal(dispatchServiceWorkerFetch(harness.listeners.fetch,endpoint),undefined,`${endpoint} must bypass the service worker`);
  }
  for(const privatePage of ["/index.html","/account.html","/verify-email","/verify-email.html","/planner.html","/discover.html"]) {
    assert.equal(dispatchServiceWorkerFetch(harness.listeners.fetch,privatePage),undefined,`${privatePage} must bypass runtime asset caching`);
  }
  assert.equal(dispatchServiceWorkerFetch(harness.listeners.fetch,"/styles.css",{method:"POST"}),undefined,"writes must never be intercepted");
  assert.equal(dispatchServiceWorkerFetch(harness.listeners.fetch,"/styles.css",{origin:"https://cdn.test"}),undefined,"cross-origin requests must never be intercepted");
});

test("private navigations are network-first and fall back to the non-sensitive offline page",async()=>{
  const harness=serviceWorkerHarness();
  const online=dispatchServiceWorkerFetch(harness.listeners.fetch,"/planner.html",{mode:"navigate"});
  assert.equal(await online,harness.networkResponse);
  harness.setOffline(true);
  const offline=dispatchServiceWorkerFetch(harness.listeners.fetch,"/account.html",{mode:"navigate"});
  assert.equal(await offline,harness.offlineResponse);
});

test("public information pages use their cached page when offline",async()=>{
  const harness=serviceWorkerHarness();
  harness.setOffline(true);
  for(const page of ["pricing","contact","terms","privacy","refunds"]) {
    for(const pathName of [`/${page}`,`/${page}/`,`/${page}.html`]) {
      const response=dispatchServiceWorkerFetch(harness.listeners.fetch,pathName,{mode:"navigate"});
      assert.equal(await response,harness.pageResponses.get(`/${page}.html`),`${pathName} offline fallback`);
    }
  }
  const paddleReturn=dispatchServiceWorkerFetch(harness.listeners.fetch,"/pricing?_ptxn=txn_01m1ky8j916ybyacs836dxbz8x",{mode:"navigate"});
  assert.equal(await paddleReturn,harness.offlineResponse,"Paddle transaction links must never fall back to cached pricing");
});

test("PWA helper registers at full scope and owns the deferred install prompt",async()=>{
  const harness=browserHarness("pwa.js");
  harness.run();
  assert.ok(Object.isFrozen(harness.window.StrataPWA));
  assert.equal(harness.window.StrataPWA.isInstalled(),false);
  assert.equal(harness.window.StrataPWA.canPrompt(),false);

  for(const handler of harness.listeners.load||[])handler();
  await new Promise(setImmediate);
  assert.equal(harness.registrations.length,1);
  assert.equal(harness.registrations[0][0],"/service-worker.js");
  assert.deepEqual({...harness.registrations[0][1]},{scope:"/",updateViaCache:"none"});

  let prevented=false,prompted=0;
  const stateEvents=[];
  harness.window.addEventListener("strata:install-state",(event)=>stateEvents.push(event.detail));
  const installEvent={type:"beforeinstallprompt",preventDefault(){prevented=true;},async prompt(){prompted+=1;},userChoice:Promise.resolve({outcome:"accepted",platform:"web"})};
  harness.window.dispatchEvent(installEvent);
  assert.equal(prevented,true);
  assert.equal(harness.window.StrataPWA.canPrompt(),true);
  const result=await harness.window.StrataPWA.promptInstall();
  assert.equal(result.outcome,"accepted");
  assert.equal(prompted,1);
  assert.equal(harness.window.StrataPWA.canPrompt(),false);
  assert.equal(harness.window.StrataPWA.isInstalled(),true);
  assert.ok(stateEvents.some((state)=>state.canPrompt===true&&state.installed===false));
  assert.ok(stateEvents.some((state)=>state.canPrompt===false&&state.installed===true));
});

test("install guide is beginner-friendly, device-specific, and progressively enhanced",async()=>{
  const html=read("pages/install.html");
  assert.match(html,/<main\s+id="installGuide">/);
  assert.match(html,/id="installStatus"\s+role="status"\s+aria-live="polite"/);
  assert.match(html,/id="installButton"[^>]*type="button"[^>]*hidden/);
  assert.match(html,/no App Store download/i);
  assert.match(html,/account still syncs across your devices/i);
  assert.match(html,/saved changes still need an internet connection/i);
  for(const platform of ["ios","android","desktop-chrome","desktop-edge"]) {
    const card=html.match(new RegExp(`<article[^>]+data-platform="${platform}"[\\s\\S]*?<\\/article>`));
    assert.ok(card,`missing ${platform} guide`);
    assert.equal((card[0].match(/<li>/g)||[]).length,4,`${platform} guide should have four steps`);
  }
  assert.match(html,/Safari[\s\S]*Share[\s\S]*Add to Home Screen/i);
  assert.match(html,/Chrome[\s\S]*Install app[\s\S]*Add to Home screen/i);
  assert.match(html,/Microsoft Edge[\s\S]*Apps[\s\S]*Install this site as an app/i);

  let canPrompt=false,installed=false,promptCount=0;
  const pwa={
    isInstalled:()=>installed,
    canPrompt:()=>canPrompt,
    async promptInstall(){promptCount+=1;installed=true;canPrompt=false;return {outcome:"accepted"};}
  };
  const button=new FakeElement(),status=new FakeElement();
  const cards=new Map(["ios","android","desktop-chrome","desktop-edge"].map((platform)=>{
    const card=new FakeElement(),badge=new FakeElement();
    card.querySelector=()=>badge;
    return [platform,{card,badge}];
  }));
  const harness=browserHarness("install.js",{userAgent:"Mozilla/5.0 (Linux; Android 15) AppleWebKit Chrome/140 Mobile",pwa});
  harness.context.document={
    getElementById(id){return id==="installButton"?button:id==="installStatus"?status:null;},
    querySelector(selector){const match=selector.match(/^\[data-platform="([^"]+)"\]$/);return match?cards.get(match[1])?.card:null;}
  };
  harness.run();
  assert.equal(cards.get("android").card.classList.contains("recommended"),true);
  assert.equal(cards.get("android").badge.hidden,false);
  assert.equal(button.hidden,true);
  assert.match(status.textContent,/Chrome.*Install app|Add to Home screen/i);

  canPrompt=true;
  harness.window.dispatchEvent({type:"strata:install-state"});
  assert.equal(button.hidden,false);
  assert.equal(button.disabled,false);
  await button.emit("click");
  assert.equal(promptCount,1);
  assert.equal(button.disabled,true);
  assert.match(button.textContent,/installed/i);
  assert.match(status.textContent,/already running as an installed app/i);
});
