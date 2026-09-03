"use strict";

const http = require("node:http");
const { readFileSync, existsSync } = require("node:fs");
const { extname, join, normalize } = require("node:path");
const { isIP } = require("node:net");
const { promisify } = require("node:util");
const { randomBytes, randomUUID, createHash, scrypt, timingSafeEqual } = require("node:crypto");
const { gzipSync } = require("node:zlib");
const { createStore,isUniqueViolation } = require("./database");
const {
  getPaymentConfig,
  publicPaymentConfig,
  webhookSecretFor,
  verifyPaddleSignature,
  createPaddleTransaction,
  fetchPaddleIpv4Cidrs,
  isPaddleWebhookAddress,
  validateCompletedTransaction,
  fullRevocationFromAdjustment
} = require("./payments");

const scryptAsync = promisify(scrypt);
const PROJECT_ROOT = join(__dirname,"..");
const PUBLIC_ROOT = join(PROJECT_ROOT,"public");
const PORT = Number(process.env.PORT || 4173);
const HOST = process.env.HOST || "127.0.0.1";
const SESSION_SECONDS = 60 * 60 * 24 * 7;
const SESSION_COOKIE = "strata_session";
const MAX_BODY_BYTES = 64 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const MIN_GZIP_BYTES = 1024;
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const EXERCISES = JSON.parse(readFileSync(join(PUBLIC_ROOT,"data","exercises.json"),"utf8"));
const DISCOVERY_DATA = JSON.parse(readFileSync(join(__dirname,"data","discovery-data.json"),"utf8"));
const BUILD_NUMBER = JSON.parse(readFileSync(join(PROJECT_ROOT,"package.json"),"utf8")).version;
const PAYMENT_CONFIG = getPaymentConfig(process.env);
const ENFORCE_PADDLE_IPS=String(process.env.PADDLE_ENFORCE_IP_ALLOWLIST||"").toLowerCase()==="true";
const PADDLE_IP_CACHE_MS=6*60*60*1000;
const EXERCISE_IDS = new Set(EXERCISES.map((exercise) => exercise.id));
const EQUIPMENT = [...new Set(EXERCISES.map((exercise) => exercise.equipment))];
// Browser URLs deliberately remain stable even though files are grouped by
// purpose on disk. Only entries in this map can ever be served publicly.
const STATIC_FILES = new Map([
  ["index.html","pages/index.html"],
  ["account.html","pages/account.html"],
  ["planner.html","pages/planner.html"],
  ["discover.html","pages/discover.html"],
  ["install.html","pages/install.html"],
  ["offline.html","pages/offline.html"],
  ["pricing.html","pages/pricing.html"],
  ["contact.html","pages/contact.html"],
  ["terms.html","pages/terms.html"],
  ["privacy.html","pages/privacy.html"],
  ["refunds.html","pages/refunds.html"],
  ["styles.css","styles/styles.css"],
  ["account.css","styles/account.css"],
  ["planner.css","styles/planner.css"],
  ["discover.css","styles/discover.css"],
  ["install.css","styles/install.css"],
  ["site-info.css","styles/site-info.css"],
  ["app.js","scripts/app.js"],
  ["account.js","scripts/account.js"],
  ["planner.js","scripts/planner.js"],
  ["discovery-core.js","scripts/discovery-core.js"],
  ["discover.js","scripts/discover.js"],
  ["install.js","scripts/install.js"],
  ["pricing.js","scripts/pricing.js"],
  ["pwa.js","scripts/pwa.js"],
  ["service-worker.js","service-worker.js"],
  ["manifest.webmanifest","manifest.webmanifest"],
  ["exercises.json","data/exercises.json"],
  ["icons/strata-icon.svg","icons/strata-icon.svg"],
  ["icons/strata-192.png","icons/strata-192.png"],
  ["icons/strata-512.png","icons/strata-512.png"],
  ["icons/strata-maskable-512.png","icons/strata-maskable-512.png"],
  ["icons/apple-touch-icon.png","icons/apple-touch-icon.png"]
]);
const PAGE_ALIASES = new Map([
  ["/install","install.html"],
  ["/pricing","pricing.html"],
  ["/contact","contact.html"],
  ["/terms","terms.html"],
  ["/privacy","privacy.html"],
  ["/refunds","refunds.html"]
]);
const PROTECTED_HTML = new Set(["planner.html","discover.html"]);
const MIME = {
  ".html":"text/html; charset=utf-8",
  ".css":"text/css; charset=utf-8",
  ".js":"text/javascript; charset=utf-8",
  ".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json; charset=utf-8",
  ".svg":"image/svg+xml",
  ".png":"image/png"
};
let store;
let paddleIpCache={cidrs:[],expiresAt:0,pending:null};

function defaultPlan() {
  return {version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map((day) => [day,[]]))};
}

