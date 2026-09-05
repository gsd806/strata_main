"use strict";

const BUILD="6.9.9";
const CACHE_PREFIX="strata-static-";
// Every release refreshes this complete versioned set before the worker takes control.
const STATIC_CACHE=`${CACHE_PREFIX}${BUILD}`;
const PRECACHE_URLS=[
  "/offline.html",
  "/install.html",
  "/pricing.html",
  "/contact.html",
  "/terms.html",
  "/privacy.html",
  "/refunds.html",
  "/planner.html",
  "/install.css?v=6.9.9",
  "/install.js?v=6.9.9",
  "/offline.js?v=6.9.9",
  "/site-info.css?v=6.9.9",
  "/pricing.js?v=6.9.9",
  "/contact.js?v=6.9.9",
  "/pwa.js?v=6.9.9",
  "/styles.css?v=6.9.9",
  "/app.js?v=6.9.9",
  "/account.css?v=6.9.9",
  "/account.js?v=6.9.9",
  "/account-recovery.js?v=6.9.9",
  "/planner.css?v=6.9.9",
  "/planner.js?v=6.9.9",
  "/discover.css?v=6.9.9",
  "/discovery-core.js?v=6.9.9",
  "/monthly-plan-core.js?v=6.9.9",
  "/discover.js?v=6.9.9",
  "/exercises.json?v=6.9.9",
  "/manifest.webmanifest",
  "/icons/strata-icon.svg",
  "/icons/strata-192.png",
  "/icons/strata-512.png",
  "/icons/strata-maskable-512.png",
  "/icons/apple-touch-icon.png"
];
const PUBLIC_ASSET_URLS=new Set(PRECACHE_URLS.map((entry) => new URL(entry,self.location.origin).href));
const PRIVATE_HTML_PATHS=new Set(["/","/index.html","/account.html","/verify-email","/verify-email.html","/forgot-password","/forgot-password.html","/reset-password","/reset-password.html","/delete-account","/delete-account.html","/discover.html","/admin","/admin.html"]);
const PUBLIC_HTML_FALLBACKS=new Map([
  ["/install","/install.html"],
  ["/pricing","/pricing.html"],
  ["/contact","/contact.html"],
  ["/terms","/terms.html"],
  ["/privacy","/privacy.html"],
  ["/refunds","/refunds.html"],
  ["/planner","/planner.html"]
]);

function bypassNetwork(pathname) {
  return pathname.startsWith("/api/") || pathname.startsWith("/auth/") || pathname==="/healthz";
}

self.addEventListener("install",(event) => {
  event.waitUntil(caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate",(event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key!==STATIC_CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

async function navigationResponse(request,url) {
  try {
    return await fetch(request);
  } catch {
    const cache=await caches.open(STATIC_CACHE);
    const normalizedPath=url.pathname.length>1?url.pathname.replace(/\/+$/g,""):url.pathname;
    const pageKey=normalizedPath.endsWith(".html")?normalizedPath.slice(0,-5):normalizedPath;
    // Paddle appends `_ptxn` to the default payment-link URL. Never serve a
    // cached checkout landing page for that request: the transaction needs a
    // live connection to Paddle and STRATA's server.
    if (pageKey==="/pricing" && url.searchParams.has("_ptxn")) {
      const offline=await cache.match("/offline.html");
      return offline || new Response("STRATA is offline.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
    }
    const publicFallback=PUBLIC_HTML_FALLBACKS.get(pageKey);
    if (publicFallback) {
      const page=await cache.match(publicFallback);
      if (page) return page;
    }
    const offline=await cache.match("/offline.html");
    return offline || new Response("STRATA is offline.",{status:503,headers:{"Content-Type":"text/plain; charset=utf-8"}});
  }
}

async function publicAssetResponse(request) {
  const cached=await caches.match(request);
  if (cached) return cached;
  const response=await fetch(request);
  if (response.ok && response.type==="basic") {
    const cache=await caches.open(STATIC_CACHE);
    await cache.put(request,response.clone());
  }
  return response;
}

self.addEventListener("fetch",(event) => {
  const request=event.request;
  if (request.method!=="GET") return;
  const url=new URL(request.url);
  if (url.origin!==self.location.origin || bypassNetwork(url.pathname)) return;
  if (request.mode==="navigate") {
    event.respondWith(navigationResponse(request,url));
    return;
  }
  if (PRIVATE_HTML_PATHS.has(url.pathname) || !PUBLIC_ASSET_URLS.has(url.href)) return;
  event.respondWith(publicAssetResponse(request));
});
