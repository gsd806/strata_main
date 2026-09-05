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
  getEmailVerificationConfig,
  verificationCodeDigest,
  safeDigestEqual,
  generateVerificationCode,
  maskEmail,
  verificationEmailHash,
  sendAccountActionEmail,
  sendSupportAcknowledgment,
  sendSupportNotification,
  sendSupportResponse,
  sendVerificationEmail,
  directSignupAllowed
} = require("./email");
const {
  getPaymentConfig,
  publicPaymentConfig,
  webhookSecretFor,
  verifyPaddleSignature,
  createPaddleTransaction,
  fetchPaddleTransaction,
  cancelPaddleTransaction,
  validateCheckoutTransaction,
  findPaddleCheckoutTransaction,
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
const SIGNUP_COOKIE = "strata_signup";
const VERIFICATION_CODE_MS = 10 * 60 * 1000;
const VERIFICATION_HARD_MS = 30 * 60 * 1000;
const VERIFICATION_COOKIE_SECONDS = VERIFICATION_HARD_MS / 1000;
const VERIFICATION_RESEND_MS = 60 * 1000;
const VERIFICATION_MAX_ATTEMPTS = 5;
const VERIFICATION_MAX_SENDS = 4;
const VERIFICATION_EMAIL_SENDS_PER_HOUR = 5;
const VERIFICATION_SEND_WINDOW_MS = 60 * 60 * 1000;
const VERIFICATION_RETENTION_MS = 24 * 60 * 60 * 1000;
const ACCOUNT_ACTION_MS = 30 * 60 * 1000;
const ACCOUNT_ACTION_EMAILS_PER_HOUR = 5;
const ACCOUNT_ACTION_SEND_WINDOW_MS = 60 * 60 * 1000;
const ACCOUNT_ACTION_RETENTION_MS = 24 * 60 * 60 * 1000;
const SUPPORT_REQUEST_WINDOW_MS = 60 * 60 * 1000;
const SUPPORT_REQUEST_RETENTION_MS = 24 * 60 * 60 * 1000;
const SUPPORT_REQUESTS_PER_IP = 5;
const SUPPORT_REQUESTS_PER_EMAIL = 4;
const SUPPORT_REQUESTS_GLOBAL = 100;
const ABANDONED_CHECKOUT_MS = 30 * 60 * 1000;
const CHECKOUT_CREATION_CLAIM_MS = 60 * 1000;
const MAX_DELETION_RECONCILIATIONS = 8;
const MAX_BODY_BYTES = 64 * 1024;
const MAX_WEBHOOK_BYTES = 256 * 1024;
const ADMIN_ELEVATION_MS = 30 * 60 * 1000;
const DISCOVERY_TRIAL_MS = 10 * 24 * 60 * 60 * 1000;
const MIN_GZIP_BYTES = 1024;
const DAYS = ["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const MONTHLY_PLAN_TARGETS = ["chest","back","shoulders","biceps","triceps","forearms","legs","glutes","calves","core"];
const EXERCISES = JSON.parse(readFileSync(join(PUBLIC_ROOT,"data","exercises.json"),"utf8"));
const DISCOVERY_DATA = JSON.parse(readFileSync(join(__dirname,"data","discovery-data.json"),"utf8"));
const BUILD_NUMBER = JSON.parse(readFileSync(join(PROJECT_ROOT,"package.json"),"utf8")).version;
const PAYMENT_CONFIG = getPaymentConfig(process.env);
const EMAIL_CONFIG = getEmailVerificationConfig(process.env);
const ADMIN_EMAIL = configuredAdminEmail(process.env.ADMIN_EMAIL);
const ENFORCE_PADDLE_IPS=String(process.env.PADDLE_ENFORCE_IP_ALLOWLIST||"").toLowerCase()==="true";
const PADDLE_IP_CACHE_MS=6*60*60*1000;
const PADDLE_TRANSACTION_STATUSES=new Set(["draft","ready","billed","paid","completed","canceled","past_due"]);
const PADDLE_STATUS_EVENTS=new Set([
  "transaction.created","transaction.ready","transaction.billed","transaction.paid",
  "transaction.past_due","transaction.payment_failed","transaction.canceled",
  "transaction.revised","transaction.updated"
]);
const PADDLE_CANCELABLE_STALE_STATUSES=new Set(["draft","ready","billed"]);
const EXERCISE_IDS = new Set(EXERCISES.map((exercise) => exercise.id));
const EXERCISE_BY_ID = new Map(EXERCISES.map((exercise) => [exercise.id,exercise]));
const EQUIPMENT = [...new Set(EXERCISES.map((exercise) => exercise.equipment))];
// Browser URLs deliberately remain stable even though files are grouped by
// purpose on disk. Only entries in this map can ever be served publicly.
const STATIC_FILES = new Map([
  ["index.html","pages/index.html"],
  ["account.html","pages/account.html"],
  ["verify-email.html","pages/verify-email.html"],
  ["forgot-password.html","pages/forgot-password.html"],
  ["reset-password.html","pages/reset-password.html"],
  ["delete-account.html","pages/delete-account.html"],
  ["admin.html","pages/admin.html"],
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
  ["admin.css","styles/admin.css"],
  ["app.js","scripts/app.js"],
  ["account.js","scripts/account.js"],
  ["verify-email.js","scripts/verify-email.js"],
  ["account-recovery.js","scripts/account-recovery.js"],
  ["planner.js","scripts/planner.js"],
  ["discovery-core.js","scripts/discovery-core.js"],
  ["monthly-plan-core.js","scripts/monthly-plan-core.js"],
  ["discover.js","scripts/discover.js"],
  ["install.js","scripts/install.js"],
  ["offline.js","scripts/offline.js"],
  ["pricing.js","scripts/pricing.js"],
  ["contact.js","scripts/contact.js"],
  ["admin.js","scripts/admin.js"],
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
  ["/refunds","refunds.html"],
  ["/verify-email","verify-email.html"],
  ["/forgot-password","forgot-password.html"],
  ["/reset-password","reset-password.html"],
  ["/delete-account","delete-account.html"],
  ["/admin","admin.html"]
]);
const PROTECTED_HTML = new Set(["discover.html"]);
const PRIVATE_HTML = new Set(["index.html","account.html","verify-email.html","forgot-password.html","reset-password.html","delete-account.html","admin.html",...PROTECTED_HTML]);
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
function configuredAdminEmail(value) {
  const email=normalizeEmail(value);
  if (!email||email!==String(value||"").trim().toLowerCase()||!validEmail(email)||email.includes(",")||/<[^>]+>|replace|example\.(?:com|org|net)$/i.test(email)) return "";
  return email;
}
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

function authAudit(event,{purpose="",email=""}={}) {
  const entry={event:String(event),at:new Date().toISOString()};
  if (["signup","login","password_reset","account_delete"].includes(purpose)) entry.purpose=purpose;
  if (email) entry.email=maskEmail(email);
  console.info(`Auth audit ${JSON.stringify(entry)}`);
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
  const session=await store.session(hashToken(token),Date.now()) || null;
  // Once verification is requested, configuration mistakes must fail closed:
  // a missing provider key must never make an unverified session valid again.
  if (session&&EMAIL_CONFIG.requestedEnabled&&!Number(session.email_verified_at)) return null;
  return session;
}

function sessionCookie(token,maxAge=SESSION_SECONDS) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`,"Path=/","HttpOnly","SameSite=Strict",`Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true") parts.push("Secure");
  return parts.join("; ");
}

function signupCookie(token,maxAge=VERIFICATION_COOKIE_SECONDS) {
  const parts = [`${SIGNUP_COOKIE}=${encodeURIComponent(token)}`,"Path=/","HttpOnly","SameSite=Strict",`Max-Age=${maxAge}`];
  if (process.env.NODE_ENV === "production" || process.env.SECURE_COOKIES === "true") parts.push("Secure");
  return parts.join("; ");
}

function signupTokenFor(req) {
  const token=cookieMap(req.headers.cookie)[SIGNUP_COOKIE];
  return token&&token.length<=200?token:null;
}

function prepareSession(userId,now=Date.now(),authVersion=1) {
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  return {
    token,
    csrfToken,
    record:{tokenHash:hashToken(token),userId,csrfToken,expiresAt:now+SESSION_SECONDS*1000,createdAt:now,authVersion:Number(authVersion)||1}
  };
}

async function createSession(userId,authVersion=1) {
  const session=prepareSession(userId,Date.now(),authVersion);
  if (!await store.insertSession(session.record)) {
    throw Object.assign(new Error("Your credentials changed while signing in. Please try again."),{status:409,code:"AUTHENTICATION_RETRY"});
  }
  return {token:session.token,csrfToken:session.csrfToken};
}

async function planSnapshotFor(userId) {
  const row = await store.plan(userId);
  if (!row) return {plan:defaultPlan(),updatedAt:0,storedPlanJson:null};
  const storedUpdatedAt=Number(row.updated_at);
  const updatedAt=Number.isSafeInteger(storedUpdatedAt)&&storedUpdatedAt>0?storedUpdatedAt:0;
  const storedPlanJson=String(row.plan_json);
  try { return {plan:sanitizePlan(JSON.parse(storedPlanJson),{repair:true}),updatedAt,storedPlanJson}; }
  catch { return {plan:defaultPlan(),updatedAt,storedPlanJson}; }
}

async function planFor(userId) {
  return (await planSnapshotFor(userId)).plan;
}

async function monthlyPlanFor(userId) {
  const row=await store.monthlyPlan(userId);
  if (!row) return null;
  try {
    const stored=JSON.parse(row.plan_json);
    const storedGeneratedAt=Number(stored?.generatedAt);
    return sanitizeMonthlyPlan(stored,{
      generatedAt:Number.isSafeInteger(storedGeneratedAt)&&storedGeneratedAt>0?storedGeneratedAt:Number(row.updated_at)
    });
  } catch {
    // A corrupt or legacy row must not break the whole Strata+ workspace.
    return null;
  }
}

function planStats(plan) {
  const planCount = DAYS.reduce((sum,day) => sum + plan.days[day].length,0);
  const workoutDays = DAYS.filter((day) => plan.days[day].length > 0).length;
  return {planCount,workoutDays};
}

async function userPayload(session) {
  const now=Date.now();
  const [plan,paidDiscovery,trial,deletion,admin]=await Promise.all([
    planFor(session.id),
    store.discoveryAccessSummary(session.id),
    store.discoveryTrial(session.id),
    store.activeAccountDeletion(session.id,now),
    adminIdentity(session)
  ]);
  const trialActive=Boolean(trial&&Number(trial.expires_at)>now);
  const discovery={
    ...paidDiscovery,
    active:paidDiscovery.active||trialActive,
    accessType:paidDiscovery.active?"paid":trialActive?"trial":null,
    trial:{eligible:!trial,active:trialActive,startedAt:trial?Number(trial.started_at):null,expiresAt:trial?Number(trial.expires_at):null}
  };
  return {
    id:session.id,
    name:session.name,
    email:session.email,
    createdAt:session.created_at,
    ...planStats(plan),
    discovery,
    isAdmin:admin.active,
    accountDeletion:{pending:Boolean(deletion),expiresAt:deletion?Number(deletion.expires_at):null}
  };
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

function communityPlanError(message,code="INVALID_COMMUNITY_PLAN") {
  return Object.assign(new Error(message),{status:400,code});
}

function communityPlanText(value,{label,min=0,max}) {
  if (typeof value!=="string") throw communityPlanError(`${label} is invalid.`);
  const text=value.trim().replace(/[ \t]+/g," ");
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/.test(text)) {
    throw communityPlanError(`${label} contains unsupported characters.`);
  }
  if (text.length<min||text.length>max) {
    const range=min>0?`between ${min} and ${max}`:`at most ${max}`;
    throw communityPlanError(`${label} must be ${range} characters.`);
  }
  return text;
}

function sanitizeCommunityPlanInput(input,currentPlan) {
  if (!input||typeof input!=="object"||Array.isArray(input)) throw communityPlanError("Invalid community plan.");
  const title=communityPlanText(input.title,{label:"Plan title",min:3,max:80});
  if (/[\r\n]/.test(input.title)) throw communityPlanError("Plan title must use one line.");
  const hasDescription=Object.prototype.hasOwnProperty.call(input,"description");
  const hasPublished=Object.prototype.hasOwnProperty.call(input,"published");
  const hasPlan=Object.prototype.hasOwnProperty.call(input,"plan");
  if (hasPlan) throw communityPlanError("Save your weekly plan before publishing it.","COMMUNITY_PLAN_BODY_NOT_ALLOWED");
  const description=hasDescription?communityPlanText(input.description,{label:"Description",max:240}):"";
  if (hasPublished&&typeof input.published!=="boolean") throw communityPlanError("Published setting is invalid.");
  const plan=currentPlan;
  if (!plan||planStats(plan).planCount<1) throw communityPlanError("Add at least one exercise before sharing your weekly plan.","EMPTY_COMMUNITY_PLAN");
  return {title,description,plan,published:!hasPublished||input.published};
}

function communityPlanId(value) {
  const id=String(value||"").toLowerCase();
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)?id:"";
}

function communityPlanPayload(row,{owner=false}={}) {
  if (!row) return null;
  let plan;
  try { plan=sanitizePlan(JSON.parse(row.plan_json)); }
  catch { return null; }
  const output={
    id:String(row.id),
    title:String(row.title),
    description:String(row.description||""),
    authorName:communityAuthorName(row.author_name),
    plan,
    createdAt:Number(row.created_at),
    updatedAt:Number(row.updated_at)
  };
  if (owner) output.published=Boolean(Number(row.is_published));
  return output;
}

function communityAuthorName(value) {
  const name=String(value||"")
    .replace(/[\u0000-\u001F\u007F\u061C\u200E\u200F\u202A-\u202E\u2066-\u2069]/g," ")
    .replace(/\s+/gu," ")
    .trim()
    .slice(0,80);
  return name||"STRATA member";
}

function communityRevision(value,label,{allowZero=false}={}) {
  if (!Number.isSafeInteger(value)||(allowZero?value<0:value<=0)) {
    throw communityPlanError(`${label} is invalid. Refresh and try again.`,"INVALID_COMMUNITY_REVISION");
  }
  return value;
}

function expectedPlanRevision(value) {
  if (!Number.isSafeInteger(value)||value<0) {
    throw Object.assign(new Error("Your plan version is missing or invalid. Refresh and try again."),{status:400,code:"PLAN_VERSION_REQUIRED"});
  }
  return value;
}

function communityPagination(url) {
  const rawLimit=url.searchParams.get("limit"),rawOffset=url.searchParams.get("offset");
  if (rawLimit!=null&&!/^[0-9]+$/.test(rawLimit)) throw communityPlanError("Community plan limit is invalid.","INVALID_PAGINATION");
  if (rawOffset!=null&&!/^[0-9]+$/.test(rawOffset)) throw communityPlanError("Community plan offset is invalid.","INVALID_PAGINATION");
  const limit=rawLimit==null?12:Number(rawLimit),offset=rawOffset==null?0:Number(rawOffset);
  if (!Number.isSafeInteger(limit)||limit<1||limit>24) throw communityPlanError("Community plan limit must be between 1 and 24.","INVALID_PAGINATION");
  if (!Number.isSafeInteger(offset)||offset<0||offset>10000) throw communityPlanError("Community plan offset must be between 0 and 10000.","INVALID_PAGINATION");
  return {limit,offset};
}

function monthlyPlanError(message) {
  return Object.assign(new Error(message),{status:400,code:"INVALID_MONTHLY_PLAN"});
}

function monthlyPlanObject(value,message="Invalid monthly plan.") {
  if (!value||typeof value!=="object"||Array.isArray(value)) throw monthlyPlanError(message);
  return value;
}

function exactMonthlyKeys(value,expected,message) {
  const keys=Object.keys(monthlyPlanObject(value,message)).sort();
  const wanted=[...expected].sort();
  if (keys.length!==wanted.length||keys.some((key,index)=>key!==wanted[index])) throw monthlyPlanError(message);
}

