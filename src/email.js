"use strict";

const { createHmac,randomInt,timingSafeEqual } = require("node:crypto");

const RESEND_API_BASE = "https://api.resend.com";
const secretsByConfig = new WeakMap();

function clean(value,max=500) {
  return String(value ?? "").trim().slice(0,max);
}

function normalizedEmail(value) {
  return clean(value,254).toLowerCase();
}

function mailboxAddress(value) {
  const mailbox=clean(value,320);
  if (!mailbox||/[\r\n]/.test(mailbox)) return "";
  const bracketed=mailbox.match(/^[^<>]{1,100}<([^<>]+)>$/);
  const address=clean(bracketed?bracketed[1]:mailbox,254).toLowerCase();
  return /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(address)?address:"";
}

function validAppBaseUrl(value,nodeEnv) {
  try {
    const url=new URL(clean(value,2048));
    const localHttp=nodeEnv!=="production"&&url.protocol==="http:"&&["localhost","127.0.0.1","::1"].includes(url.hostname);
    if (url.protocol!=="https:"&&!localHttp) return "";
    if (url.username||url.password||url.search||url.hash) return "";
    url.pathname=url.pathname.replace(/\/+$/g,"")||"/";
    return url.href.replace(/\/$/,"");
  } catch {
    return "";
  }
}

function timeoutSignal(milliseconds) {
  return typeof globalThis.AbortSignal?.timeout==="function"?globalThis.AbortSignal.timeout(milliseconds):undefined;
}

function placeholderCredential(value) {
  return /replace[-_ ]?with|replace-with|<[^>]+>|your[-_ ]?(?:private|secret|key)/i.test(String(value||""));
}

function directSignupAllowed(config,nodeEnv=process.env.NODE_ENV) {
  const runtime=clean(nodeEnv,40).toLowerCase();
  return ["","development","test"].includes(runtime)&&config?.requestedEnabled!==true;
}

function getEmailVerificationConfig(env=process.env) {
  const flagValue=clean(env.EMAIL_VERIFICATION_ENABLED,20).toLowerCase();
  const requestedEnabled=flagValue==="true";
  const flagValid=flagValue==="true"||flagValue==="false";
  const apiKey=clean(env.RESEND_API_KEY,1000);
  const from=clean(env.EMAIL_FROM,320);
  const replyTo=clean(env.EMAIL_REPLY_TO,320);
  const verificationSecret=clean(env.EMAIL_VERIFICATION_SECRET,4096);
  const appBaseUrl=validAppBaseUrl(env.APP_BASE_URL,clean(env.NODE_ENV,40));
  const validApiKey=apiKey.startsWith("re_")&&apiKey.length>=20&&!placeholderCredential(apiKey);
  const validFrom=Boolean(mailboxAddress(from));
  const validReplyTo=!replyTo||Boolean(mailboxAddress(replyTo));
  const validSecret=verificationSecret.length>=32&&!placeholderCredential(verificationSecret);
  const validBaseUrl=Boolean(appBaseUrl);
  const credentialsValid=validApiKey&&validFrom&&validReplyTo&&validSecret&&validBaseUrl;
  const missing=[];
  if (requestedEnabled) {
    if (!validApiKey) missing.push("Resend API key");
    if (!validFrom) missing.push("valid sender address");
    if (!validReplyTo) missing.push("valid reply-to address");
    if (!validSecret) missing.push("verification secret of at least 32 characters");
    if (!validBaseUrl) missing.push("valid HTTPS application URL");
  }

  // Only browser-safe operational fields are enumerable. The API key and
  // verification secret are retained privately so accidental JSON encoding
  // cannot disclose either credential.
  const config=Object.freeze({
    requestedEnabled,
    flagValid,
    configured:credentialsValid,
    deliveryConfigured:credentialsValid,
    secretConfigured:validSecret,
    enabled:requestedEnabled&&credentialsValid,
    from:validFrom?from:"",
    replyTo:validReplyTo?replyTo:"",
    appBaseUrl:validBaseUrl?appBaseUrl:"",
    missing:Object.freeze(missing)
  });
  let apiBase=RESEND_API_BASE;
  if (env.NODE_ENV==="test"&&validAppBaseUrl(env.RESEND_API_BASE,"test")) apiBase=validAppBaseUrl(env.RESEND_API_BASE,"test");
  secretsByConfig.set(config,{apiKey,verificationSecret,apiBase});
  return config;
}

function requireVerificationSecret(config) {
  const secret=secretsByConfig.get(config)?.verificationSecret||"";
  if (secret.length<32) throw Object.assign(new Error("Email verification is not configured."),{status:503,code:"EMAIL_VERIFICATION_UNAVAILABLE"});
  return secret;
}

function digestParts(secret,purpose,parts) {
  const hmac=createHmac("sha256",secret);
  hmac.update(`${purpose}\0`);
  for (const part of parts) {
    const value=String(part);
    hmac.update(`${Buffer.byteLength(value,"utf8")}:`);
    hmac.update(value);
    hmac.update("\0");
  }
  return hmac.digest("hex");
}