function defaultPreferences() {
  return {version:1,goal:"hypertrophy",level:"Intermediate",days:4,equipment:[...EQUIPMENT],preferences:["stable","long-range"],limitations:[]};
}

function cleanText(value,max) { return String(value ?? "").trim().slice(0,max); }
function normalizeEmail(value) { return cleanText(value,254).toLowerCase(); }
function validEmail(email) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email); }
function hashToken(token) { return createHash("sha256").update(token).digest("hex"); }
function escapeHtml(value) { return String(value ?? "").replace(/[&<>'"]/g,(char) => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char])); }

async function passwordHash(password,salt) {
  const key = await scryptAsync(password,Buffer.from(salt,"base64"),64,{N:16384,r:8,p:1,maxmem:64*1024*1024});
  return Buffer.from(key).toString("base64");
}

async function passwordMatches(password,user) {
  const actual = Buffer.from(await passwordHash(password,user.password_salt),"base64");
  const expected = Buffer.from(user.password_hash,"base64");
  return actual.length === expected.length && timingSafeEqual(actual,expected);
}

function accountStorageUnavailable(error) {
  console.error("Account storage request failed:",error);
  return Object.assign(new Error("Account storage is temporarily unavailable. Please try again."),{status:503,cause:error});
}

function cookieMap(header="") {
  const cookies=Object.create(null);
  for (const part of String(header||"").split(";")) {
    const trimmed=part.trim(),separator=trimmed.indexOf("=");
    if (separator<1) continue;
    try {
      const key=decodeURIComponent(trimmed.slice(0,separator));
      const value=decodeURIComponent(trimmed.slice(separator+1));
      if (key) cookies[key]=value;
    } catch {
      // Ignore malformed cookie pairs without breaking otherwise valid cookies.
    }
  }
  return cookies;
}

async function sessionFor(req) {
  const token = cookieMap(req.headers.cookie)[SESSION_COOKIE];
  if (!token || token.length > 200) return null;
  return await store.session(hashToken(token),Date.now()) || null;
}

function sessionCookie(token,maxAge=SESSION_SECONDS) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`,"Path=/","HttpOnly","SameSite=Strict",`Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true") parts.push("Secure");
  return parts.join("; ");
}

async function createSession(userId) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const now = Date.now();
  await store.insertSession({tokenHash:hashToken(token),userId,csrfToken,expiresAt:now+SESSION_SECONDS*1000,createdAt:now});
  return {token,csrfToken};
}

async function planFor(userId) {
  const row = await store.plan(userId);
  if (!row) return defaultPlan();
  try { return sanitizePlan(JSON.parse(row.plan_json),{repair:true}); } catch { return defaultPlan(); }
}

function planStats(plan) {
  const planCount = DAYS.reduce((sum,day) => sum + plan.days[day].length,0);
  const workoutDays = DAYS.filter((day) => plan.days[day].length > 0).length;
  return {planCount,workoutDays};
}

async function userPayload(session) {
  const [plan,discovery]=await Promise.all([
    planFor(session.id),
    store.discoveryAccessSummary(session.id)
  ]);
  return {id:session.id,name:session.name,email:session.email,createdAt:session.created_at,...planStats(plan),discovery};
}

function cleanChoiceList(value,allowed,max=20) {
  return [...new Set((Array.isArray(value)?value:[]).map((item) => cleanText(item,60)).filter((item) => allowed.includes(item)))].slice(0,max);
}

function sanitizePreferences(input) {
  if (!input || typeof input !== "object") throw Object.assign(new Error("Invalid preference profile."),{status:400});
  const goals=["hypertrophy","strength","balanced","time-efficient"], levels=["Beginner","Intermediate","Advanced"];
  const preferenceOptions=["stable","long-range","simple-setup","compound","isolation"];
  const limitationOptions=["no-overhead","no-deep-knee","no-unsupported-hinge","no-floor","no-unilateral"];
  const equipment=cleanChoiceList(input.equipment,EQUIPMENT);
  if (!equipment.length) throw Object.assign(new Error("Select at least one available equipment type."),{status:400});
  return {
    version:1,
    goal:goals.includes(input.goal)?input.goal:"hypertrophy",
    level:levels.includes(input.level)?input.level:"Intermediate",
    days:Math.max(1,Math.min(7,Math.round(Number(input.days)||4))),
    equipment,
    preferences:cleanChoiceList(input.preferences,preferenceOptions),
    limitations:cleanChoiceList(input.limitations,limitationOptions)
  };
}

async function preferencesFor(userId) {
  const row=await store.preferences(userId);
  if (!row) return defaultPreferences();
  try { return sanitizePreferences(JSON.parse(row.preferences_json)); } catch { return defaultPreferences(); }
}

function sanitizeRating(input) {
  const output={};
  for (const key of ["comfort","pump","enjoyment","stability","setup","overall"]) {
    const value=Number(input?.[key]);
    if (!Number.isInteger(value)||value<1||value>5) throw Object.assign(new Error("Every rating must be a whole number from 1 to 5."),{status:400});
    output[key]=value;
  }
  return output;
}

function sanitizePlan(input,{repair=false}={}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw Object.assign(new Error("Invalid plan."),{status:400});
  }
  const inputDays=input.days&&typeof input.days==="object"&&!Array.isArray(input.days)?input.days:null;
  if (!inputDays&&!repair) throw Object.assign(new Error("Invalid plan."),{status:400});
  if (!DAYS.includes(input.restDay)&&!repair) throw Object.assign(new Error("Choose a valid rest day."),{status:400});
  const output = defaultPlan();
  output.restDay = DAYS.includes(input.restDay)?input.restDay:"Sunday";
  const instanceIds=new Set();
  let total = 0;
  for (const day of DAYS) {
    const source = inputDays?.[day];
    if (!Array.isArray(source)&&!repair) throw Object.assign(new Error(`Exercises for ${day} must be a list.`),{status:400});
    const items=Array.isArray(source)?source:[];
    if (items.length>30&&!repair) throw Object.assign(new Error(`${day} can contain at most 30 exercises.`),{status:400});
    output.days[day] = items.slice(0,30).map((item) => {
      const exerciseId = cleanText(item?.exerciseId,80);
      if (!EXERCISE_IDS.has(exerciseId)) {
        if (!repair) throw Object.assign(new Error("Plan contains an unknown exercise."),{status:400});
        return null;
      }
      const requestedId=String(item?.instanceId||"");
      let instanceId=requestedId;
      if (!/^[a-zA-Z0-9_-]{6,100}$/.test(requestedId) || instanceIds.has(requestedId)) {
        do { instanceId=randomUUID(); } while (instanceIds.has(instanceId));
      }
      instanceIds.add(instanceId);
      let sets=Number(item?.sets);
      if (!Number.isInteger(sets)||sets<1||sets>10) {
        if (!repair) throw Object.assign(new Error("Sets must be a whole number from 1 to 10."),{status:400});
        sets=Number.isFinite(sets)?Math.max(1,Math.min(10,Math.round(sets))):3;
      }
      total += 1;
      return {
        instanceId,
        exerciseId,
        sets,
        reps:cleanText(item.reps,20) || "8–12"
      };
    }).filter(Boolean);
  }
  if (total > 140) throw Object.assign(new Error("Plan is too large."),{status:400});
  if (output.days[output.restDay].length) {
    if (!repair) throw Object.assign(new Error("The selected rest day must not contain exercises."),{status:400});
    const emptyDay=DAYS.find((day)=>output.days[day].length===0);
    if (!emptyDay) throw Object.assign(new Error("The plan needs an empty rest day."),{status:400});
    output.restDay=emptyDay;
  }
  return output;
}