function monthlyPlanText(value,max,label,{required=true}={}) {
  if (typeof value!=="string") throw monthlyPlanError(`${label} is invalid.`);
  const text=value.trim();
  if ((required&&!text)||text.length>max) throw monthlyPlanError(`${label} must be ${required?"between 1 and ":"at most "}${max} characters.`);
  return text;
}

function monthlyPlanDate(value) {
  if (typeof value!=="string"||!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(value)) throw monthlyPlanError("Choose a valid start date.");
  const date=new Date(`${value}T00:00:00.000Z`);
  if (!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value||date.getUTCFullYear()<1900||date.getUTCFullYear()>2200) throw monthlyPlanError("Choose a valid start date between 1900 and 2200.");
  return date;
}

function exerciseMatchesMonthlyTarget(exercise,target) {
  const group=String(exercise?.group||"").toLowerCase(),sub=String(exercise?.sub||"").toLowerCase();
  if (target==="biceps") return group==="arms"&&(sub.includes("biceps")||sub.includes("brachialis"));
  if (target==="triceps") return group==="arms"&&sub.includes("triceps");
  if (target==="forearms") return group==="arms"&&sub.includes("forearm");
  return group===target;
}

function validateMonthlyExercises(items,targets,context,{minimumPerTarget=0}={}) {
  const ids=items.map((item)=>item.exerciseId);
  if (new Set(ids).size!==ids.length) throw monthlyPlanError(`${context} contains a repeated exercise.`);
  for (const item of items) {
    const exercise=EXERCISE_BY_ID.get(item.exerciseId);
    if (!targets.some((target)=>exerciseMatchesMonthlyTarget(exercise,target))) throw monthlyPlanError(`${context} contains an exercise outside its selected muscle groups.`);
  }
  for (const target of targets) {
    const count=items.filter((item)=>exerciseMatchesMonthlyTarget(EXERCISE_BY_ID.get(item.exerciseId),target)).length;
    if (count<minimumPerTarget) throw monthlyPlanError(`${context} needs ${minimumPerTarget} ${target} exercise${minimumPerTarget===1?"":"s"}.`);
  }
}

function monthlyPlanExercise(input,context) {
  exactMonthlyKeys(input,["exerciseId","sets","reps"],`${context} contains an invalid exercise.`);
  const exerciseId=monthlyPlanText(input.exerciseId,80,"Exercise ID");
  if (!EXERCISE_IDS.has(exerciseId)) throw monthlyPlanError(`${context} contains an unknown exercise.`);
  const sets=Number(input.sets);
  if (!Number.isInteger(sets)||sets<1||sets>10) throw monthlyPlanError(`${context} sets must be a whole number from 1 to 10.`);
  const reps=monthlyPlanText(input.reps,20,`${context} reps`);
  return {exerciseId,sets,reps};
}

function monthlyPlanTargets(input,{rest,context}) {
  if (!Array.isArray(input)) throw monthlyPlanError(`${context} targets must be a list.`);
  if (input.length>4) throw monthlyPlanError(`${context} can use at most four muscle groups.`);
  const targets=input.map((target)=>monthlyPlanText(target,20,`${context} muscle group`));
  if (new Set(targets).size!==targets.length||targets.some((target)=>!MONTHLY_PLAN_TARGETS.includes(target))) {
    throw monthlyPlanError(`${context} contains an invalid or repeated muscle group.`);
  }
  if (rest&&targets.length) throw monthlyPlanError(`${context} cannot contain muscle groups on a rest day.`);
  if (!rest&&!targets.length) throw monthlyPlanError(`${context} needs at least one muscle group or must be marked as rest.`);
  return targets;
}

function sameMonthlyTargets(actual,expected) {
  return actual.length===expected.length&&actual.every((target)=>expected.includes(target));
}

function sanitizeMonthlyPlan(input,{generatedAt=Date.now()}={}) {
  monthlyPlanObject(input,"Invalid monthly plan.");
  const inputKeys=Object.keys(input);
  const requiredKeys=["version","title","source","startDate","exercisesPerTarget","schedule","days"];
  if (requiredKeys.some((key)=>!inputKeys.includes(key))||inputKeys.some((key)=>![...requiredKeys,"generatedAt"].includes(key))) {
    throw monthlyPlanError("Invalid monthly plan.");
  }
  if (input.version!==1) throw monthlyPlanError("Unsupported monthly plan version.");
  const title=monthlyPlanText(input.title,80,"Plan title");
  if (!['weekly','muscle-schedule'].includes(input.source)) throw monthlyPlanError("Choose a valid monthly-plan source.");
  const startDate=monthlyPlanText(input.startDate,10,"Start date");
  const start=monthlyPlanDate(startDate);
  const exercisesPerTarget=Number(input.exercisesPerTarget);
  if (!Number.isInteger(exercisesPerTarget)||exercisesPerTarget<1||exercisesPerTarget>3) {
    throw monthlyPlanError("Exercises per muscle group must be a whole number from 1 to 3.");
  }

  const inputSchedule=monthlyPlanObject(input.schedule,"Monthly plan schedule is invalid.");
  exactMonthlyKeys(inputSchedule,DAYS,"Monthly plan schedule must include Monday through Sunday.");
  const schedule={};
  for (const day of DAYS) {
    const entry=inputSchedule[day];
    exactMonthlyKeys(entry,["rest","targets","sourceItems"],`${day} schedule is invalid.`);
    if (typeof entry.rest!=="boolean") throw monthlyPlanError(`${day} rest setting is invalid.`);
    const targets=monthlyPlanTargets(entry.targets,{rest:entry.rest,context:day});
    if (!Array.isArray(entry.sourceItems)||entry.sourceItems.length>12) throw monthlyPlanError(`${day} can contain at most 12 source exercises.`);
    const sourceItems=entry.sourceItems.map((item)=>monthlyPlanExercise(item,`${day} source plan`));
    if (entry.rest&&sourceItems.length) throw monthlyPlanError(`${day} cannot contain source exercises on a rest day.`);
    validateMonthlyExercises(sourceItems,targets,`${day} source plan`);
    schedule[day]={rest:entry.rest,targets,sourceItems};
  }
  if (!DAYS.some((day)=>schedule[day].rest)) throw monthlyPlanError("Choose at least one rest day.");
  if (!DAYS.some((day)=>!schedule[day].rest)) throw monthlyPlanError("Choose at least one training day.");

  if (!Array.isArray(input.days)||input.days.length!==31) throw monthlyPlanError("A monthly plan must contain exactly 31 days.");
  const days=input.days.map((entry,index)=>{
    const context=`Day ${index+1}`;
    exactMonthlyKeys(entry,["dayNumber","date","weekday","rest","targets","exercises"],`${context} is invalid.`);
    if (entry.dayNumber!==index+1) throw monthlyPlanError(`${context} has an invalid day number.`);
    const expectedDate=new Date(start.getTime()+index*24*60*60*1000);
    const expectedDateText=expectedDate.toISOString().slice(0,10);
    if (entry.date!==expectedDateText) throw monthlyPlanError(`${context} date must follow the selected start date.`);
    const expectedWeekday=DAYS[(expectedDate.getUTCDay()+6)%7];
    if (entry.weekday!==expectedWeekday) throw monthlyPlanError(`${context} has an invalid weekday.`);
    if (typeof entry.rest!=="boolean"||entry.rest!==schedule[expectedWeekday].rest) throw monthlyPlanError(`${context} does not match the weekly rest schedule.`);
    const targets=monthlyPlanTargets(entry.targets,{rest:entry.rest,context});
    if (!sameMonthlyTargets(targets,schedule[expectedWeekday].targets)) throw monthlyPlanError(`${context} does not match the weekly muscle-group schedule.`);
    if (!Array.isArray(entry.exercises)||entry.exercises.length>12) throw monthlyPlanError(`${context} can contain at most 12 exercises.`);
    const exercises=entry.exercises.map((item)=>monthlyPlanExercise(item,context));
    if (entry.rest&&exercises.length) throw monthlyPlanError(`${context} cannot contain exercises on a rest day.`);
    if (!entry.rest) validateMonthlyExercises(exercises,targets,context,{minimumPerTarget:exercisesPerTarget});
    return {dayNumber:index+1,date:expectedDateText,weekday:expectedWeekday,rest:entry.rest,targets:schedule[expectedWeekday].targets,exercises};
  });

  const stampedAt=Number(generatedAt);
  if (!Number.isSafeInteger(stampedAt)||stampedAt<=0) throw monthlyPlanError("Monthly plan timestamp is invalid.");
  return {version:1,title,source:input.source,startDate,exercisesPerTarget,schedule,days,generatedAt:stampedAt};
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

function adminPrincipalMatches(principal) {
  return Boolean(
    ADMIN_EMAIL&&principal&&
    normalizeEmail(principal.configured_email)===ADMIN_EMAIL&&
    normalizeEmail(principal.email)===ADMIN_EMAIL&&
    Number(principal.email_verified_at)&&
    !principal.suspended_at
  );
}

async function adminIdentity(session,{allowBootstrap=false}={}) {
  if (!ADMIN_EMAIL||!session||!Number(session.email_verified_at)||session.suspended_at) return {active:false,boundNow:false,principal:null};
  let principal=await store.adminPrincipal();
  let boundNow=false;
  if (!principal&&allowBootstrap&&normalizeEmail(session.email)===ADMIN_EMAIL) {
    const claimed=await store.claimAdminPrincipal(session.id,ADMIN_EMAIL,Date.now());
    principal=claimed.principal;
    boundNow=claimed.boundNow;
  }
  const active=adminPrincipalMatches(principal)&&principal.user_id===session.id;
  return {active,boundNow,principal};
}

async function maybeClaimAdminForLogin(user) {
  if (!ADMIN_EMAIL||!user||normalizeEmail(user.email)!==ADMIN_EMAIL||!Number(user.email_verified_at)||user.suspended_at) return user;
  await store.claimAdminPrincipal(user.id,ADMIN_EMAIL,Date.now());
  return await store.userById(user.id);
}

async function requireAdmin(req,res,{elevated=true,allowBootstrap=false}={}) {
  const session=await requireSession(req,res);
  if (!session) return null;
  const identity=await adminIdentity(session,{allowBootstrap});
  if (identity.boundNow) {
    json(res,409,{error:"Admin ownership is secured. Sign in again to continue.",code:"ADMIN_RELOGIN_REQUIRED"},{"Set-Cookie":sessionCookie("",0)});
    return null;
  }
  if (!identity.active) {
    json(res,403,{error:"Administrator access required.",code:"ADMIN_REQUIRED"});
    return null;
  }
  if (elevated&&!await store.adminElevation(session.token_hash,Date.now())) {
    json(res,428,{error:"Confirm your password to continue in Admin.",code:"ADMIN_ELEVATION_REQUIRED"});
    return null;
  }
  return session;
}

function requireAdminMutation(req,res,session) {
  if (!trustedAuthOrigin(req)) {
    json(res,403,{error:"Admin security check failed. Refresh and try again.",code:"ADMIN_ORIGIN_REQUIRED"});
    return false;
  }
  if (!validCsrf(req,session)) {
    json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});
    return false;
  }
  if (!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json")) {
    json(res,415,{error:"Admin requests must use JSON.",code:"JSON_REQUIRED"});
    return false;
  }
  return true;
}

function adminReason(value) {
  const reason=cleanText(value,200);
  if (reason.length<4) throw Object.assign(new Error("Add a short reason for this admin action."),{status:400,code:"ADMIN_REASON_REQUIRED"});
  if (sensitiveAdminText(reason)) throw Object.assign(new Error("Do not put passwords, codes, API keys, tokens, or private action links in an admin reason."),{status:400,code:"ADMIN_SENSITIVE_REASON"});
  return reason;
}

function sensitiveAdminText(value) {
  const text=String(value||"");
  return /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text)
    || /\b(?:password|passcode|secret|token|api[\s_-]*key)\s*[:=]\s*\S{6,}/i.test(text)
    || /\b(?:verification|security|recovery)\s+code\s*[:=]?\s*\d{6}\b/i.test(text)
    || /\b(?:re_|pdl_(?:live|sdbx|ntfset)_|live_)[A-Za-z0-9_-]{12,}/i.test(text)
    || /(?:[#?&](?:token|code)=)[A-Za-z0-9_-]{6,}/i.test(text);
}

function cleanAdminTarget(value) {
  const id=cleanText(value,100);
  return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";
}

async function recordAdminAudit(actorUserId,targetUserId,action,reason,result="success") {
  await store.recordAdminAudit({id:randomUUID(),actorUserId,targetUserId,action,reason,result,createdAt:Date.now()});
}

function adminAuditEvent(actorUserId,targetUserId,action,reason,result="success") {
  return {id:randomUUID(),actorUserId,targetUserId,action,reason,result,createdAt:Date.now()};
}

function safeTokenEqual(actual,expected) {
  const left=Buffer.from(String(actual||""));
  const right=Buffer.from(String(expected||""));
  return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}

function validCsrf(req,session) {
  return safeTokenEqual(req.headers["x-csrf-token"],session?.csrf_token);
}

function requireCommunityMutation(req,res,session,{jsonBody=false}={}) {
  if (!trustedAuthOrigin(req)) {
    json(res,403,{error:"Community-plan security check failed. Refresh and try again.",code:"COMMUNITY_ORIGIN_REQUIRED"});
    return false;
  }
  if (!validCsrf(req,session)) {
    json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});
    return false;
  }
  if (jsonBody&&!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json")) {
    json(res,415,{error:"Community-plan requests must use JSON.",code:"JSON_REQUIRED"});
    return false;
  }
  return true;
}