function verificationCodeDigest(config,{challengeId,generation,email,code}) {
  const normalized=normalizedEmail(email);
  const numericGeneration=Number(generation);
  if (!challengeId||!Number.isSafeInteger(numericGeneration)||numericGeneration<1||!normalized||!/^\d{6}$/.test(String(code||""))) {
    throw new TypeError("Invalid verification digest input.");
  }
  return digestParts(requireVerificationSecret(config),"verification-code-v1",[challengeId,numericGeneration,normalized,String(code)]);
}

function verificationEmailHash(config,email) {
  const normalized=normalizedEmail(email);
  if (!normalized) throw new TypeError("Invalid verification email.");
  return digestParts(requireVerificationSecret(config),"verification-email-v1",[normalized]);
}

function safeDigestEqual(actual,expected) {
  const left=Buffer.from(String(actual||""),"utf8");
  const right=Buffer.from(String(expected||""),"utf8");
  return left.length===right.length&&left.length>0&&timingSafeEqual(left,right);
}

function generateVerificationCode(randomIntImpl=randomInt) {
  const value=randomIntImpl(0,1_000_000);
  if (!Number.isSafeInteger(value)||value<0||value>=1_000_000) throw new Error("Secure verification code generation failed.");
  return String(value).padStart(6,"0");
}

function maskEmail(value) {
  const email=normalizedEmail(value);
  const separator=email.lastIndexOf("@");
  if (separator<1) return "your email address";
  const local=email.slice(0,separator),domain=email.slice(separator+1);
  const masked=local.length===1?"*":local.length===2?`${local[0]}*`:`${local[0]}${"*".repeat(Math.min(6,local.length-2))}${local.at(-1)}`;
  return `${masked}@${domain}`;
}

function escapeHtml(value) {
  return String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
}

async function sendVerificationEmail(config,message,fetchImpl=globalThis.fetch) {
  const secrets=secretsByConfig.get(config);
  if (!config?.enabled||!config.configured||!secrets?.apiKey) {
    throw Object.assign(new Error("Email verification is not available yet."),{status:503,code:"EMAIL_VERIFICATION_UNAVAILABLE"});
  }
  const to=normalizedEmail(message?.to);
  const code=String(message?.code||"");
  const challengeId=clean(message?.challengeId,200);
  const generation=Number(message?.generation);
  const name=clean(message?.name,80)||"there";
  const expiresInMinutes=Math.max(1,Math.min(30,Math.ceil(Number(message?.expiresInMinutes)||10)));
  if (!mailboxAddress(to)||!/^\d{6}$/.test(code)||!challengeId||!Number.isSafeInteger(generation)||generation<1) {
    throw new TypeError("Invalid verification email input.");
  }

  const verificationUrl=`${config.appBaseUrl}/verify-email`;
  const subject="Your STRATA verification code";
  const text=[
    `Hi ${name},`,
    "",
    `Your STRATA verification code is ${code}.`,
    `It expires in ${expiresInMinutes} minutes.`,
    "",
    "Return to the browser where you started signup and enter this code. If you did not request this account, you can ignore this email.",
    verificationUrl
  ].join("\n");
  const html=`<!doctype html><html><body style="margin:0;padding:24px;background:#f4f2ec;color:#10110f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:auto;background:#fff;padding:32px;border:1px solid #bbb"><p>Hi ${escapeHtml(name)},</p><h1 style="font-size:24px">Verify your STRATA email</h1><p>Your six-digit verification code is:</p><p style="font-size:36px;font-weight:700;letter-spacing:8px">${escapeHtml(code)}</p><p>It expires in ${expiresInMinutes} minutes.</p><p>Enter it on the STRATA verification page. If you did not request this account, you can ignore this email.</p><p><a href="${escapeHtml(verificationUrl)}">Open email verification</a></p></main></body></html>`;
  const idempotencyDigest=digestParts(requireVerificationSecret(config),"verification-delivery-v1",[challengeId,generation]);
  const body={from:config.from,to:[to],subject,text,html};
  if (config.replyTo) body.reply_to=config.replyTo;

  let response;
  try {
    response=await fetchImpl(`${secrets.apiBase}/emails`,{
      method:"POST",
      headers:{
        Authorization:`Bearer ${secrets.apiKey}`,
        "Content-Type":"application/json",
        "Idempotency-Key":`strata-${idempotencyDigest}`
      },
      signal:timeoutSignal(10_000),
      body:JSON.stringify(body)
    });
  } catch {
    throw Object.assign(new Error("The verification email could not be sent. Please try again."),{status:502,code:"EMAIL_DELIVERY_UNAVAILABLE"});
  }
  if (!response?.ok) {
    throw Object.assign(new Error("The verification email could not be sent. Please try again."),{status:502,code:"EMAIL_DELIVERY_FAILED"});
  }
  let payload;
  try { payload=await response.json(); } catch { payload=null; }
  return {messageId:clean(payload?.id,200)};
}

module.exports = {
  directSignupAllowed,
  escapeHtml,
  generateVerificationCode,
  getEmailVerificationConfig,
  maskEmail,
  safeDigestEqual,
  sendVerificationEmail,
  verificationCodeDigest,
  verificationEmailHash
};