function securityHeaders() {
  return {
    "Content-Security-Policy":"default-src 'self'; img-src 'self' https://images.unsplash.com https://*.paddle.com data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; script-src 'self' https://cdn.paddle.com; connect-src 'self' https://*.paddle.com; manifest-src 'self'; worker-src 'self'; frame-src https://*.paddle.com; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'",
    "X-Content-Type-Options":"nosniff",
    "X-Frame-Options":"DENY",
    "Referrer-Policy":"strict-origin-when-cross-origin",
    "Permissions-Policy":"camera=(), microphone=(), geolocation=()"
  };
}

function headerKey(headers,name) {
  const lowered=name.toLowerCase();
  return Object.keys(headers).find((key)=>key.toLowerCase()===lowered);
}

function appendVary(headers,value) {
  const key=headerKey(headers,"Vary")||"Vary";
  const values=String(headers[key]||"").split(",").map((item)=>item.trim()).filter(Boolean);
  if (!values.some((item)=>item.toLowerCase()===value.toLowerCase())) values.push(value);
  headers[key]=values.join(", ");
}

function gzipAccepted(header) {
  let explicit;
  let wildcard;
  for (const item of String(header||"").split(",")) {
    const [rawCoding,...parameters]=item.trim().split(";");
    const coding=rawCoding.trim().toLowerCase();
    if (!coding) continue;
    let quality=1;
    for (const parameter of parameters) {
      const match=parameter.trim().match(/^q\s*=\s*(.+)$/i);
      if (!match) continue;
      const valid=/^(?:0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.test(match[1]);
      quality=valid?Number(match[1]):0;
      break;
    }
    if (coding==="gzip") explicit=explicit===undefined?quality:Math.max(explicit,quality);
    if (coding==="*") wildcard=wildcard===undefined?quality:Math.max(wildcard,quality);
  }
  return (explicit??wildcard??0)>0;
}

function compressibleType(contentType) {
  return /^text\//i.test(contentType)||/^(?:application\/(?:json|javascript|manifest\+json)|image\/svg\+xml)(?:;|$)/i.test(contentType);
}

function responseBody(req,body,headers) {
  const original=Buffer.isBuffer(body)?body:Buffer.from(String(body));
  const typeKey=headerKey(headers,"Content-Type");
  const encodingKey=headerKey(headers,"Content-Encoding");
  const canCompress=!encodingKey&&original.length>=MIN_GZIP_BYTES&&compressibleType(String(typeKey?headers[typeKey]:""));
  let payload=original;
  if (canCompress) {
    appendVary(headers,"Accept-Encoding");
    if (gzipAccepted(req?.headers?.["accept-encoding"])) {
      const compressed=gzipSync(original);
      if (compressed.length<original.length) {
        headers["Content-Encoding"]="gzip";
        payload=compressed;
      }
    }
  }
  const lengthKey=headerKey(headers,"Content-Length");
  if (lengthKey) delete headers[lengthKey];
  headers["Content-Length"]=payload.length;
  return payload;
}

function json(res,status,data,headers={}) {
  const responseHeaders={...securityHeaders(),"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store",...headers};
  const body=responseBody(res.req,JSON.stringify(data),responseHeaders);
  res.writeHead(status,responseHeaders);
  if (res.req?.method==="HEAD") res.end(); else res.end(body);
}

function bodyBuffer(req,maxBytes=MAX_BODY_BYTES) {
  return new Promise((resolve,reject) => {
    let chunks=[],bytes=0,tooLarge=false;
    req.on("data",(chunk) => {
      if (tooLarge) return;
      bytes+=chunk.length;
      if (bytes>maxBytes) {
        tooLarge=true;
        chunks=[];
        reject(Object.assign(new Error("Request is too large."),{status:413}));
        return;
      }
      chunks.push(chunk);
    });
    req.on("end",() => { if (!tooLarge) resolve(Buffer.concat(chunks,bytes)); });
    req.on("error",reject);
  });
}

async function bodyText(req) { return (await bodyBuffer(req)).toString("utf8"); }

async function bodyJson(req) {
  const body=await bodyText(req);
  try { return body ? JSON.parse(body) : {}; } catch { throw Object.assign(new Error("Invalid JSON."),{status:400}); }
}

async function bodyForm(req) {
  const body=await bodyText(req),params=new URLSearchParams(body);
  return Object.fromEntries(params.entries());
}

async function requireSession(req,res) {
  const session = await sessionFor(req);
  if (!session) { json(res,401,{error:"Sign in required."}); return null; }
  return session;
}

function safeTokenEqual(actual,expected) {
  const left=Buffer.from(String(actual||""));
  const right=Buffer.from(String(expected||""));
  return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}

function validCsrf(req,session) {
  return safeTokenEqual(req.headers["x-csrf-token"],session?.csrf_token);
}

async function requireDiscoveryAccess(req,res) {
  const session=await requireSession(req,res);
  if (!session) return null;
  if (!await store.hasDiscoveryAccess(session.id)) {
    json(res,402,{error:"Discovery purchase required.",code:"DISCOVERY_ACCESS_REQUIRED"});
    return null;
  }
  return session;
}

function sameOrigin(req) {
  const fetchSite=String(req.headers["sec-fetch-site"]||"").toLowerCase();
  if (fetchSite==="cross-site") return false;
  const origin = req.headers.origin;
  if (!origin) return true;
  const protocol = String(req.headers["x-forwarded-proto"] || (process.env.NODE_ENV === "production" ? "https" : "http")).split(",")[0].trim();
  return origin === `${protocol}://${req.headers.host}`;
}

const rateBuckets = new Map();
function requestAddress(req) {
  const direct=req.socket.remoteAddress||"unknown";
  if (process.env.TRUST_PROXY!=="true") return direct;
  const forwarded=String(req.headers["x-forwarded-for"]||"").split(",").map((value)=>value.trim()).filter((value)=>isIP(value));
  return forwarded.at(-1)||direct;
}

async function currentPaddleIps() {
  if (paddleIpCache.cidrs.length&&paddleIpCache.expiresAt>Date.now()) return paddleIpCache.cidrs;
  if (paddleIpCache.pending) return paddleIpCache.pending;
  paddleIpCache.pending=fetchPaddleIpv4Cidrs(PAYMENT_CONFIG)
    .then((cidrs) => {
      paddleIpCache={cidrs,expiresAt:Date.now()+PADDLE_IP_CACHE_MS,pending:null};
      return cidrs;
    })
    .finally(() => { paddleIpCache.pending=null; });
  return paddleIpCache.pending;
}

async function paddleWebhookSourceAllowed(req) {
  if (!ENFORCE_PADDLE_IPS) return true;
  let cidrs;
  try { cidrs=await currentPaddleIps(); }
  catch { throw Object.assign(new Error("Webhook source verification is temporarily unavailable."),{status:503}); }
  return isPaddleWebhookAddress(requestAddress(req),cidrs);
}

function rateAllowed(req,kind,max=10) {
  const key = `${kind}:${requestAddress(req)}`;
  const now=Date.now(), windowMs=15*60*1000;
  const bucket=(rateBuckets.get(key)||[]).filter((time) => now-time<windowMs);
  if (bucket.length >= max) return false;
  bucket.push(now); rateBuckets.set(key,bucket); return true;
}

async function registerAccount(input) {
  const name=cleanText(input.name,40),email=normalizeEmail(input.email),password=String(input.password||"");
  if (name.length<2 || !validEmail(email) || password.length<10 || password.length>128) throw Object.assign(new Error("Use a valid name, email, and password of 10–128 characters."),{status:400});
  try {
    if (await store.userByEmail(email)) throw Object.assign(new Error("An account with that email already exists."),{status:409});
    const id=randomUUID(),salt=randomBytes(16).toString("base64"),hash=await passwordHash(password,salt),now=Date.now();
    try { await store.insertUser({id,name,email,passwordHash:hash,passwordSalt:salt,createdAt:now}); }
    catch(error) { if (isUniqueViolation(error)) throw Object.assign(new Error("An account with that email already exists."),{status:409}); throw error; }
    const session=await createSession(id),user=await store.userById(id);
    return {session,user};
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

async function authenticateAccount(input) {
  const email=normalizeEmail(input.email),password=String(input.password||"");
  try {
    const user=await store.userByEmail(email);
    if (!user || !await passwordMatches(password,user)) throw Object.assign(new Error("Email or password is incorrect."),{status:401});
    return {session:await createSession(user.id),user};
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

function safeAccountNext(value) {
  const next=String(value||"");
  if (next==="pricing"||next==="/pricing"||next==="/pricing.html") return "/pricing";
  if (next==="/planner.html"||next==="/discover.html"||/^\/planner\.html\?add=[a-z0-9-]{2,80}$/.test(next)) return next;
  return "/planner.html";
}

function accountErrorLocation(mode,message,requestedNext) {
  const params=new URLSearchParams({mode,error:message});
  const next=safeAccountNext(requestedNext);
  if (next.startsWith("/planner.html")) {
    params.set("next","planner");
    const add=new URL(next,"http://strata.local").searchParams.get("add");
    if (add) params.set("add",add);
  } else if (next==="/pricing") {
    params.set("next","pricing");
  }
  return `/account.html?${params}`;
}

function redirect(res,location,headers={}) {
  res.writeHead(303,{...securityHeaders(),Location:location,"Cache-Control":"no-store",...headers});res.end();
}

async function handleAuthForm(req,res,url) {
  if (!["/auth/signup","/auth/login"].includes(url.pathname)) { json(res,404,{error:"Account route not found."}); return; }
  if (req.method!=="POST") { json(res,405,{error:"Method not allowed."},{Allow:"POST"}); return; }
  if (!sameOrigin(req)) { redirect(res,"/account.html?error="+encodeURIComponent("Cross-origin request rejected.")); return; }
  if (!rateAllowed(req,"auth")) { redirect(res,"/account.html?error="+encodeURIComponent("Too many attempts. Try again later.")); return; }
  const input=await bodyForm(req),mode=url.pathname==="/auth/signup"?"signup":"login";
  try {
    const result=mode==="signup"?await registerAccount(input):await authenticateAccount(input);
    redirect(res,safeAccountNext(input.next),{"Set-Cookie":sessionCookie(result.session.token)});
  } catch(error) {
    const message=error.status?error.message:"Unable to complete the account request.";
    if (!error.status) console.error(error);
    redirect(res,accountErrorLocation(mode,message,input.next));
  }
}

async function handleHealth(req,res) {
  if (req.method!=="GET") { json(res,405,{error:"Method not allowed."},{Allow:"GET"}); return; }
  try {
    const ok=await store.ping();
    json(res,ok?200:503,{ok});
  } catch {
    json(res,503,{ok:false});
  }
}

function eventTime(value,fallback=Date.now()) {
  const parsed=Date.parse(String(value||""));
  return Number.isFinite(parsed)?parsed:fallback;
}

async function processPaddleEvent(event) {
  const eventId=cleanText(event?.event_id,100);
  const eventType=cleanText(event?.event_type,100);
  const data=event?.data;
  if (!/^evt_[a-z0-9]{20,}$/.test(eventId)||!eventType||!data||typeof data!=="object") {
    throw Object.assign(new Error("Invalid Paddle event."),{status:400});
  }
  if (await store.webhookEvent(eventId)) return "replayed";

  const occurredAt=eventTime(event.occurred_at);
  const now=Date.now();
  let outcome="ignored";
  if (eventType==="transaction.completed") {
    const transactionId=cleanText(data.id,100);
    const purchase=await store.purchaseByTransaction(transactionId);
    const validation=validateCompletedTransaction(data,PAYMENT_CONFIG);
    const claimedUser=cleanText(data.custom_data?.strata_user_id,100);
    if (purchase&&validation.ok&&claimedUser===purchase.user_id) {
      await store.completePurchase(transactionId,{
        customerId:cleanText(data.customer_id,100)||null,
        completedAt:eventTime(data.updated_at||event.occurred_at,now),
        updatedAt:occurredAt
      });
      outcome="granted";
    } else {
      outcome=purchase?`rejected:${validation.ok?"account":validation.reason}`:"ignored:unknown-transaction";
    }
  } else if (eventType==="transaction.canceled"||eventType==="transaction.payment_failed") {
    const transactionId=cleanText(data.id,100);
    if (await store.purchaseByTransaction(transactionId)) {
      await store.updatePurchaseStatus(transactionId,cleanText(data.status,40)||eventType.split(".")[1],occurredAt);
      outcome="updated";
    }
  } else if (eventType==="adjustment.created"||eventType==="adjustment.updated") {
    const adjustmentId=cleanText(data.id,100);
    const transactionId=cleanText(data.transaction_id,100);
    const purchase=transactionId?await store.purchaseByTransaction(transactionId):null;
    if (adjustmentId&&transactionId&&purchase) {
      const adjustmentApplied=await store.upsertAdjustment({
        adjustmentId,
        transactionId,
        action:cleanText(data.action,40),
        type:cleanText(data.type,40),
        status:cleanText(data.status,40),
        occurredAt,
        updatedAt:now
      });
      const revocation=fullRevocationFromAdjustment(data);
      if (revocation&&adjustmentApplied) {
        await store.revokePurchase(transactionId,revocation.reason,occurredAt,now);
        outcome="revoked";
      } else {
        outcome="adjustment-recorded";
      }
    }
  }

  await store.recordWebhookEvent({
    eventId,
    notificationId:cleanText(event.notification_id,100)||null,
    eventType,
    occurredAt,
    processedAt:Date.now()
  });
  return outcome;
}

async function handlePaddleWebhook(req,res) {
  if (req.method!=="POST") { json(res,405,{error:"Method not allowed."},{Allow:"POST"}); return; }
  if (!await paddleWebhookSourceAllowed(req)) { json(res,403,{error:"Webhook source rejected."}); return; }
  const secret=webhookSecretFor(PAYMENT_CONFIG);
  if (!secret) { json(res,503,{error:"Webhook is not configured."}); return; }
  const rawBody=await bodyBuffer(req,MAX_WEBHOOK_BYTES);
  if (!verifyPaddleSignature(rawBody,req.headers["paddle-signature"],secret)) {
    json(res,400,{error:"Invalid webhook signature."});
    return;
  }
  let event;
  try { event=JSON.parse(rawBody.toString("utf8")); }
  catch { json(res,400,{error:"Invalid JSON."}); return; }
  const outcome=await processPaddleEvent(event);
  json(res,200,{ok:true,outcome});
}

async function handleApi(req,res,url) {
  if (url.pathname==="/api/paddle/webhook") { await handlePaddleWebhook(req,res); return; }
  if (["POST","PUT","PATCH","DELETE"].includes(req.method) && !sameOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
  if (url.pathname === "/api/signup" && req.method === "POST") {
    if (!rateAllowed(req,"auth")) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    const result=await registerAccount(await bodyJson(req));
    json(res,201,{user:await userPayload(result.user)},{"Set-Cookie":sessionCookie(result.session.token)});
    return;
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!rateAllowed(req,"auth")) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    const result=await authenticateAccount(await bodyJson(req));
    json(res,200,{user:await userPayload(result.user)},{"Set-Cookie":sessionCookie(result.session.token)});
    return;
  }
  if (url.pathname === "/api/status" && req.method === "GET") {
    json(res,200,{ok:true,build:BUILD_NUMBER,storage:store.kind,persistent:store.kind==="turso"||process.env.NODE_ENV!=="production",paymentsConfigured:PAYMENT_CONFIG.configured,checkoutEnabled:PAYMENT_CONFIG.enabled,webhookIpAllowlist:ENFORCE_PADDLE_IPS}); return;
  }
  if (url.pathname === "/api/billing/config" && req.method === "GET") {
    json(res,200,publicPaymentConfig(PAYMENT_CONFIG)); return;
  }
  if (url.pathname === "/api/me" && req.method === "GET") {
    const session=await sessionFor(req);
    if (!session) { json(res,401,{error:"Not signed in."}); return; }
    json(res,200,{user:await userPayload(session),csrfToken:session.csrf_token}); return;
  }
  if (url.pathname === "/api/billing/checkout" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    if (!PAYMENT_CONFIG.enabled) { json(res,503,{error:"Checkout is not available yet.",code:"CHECKOUT_UNAVAILABLE"}); return; }
    if (!rateAllowed(req,`checkout:${session.id}`,8)) { json(res,429,{error:"Too many checkout attempts. Try again later."}); return; }
    if (await store.hasDiscoveryAccess(session.id)) {
      json(res,409,{error:"Discovery is already unlocked for this account.",code:"ALREADY_ENTITLED"}); return;
    }
    const pending=await store.pendingPurchaseForUser(session.id,PAYMENT_CONFIG.priceId);
    if (pending&&Number(pending.updated_at)>Date.now()-30*60*1000) {
      json(res,200,{transactionId:pending.transaction_id,reused:true}); return;
    }
    const created=await createPaddleTransaction(PAYMENT_CONFIG,{userId:session.id});
    const now=Date.now();
    await store.insertPendingPurchase({
      transactionId:created.transactionId,
      userId:session.id,
      priceId:PAYMENT_CONFIG.priceId,
      productId:PAYMENT_CONFIG.productId,
      paddleStatus:created.status,
      createdAt:now,
      updatedAt:now
    });
    json(res,201,{transactionId:created.transactionId}); return;
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    await store.deleteSession(session.token_hash);
    json(res,200,{ok:true},{"Set-Cookie":sessionCookie("",0)}); return;
  }
  if (url.pathname === "/api/plan" && req.method === "GET") {
    const session=await requireSession(req,res); if (!session) return;
    json(res,200,{plan:await planFor(session.id),user:await userPayload(session)}); return;
  }
  if (url.pathname === "/api/plan" && req.method === "PUT") {
    const session=await requireSession(req,res); if (!session) return;
    const input=await bodyJson(req), plan=sanitizePlan(input.plan);
    await store.upsertPlan(session.id,JSON.stringify(plan),Date.now());
    json(res,200,{ok:true,plan,stats:planStats(plan)}); return;
  }
  if (url.pathname === "/api/discovery" && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const [preferences,aggregates,userRatings]=await Promise.all([preferencesFor(session.id),store.ratingAggregates(),store.ratingsForUser(session.id)]);
    json(res,200,{user:await userPayload(session),exercises:EXERCISES,methodology:DISCOVERY_DATA.methodology,sources:DISCOVERY_DATA.sources,limitedConfidenceExercises:DISCOVERY_DATA.limitedConfidenceExercises,preferences,ratings:{aggregates,user:userRatings}}); return;
  }
  if (url.pathname === "/api/preferences" && req.method === "PUT") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const input=await bodyJson(req), preferences=sanitizePreferences(input.preferences);
    await store.upsertPreferences(session.id,JSON.stringify(preferences),Date.now());
    json(res,200,{ok:true,preferences}); return;
  }
  const ratingMatch=url.pathname.match(/^\/api\/ratings\/([a-z0-9-]{2,80})$/);
  if (ratingMatch && req.method === "PUT") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const exerciseId=ratingMatch[1];
    if (!EXERCISE_IDS.has(exerciseId)) { json(res,404,{error:"Exercise not found."}); return; }
    if (!rateAllowed(req,`rating:${session.id}`,60)) { json(res,429,{error:"Too many rating updates. Try again later."}); return; }
    const input=await bodyJson(req), rating=sanitizeRating(input.rating), now=Date.now();
    await store.upsertRating(session.id,exerciseId,rating,now,now);
    json(res,200,{ok:true,rating:{exercise_id:exerciseId,...rating,updated_at:now},aggregate:await store.ratingAggregate(exerciseId)}); return;
  }
  json(res,404,{error:"API route not found."});
}

async function serveStatic(req,res,url) {
  const aliasPath=url.pathname.length>1?url.pathname.replace(/\/+$/g,""):url.pathname;
  const requested = aliasPath === "/"
    ? "index.html"
    : PAGE_ALIASES.has(aliasPath)
      ? PAGE_ALIASES.get(aliasPath)
      : normalize(url.pathname).replace(/^[/\\]+/,"");
  if (!STATIC_FILES.has(requested)) { json(res,404,{error:"Page not found."}); return; }
  const activeSession=(PROTECTED_HTML.has(requested)||requested==="index.html")?await sessionFor(req):null;
  if (PROTECTED_HTML.has(requested) && !activeSession) {
    const params=new URLSearchParams({mode:"login"});
    if (requested==="planner.html") {
      params.set("next","planner");
      const add=cleanText(url.searchParams.get("add"),80);
      if (/^[a-z0-9-]{2,80}$/.test(add)&&EXERCISE_IDS.has(add)) params.set("add",add);
    } else if (requested==="discover.html") {
      params.set("next","pricing");
    }
    res.writeHead(302,{...securityHeaders(),Location:`/account.html?${params}`,"Cache-Control":"no-store"});
    res.end();
    return;
  }
  if (requested==="discover.html"&&!await store.hasDiscoveryAccess(activeSession.id)) {
    res.writeHead(302,{...securityHeaders(),Location:"/pricing?reason=discovery-required","Cache-Control":"no-store"});
    res.end();
    return;
  }
  const publicFile=STATIC_FILES.get(requested);
  const filePath=join(PUBLIC_ROOT,publicFile);
  if (!existsSync(filePath)) { json(res,404,{error:"Page not found."}); return; }
  let body=readFileSync(filePath);
  if (requested==="index.html") {
    const user=activeSession?await userPayload(activeSession):null;
    const actions=user
      ? `<a class="account-button discover-button" id="discoverButton" href="${user.discovery.active?"/discover.html":"/pricing"}">${user.discovery.active?"Discover":"Unlock Discovery"}</a>\n        <a class="account-button account-create" id="signupButton" href="/account.html?mode=signup" hidden>Sign up</a>\n        <a class="account-button account-link signed-in" id="accountButton" href="/account.html">${escapeHtml(user.name.split(/\s+/)[0])} profile</a>\n        <a class="session-button" id="planButton" href="/planner.html">Plan <span id="planCount">${user.planCount}</span></a>`
      : `<a class="account-button discover-button" id="discoverButton" href="/discover.html" hidden>Discover</a>\n        <a class="account-button account-create" id="signupButton" href="/account.html?mode=signup">Sign up</a>\n        <a class="account-button account-link" id="accountButton" href="/account.html?mode=login">Log in</a>\n        <a class="session-button" id="planButton" href="/account.html?mode=login&amp;next=planner">Plan <span id="planCount">0</span></a>`;
    body=Buffer.from(body.toString("utf8").replace(/<!-- ACCOUNT_ACTIONS_START -->[\s\S]*?<!-- ACCOUNT_ACTIONS_END -->/,`<!-- ACCOUNT_ACTIONS_START -->\n        ${actions}\n        <!-- ACCOUNT_ACTIONS_END -->`));
  }
  const privateHtml=requested==="index.html"||PROTECTED_HTML.has(requested);
  const cacheControl=privateHtml
    ? "private, no-store"
    : requested==="service-worker.js"||requested==="manifest.webmanifest"
      ? "no-cache, must-revalidate"
      : requested.endsWith(".html")
        ? "no-cache"
        : requested.endsWith(".js")||requested.endsWith(".css")
          ? "no-cache, must-revalidate"
          : "public, max-age=300";
  const headers={...securityHeaders(),"Content-Type":MIME[extname(filePath)]||"application/octet-stream","Cache-Control":cacheControl};
  if (requested==="service-worker.js") headers["Service-Worker-Allowed"]="/";
  if (privateHtml) headers.Vary="Cookie";
  body=responseBody(req,body,headers);
  res.writeHead(200,headers); if (req.method === "HEAD") res.end(); else res.end(body);
}

const server=http.createServer(async(req,res) => {
  try {
    const url=new URL(req.url,`http://${req.headers.host || "localhost"}`);
    if (url.pathname==="/healthz") await handleHealth(req,res);
    else if (url.pathname.startsWith("/api/")) await handleApi(req,res,url);
    else if (url.pathname.startsWith("/auth/")) await handleAuthForm(req,res,url);
    else if (["GET","HEAD"].includes(req.method)) await serveStatic(req,res,url);
    else json(res,405,{error:"Method not allowed."},{Allow:"GET, HEAD"});
  } catch(error) {
    if (!res.headersSent) json(res,error.status||500,{error:error.status?error.message:"Unexpected server error."});
    if (!error.status) console.error(error);
  }
});

let cleanup;
async function start() {
  store = await createStore(PROJECT_ROOT);
  await store.deleteExpired(Date.now());
  if (ENFORCE_PADDLE_IPS) void currentPaddleIps().catch((error)=>console.error(error.message));
  cleanup=setInterval(() => {
    void store.deleteExpired(Date.now()).catch(console.error);
    for (const [key,times] of rateBuckets) if (!times.some((time) => Date.now()-time<15*60*1000)) rateBuckets.delete(key);
  },60*60*1000);
  cleanup.unref();
  server.listen(PORT,HOST,() => {
    const address=server.address(),listeningPort=typeof address==="object"&&address?address.port:PORT;
    console.log(`Strata running at http://${HOST}:${listeningPort} using ${store.kind} storage`);
  });
}
async function shutdown() {
  if (cleanup) clearInterval(cleanup);
  server.close(async() => { await store?.close(); process.exit(0); });
}
process.on("SIGINT",shutdown);
process.on("SIGTERM",shutdown);
start().catch((error) => { console.error(`STRATA could not start: ${error.message}`); process.exitCode=1; });