async function requireDiscoveryAccess(req,res) {
  const session=await requireSession(req,res);
  if (!session) return null;
  if (!await store.hasDiscoveryAccess(session.id)) {
    json(res,402,{error:"Strata+ purchase required.",code:"DISCOVERY_ACCESS_REQUIRED"});
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

function trustedAuthOrigin(req) {
  const origin=String(req.headers.origin||"");
  if (!origin||origin==="null") return false;
  const configured=String(process.env.APP_BASE_URL||"").trim();
  if (configured&&process.env.NODE_ENV==="production") {
    try { return origin===new URL(configured).origin; }
    catch { return false; }
  }
  return sameOrigin(req);
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

function rateKeyAllowed(key,max=10,windowMs=15*60*1000) {
  const now=Date.now();
  const bucket=(rateBuckets.get(key)||[]).filter((time) => now-time<windowMs);
  if (bucket.length >= max) return false;
  bucket.push(now); rateBuckets.set(key,bucket); return true;
}

function rateAllowed(req,kind,max=10,windowMs=15*60*1000) {
  return rateKeyAllowed(`${kind}:${requestAddress(req)}`,max,windowMs);
}

function validateRegistration(input) {
  const name=cleanText(input.name,40),email=normalizeEmail(input.email),password=String(input.password||"");
  if (name.length<2 || !validEmail(email) || password.length<10 || password.length>128) throw Object.assign(new Error("Use a valid name, email, and password of 10–128 characters."),{status:400});
  return {name,email,password};
}

async function registerAccountDirect(input) {
  const {name,email,password}=validateRegistration(input);
  try {
    if (await store.userByEmail(email)) throw Object.assign(new Error("An account with that email already exists."),{status:409});
    const id=randomUUID(),salt=randomBytes(16).toString("base64"),hash=await passwordHash(password,salt),now=Date.now();
    try { await store.insertUser({id,name,email,passwordHash:hash,passwordSalt:salt,createdAt:now}); }
    catch(error) { if (isUniqueViolation(error)) throw Object.assign(new Error("An account with that email already exists."),{status:409}); throw error; }
    const session=await createSession(id,1),user=await store.userById(id);
    return {session,user};
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

function verificationPublic(row,now=Date.now()) {
  const deliveryState=row.delivery_state==="sent"
    ? "sent"
    : row.delivery_state==="failed"
      ? "failed"
      : "pending";
  return {
    verificationRequired:true,
    purpose:row.purpose==="login"?"login":"signup",
    maskedEmail:maskEmail(row.email),
    expiresAt:Number(row.expires_at),
    resendAfter:Math.max(now,Number(row.last_sent_at)+VERIFICATION_RESEND_MS),
    attemptsRemaining:Math.max(0,VERIFICATION_MAX_ATTEMPTS-Number(row.attempts_used||0)),
    deliveryState
  };
}

function verificationError(message,status,code,extra={}) {
  return Object.assign(new Error(message),{status,code,...extra});
}

function ensureVerificationDeliveryConfigured() {
  if (!EMAIL_CONFIG.enabled) {
    throw verificationError("Email verification is temporarily unavailable. Please try again later.",503,"EMAIL_VERIFICATION_UNAVAILABLE");
  }
}

async function claimVerificationSendSlot({email,challengeId,generation,sentAt}) {
  const now=Date.now();
  const send={
    id:randomUUID(),
    emailHash:verificationEmailHash(EMAIL_CONFIG,email),
    challengeId,
    generation:Number(generation),
    sentAt:Number(sentAt)
  };
  const claimed=await store.claimVerificationSend(send,now-VERIFICATION_SEND_WINDOW_MS,VERIFICATION_EMAIL_SENDS_PER_HOUR);
  return {claimed,send};
}

function verificationEmailLimit() {
  return verificationError("Too many verification emails were requested. Please wait and try again.",429,"VERIFICATION_EMAIL_LIMIT",{retryAfter:3600});
}

async function deliverVerification(row,code) {
  const remainingMs=Math.min(Number(row.expires_at),Number(row.hard_expires_at))-Date.now();
  if (remainingMs<=0) {
    throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
  }
  try {
    const delivery=await sendVerificationEmail(EMAIL_CONFIG,{
      to:row.email,
      name:row.name,
      code,
      challengeId:row.challenge_id,
      generation:Number(row.generation),
      purpose:row.purpose==="login"?"login":"signup",
      expiresInMinutes:Math.max(1,Math.ceil(remainingMs/60000))
    });
    await store.markVerificationDelivery(row.challenge_id,Number(row.generation),"sent",Date.now());
    return delivery;
  } catch(error) {
    await store.markVerificationDelivery(row.challenge_id,Number(row.generation),"failed",Date.now());
    console.error(`Verification email delivery failed: ${error?.code||"provider-error"}`);
    throw verificationError("The verification email could not be sent. Please wait a moment and resend it.",503,"EMAIL_DELIVERY_UNAVAILABLE");
  }
}

async function createVerificationChallenge({purpose,userId,email,name,passwordHash="",passwordSalt=""}) {
  const code=generateVerificationCode();
  const challengeId=randomUUID();
  const signupToken=randomBytes(32).toString("base64url");
  const now=Date.now();
  const generation=1;
  const row={
    challengeId,
    browserTokenHash:hashToken(signupToken),
    purpose,
    userId,
    email,
    name,
    passwordHash,
    passwordSalt,
    codeDigest:verificationCodeDigest(EMAIL_CONFIG,{challengeId,generation,email,code}),
    generation,
    attemptsUsed:0,
    sendCount:1,
    lastSentAt:now,
    expiresAt:now+VERIFICATION_CODE_MS,
    hardExpiresAt:now+VERIFICATION_HARD_MS,
    deliveryState:"sending",
    createdAt:now,
    updatedAt:now
  };
  const reservation=await claimVerificationSendSlot({email:row.email,challengeId,generation,sentAt:now});
  if (!reservation.claimed) throw verificationEmailLimit();
  await store.insertVerification(row);
  const stored=await store.verificationByTokenHash(row.browserTokenHash);
  try {
    await deliverVerification(stored,code);
  } catch(error) {
    error.signupToken=signupToken;
    error.verification=verificationPublic(stored);
    throw error;
  }
  authAudit("verification_challenge_sent",{purpose,email});
  return {signupToken,verification:verificationPublic(stored)};
}

async function beginAccountRegistration(input) {
  if (!EMAIL_CONFIG.requestedEnabled) {
    if (!directSignupAllowed(EMAIL_CONFIG,process.env.NODE_ENV,process.env.ALLOW_UNVERIFIED_SIGNUP_FOR_TESTS)) {
      throw verificationError("Email verification is temporarily unavailable. Please try again later.",503,"EMAIL_VERIFICATION_UNAVAILABLE");
    }
    authAudit("test_only_unverified_signup",{purpose:"signup",email:normalizeEmail(input?.email)});
    return {verified:true,...await registerAccountDirect(input)};
  }
  ensureVerificationDeliveryConfigured();
  const {name,email,password}=validateRegistration(input);
  try {
    if (await store.userByEmail(email)) {
      authAudit("signup_existing_email_rejected",{purpose:"signup",email});
      throw Object.assign(new Error("An account with that email already exists."),{status:409,code:"ACCOUNT_EXISTS"});
    }
    const passwordSalt=randomBytes(16).toString("base64");
    const pendingPasswordHash=await passwordHash(password,passwordSalt);
    return await createVerificationChallenge({
      purpose:"signup",
      userId:randomUUID(),
      email,
      name,
      passwordHash:pendingPasswordHash,
      passwordSalt
    });
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

async function verificationForRequest(req) {
  const token=signupTokenFor(req);
  if (!token) return null;
  try { return await store.verificationByTokenHash(hashToken(token)); }
  catch(error) { throw accountStorageUnavailable(error); }
}

function usableVerification(row,now=Date.now()) {
  return Boolean(row&&!row.consumed_at&&Number(row.hard_expires_at)>now);
}

async function verifyAccountEmail(req,input) {
  const code=String(input.code||"").trim();
  const row=await verificationForRequest(req);
  const now=Date.now();
  if (!usableVerification(row,now)) {
    throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
  }
  if (Number(row.expires_at)<=now) {
    throw verificationError("That verification code expired. Request a new code and try again.",410,"VERIFICATION_CODE_EXPIRED",{verification:verificationPublic(row,now)});
  }
  const attempt=await store.claimVerificationAttempt(row.challenge_id,Number(row.generation),now,VERIFICATION_MAX_ATTEMPTS);
  if (!attempt) {
    const current=await verificationForRequest(req),checkedAt=Date.now();
    if (!usableVerification(current,checkedAt)) {
      throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
    }
    if (Number(current.generation)!==Number(row.generation)) {
      throw verificationError("A newer verification code was sent. Use the most recent code from your email.",409,"VERIFICATION_CODE_REPLACED",{verification:verificationPublic(current,checkedAt)});
    }
    if (Number(current.expires_at)<=checkedAt) {
      throw verificationError("That verification code expired. Request a new code and try again.",410,"VERIFICATION_CODE_EXPIRED",{verification:verificationPublic(current,checkedAt)});
    }
    throw verificationError("That verification code is invalid or expired. Request a new code and try again.",400,"INVALID_VERIFICATION_CODE",{
      attemptsRemaining:Math.max(0,VERIFICATION_MAX_ATTEMPTS-Number(current.attempts_used||0)),
      verification:verificationPublic(current,checkedAt)
    });
  }
  const remaining=Math.max(0,VERIFICATION_MAX_ATTEMPTS-Number(attempt.attempts_used));
  if (!/^[0-9]{6}$/.test(code)) {
    throw verificationError("That verification code is invalid or expired. Request a new code and try again.",400,"INVALID_VERIFICATION_CODE",{attemptsRemaining:remaining});
  }
  const actual=verificationCodeDigest(EMAIL_CONFIG,{challengeId:attempt.challenge_id,generation:Number(attempt.generation),email:attempt.email,code});
  if (!safeDigestEqual(actual,attempt.code_digest)) {
    throw verificationError("That verification code is invalid or expired. Request a new code and try again.",400,"INVALID_VERIFICATION_CODE",{attemptsRemaining:remaining});
  }
  const purpose=attempt.purpose==="login"?"login":"signup";
  const preparedSession=prepareSession(attempt.user_id,now);
  if (purpose==="login") {
    let user;
    try {
      user=await store.completeLoginVerification(attempt.challenge_id,Number(attempt.generation),now,preparedSession.record);
    } catch(error) {
      throw accountStorageUnavailable(error);
    }
    if (!user) throw verificationError("That verification code is invalid or expired. Request a new code and try again.",400,"INVALID_VERIFICATION_CODE");
    authAudit("verification_completed",{purpose,email:attempt.email});
    return {purpose,session:{token:preparedSession.token,csrfToken:preparedSession.csrfToken},user};
  }
  if (await store.userByEmail(attempt.email)) {
    await store.consumeVerification(attempt.challenge_id,Number(attempt.generation),now);
    throw verificationError("An account with that email already exists. Sign in instead.",409,"ACCOUNT_EXISTS",{clearSignup:true});
  }
  let user;
  try { user=await store.completeSignup(attempt.challenge_id,Number(attempt.generation),now,preparedSession.record); }
  catch(error) {
    if (isUniqueViolation(error)) {
      let existing=null;
      try { existing=await store.userByEmail(attempt.email); }
      catch(storageError) { throw accountStorageUnavailable(storageError); }
      if (existing) throw verificationError("An account with that email already exists. Sign in instead.",409,"ACCOUNT_EXISTS",{clearSignup:true});
    }
    throw accountStorageUnavailable(error);
  }
  if (!user) throw verificationError("That verification code is invalid or expired. Request a new code and try again.",400,"INVALID_VERIFICATION_CODE");
  authAudit("verification_completed",{purpose,email:attempt.email});
  return {purpose,session:{token:preparedSession.token,csrfToken:preparedSession.csrfToken},user};
}

async function resendAccountVerification(req) {
  ensureVerificationDeliveryConfigured();
  const row=await verificationForRequest(req);
  const now=Date.now();
  if (!usableVerification(row,now)) throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
  const retryMs=Number(row.last_sent_at)+VERIFICATION_RESEND_MS-now;
  if (retryMs>0) throw verificationError("Please wait before requesting another verification code.",429,"VERIFICATION_COOLDOWN",{retryAfter:Math.ceil(retryMs/1000)});
  if (Number(row.send_count)>=VERIFICATION_MAX_SENDS) throw verificationError("This verification request has reached its resend limit. Create the account again to continue.",429,"VERIFICATION_SEND_LIMIT",{clearSignup:true});
  if (Number(row.hard_expires_at)-now<VERIFICATION_RESEND_MS) {
    throw verificationError("This verification request is too close to expiring to send another code. Use the current code or create the account again after it expires.",409,"VERIFICATION_EXPIRING",{verification:verificationPublic(row,now)});
  }
  const code=generateVerificationCode();
  const nextGeneration=Number(row.generation)+1;
  const reservation=await claimVerificationSendSlot({email:row.email,challengeId:row.challenge_id,generation:nextGeneration,sentAt:now});
  let mayRotate=reservation.claimed;
  if (!mayRotate) {
    const current=await verificationForRequest(req),checkedAt=Date.now();
    if (usableVerification(current,checkedAt)) {
      // A process may have stopped after reserving this generation but before
      // rotating the challenge. Reuse that durable reservation. During a live
      // concurrent resend both requests may reach this point, but the guarded
      // rotation below still permits only one winner and therefore one email.
      const reserved=Number(current.generation)===Number(row.generation)
        ? await store.verificationSendByChallengeGeneration(row.challenge_id,nextGeneration)
        : null;
      if (reserved) mayRotate=true;
      else {
        const emailHash=verificationEmailHash(EMAIL_CONFIG,row.email);
        const sends=await store.countVerificationSends(emailHash,checkedAt-VERIFICATION_SEND_WINDOW_MS);
        if (sends>=VERIFICATION_EMAIL_SENDS_PER_HOUR) throw verificationEmailLimit();
        const retryAfter=Math.max(1,Math.ceil((Number(current.last_sent_at)+VERIFICATION_RESEND_MS-checkedAt)/1000));
        throw verificationError("Another verification-code request is already being processed. Please wait before trying again.",429,"VERIFICATION_COOLDOWN",{retryAfter,verification:verificationPublic(current,checkedAt)});
      }
    }
    if (!mayRotate) throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
  }
  const updated=await store.rotateVerification(row.challenge_id,Number(row.generation),{
    codeDigest:verificationCodeDigest(EMAIL_CONFIG,{challengeId:row.challenge_id,generation:nextGeneration,email:row.email,code}),
    lastSentAt:now,
    expiresAt:Math.min(now+VERIFICATION_CODE_MS,Number(row.hard_expires_at)),
    deliveryState:"sending",
    updatedAt:now
  });
  if (!updated) {
    const current=await verificationForRequest(req),checkedAt=Date.now();
    if (usableVerification(current,checkedAt)) {
      const retryAfter=Math.max(1,Math.ceil((Number(current.last_sent_at)+VERIFICATION_RESEND_MS-checkedAt)/1000));
      throw verificationError("Another verification-code request is already being processed. Please wait before trying again.",429,"VERIFICATION_COOLDOWN",{retryAfter,verification:verificationPublic(current,checkedAt)});
    }
    throw verificationError("Your verification request expired. Create the account again to receive a new code.",410,"VERIFICATION_EXPIRED",{clearSignup:true});
  }
  await deliverVerification(updated,code);
  return verificationPublic(updated);
}

async function authenticateAccount(input) {
  const email=normalizeEmail(input.email),password=String(input.password||"");
  try {
    const user=await store.userByEmail(email);
    if (!user) {
      await passwordHash(password,Buffer.alloc(16).toString("base64"));
      throw Object.assign(new Error("Email or password is incorrect."),{status:401});
    }
    const matches=await passwordMatches(password,user);
    if (!matches) throw Object.assign(new Error("Email or password is incorrect."),{status:401});
    if (user.suspended_at) throw Object.assign(new Error("This account is temporarily paused. Contact STRATA support for help."),{status:403,code:"ACCOUNT_SUSPENDED"});
    if (EMAIL_CONFIG.requestedEnabled&&!Number(user.email_verified_at)) {
      ensureVerificationDeliveryConfigured();
      return await createVerificationChallenge({
        purpose:"login",
        userId:user.id,
        email:user.email,
        name:user.name
      });
    }
    const currentUser=await maybeClaimAdminForLogin(user);
    return {session:await createSession(currentUser.id,currentUser.auth_version),user:currentUser};
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

const PASSWORD_RESET_RESPONSE = "If an account uses that email, a password-reset link has been sent. Check the inbox and spam folder.";

function ensureAccountEmailConfigured() {
  if (!EMAIL_CONFIG.enabled) {
    throw Object.assign(new Error("Account recovery email is temporarily unavailable. Please try again later."),{status:503,code:"ACCOUNT_EMAIL_UNAVAILABLE"});
  }
}

function validAccountActionToken(value) {
  const token=String(value||"").trim();
  return /^[A-Za-z0-9_-]{43}$/.test(token)?token:"";
}

function accountActionError(message,status,code) {
  return Object.assign(new Error(message),{status,code});
}

async function claimAccountActionSend(email,purpose) {
  const now=Date.now();
  const emailHash=verificationEmailHash(EMAIL_CONFIG,email);
  const send={id:randomUUID(),emailHash,purpose,sentAt:now};
  const claimed=await store.claimAccountActionSend(send,now-ACCOUNT_ACTION_SEND_WINDOW_MS,ACCOUNT_ACTION_EMAILS_PER_HOUR);
  return {claimed,emailHash};
}

async function createAndDeliverAccountAction(user,purpose) {
  const token=randomBytes(32).toString("base64url");
  const now=Date.now();
  const staged=await store.stageAccountAction({
    requestId:randomUUID(),
    userId:user.id,
    purpose,
    tokenHash:hashToken(token),
    expiresAt:now+ACCOUNT_ACTION_MS,
    createdAt:now
  });
  if (!staged) throw new Error("Account action could not be staged.");
  try {
    await sendAccountActionEmail(EMAIL_CONFIG,{
      to:user.email,
      name:user.name,
      token,
      requestId:staged.request_id,
      purpose,
      expiresInMinutes:Math.ceil(ACCOUNT_ACTION_MS/60000)
    });
    const action=await store.activateAccountAction(staged.request_id,staged.token_hash,Date.now());
    if (!action) throw new Error("Delivered account action could not be activated.");
    authAudit("account_action_sent",{purpose,email:user.email});
    return {expiresAt:Number(action.expires_at),maskedEmail:maskEmail(user.email)};
  } catch(error) {
    try { await store.discardStagedAccountAction(staged.request_id,staged.token_hash); }
    catch(discardError) { console.error("Staged account-action cleanup failed:",discardError); }
    console.error(`Account action email delivery failed: ${error?.code||"provider-error"}`);
    throw accountActionError("The account email could not be sent. Please try again in a moment.",503,"ACCOUNT_EMAIL_DELIVERY_UNAVAILABLE");
  }
}

async function requestForgotPassword(input) {
  ensureAccountEmailConfigured();
  const email=normalizeEmail(input?.email);
  if (!validEmail(email)) throw accountActionError("Enter a valid email address.",400,"INVALID_EMAIL");
  try {
    const reservation=await claimAccountActionSend(email,"password_reset");
    if (reservation.claimed) {
      const user=await store.userByEmail(email);
      if (user) {
        // Public recovery always returns on the same short schedule. Provider
        // latency must not reveal whether the address has an account.
        void createAndDeliverAccountAction(user,"password_reset").catch((error) => {
          console.error(`Background password-reset delivery failed: ${error?.code||"provider-error"}`);
        });
      }
    }
    await new Promise((resolve)=>setTimeout(resolve,400));
    authAudit("password_reset_requested",{purpose:"password_reset",email});
    return {ok:true,message:PASSWORD_RESET_RESPONSE};
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

async function requestSignedInAccountAction(session,purpose) {
  ensureAccountEmailConfigured();
  try {
    const principal=purpose==="account_delete"?await store.adminPrincipal():null;
    if (principal?.user_id===session.id) {
      throw accountActionError("The primary administrator account cannot be deleted while it owns site management.",409,"ADMIN_ACCOUNT_PROTECTED");
    }
    const reservation=await claimAccountActionSend(session.email,purpose);
    if (!reservation.claimed) throw accountActionError("Too many account emails were requested. Please wait and try again.",429,"ACCOUNT_EMAIL_LIMIT");
    return await createAndDeliverAccountAction(session,purpose);
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

function checkoutReconciliationError(message,code="PURCHASE_RECONCILIATION_UNAVAILABLE") {
  return accountActionError(message,503,code);
}

async function releaseCheckoutClaim(claim,expectedTransactionId=null) {
  if (await store.releaseCheckoutCreation(claim.user_id,claim.claim_id,expectedTransactionId)) return true;
  // A concurrent recovery may already have removed this claim. A replacement
  // claim (or one that gained a transaction) must be left intact and handled by
  // the next request rather than being mistaken for successful cleanup.
  return !(await store.checkoutCreationForUser(claim.user_id));
}

function validatePurchaseCheckoutForCancellation(remote,purchase) {
  const checkoutId=cleanText(remote.data?.custom_data?.strata_checkout_id,100);
  return validateCheckoutTransaction(remote.data,PAYMENT_CONFIG,{
    userId:purchase.user_id,
    checkoutId,
    priceId:purchase.price_id,
    productId:purchase.product_id
  });
}

async function transactionForCheckoutClaim(claim) {
  const validationOptions={
    userId:claim.user_id,
    checkoutId:claim.claim_id,
    priceId:claim.price_id,
    productId:PAYMENT_CONFIG.productId
  };
  let remote;
  try {
    remote=claim.transaction_id
      ? await fetchPaddleTransaction(PAYMENT_CONFIG,claim.transaction_id)
      : await findPaddleCheckoutTransaction(PAYMENT_CONFIG,{
        ...validationOptions,
        createdAt:Number(claim.created_at)
      });
  } catch {
    throw checkoutReconciliationError("STRATA could not safely confirm an interrupted Strata+ checkout. Please try again later.");
  }
  if (!remote) return null;
  const validation=validateCheckoutTransaction(remote.data,PAYMENT_CONFIG,validationOptions);
  if (!validation.ok) {
    throw checkoutReconciliationError("STRATA could not safely validate an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
  }
  if (!claim.transaction_id) {
    const recorded=await store.recordCheckoutCreationTransaction(claim.user_id,claim.claim_id,remote.transactionId,Date.now());
    if (!recorded) {
      // The creator may have attached the same transaction and released the
      // claim between our provider lookup and this write. Treat that as a
      // successful handoff, but never accept a transaction attached elsewhere.
      const attached=await store.purchaseByTransaction(remote.transactionId);
      if (attached?.user_id!==claim.user_id) {
        throw checkoutReconciliationError("The interrupted checkout changed while it was being recovered. Please try again.");
      }
    }
  }
  return remote;
}

async function recoverCheckoutCreation(claim) {
  const remote=await transactionForCheckoutClaim(claim);
  if (!remote) {
    if (Number(claim.expires_at)>Date.now()) return {state:"waiting"};
    return await releaseCheckoutClaim(claim,null)?{state:"replace"}:{state:"waiting"};
  }
  let purchase=await store.purchaseByTransaction(remote.transactionId);
  if (purchase&&purchase.user_id!==claim.user_id) {
    throw checkoutReconciliationError("STRATA could not safely attach an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
  }
  if (remote.status==="canceled") {
    if (purchase) await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(Date.now(),Number(purchase.updated_at)+1));
    return await releaseCheckoutClaim(claim,remote.transactionId)?{state:"replace"}:{state:"waiting"};
  }
  if (!purchase) {
    const createdAt=eventTime(remote.data.created_at,Number(claim.created_at)||Date.now());
    const updatedAt=Math.max(createdAt,eventTime(remote.data.updated_at,Date.now()));
    try {
      purchase=await store.insertPendingPurchase({
        transactionId:remote.transactionId,
        userId:claim.user_id,
        priceId:claim.price_id,
        productId:cleanText(remote.data?.items?.[0]?.price?.product_id,100)||PAYMENT_CONFIG.productId,
        paddleStatus:remote.status,
        createdAt,
        updatedAt
      });
    } catch(error) {
      if (!isUniqueViolation(error)) throw error;
      purchase=await store.purchaseByTransaction(remote.transactionId);
    }
  }
  if (!purchase) {
    return await store.activeAccountDeletion(claim.user_id,Date.now())?{state:"deletion"}:{state:"blocked"};
  }
  let entitled=false;
  if (remote.status==="completed") {
    const validation=validateCompletedTransaction(remote.data,{...PAYMENT_CONFIG,priceId:claim.price_id});
    if (!validation.ok) throw checkoutReconciliationError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
    const completedAt=eventTime(remote.data.updated_at,Date.now());
    await store.completePurchase(remote.transactionId,{
      customerId:cleanText(remote.data.customer_id,100)||null,
      completedAt,
      updatedAt:completedAt
    });
    entitled=await store.hasPaidDiscoveryAccess(claim.user_id);
  } else if (purchase.paddle_status!==remote.status) {
    await store.updatePurchaseStatus(remote.transactionId,remote.status,Math.max(Date.now(),Number(purchase.updated_at)+1));
  }
  const released=await releaseCheckoutClaim(claim,remote.transactionId);
  if (remote.status==="completed") {
    if (entitled) return {state:"entitled"};
    return released?{state:"replace"}:{state:"waiting"};
  }
  if (!released) return {state:"waiting"};
  if (remote.status==="draft"||remote.status==="ready") return {state:"transaction",transactionId:remote.transactionId};
  return {state:"pending"};
}

async function reconcileCheckoutCreationBeforeDeletion(userId) {
  const claim=await store.checkoutCreationForUser(userId);
  if (!claim) return 0;
  const remote=await transactionForCheckoutClaim(claim);
  if (!remote) {
    if (Number(claim.expires_at)<=Date.now()) {
      return await releaseCheckoutClaim(claim,null)?0:1;
    }
    return 1;
  }
  const purchase=await store.purchaseByTransaction(remote.transactionId);
  if (purchase&&purchase.user_id!==userId) {
    throw checkoutReconciliationError("STRATA could not safely attach an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
  }
  if (remote.status==="canceled") {
    if (purchase) await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(Date.now(),Number(purchase.updated_at)+1));
    return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
  }
  if (PADDLE_CANCELABLE_STALE_STATUSES.has(remote.status)) {
    try { await cancelPaddleTransaction(PAYMENT_CONFIG,remote.transactionId); }
    catch { throw checkoutReconciliationError("STRATA could not safely close an interrupted Strata+ checkout. Please try again later."); }
    if (purchase) await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(Date.now(),Number(purchase.updated_at)+1));
    return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
  }
  if (remote.status==="completed") {
    const validation=validateCompletedTransaction(remote.data,{...PAYMENT_CONFIG,priceId:claim.price_id});
    if (!validation.ok) throw checkoutReconciliationError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
    if (!purchase) throw checkoutReconciliationError("STRATA could not safely attach a completed Strata+ checkout while account deletion is pending. Please cancel deletion and contact support.","PURCHASE_RECONCILIATION_INVALID");
    const completedAt=eventTime(remote.data.updated_at,Date.now());
    await store.completePurchase(remote.transactionId,{
      customerId:cleanText(remote.data.customer_id,100)||null,
      completedAt,
      updatedAt:completedAt
    });
    return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
  }
  await store.extendCheckoutCreation(userId,claim.claim_id,Date.now()+CHECKOUT_CREATION_CLAIM_MS,Date.now());
  return 1;
}

async function reconcileUnsettledPurchases(userId) {
  const purchases=await store.unsettledPurchasesForUser(userId);
  const now=Date.now();
  const staleBefore=now-ABANDONED_CHECKOUT_MS;
  const stale=purchases.filter((purchase)=>purchase.paddle_status==="past_due"||Number(purchase.updated_at)<=staleBefore).slice(0,MAX_DELETION_RECONCILIATIONS);
  const reconciled=await Promise.allSettled(stale.map(async(purchase)=>{
    let remote;
    try { remote=await fetchPaddleTransaction(PAYMENT_CONFIG,purchase.transaction_id); }
    catch {
      throw accountActionError("STRATA could not safely confirm an older Strata+ checkout. Please try again later.",503,"PURCHASE_RECONCILIATION_UNAVAILABLE");
    }
    const reconciledAt=Math.max(Date.now(),Number(purchase.updated_at)+1);
    if (remote.status==="canceled") {
      await store.updatePurchaseStatus(purchase.transaction_id,"canceled",reconciledAt);
      return;
    }
    if (PADDLE_CANCELABLE_STALE_STATUSES.has(remote.status)) {
      const validation=validatePurchaseCheckoutForCancellation(remote,purchase);
      if (!validation.ok) {
        throw accountActionError("STRATA could not safely validate an abandoned Strata+ checkout. Please contact support.",503,"PURCHASE_RECONCILIATION_INVALID");
      }
      try { await cancelPaddleTransaction(PAYMENT_CONFIG,purchase.transaction_id); }
      catch {
        throw accountActionError("STRATA could not safely close an abandoned Strata+ checkout. Please try again later.",503,"PURCHASE_RECONCILIATION_UNAVAILABLE");
      }
      await store.updatePurchaseStatus(purchase.transaction_id,"canceled",reconciledAt);
      return;
    }
    if (remote.status==="completed") {
      const validation=validateCompletedTransaction(remote.data,{
        ...PAYMENT_CONFIG,
        priceId:purchase.price_id,
        productId:purchase.product_id
      });
      const claimedUser=cleanText(remote.data?.custom_data?.strata_user_id,100);
      if (!validation.ok||claimedUser!==purchase.user_id) {
        throw accountActionError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.",503,"PURCHASE_RECONCILIATION_INVALID");
      }
      const completedAt=eventTime(remote.data.updated_at,Date.now());
      await store.completePurchase(purchase.transaction_id,{
        customerId:cleanText(remote.data.customer_id,100)||null,
        completedAt,
        updatedAt:completedAt
      });
    }
  }));
  const failure=reconciled.find((result)=>result.status==="rejected");
  if (failure) throw failure.reason;
  return store.pendingPurchasesForUser(userId);
}

async function inspectAccountAction(input,expectedPurpose) {
  const token=validAccountActionToken(input?.token);
  if (!token) return {active:false};
  try {
    const row=await store.accountActionByTokenHash(hashToken(token));
    const active=Boolean(row&&row.purpose===expectedPurpose&&row.delivery_state==="sent"&&row.consumed_at==null&&Number(row.expires_at)>Date.now());
    return active
      ? {active:true,expiresAt:Number(row.expires_at),maskedEmail:maskEmail(row.email)}
      : {active:false};
  } catch(error) {
    throw accountStorageUnavailable(error);
  }
}

async function resetPassword(input) {
  const token=validAccountActionToken(input?.token);
  const password=String(input?.password||"");
  const confirmation=String(input?.confirmation||"");
  if (!token) throw accountActionError("This password-reset link is invalid or expired. Request a new one.",400,"INVALID_RESET_LINK");
  if (password.length<10||password.length>128) throw accountActionError("Use a password of 10–128 characters.",400,"INVALID_PASSWORD");
  if (password!==confirmation) throw accountActionError("The two password entries do not match.",400,"PASSWORD_MISMATCH");
  try {
    const action=await store.accountActionByTokenHash(hashToken(token));
    if (!action||action.purpose!=="password_reset"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=Date.now()) {
      throw accountActionError("This password-reset link is invalid or expired. Request a new one.",400,"INVALID_RESET_LINK");
    }
    const salt=randomBytes(16).toString("base64");
    const hash=await passwordHash(password,salt);
    const user=await store.completePasswordReset(hashToken(token),hash,salt,Date.now());
    if (!user) throw accountActionError("This password-reset link is invalid or expired. Request a new one.",400,"INVALID_RESET_LINK");
    authAudit("password_reset_completed",{purpose:"password_reset",email:user.email});
    return user;
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

async function deleteAccountWithToken(input) {
  const token=validAccountActionToken(input?.token);
  if (!token) throw accountActionError("This deletion link is invalid or expired. Request a new one from your account.",400,"INVALID_DELETE_LINK");
  if (String(input?.confirmation||"").trim()!=="DELETE") {
    throw accountActionError("Type DELETE exactly to confirm permanent account deletion.",400,"DELETE_CONFIRMATION_REQUIRED");
  }
  try {
    const action=await store.accountActionByTokenHash(hashToken(token));
    if (!action||action.purpose!=="account_delete"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=Date.now()) {
      throw accountActionError("This deletion link is invalid or expired. Request a new one from your account.",400,"INVALID_DELETE_LINK");
    }
    const principal=await store.adminPrincipal();
    if (principal?.user_id===action.user_id) {
      throw accountActionError("The primary administrator account cannot be deleted while it owns site management.",409,"ADMIN_ACCOUNT_PROTECTED");
    }
    if (await reconcileCheckoutCreationBeforeDeletion(action.user_id)>0) {
      throw accountActionError("A Strata+ checkout is still being prepared. Nothing was deleted; please try again later.",409,"CHECKOUT_PREPARING");
    }
    if (await reconcileUnsettledPurchases(action.user_id)>0) {
      throw accountActionError("A Strata+ payment is still being processed. Nothing was deleted; please try again later.",409,"PURCHASE_PENDING");
    }
    const emailHash=verificationEmailHash(EMAIL_CONFIG,action.email);
    const result=await store.deleteAccount(hashToken(token),Date.now(),emailHash);
    if (result.status==="purchase_pending") {
      throw accountActionError("A Strata+ payment is still being processed. Nothing was deleted; please try again later.",409,"PURCHASE_PENDING");
    }
    if (result.status==="checkout_pending") {
      throw accountActionError("A Strata+ checkout is still being prepared. Nothing was deleted; please try again later.",409,"CHECKOUT_PREPARING");
    }
    if (result.status!=="deleted") throw accountActionError("This deletion link is invalid or expired. Request a new one from your account.",400,"INVALID_DELETE_LINK");
    authAudit("account_deleted",{purpose:"account_delete",email:action.email});
    return result.user;
  } catch(error) {
    if (error.status) throw error;
    throw accountStorageUnavailable(error);
  }
}

function safeAccountNext(value) {
  const next=String(value||"");
  if (next==="admin"||next==="/admin"||next==="/admin.html") return "/admin";
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
  } else if (next==="/admin") {
    params.set("next","admin");
  }
  return `/account.html?${params}`;
}

function verificationLocation(requestedNext,{error="",sent=false,purpose=""}={}) {
  const params=new URLSearchParams();
  const next=safeAccountNext(requestedNext);
  if (next.startsWith("/planner.html")) {
    params.set("next","planner");
    const add=new URL(next,"http://strata.local").searchParams.get("add");
    if (add) params.set("add",add);
  } else if (next==="/pricing") params.set("next","pricing");
  else if (next==="/discover.html") params.set("next","discover");
  else if (next==="/admin") params.set("next","admin");
  if (purpose==="login"||purpose==="signup") params.set("purpose",purpose);
  if (error) params.set("error",error);
  if (sent) params.set("sent","1");
  return `/verify-email.html${params.size?`?${params}`:""}`;
}

function requestedPageNext(url) {
  const requested=cleanText(url.searchParams.get("next"),100);
  const add=cleanText(url.searchParams.get("add"),80);
  if (requested==="planner") {
    return /^[a-z0-9-]{2,80}$/.test(add)&&EXERCISE_IDS.has(add)
      ? `/planner.html?add=${add}`
      : "/planner.html";
  }
  if (requested==="pricing") return "/pricing";
  if (requested==="discover") return "/discover.html";
  if (requested==="admin") return "/admin";
  return safeAccountNext(requested);
}

function replaceInputValue(html,id,value) {
  const pattern=new RegExp(`(<input\\b[^>]*\\bid="${id}"[^>]*\\bvalue=")[^"]*(")`);
  return html.replace(pattern,(_match,before,after)=>`${before}${escapeHtml(value)}${after}`);
}

function revealPageMessage(html,id,message) {
  if (!message) return html;
  const pattern=new RegExp(`(<div\\b[^>]*\\bid="${id}"[^>]*?)\\s+hidden(\\s*><\\/div>)`);
  return html.replace(pattern,(_match,before,after)=>`${before}${after.slice(0,-6)}${escapeHtml(message)}</div>`);
}

function replaceElementText(html,id,message) {
  if (!message) return html;
  const pattern=new RegExp(`(<[^>]+\\bid="${id}"[^>]*>)[^<]*(<\\/[^>]+>)`);
  return html.replace(pattern,(_match,before,after)=>`${before}${escapeHtml(message)}${after}`);
}

function safeAccountPageError(value) {
  const messages=new Set([
    "Cross-origin request rejected.",
    "Too many attempts. Try again later.",
    "Use a valid name, email, and password of 10–128 characters.",
    "An account with that email already exists.",
    "Email or password is incorrect.",
    "This account is temporarily paused. Contact STRATA support for help.",
    "Admin ownership is secured. Sign in again to continue.",
    "Administrator access required.",
    "Unable to complete the account request.",
    "Account storage is temporarily unavailable. Please try again.",
    "Email verification is temporarily unavailable. Please try again later."
  ]);
  const message=cleanText(value,240);
  return message?(messages.has(message)?message:"Unable to complete the account request. Please try again."):"";
}

function safeVerificationPageError(value) {
  const message=cleanText(value,300);
  if (!message) return "";
  const known=new Map([
    ["That verification code is invalid or expired. Request a new code and try again.","That code is incorrect or expired. Check the email or request another code."],
    ["That verification code expired. Request a new code and try again.","That code expired. Request another code below."],
    ["Your verification request expired. Create the account again to receive a new code.","Your verification request expired. Return to signup to begin again."],
    ["Please wait before requesting another verification code.","Please wait before requesting another code."],
    ["This verification request has reached its resend limit. Create the account again to continue.","This request reached its resend limit. Return to signup to begin again."],
    ["Too many verification emails were requested. Please wait and try again.","Too many verification emails were requested. Please wait and try again."],
    ["The verification email could not be sent. Please wait a moment and resend it.","We could not send the verification email. Please wait a moment, then request another code."],
    ["Email verification is temporarily unavailable. Please try again later.","Email verification is temporarily unavailable. Please try again later."],
    ["Too many attempts. Try again later.","Too many attempts. Please wait and try again."],
    ["Cross-origin request rejected.","The security check failed. Return to signup and try again."]
  ]);
  return known.get(message)||"Unable to complete the verification request. Please try again.";
}

function renderAccountFallbacks(html,url) {
  const next=requestedPageNext(url);
  let output=replaceInputValue(html,"signupNext",next);
  output=replaceInputValue(output,"loginNext",next);
  const message=safeAccountPageError(url.searchParams.get("error"));
  if (message) output=revealPageMessage(output,url.searchParams.get("mode")==="login"?"loginMessage":"signupMessage",message);
  return output;
}

function renderVerificationFallbacks(html,url) {
  const next=requestedPageNext(url);
  let output=replaceInputValue(html,"verificationNext",next);
  output=replaceInputValue(output,"resendNext",next);
  const purpose=url.searchParams.get("purpose")==="login"?"login":"signup";
  output=replaceInputValue(output,"verificationPurpose",purpose);
  output=replaceInputValue(output,"resendPurpose",purpose);
  let message=safeVerificationPageError(url.searchParams.get("error"));
  if (!message&&url.searchParams.get("delivery")==="failed") {
    message="We could not send the verification email. Please wait a moment, then request another code.";
  }
  output=revealPageMessage(output,"verificationMessage",message);
  if (url.searchParams.get("sent")==="1") {
    output=replaceElementText(output,"verificationStatus","A fresh code was sent. Check your inbox and spam folder.");
  }
  return output;
}

function redirect(res,location,headers={}) {
  res.writeHead(303,{...securityHeaders(),Location:location,"Cache-Control":"no-store",...headers});res.end();
}

async function handleAuthForm(req,res,url) {
  const recoveryRoutes=new Set(["/auth/password-reset/request","/auth/password-reset/complete","/auth/account-delete/complete"]);
  if (recoveryRoutes.has(url.pathname)) {
    if (req.method!=="POST") { json(res,405,{error:"Method not allowed."},{Allow:"POST"}); return; }
    const input=await bodyForm(req);
    if (!trustedAuthOrigin(req)) {
      const location=url.pathname==="/auth/password-reset/request"?"/forgot-password?error=security":url.pathname==="/auth/password-reset/complete"?"/reset-password?error=security":"/delete-account?error=security";
      redirect(res,location); return;
    }
    try {
      if (url.pathname==="/auth/password-reset/request") {
        if (rateAllowed(req,"password-reset-request",8)) await requestForgotPassword(input);
        redirect(res,"/forgot-password?sent=1"); return;
      }
      if (url.pathname==="/auth/password-reset/complete") {
        if (!rateAllowed(req,"password-reset-complete",10)) throw accountActionError("Too many attempts. Try again later.",429,"PASSWORD_RESET_RATE_LIMIT");
        await resetPassword(input);
        redirect(res,"/account.html?mode=login&reset=1",{"Set-Cookie":sessionCookie("",0)}); return;
      }
      if (!rateAllowed(req,"account-delete-complete",10)) throw accountActionError("Too many attempts. Try again later.",429,"ACCOUNT_DELETE_RATE_LIMIT");
      await deleteAccountWithToken(input);
      redirect(res,"/delete-account?deleted=1",{"Set-Cookie":[sessionCookie("",0),signupCookie("",0)]}); return;
    } catch(error) {
      if (!error.status) console.error(error);
      const location=url.pathname==="/auth/password-reset/request"?"/forgot-password?sent=1":url.pathname==="/auth/password-reset/complete"?"/reset-password?error=invalid":"/delete-account?error=invalid";
      redirect(res,location);
      return;
    }
  }
  const routes=new Set(["/auth/signup","/auth/login","/auth/verify-email","/auth/resend-verification"]);
  if (!routes.has(url.pathname)) { json(res,404,{error:"Account route not found."}); return; }
  if (req.method!=="POST") { json(res,405,{error:"Method not allowed."},{Allow:"POST"}); return; }
  const input=await bodyForm(req);
  const verificationAction=url.pathname==="/auth/verify-email"||url.pathname==="/auth/resend-verification";
  const rejectedLocation=(message)=>verificationAction
    ? verificationLocation(input.next,{error:message,purpose:input.purpose})
    : accountErrorLocation(url.pathname==="/auth/login"?"login":"signup",message,input.next);
  if (!trustedAuthOrigin(req)) { redirect(res,rejectedLocation("Cross-origin request rejected.")); return; }
  const rateKind=url.pathname==="/auth/verify-email"?"verify-email":url.pathname==="/auth/resend-verification"?"resend-verification":"auth";
  const rateMaximum=rateKind==="verify-email"?12:rateKind==="resend-verification"?6:10;
  if (!rateAllowed(req,rateKind,rateMaximum)) { redirect(res,rejectedLocation("Too many attempts. Try again later.")); return; }
  try {
    if (url.pathname==="/auth/signup") {
      const result=await beginAccountRegistration(input);
      if (result.verification) {
        redirect(res,verificationLocation(input.next,{purpose:result.verification.purpose}),{"Set-Cookie":signupCookie(result.signupToken)});
      } else {
        redirect(res,safeAccountNext(input.next),{"Set-Cookie":sessionCookie(result.session.token)});
      }
      return;
    }
    if (url.pathname==="/auth/login") {
      const result=await authenticateAccount(input);
      if (result.verification) {
        redirect(res,verificationLocation(input.next,{purpose:result.verification.purpose}),{"Set-Cookie":signupCookie(result.signupToken)});
      } else {
        redirect(res,safeAccountNext(input.next),{"Set-Cookie":sessionCookie(result.session.token)});
      }
      return;
    }
    if (url.pathname==="/auth/verify-email") {
      const result=await verifyAccountEmail(req,input);
      redirect(res,safeAccountNext(input.next),{"Set-Cookie":[sessionCookie(result.session.token),signupCookie("",0)]});
      return;
    }
    const verification=await resendAccountVerification(req);
    redirect(res,verificationLocation(input.next,{sent:true,purpose:verification.purpose||input.purpose}));
  } catch(error) {
    const message=error.status?error.message:"Unable to complete the account request.";
    if (!error.status) console.error(error);
    const headers={};
    if (error.signupToken) headers["Set-Cookie"]=signupCookie(error.signupToken);
    if (error.clearSignup) headers["Set-Cookie"]=signupCookie("",0);
    if ((url.pathname==="/auth/signup"||url.pathname==="/auth/login")&&error.signupToken) redirect(res,verificationLocation(input.next,{error:message,purpose:error.verification?.purpose||input.purpose}),headers);
    else if (url.pathname==="/auth/verify-email"&&error.code==="ACCOUNT_EXISTS") redirect(res,accountErrorLocation("login",message,input.next),headers);
    else if (url.pathname==="/auth/verify-email"||url.pathname==="/auth/resend-verification") redirect(res,verificationLocation(input.next,{error:message,purpose:error.verification?.purpose||input.purpose}),headers);
    else redirect(res,accountErrorLocation(url.pathname==="/auth/signup"?"signup":"login",message,input.next),headers);
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
    const validation=validateCompletedTransaction(data,purchase?{
      ...PAYMENT_CONFIG,
      priceId:purchase.price_id,
      productId:purchase.product_id
    }:PAYMENT_CONFIG);
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
  } else if (PADDLE_STATUS_EVENTS.has(eventType)) {
    const transactionId=cleanText(data.id,100);
    const transactionStatus=cleanText(data.status,40);
    if (transactionStatus!=="completed"&&PADDLE_TRANSACTION_STATUSES.has(transactionStatus)&&await store.purchaseByTransaction(transactionId)) {
      await store.updatePurchaseStatus(transactionId,transactionStatus,occurredAt);
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

function numericAdminRow(row) {
  const output={...row};
  for (const key of ["created_at","email_verified_at","suspended_at","active_session_count","active_purchase_count","pending_purchase_count","purchase_count","rating_count","latest_purchase_at","deletion_expires_at","updated_at","last_response_at","bound_at"]) {
    if (output[key]!=null) output[key]=Number(output[key]);
  }
  return output;
}

function adminUserPayload(row,{detail=false}={}) {
  if (!row) return null;
  const output=numericAdminRow(row);
  const result={
    id:output.id,
    name:output.name,
    email:output.email,
    createdAt:output.created_at,
    verifiedAt:output.email_verified_at??null,
    suspendedAt:output.suspended_at??null,
    activeSessions:Number(output.active_session_count||0),
    discovery:{
      active:Number(output.active_purchase_count||0)>0,
      activePurchaseCount:Number(output.active_purchase_count||0),
      pendingPurchaseCount:Number(output.pending_purchase_count||0),
      purchaseCount:Number(output.purchase_count||0),
      latestPurchaseAt:output.latest_purchase_at??null,
      transactionId:output.transaction_id||null,
      transactionStatus:output.transaction_status||null
    },
    accountDeletion:{pending:Boolean(output.deletion_expires_at),expiresAt:output.deletion_expires_at??null}
  };
  if (detail) {
    let plan=defaultPlan();
    try { if (output.plan_json) plan=sanitizePlan(JSON.parse(output.plan_json),{repair:true}); } catch { /* Show safe zero/default plan stats. */ }
    Object.assign(result,planStats(plan),{ratingCount:Number(output.rating_count||0)});
  }
  return result;
}

function adminOverviewPayload(row) {
  const value=(key)=>Number(row?.[key]||0);
  return {
    accounts:{total:value("total_users"),verified:value("verified_users"),suspended:value("suspended_users"),activeSessions:value("active_sessions")},
    discovery:{activeUsers:value("discovery_users"),pendingPayments:value("pending_payments")},
    support:{open:value("open_support"),pendingDeletions:value("pending_deletions")},
    services:{storage:store.kind,persistent:store.kind==="turso"||process.env.NODE_ENV!=="production",email:EMAIL_CONFIG.enabled,checkout:PAYMENT_CONFIG.enabled,webhookProtection:ENFORCE_PADDLE_IPS}
  };
}

function supportTicketPayload(row) {
  return {
    id:row.id,
    reference:row.reference,
    userId:row.user_id||null,
    name:row.name,
    email:row.email,
    category:row.category,
    subject:row.subject,
    customerReference:row.reference_id||"",
    message:row.message,
    status:row.status,
    note:row.admin_note||"",
    lastResponseAt:row.last_response_at==null?null:Number(row.last_response_at),
    createdAt:Number(row.created_at),
    updatedAt:Number(row.updated_at)
  };
}

const SUPPORT_CATEGORIES=new Set(["account","password","payment","privacy","exercise","other"]);
const SUPPORT_STATUSES=new Set(["new","open","waiting","resolved"]);

function cleanSupportLine(value,max) {
  return cleanText(value,max).replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]+/g," ").replace(/\s+/g," ").trim();
}

function cleanSupportMessage(value,max) {
  return cleanText(value,max).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"");
}

function luhnValid(value) {
  const digits=String(value||"").replace(/[^0-9]/g,"");
  if (digits.length<13||digits.length>19||/^0+$/.test(digits)) return false;
  let sum=0,double=false;
  for (let index=digits.length-1;index>=0;index-=1) {
    let digit=Number(digits[index]);
    if (double) { digit*=2; if (digit>9) digit-=9; }
    sum+=digit; double=!double;
  }
  return sum%10===0;
}

function sensitiveSupportText(...values) {
  const text=values.join("\n");
  if (sensitiveAdminText(text)) return true;
  return (text.match(/\b(?:\d[ -]?){12,18}\d\b/g)||[]).some(luhnValid);
}

function validateSupportRequest(input,session) {
  const name=cleanSupportLine(session?.name||input?.name,80);
  const email=session?.email||normalizeEmail(input?.email);
  const category=cleanSupportLine(input?.category,30).toLowerCase();
  const subject=cleanSupportLine(input?.subject,100);
  const referenceId=cleanSupportLine(input?.referenceId,80);
  const message=cleanSupportMessage(input?.message,2000);
  const website=cleanText(input?.website,200);
  if (website) return {honeypot:true};
  if (name.length<2||!validEmail(email)||!SUPPORT_CATEGORIES.has(category)||subject.length<3||message.length<10) {
    throw Object.assign(new Error("Add a valid name, email, category, subject, and message."),{status:400,code:"INVALID_SUPPORT_REQUEST"});
  }
  if (sensitiveSupportText(subject,referenceId,message)) {
    throw Object.assign(new Error("Remove passwords, verification codes, private links, API keys, tokens, and payment-card numbers before sending."),{status:400,code:"SENSITIVE_SUPPORT_CONTENT"});
  }
  return {name,email,category,subject,referenceId,message};
}

function newSupportReference(now=Date.now()) {
  return `STR-${new Date(now).getUTCFullYear()}-${randomBytes(4).toString("hex").slice(0,6).toUpperCase()}`;
}

async function createSupportRequest(req,input) {
  const session=await sessionFor(req);
  const clean=validateSupportRequest(input,session);
  if (clean.honeypot) return {reference:newSupportReference(),accepted:true};
  let emailKey;
  try { emailKey=verificationEmailHash(EMAIL_CONFIG,clean.email); }
  catch { emailKey=hashToken(clean.email); }
  const now=Date.now();
  const reserved=await store.claimSupportRequestEvent({
    id:randomUUID(),
    ipHash:hashToken(`support-ip:${requestAddress(req)}`),
    emailHash:emailKey,
    createdAt:now
  },{
    since:now-SUPPORT_REQUEST_WINDOW_MS,
    ipLimit:SUPPORT_REQUESTS_PER_IP,
    emailLimit:SUPPORT_REQUESTS_PER_EMAIL,
    globalLimit:SUPPORT_REQUESTS_GLOBAL
  });
  if (!reserved) throw Object.assign(new Error("Too many support requests were sent. Please wait and try again."),{status:429,code:"SUPPORT_RATE_LIMIT"});
  let ticket;
  for (let attempt=0;attempt<3&&!ticket;attempt+=1) {
    try {
      ticket=await store.insertSupportTicket({id:randomUUID(),reference:newSupportReference(now),userId:session?.id||null,...clean,createdAt:now,updatedAt:now});
    } catch(error) {
      if (!isUniqueViolation(error)||attempt===2) throw error;
    }
  }
  if (!ticket) throw new Error("Support request could not be stored.");
  const deliveries=await Promise.allSettled([
    sendSupportAcknowledgment(EMAIL_CONFIG,ticket),
    sendSupportNotification(EMAIL_CONFIG,ticket)
  ]);
  for (const delivery of deliveries) if (delivery.status==="rejected") console.error(`Support email delivery failed: ${delivery.reason?.code||"provider-error"}`);
  return {reference:ticket.reference,accepted:true,emailSent:deliveries[0]?.status==="fulfilled"};
}

function validAdminConfirmation(action,value,target) {
  const expected={
    "send-password-reset":"SEND RESET",
    "send-delete-link":target?.email||"",
    "cancel-deletion":"CANCEL",
    "revoke-sessions":"REVOKE",
    suspend:"SUSPEND",
    restore:"RESTORE"
  }[action];
  return Boolean(expected&&String(value||"").trim()===expected);
}

async function performAdminUserAction(session,targetId,input) {
  const target=await store.adminUserById(targetId,Date.now());
  if (!target) throw Object.assign(new Error("Account not found."),{status:404,code:"ADMIN_TARGET_NOT_FOUND"});
  const principal=await store.adminPrincipal();
  if (principal?.user_id===target.id) throw Object.assign(new Error("Use Account Security for the primary administrator account."),{status:409,code:"ADMIN_SELF_PROTECTED"});
  const action=cleanText(input?.action,40);
  if (!["send-password-reset","send-delete-link","cancel-deletion","revoke-sessions","suspend","restore"].includes(action)) throw Object.assign(new Error("Unknown admin action."),{status:400,code:"UNKNOWN_ADMIN_ACTION"});
  const reason=adminReason(input?.reason);
  if (!validAdminConfirmation(action,input?.confirmation,target)) throw Object.assign(new Error("The confirmation text does not match this action."),{status:400,code:"ADMIN_CONFIRMATION_REQUIRED"});

  let message="Action completed.";
  if (action==="send-password-reset") {
    await recordAdminAudit(session.id,target.id,action,reason,"requested");
    const delivery=await requestSignedInAccountAction(target,"password_reset");
    return {ok:true,message:`Password-reset email sent to ${delivery.maskedEmail}.`,user:adminUserPayload(await store.adminUserById(target.id,Date.now()),{detail:true})};
  }
  if (action==="send-delete-link") {
    await recordAdminAudit(session.id,target.id,action,reason,"requested");
    const delivery=await requestSignedInAccountAction(target,"account_delete");
    return {ok:true,message:`Deletion-confirmation email sent to ${delivery.maskedEmail}.`,user:adminUserPayload(await store.adminUserById(target.id,Date.now()),{detail:true})};
  }
  if (action==="cancel-deletion") {
    const canceled=await store.cancelAccountDeletionWithAudit(target.id,adminAuditEvent(session.id,target.id,action,reason));
    if (!canceled) throw Object.assign(new Error("This account has no pending deletion request."),{status:409,code:"NO_PENDING_DELETION"});
    message="Pending account deletion canceled.";
  } else if (action==="revoke-sessions") {
    const result=await store.revokeUserSessions(target.id,adminAuditEvent(session.id,target.id,action,reason));
    if (!result) throw Object.assign(new Error("Account not found."),{status:404,code:"ADMIN_TARGET_NOT_FOUND"});
    message=`Signed the account out on ${result.revoked} active ${result.revoked===1?"session":"sessions"}.`;
  } else if (action==="suspend") {
    if (target.suspended_at) throw Object.assign(new Error("This account is already paused."),{status:409,code:"ACCOUNT_ALREADY_SUSPENDED"});
    if (!await store.suspendUser(target.id,Date.now(),adminAuditEvent(session.id,target.id,action,reason))) throw Object.assign(new Error("The account state changed. Refresh and try again."),{status:409,code:"ADMIN_STATE_CHANGED"});
    message="Account paused and all sessions revoked.";
  } else if (action==="restore") {
    if (!target.suspended_at) throw Object.assign(new Error("This account is already active."),{status:409,code:"ACCOUNT_ALREADY_ACTIVE"});
    if (!await store.restoreUser(target.id,adminAuditEvent(session.id,target.id,action,reason))) throw Object.assign(new Error("The account state changed. Refresh and try again."),{status:409,code:"ADMIN_STATE_CHANGED"});
    message="Account restored. The user can sign in again.";
  }
  return {ok:true,message,user:adminUserPayload(await store.adminUserById(target.id,Date.now()),{detail:true})};
}

function sendVerificationApiError(res,error) {
  const headers={};
  if (error.signupToken) headers["Set-Cookie"]=signupCookie(error.signupToken);
  if (error.clearSignup) headers["Set-Cookie"]=signupCookie("",0);
  if (error.retryAfter) headers["Retry-After"]=String(error.retryAfter);
  json(res,error.status||500,{
    error:error.status?error.message:"Unable to complete the verification request.",
    code:error.code||"VERIFICATION_FAILED",
    verificationRequired:Boolean(error.verification),
    ...(error.verification||{}),
    ...(Number.isFinite(error.attemptsRemaining)?{attemptsRemaining:error.attemptsRemaining}:{}),
    ...(Number.isFinite(error.retryAfter)?{retryAfter:error.retryAfter}:{})
  },headers);
}

async function handleApi(req,res,url) {
  if (url.pathname==="/api/paddle/webhook") { await handlePaddleWebhook(req,res); return; }
  if (["POST","PUT","PATCH","DELETE"].includes(req.method) && !sameOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
  if (url.pathname==="/api/support"&&req.method==="POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Support security check failed. Refresh and try again.",code:"SUPPORT_ORIGIN_REQUIRED"}); return; }
    if (!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json")) { json(res,415,{error:"Support requests must use JSON.",code:"JSON_REQUIRED"}); return; }
    try { json(res,201,{ok:true,...await createSupportRequest(req,await bodyJson(req))}); }
    catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"SUPPORT_REQUEST_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/signup" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"auth")) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    try {
      const result=await beginAccountRegistration(await bodyJson(req));
      if (result.verification) {
        json(res,202,result.verification,{"Set-Cookie":signupCookie(result.signupToken)});
      } else {
        json(res,201,{user:await userPayload(result.user)},{"Set-Cookie":sessionCookie(result.session.token)});
      }
    } catch(error) {
      if (!error.status) throw error;
      sendVerificationApiError(res,error);
    }
    return;
  }
  if (url.pathname === "/api/login" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"auth")) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    try {
      const result=await authenticateAccount(await bodyJson(req));
      if (result.verification) {
        json(res,202,result.verification,{"Set-Cookie":signupCookie(result.signupToken)});
      } else {
        json(res,200,{user:await userPayload(result.user)},{"Set-Cookie":sessionCookie(result.session.token)});
      }
    } catch(error) {
      if (!error.status) throw error;
      if (error.signupToken||error.verification||/^(?:EMAIL_|VERIFICATION_)/.test(String(error.code||""))) sendVerificationApiError(res,error);
      else json(res,error.status,{error:error.message,code:error.code||"AUTHENTICATION_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/verification-status" && req.method === "GET") {
    const row=await verificationForRequest(req),now=Date.now();
    if (!usableVerification(row,now)) { json(res,200,{active:false,...(row?{purpose:row.purpose==="login"?"login":"signup"}:{})}); return; }
    json(res,200,{active:true,...verificationPublic(row,now)}); return;
  }
  if (url.pathname === "/api/verify-email" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"verify-email",12)) { json(res,429,{error:"Too many attempts. Try again later.",code:"VERIFICATION_RATE_LIMIT"}); return; }
    try {
      const result=await verifyAccountEmail(req,await bodyJson(req));
      json(res,result.purpose==="login"?200:201,{user:await userPayload(result.user)},{"Set-Cookie":[sessionCookie(result.session.token),signupCookie("",0)]});
    } catch(error) {
      if (!error.status) throw error;
      sendVerificationApiError(res,error);
    }
    return;
  }
  if (url.pathname === "/api/resend-verification" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"resend-verification",6)) { json(res,429,{error:"Too many attempts. Try again later.",code:"VERIFICATION_RATE_LIMIT"}); return; }
    try { json(res,202,await resendAccountVerification(req)); }
    catch(error) {
      if (!error.status) throw error;
      sendVerificationApiError(res,error);
    }
    return;
  }
  if (url.pathname === "/api/password-reset/request" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"password-reset-request",8)) {
      json(res,202,{ok:true,message:PASSWORD_RESET_RESPONSE}); return;
    }
    try { json(res,202,await requestForgotPassword(await bodyJson(req))); }
    catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"PASSWORD_RESET_REQUEST_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/account/password-reset/request" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    if (!rateAllowed(req,`password-reset-account:${session.id}`,5)) { json(res,429,{error:"Too many account emails were requested. Please wait and try again.",code:"ACCOUNT_EMAIL_LIMIT"}); return; }
    try { json(res,202,{ok:true,...await requestSignedInAccountAction(session,"password_reset")}); }
    catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"PASSWORD_RESET_REQUEST_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/password-reset/status" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"password-reset-status",30)) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    json(res,200,await inspectAccountAction(await bodyJson(req),"password_reset")); return;
  }
  if (url.pathname === "/api/password-reset/complete" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"password-reset-complete",10)) { json(res,429,{error:"Too many attempts. Try again later.",code:"PASSWORD_RESET_RATE_LIMIT"}); return; }
    try {
      await resetPassword(await bodyJson(req));
      json(res,200,{ok:true,message:"Password reset complete. Sign in with your new password."},{"Set-Cookie":sessionCookie("",0)});
    } catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"PASSWORD_RESET_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/account/delete/request" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    if (!rateAllowed(req,`account-delete-request:${session.id}`,5)) { json(res,429,{error:"Too many account emails were requested. Please wait and try again.",code:"ACCOUNT_EMAIL_LIMIT"}); return; }
    try { json(res,202,{ok:true,...await requestSignedInAccountAction(session,"account_delete")}); }
    catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"ACCOUNT_DELETE_REQUEST_FAILED"});
    }
    return;
  }
  if (url.pathname === "/api/account/delete/cancel" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    await store.cancelAccountDeletion(session.id);
    json(res,200,{ok:true}); return;
  }
  if (url.pathname === "/api/account/delete/status" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"account-delete-status",30)) { json(res,429,{error:"Too many attempts. Try again later."}); return; }
    json(res,200,await inspectAccountAction(await bodyJson(req),"account_delete")); return;
  }
  if (url.pathname === "/api/account/delete/complete" && req.method === "POST") {
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Cross-origin request rejected."}); return; }
    if (!rateAllowed(req,"account-delete-complete",10)) { json(res,429,{error:"Too many attempts. Try again later.",code:"ACCOUNT_DELETE_RATE_LIMIT"}); return; }
    try {
      await deleteAccountWithToken(await bodyJson(req));
      json(res,200,{ok:true,message:"Your STRATA account was permanently deleted."},{"Set-Cookie":[sessionCookie("",0),signupCookie("",0)]});
    } catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"ACCOUNT_DELETE_FAILED"});
    }
    return;
  }
  if (url.pathname==="/api/admin/session"&&req.method==="GET") {
    const session=await requireAdmin(req,res,{elevated:false,allowBootstrap:true});
    if (!session) return;
    const elevation=await store.adminElevation(session.token_hash,Date.now());
    json(res,200,{admin:true,elevated:Boolean(elevation),elevatedUntil:elevation?Number(elevation.expires_at):null}); return;
  }
  if (url.pathname==="/api/admin/elevate"&&req.method==="POST") {
    const session=await requireAdmin(req,res,{elevated:false,allowBootstrap:true});
    if (!session) return;
    if (!requireAdminMutation(req,res,session)) return;
    if (!rateAllowed(req,`admin-elevate:${session.id}`,8,15*60*1000)) { json(res,429,{error:"Too many admin confirmation attempts. Wait and try again.",code:"ADMIN_RATE_LIMIT"}); return; }
    const input=await bodyJson(req),password=String(input?.password||"");
    const user=await store.accountCredentialsById(session.id);
    if (!user||password.length<1||password.length>128||!await passwordMatches(password,user)) { json(res,401,{error:"Password is incorrect.",code:"ADMIN_PASSWORD_INCORRECT"}); return; }
    const now=Date.now(),elevatedUntil=now+ADMIN_ELEVATION_MS;
    const nextSession=prepareSession(session.id,now,session.auth_version);
    const rotated=await store.rotateAdminSessionForElevation(
      session.token_hash,
      nextSession.record,
      elevatedUntil,
      adminAuditEvent(session.id,session.id,"admin-elevated","Owner password confirmed"),
      now
    );
    if (!rotated) { json(res,409,{error:"Your session changed. Sign in and try again.",code:"ADMIN_SESSION_CHANGED"}); return; }
    json(res,200,{ok:true,elevatedUntil,csrfToken:nextSession.csrfToken},{"Set-Cookie":sessionCookie(nextSession.token)}); return;
  }
  if (url.pathname==="/api/admin/overview"&&req.method==="GET") {
    const session=await requireAdmin(req,res); if (!session) return;
    json(res,200,{overview:adminOverviewPayload(await store.adminOverview(Date.now()))}); return;
  }
  if (url.pathname==="/api/admin/users"&&req.method==="GET") {
    const session=await requireAdmin(req,res); if (!session) return;
    const query=cleanText(url.searchParams.get("q"),100);
    const limit=Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get("limit"))||20)));
    const offset=Math.max(0,Math.min(10000,Math.floor(Number(url.searchParams.get("offset"))||0)));
    const result=await store.adminUsers(query,limit,offset,Date.now());
    json(res,200,{users:result.users.map((user)=>adminUserPayload(user)),total:result.total,limit,offset}); return;
  }
  const adminUserDetailMatch=url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
  if (adminUserDetailMatch&&req.method==="GET") {
    const session=await requireAdmin(req,res); if (!session) return;
    const targetId=cleanAdminTarget(adminUserDetailMatch[1]);
    const user=targetId?await store.adminUserById(targetId,Date.now()):null;
    if (!user) { json(res,404,{error:"Account not found.",code:"ADMIN_TARGET_NOT_FOUND"}); return; }
    json(res,200,{user:adminUserPayload(user,{detail:true})}); return;
  }
  const adminUserActionMatch=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/actions$/);
  if (adminUserActionMatch&&req.method==="POST") {
    const session=await requireAdmin(req,res); if (!session) return;
    if (!requireAdminMutation(req,res,session)) return;
    if (!rateAllowed(req,`admin-user-action:${session.id}`,30,15*60*1000)) { json(res,429,{error:"Too many admin actions. Wait and try again.",code:"ADMIN_RATE_LIMIT"}); return; }
    const targetId=cleanAdminTarget(adminUserActionMatch[1]);
    if (!targetId) { json(res,404,{error:"Account not found.",code:"ADMIN_TARGET_NOT_FOUND"}); return; }
    try { json(res,200,await performAdminUserAction(session,targetId,await bodyJson(req))); }
    catch(error) {
      if (!error.status) throw error;
      json(res,error.status,{error:error.message,code:error.code||"ADMIN_ACTION_FAILED"});
    }
    return;
  }
  if (url.pathname==="/api/admin/audit"&&req.method==="GET") {
    const session=await requireAdmin(req,res); if (!session) return;
    const limit=Math.max(1,Math.min(100,Math.floor(Number(url.searchParams.get("limit"))||40)));
    const events=(await store.adminAudit(limit)).map((event)=>({id:event.id,action:event.action,reason:event.reason,result:event.result,createdAt:Number(event.created_at),actor:{id:event.actor_id,name:event.actor_name,email:event.actor_email},target:event.target_id||event.target_user_id?{id:event.target_id||event.target_user_id,name:event.target_name||null,email:event.target_email||null}:null}));
    json(res,200,{events,limit}); return;
  }
  if (url.pathname==="/api/admin/support"&&req.method==="GET") {
    const session=await requireAdmin(req,res); if (!session) return;
    const requestedStatus=cleanText(url.searchParams.get("status"),20);
    const status=SUPPORT_STATUSES.has(requestedStatus)?requestedStatus:"";
    const limit=Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get("limit"))||20)));
    const offset=Math.max(0,Math.min(10000,Math.floor(Number(url.searchParams.get("offset"))||0)));
    const result=await store.adminSupportTickets(status,limit,offset);
    json(res,200,{tickets:result.tickets.map(supportTicketPayload),total:result.total,limit,offset,status}); return;
  }
  const adminSupportMatch=url.pathname.match(/^\/api\/admin\/support\/([^/]+)$/);
  if (adminSupportMatch&&req.method==="POST") {
    const session=await requireAdmin(req,res); if (!session) return;
    if (!requireAdminMutation(req,res,session)) return;
    if (!rateAllowed(req,`admin-support:${session.id}`,30,15*60*1000)) { json(res,429,{error:"Too many support updates. Wait and try again.",code:"ADMIN_RATE_LIMIT"}); return; }
    const ticketId=cleanAdminTarget(adminSupportMatch[1]);
    const ticket=ticketId?await store.supportTicketById(ticketId):null;
    if (!ticket) { json(res,404,{error:"Support request not found.",code:"SUPPORT_NOT_FOUND"}); return; }
    const input=await bodyJson(req);
    const status=SUPPORT_STATUSES.has(cleanText(input?.status,20))?cleanText(input.status,20):ticket.status;
    const note=cleanSupportMessage(input?.note,1000);
    const response=cleanSupportMessage(input?.response,2000);
    const expectedUpdatedAt=Number(input?.expectedUpdatedAt);
    if (sensitiveAdminText(note)||sensitiveAdminText(response)) { json(res,400,{error:"Do not put passwords, codes, API keys, tokens, or private action links in support notes or responses.",code:"SENSITIVE_SUPPORT_CONTENT"}); return; }
    if (!Number.isSafeInteger(expectedUpdatedAt)||expectedUpdatedAt<=0) { json(res,400,{error:"Refresh the help request before updating it.",code:"SUPPORT_VERSION_REQUIRED"}); return; }
    if (expectedUpdatedAt!==Number(ticket.updated_at)) { json(res,409,{error:"The support request changed in another tab. Refresh and try again.",code:"SUPPORT_STATE_CHANGED"}); return; }
    if (!note&&!response&&status===ticket.status) { json(res,400,{error:"Change the status, add a private note, or write a response.",code:"EMPTY_SUPPORT_UPDATE"}); return; }
    const updatedAt=Math.max(Date.now(),expectedUpdatedAt+1);
    let updated=await store.updateSupportTicket(ticket.id,{
      status,note,responseSent:false,updatedAt,expectedUpdatedAt
    },adminAuditEvent(session.id,ticket.user_id||null,"support-updated",note||`Support request ${status}`,response?"response-pending":"success"));
    if (!updated) { json(res,409,{error:"The support request changed. Refresh and try again.",code:"SUPPORT_STATE_CHANGED"}); return; }
    if (response.length>0) {
      try {
        await sendSupportResponse(EMAIL_CONFIG,updated,response);
      } catch {
        json(res,502,{error:"The help-request workflow was saved, but the email response was not sent. Open the request and try the response again.",code:"SUPPORT_RESPONSE_DELIVERY_FAILED",ticket:supportTicketPayload(updated)});
        return;
      }
      updated=await store.markSupportResponseSent(ticket.id,Date.now())||updated;
      await recordAdminAudit(session.id,ticket.user_id||null,"support-response-sent","Response delivered through the configured support email");
    }
    json(res,200,{ok:true,ticket:supportTicketPayload(updated),message:response?"Response sent and support request updated.":"Support request updated."}); return;
  }
  if (url.pathname === "/api/status" && req.method === "GET") {
    json(res,200,{ok:true,build:BUILD_NUMBER,storage:store.kind,persistent:store.kind==="turso"||process.env.NODE_ENV!=="production",paymentsConfigured:PAYMENT_CONFIG.configured,checkoutEnabled:PAYMENT_CONFIG.enabled,webhookIpAllowlist:ENFORCE_PADDLE_IPS,emailVerificationEnabled:EMAIL_CONFIG.enabled,emailVerificationConfigured:EMAIL_CONFIG.configured,passwordResetEnabled:EMAIL_CONFIG.enabled,accountDeletionEnabled:EMAIL_CONFIG.enabled,adminConfigured:Boolean(ADMIN_EMAIL)}); return;
  }
  if (url.pathname === "/api/billing/config" && req.method === "GET") {
    json(res,200,publicPaymentConfig(PAYMENT_CONFIG)); return;
  }
  if (url.pathname === "/api/me" && req.method === "GET") {
    const session=await sessionFor(req);
    if (!session) { json(res,401,{error:"Not signed in."}); return; }
    json(res,200,{user:await userPayload(session),csrfToken:session.csrf_token}); return;
  }
  if (url.pathname === "/api/discovery/trial" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    if (await store.hasPaidDiscoveryAccess(session.id)) {
      json(res,409,{error:"Strata+ is already permanently unlocked for this account.",code:"DISCOVERY_ALREADY_ACTIVE"}); return;
    }
    const now=Date.now();
    if (await store.activeAccountDeletion(session.id,now)) {
      json(res,409,{error:"Cancel the pending account-deletion request before starting a trial.",code:"ACCOUNT_DELETION_PENDING"}); return;
    }
    if (!rateAllowed(req,`discovery-trial:${session.id}`,5)) { json(res,429,{error:"Too many trial attempts. Try again later."}); return; }
    const created=await store.startDiscoveryTrial(session.id,now,now+DISCOVERY_TRIAL_MS);
    const trial=created||await store.discoveryTrial(session.id);
    if (!trial) { json(res,409,{error:"The trial could not be started for this account.",code:"TRIAL_UNAVAILABLE"}); return; }
    if (!created&&Number(trial.expires_at)<=now) {
      json(res,409,{error:"This account has already used its one-time Strata+ trial.",code:"TRIAL_ALREADY_USED"}); return;
    }
    json(res,created?201:200,{ok:true,user:await userPayload(session)}); return;
  }
  if (url.pathname === "/api/billing/checkout" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    await bodyJson(req);
    if (!PAYMENT_CONFIG.enabled) { json(res,503,{error:"Checkout is not available yet.",code:"CHECKOUT_UNAVAILABLE"}); return; }
    if (await store.activeAccountDeletion(session.id,Date.now())) { json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"}); return; }
    if (!rateAllowed(req,`checkout:${session.id}`,8)) { json(res,429,{error:"Too many checkout attempts. Try again later."}); return; }
    if (await store.hasPaidDiscoveryAccess(session.id)) {
      json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"}); return;
    }

    const interrupted=await store.checkoutCreationForUser(session.id);
    if (interrupted) {
      const recovery=await recoverCheckoutCreation(interrupted);
      if (recovery.state==="transaction") {
        json(res,200,{transactionId:recovery.transactionId,reused:true,recovered:true}); return;
      }
      if (recovery.state==="entitled") {
        json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"}); return;
      }
      if (recovery.state==="deletion") {
        json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"}); return;
      }
      if (recovery.state==="pending"||recovery.state==="blocked") {
        json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"}); return;
      }
      if (recovery.state==="waiting") {
        json(res,409,{error:"Another checkout is already being prepared. Please try again in a moment.",code:"CHECKOUT_PREPARING"}); return;
      }
    }

    const claimedAt=Date.now(), claimId=randomUUID();
    const claim=await store.claimCheckoutCreation({
      userId:session.id,
      priceId:PAYMENT_CONFIG.priceId,
      claimId,
      expiresAt:claimedAt+CHECKOUT_CREATION_CLAIM_MS,
      now:claimedAt
    });
    if (!claim) {
      const pending=await store.pendingPurchaseForUser(session.id,PAYMENT_CONFIG.priceId);
      if (pending) { json(res,200,{transactionId:pending.transaction_id,reused:true}); return; }
      json(res,409,{error:"Another checkout is already being prepared. Please try again in a moment.",code:"CHECKOUT_PREPARING"}); return;
    }
    let preserveClaim=false,releaseTransactionId=null;
    try {
      if (await store.activeAccountDeletion(session.id,Date.now())) {
        json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"}); return;
      }
      if (await store.hasPaidDiscoveryAccess(session.id)) {
        json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"}); return;
      }
      let pending=await store.pendingPurchaseForUser(session.id,PAYMENT_CONFIG.priceId);
      if (pending&&Number(pending.updated_at)>Date.now()-ABANDONED_CHECKOUT_MS) {
        json(res,200,{transactionId:pending.transaction_id,reused:true}); return;
      }
      if (await store.pendingPurchasesForUser(session.id)>0) {
        await reconcileUnsettledPurchases(session.id);
        if (await store.hasPaidDiscoveryAccess(session.id)) {
          json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"}); return;
        }
        pending=await store.pendingPurchaseForUser(session.id,PAYMENT_CONFIG.priceId);
        if (pending) { json(res,200,{transactionId:pending.transaction_id,reused:true}); return; }
        if (await store.pendingPurchasesForUser(session.id)>0) {
          json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"}); return;
        }
      }

      // From this point forward, any failure may have happened after Paddle
      // accepted the create request. Keep the durable claim so a retry can
      // find the transaction by its stable checkout reference before creating
      // another payable transaction.
      preserveClaim=true;
      const created=await createPaddleTransaction(PAYMENT_CONFIG,{userId:session.id,checkoutId:claimId});
      releaseTransactionId=created.transactionId;
      const now=Date.now();
      const recorded=await store.recordCheckoutCreationTransaction(session.id,claimId,created.transactionId,now);
      if (!recorded) {
        const recoveredPurchase=await store.purchaseByTransaction(created.transactionId);
        if (recoveredPurchase?.user_id===session.id) {
          preserveClaim=false;
          json(res,201,{transactionId:created.transactionId,recovered:true}); return;
        }
        throw checkoutReconciliationError("STRATA could not safely record the prepared Strata+ checkout. Please try again later.");
      }
      let storedPurchase;
      try {
        storedPurchase=await store.insertPendingPurchase({
          transactionId:created.transactionId,
          userId:session.id,
          priceId:PAYMENT_CONFIG.priceId,
          productId:PAYMENT_CONFIG.productId,
          paddleStatus:created.status,
          createdAt:now,
          updatedAt:now
        });
      } catch(error) {
        if (isUniqueViolation(error)) storedPurchase=await store.purchaseByTransaction(created.transactionId);
        if (storedPurchase?.user_id!==session.id) throw error;
        if (!storedPurchase) throw error;
      }
      if (!storedPurchase) {
        if (await store.activeAccountDeletion(session.id,Date.now())) {
          json(res,409,{error:"Checkout could not be attached because account deletion is pending. Cancel deletion and try again.",code:"ACCOUNT_DELETION_PENDING"}); return;
        }
        json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"}); return;
      }
      if (storedPurchase.user_id!==session.id) {
        throw checkoutReconciliationError("STRATA could not safely attach the prepared Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      }
      preserveClaim=false;
      json(res,201,{transactionId:created.transactionId}); return;
    } finally {
      try {
        if (preserveClaim) {
          await store.extendCheckoutCreation(session.id,claimId,Date.now()+CHECKOUT_CREATION_CLAIM_MS,Date.now());
        } else {
          const released=await releaseCheckoutClaim(claim,releaseTransactionId);
          if (!released) console.error("Could not release a checkout-creation claim because its transaction binding changed; recovery will reconcile the current claim.");
        }
      } catch {
        if (preserveClaim) console.error("Could not extend a checkout-creation claim; recovery will retry from its stored reference.");
        else console.error("Could not release a checkout-creation claim; it will expire automatically.");
      }
    }
  }
  if (url.pathname === "/api/logout" && req.method === "POST") {
    // Logout is intentionally idempotent. Even an expired or newly blocked
    // pre-verification cookie must be removable and must never become usable
    // again after the account is verified.
    const token=cookieMap(req.headers.cookie)[SESSION_COOKIE];
    if (token&&token.length<=200) {
      try { await store.deleteSession(hashToken(token)); }
      catch(error) {
        console.error("Session cleanup during logout failed:",error);
        json(res,503,{error:"Could not sign out safely. Please try again."}); return;
      }
    }
    json(res,200,{ok:true},{"Set-Cookie":sessionCookie("",0)}); return;
  }
  if (url.pathname === "/api/plan" && req.method === "GET") {
    const session=await requireSession(req,res); if (!session) return;
    const [snapshot,user]=await Promise.all([planSnapshotFor(session.id),userPayload(session)]);
    json(res,200,{plan:snapshot.plan,planUpdatedAt:snapshot.updatedAt,user,csrfToken:session.csrf_token}); return;
  }
  if (url.pathname === "/api/plan" && req.method === "PUT") {
    const session=await requireSession(req,res); if (!session) return;
    const input=await bodyJson(req), expectedPlanUpdatedAt=expectedPlanRevision(input.expectedPlanUpdatedAt), plan=sanitizePlan(input.plan);
    const saved=await store.upsertPlan(session.id,JSON.stringify(plan),Date.now(),expectedPlanUpdatedAt);
    if (!saved) {
      const current=await planSnapshotFor(session.id);
      // A retry after a committed response was lost is not a conflict. The
      // canonical plan is already stored, so return its authoritative revision
      // and let the browser resume from it without asking for an overwrite.
      if (JSON.stringify(current.plan)===JSON.stringify(plan)) {
        json(res,200,{ok:true,plan:current.plan,planUpdatedAt:current.updatedAt,stats:planStats(current.plan),reused:true});
        return;
      }
      json(res,409,{
        error:"Your weekly plan changed in another tab or device. Review the latest copy before saving again.",
        code:"PLAN_CHANGED",
        plan:current.plan,
        planUpdatedAt:current.updatedAt,
        stats:planStats(current.plan)
      });
      return;
    }
    json(res,200,{ok:true,plan,planUpdatedAt:Number(saved.updated_at),stats:planStats(plan)}); return;
  }
  if (url.pathname === "/api/community-plans/mine" && req.method === "GET") {
    const session=await requireSession(req,res); if (!session) return;
    const plans=(await store.communityWeeklyPlansForUser(session.id))
      .map((row)=>communityPlanPayload(row,{owner:true}))
      .filter(Boolean);
    json(res,200,{plans,csrfToken:session.csrf_token}); return;
  }
  if (url.pathname === "/api/community-plans" && req.method === "POST") {
    const session=await requireSession(req,res); if (!session) return;
    if (!requireCommunityMutation(req,res,session,{jsonBody:true})) return;
    if (!rateAllowed(req,`community-plan-publish:${session.id}`,15,15*60*1000)) {
      json(res,429,{error:"Too many community-plan updates. Wait a moment and try again.",code:"COMMUNITY_RATE_LIMIT"}); return;
    }
    const input=await bodyJson(req);
    const expectedPlanUpdatedAt=communityRevision(input.expectedPlanUpdatedAt,"Your plan version");
    const currentPlan=await planSnapshotFor(session.id);
    if (currentPlan.updatedAt!==expectedPlanUpdatedAt) {
      json(res,409,{error:"Your weekly plan changed. Refresh it and publish again.",code:"PLAN_CHANGED"}); return;
    }
    const clean=sanitizeCommunityPlanInput(input,currentPlan.plan);
    const now=Date.now();
    const existing=(await store.communityWeeklyPlansForUser(session.id))[0]||null;
    const saved=await store.upsertCommunityWeeklyPlanFromPlan({
      id:existing?.id||randomUUID(),userId:session.id,title:clean.title,description:clean.description,
      isPublished:clean.published,createdAt:existing?Number(existing.created_at):now,updatedAt:now,
      expectedPlanUpdatedAt,storedPlanJson:currentPlan.storedPlanJson
    });
    if (!saved) { json(res,409,{error:"Your weekly plan changed. Refresh it and publish again.",code:"PLAN_CHANGED"}); return; }
    const row=await store.communityWeeklyPlanForOwner(saved.id,session.id);
    const plan=communityPlanPayload(row,{owner:true});
    if (!plan) { json(res,500,{error:"Your plan was saved but could not be read safely.",code:"COMMUNITY_PLAN_INVALID"}); return; }
    json(res,200,{ok:true,plan,planUpdatedAt:currentPlan.updatedAt}); return;
  }
  if (url.pathname === "/api/community-plans" && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const {limit,offset}=communityPagination(url);
    const rows=await store.communityWeeklyPlans(limit+1,offset);
    const hasMore=rows.length>limit;
    const plans=rows.slice(0,limit).map((row)=>communityPlanPayload(row)).filter(Boolean);
    json(res,200,{plans,pagination:{limit,offset,nextOffset:hasMore?offset+limit:null}}); return;
  }
  const communityApplyMatch=url.pathname.match(/^\/api\/community-plans\/([0-9a-f-]{36})\/apply$/i);
  if (communityApplyMatch && req.method === "POST") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    if (!requireCommunityMutation(req,res,session,{jsonBody:true})) return;
    if (!rateAllowed(req,`community-plan-apply:${session.id}`,30,15*60*1000)) {
      json(res,429,{error:"Too many plan changes. Wait a moment and try again.",code:"COMMUNITY_RATE_LIMIT"}); return;
    }
    const input=await bodyJson(req);
    const sourceUpdatedAt=communityRevision(input.sourceUpdatedAt,"Community plan version");
    const targetUpdatedAt=communityRevision(input.targetUpdatedAt,"Your plan version",{allowZero:true});
    const id=communityPlanId(communityApplyMatch[1]);
    const sourceRow=id?await store.communityWeeklyPlan(id):null;
    const source=communityPlanPayload(sourceRow);
    if (!source) { json(res,404,{error:"Community plan not found.",code:"COMMUNITY_PLAN_NOT_FOUND"}); return; }
    if (source.updatedAt!==sourceUpdatedAt) {
      json(res,409,{error:"That community plan changed. Refresh it and confirm again.",code:"COMMUNITY_PLAN_CHANGED"}); return;
    }
    const applied=await store.applyCommunityWeeklyPlan({
      id,userId:session.id,sourceUpdatedAt,targetUpdatedAt,
      planJson:JSON.stringify(source.plan),storedPlanJson:sourceRow.plan_json,updatedAt:Date.now()
    });
    if (!applied) { json(res,409,{error:"A plan changed before it could be applied. Refresh and confirm again.",code:"COMMUNITY_PLAN_CHANGED"}); return; }
    let plan;
    try { plan=sanitizePlan(JSON.parse(applied.plan_json)); }
    catch { json(res,500,{error:"The applied plan could not be read safely.",code:"COMMUNITY_PLAN_INVALID"}); return; }
    json(res,200,{ok:true,plan,planUpdatedAt:Number(applied.updated_at),stats:planStats(plan),source:{id:source.id,title:source.title,authorName:source.authorName}}); return;
  }
  const communityPlanMatch=url.pathname.match(/^\/api\/community-plans\/([0-9a-f-]{36})$/i);
  if (communityPlanMatch && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const id=communityPlanId(communityPlanMatch[1]);
    const plan=communityPlanPayload(id?await store.communityWeeklyPlan(id):null);
    if (!plan) { json(res,404,{error:"Community plan not found.",code:"COMMUNITY_PLAN_NOT_FOUND"}); return; }
    json(res,200,{plan}); return;
  }
  if (communityPlanMatch && req.method === "PATCH") {
    const session=await requireSession(req,res); if (!session) return;
    if (!requireCommunityMutation(req,res,session,{jsonBody:true})) return;
    if (!rateAllowed(req,`community-plan-manage:${session.id}`,30,15*60*1000)) {
      json(res,429,{error:"Too many community-plan updates. Wait a moment and try again.",code:"COMMUNITY_RATE_LIMIT"}); return;
    }
    const id=communityPlanId(communityPlanMatch[1]);
    let owned=id?await store.communityWeeklyPlanForOwner(id,session.id):null;
    if (!owned) {
      const visible=id?await store.communityWeeklyPlan(id):null;
      json(res,visible?403:404,{error:visible?"Only the plan owner can change this upload.":"Community plan not found.",code:visible?"COMMUNITY_PLAN_FORBIDDEN":"COMMUNITY_PLAN_NOT_FOUND"}); return;
    }
    const input=await bodyJson(req);
    if (typeof input.published!=="boolean") { json(res,400,{error:"Published setting is invalid.",code:"INVALID_COMMUNITY_PLAN"}); return; }
    await store.setCommunityWeeklyPlanPublished(id,session.id,input.published,Date.now());
    owned=await store.communityWeeklyPlanForOwner(id,session.id);
    if (!owned) { json(res,409,{error:"The community plan changed. Refresh and try again.",code:"COMMUNITY_PLAN_CHANGED"}); return; }
    json(res,200,{ok:true,plan:communityPlanPayload(owned,{owner:true})}); return;
  }
  if (communityPlanMatch && req.method === "DELETE") {
    const session=await requireSession(req,res); if (!session) return;
    if (!requireCommunityMutation(req,res,session)) return;
    if (!rateAllowed(req,`community-plan-manage:${session.id}`,30,15*60*1000)) {
      json(res,429,{error:"Too many community-plan updates. Wait a moment and try again.",code:"COMMUNITY_RATE_LIMIT"}); return;
    }
    const id=communityPlanId(communityPlanMatch[1]);
    const owned=id?await store.communityWeeklyPlanForOwner(id,session.id):null;
    if (!owned) {
      const visible=id?await store.communityWeeklyPlan(id):null;
      json(res,visible?403:404,{error:visible?"Only the plan owner can remove this upload.":"Community plan not found.",code:visible?"COMMUNITY_PLAN_FORBIDDEN":"COMMUNITY_PLAN_NOT_FOUND"}); return;
    }
    if (!await store.deleteCommunityWeeklyPlan(id,session.id)) {
      json(res,409,{error:"The community plan changed. Refresh and try again.",code:"COMMUNITY_PLAN_CHANGED"}); return;
    }
    json(res,200,{ok:true}); return;
  }
  if (url.pathname === "/api/monthly-plan" && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const [monthlyPlan,weeklyPlan]=await Promise.all([monthlyPlanFor(session.id),planFor(session.id)]);
    json(res,200,{monthlyPlan,weeklyPlan,csrfToken:session.csrf_token}); return;
  }
  if (url.pathname === "/api/monthly-plan" && req.method === "PUT") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
    const input=await bodyJson(req), now=Date.now(), monthlyPlan=sanitizeMonthlyPlan(input.monthlyPlan,{generatedAt:now});
    await store.upsertMonthlyPlan(session.id,JSON.stringify(monthlyPlan),now);
    json(res,200,{ok:true,monthlyPlan}); return;
  }
  if (url.pathname === "/api/discovery" && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const [preferences,aggregates,userRatings,monthlyPlan,weeklyPlan,user]=await Promise.all([preferencesFor(session.id),store.ratingAggregates(),store.ratingsForUser(session.id),monthlyPlanFor(session.id),planSnapshotFor(session.id),userPayload(session)]);
    json(res,200,{user,csrfToken:session.csrf_token,exercises:EXERCISES,methodology:DISCOVERY_DATA.methodology,sources:DISCOVERY_DATA.sources,limitedConfidenceExercises:DISCOVERY_DATA.limitedConfidenceExercises,preferences,ratings:{aggregates,user:userRatings},monthlyPlan,weeklyPlan:weeklyPlan.plan,weeklyPlanUpdatedAt:weeklyPlan.updatedAt}); return;
  }
  if (url.pathname === "/api/ratings/aggregates" && req.method === "GET") {
    const session=await requireDiscoveryAccess(req,res); if (!session) return;
    const aggregates=await store.ratingAggregates();
    // This deliberately contains community aggregates only. Never include a
    // user row, email address, per-account rating, or session credential here.
    json(res,200,{aggregates,updatedAt:Date.now()}); return;
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
    if (!trustedAuthOrigin(req)) { json(res,403,{error:"Rating security check failed. Refresh and try again.",code:"RATING_ORIGIN_REQUIRED"}); return; }
    if (!validCsrf(req,session)) { json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"}); return; }
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
  const activeSession=(PROTECTED_HTML.has(requested)||requested==="index.html"||requested==="admin.html")?await sessionFor(req):null;
  if (requested==="admin.html") {
    if (!activeSession) {
      res.writeHead(302,{...securityHeaders(),Location:"/account.html?mode=login&next=admin","Cache-Control":"no-store"});
      res.end();
      return;
    }
    const identity=await adminIdentity(activeSession,{allowBootstrap:true});
    if (identity.boundNow) {
      const params=new URLSearchParams({mode:"login",next:"admin",error:"Admin ownership is secured. Sign in again to continue."});
      res.writeHead(302,{...securityHeaders(),Location:`/account.html?${params}`,"Cache-Control":"no-store","Set-Cookie":sessionCookie("",0)});
      res.end();
      return;
    }
    if (!identity.active) {
      const params=new URLSearchParams({mode:"login",next:"admin",error:"Administrator access required."});
      res.writeHead(302,{...securityHeaders(),Location:`/account.html?${params}`,"Cache-Control":"no-store"});
      res.end();
      return;
    }
  }
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
  if (requested==="account.html") body=Buffer.from(renderAccountFallbacks(body.toString("utf8"),url));
  if (requested==="verify-email.html") body=Buffer.from(renderVerificationFallbacks(body.toString("utf8"),url));
  if (requested==="index.html") {
    const user=activeSession?await userPayload(activeSession):null;
    const actions=user
      ? `<a class="account-button discover-button" id="discoverButton" href="${user.discovery.active?"/discover.html":"/pricing"}">${user.discovery.active?"Strata+":"Unlock Strata+"}</a>\n        <a class="account-button account-create" id="signupButton" href="/account.html?mode=signup" hidden>Sign up</a>\n        <a class="account-button account-link signed-in" id="accountButton" href="/account.html">${escapeHtml(user.name.split(/\s+/)[0])} profile</a>\n        <a class="session-button" id="planButton" href="/planner.html">Plan <span id="planCount">${user.planCount}</span></a>`
      : `<a class="account-button discover-button" id="discoverButton" href="/discover.html" hidden>Strata+</a>\n        <a class="account-button account-create" id="signupButton" href="/account.html?mode=signup">Sign up</a>\n        <a class="account-button account-link" id="accountButton" href="/account.html?mode=login">Log in</a>\n        <a class="session-button" id="planButton" href="/planner.html">Plan <span id="planCount">0</span></a>`;
    body=Buffer.from(body.toString("utf8").replace(/<!-- ACCOUNT_ACTIONS_START -->[\s\S]*?<!-- ACCOUNT_ACTIONS_END -->/,`<!-- ACCOUNT_ACTIONS_START -->\n        ${actions}\n        <!-- ACCOUNT_ACTIONS_END -->`));
  }
  const privateHtml=PRIVATE_HTML.has(requested);
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
  if (requested==="admin.html") headers["X-Robots-Tag"]="noindex, nofollow, noarchive";
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
    if (!res.headersSent) {
      const payload={error:error.status?error.message:"Unexpected server error."};
      if (error.status&&/^[A-Z][A-Z0-9_]{2,63}$/.test(String(error.code||""))) payload.code=String(error.code);
      json(res,error.status||500,payload);
    }
    if (!error.status) console.error(error);
  }
});

let cleanup;
async function start() {
  if (process.env.NODE_ENV==="production"&&!EMAIL_CONFIG.flagValid) {
    throw new Error("EMAIL_VERIFICATION_ENABLED must be set explicitly to true or false in production.");
  }
  store = await createStore(PROJECT_ROOT);
  if (ADMIN_EMAIL) {
    const configuredUser=await store.userByEmail(ADMIN_EMAIL);
    if (configuredUser&&Number(configuredUser.email_verified_at)&&!configuredUser.suspended_at) {
      await store.claimAdminPrincipal(configuredUser.id,ADMIN_EMAIL,Date.now());
    }
  }
  await store.deleteExpired(Date.now());
  await store.deleteExpiredAdminElevations(Date.now());
  await store.deleteOldVerificationData(Date.now(),Date.now()-VERIFICATION_RETENTION_MS);
  await store.deleteOldAccountActionData(Date.now(),Date.now()-ACCOUNT_ACTION_RETENTION_MS);
  await store.deleteOldSupportRequestEvents(Date.now()-SUPPORT_REQUEST_RETENTION_MS);
  if (ENFORCE_PADDLE_IPS) void currentPaddleIps().catch((error)=>console.error(error.message));
  cleanup=setInterval(() => {
    void store.deleteExpired(Date.now()).catch(console.error);
    void store.deleteExpiredAdminElevations(Date.now()).catch(console.error);
    void store.deleteOldVerificationData(Date.now(),Date.now()-VERIFICATION_RETENTION_MS).catch(console.error);
    void store.deleteOldAccountActionData(Date.now(),Date.now()-ACCOUNT_ACTION_RETENTION_MS).catch(console.error);
    void store.deleteOldSupportRequestEvents(Date.now()-SUPPORT_REQUEST_RETENTION_MS).catch(console.error);
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
