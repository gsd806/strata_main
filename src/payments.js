"use strict";

const { createHmac,timingSafeEqual } = require("node:crypto");

const DEFAULT_PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";
const DEFAULT_PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
const LIVE_API_BASE="https://api.paddle.com";
const secretsByConfig=new WeakMap();

function clean(value) { return String(value||"").trim(); }
function validId(value,prefix) { return new RegExp(`^${prefix}_[a-z0-9]{20,}$`).test(value); }
function placeholderCredential(value) { return /replace[-_ ]?with|<[^>]+>|your[-_ ]?(?:private|secret|key)/i.test(String(value||"")); }
function timeoutSignal(milliseconds) { return typeof globalThis.AbortSignal?.timeout==="function"?globalThis.AbortSignal.timeout(milliseconds):undefined; }

function getPaymentConfig(env=process.env) {
  const productId=clean(env.PADDLE_PRODUCT_ID)||DEFAULT_PRODUCT_ID;
  const priceId=clean(env.PADDLE_PRICE_ID)||DEFAULT_PRICE_ID;
  const clientToken=clean(env.PADDLE_CLIENT_TOKEN);
  const apiKey=clean(env.PADDLE_API_KEY);
  const webhookSecret=clean(env.PADDLE_WEBHOOK_SECRET);
  const requestedEnabled=clean(env.PADDLE_CHECKOUT_ENABLED).toLowerCase()==="true";
  const validClientToken=clientToken.startsWith("live_")&&!/sandbox|sdbx/i.test(clientToken)&&!placeholderCredential(clientToken);
  const validApiKey=apiKey.startsWith("pdl_live_apikey_")&&apiKey.length>=40&&!/sandbox|sdbx/i.test(apiKey)&&!placeholderCredential(apiKey);
  const validWebhookSecret=webhookSecret.startsWith("pdl_ntfset_")&&webhookSecret.length>=20&&!placeholderCredential(webhookSecret);
  const validCatalog=validId(productId,"pro")&&validId(priceId,"pri");
  const configured=validClientToken&&validApiKey&&validWebhookSecret&&validCatalog;
  const missing=[];
  if (!validClientToken) missing.push("live client-side token");
  if (!validApiKey) missing.push("live API key");
  if (!validWebhookSecret) missing.push("webhook signing secret");
  if (!validCatalog) missing.push("valid live catalog IDs");

  // Deliberately contains browser-safe fields only. Server credentials live in
  // a private WeakMap so they cannot be serialized into a response by mistake.
  const config={
    environment:"live",
    productId,
    priceId,
    clientToken:validClientToken?clientToken:"",
    price:{amount:"5.99",currency:"USD"},
    requestedEnabled,
    configured,
    enabled:requestedEnabled&&configured,
    missing
  };
  let apiBase=LIVE_API_BASE;
  if (env.NODE_ENV==="test"&&clean(env.PADDLE_API_BASE)) apiBase=clean(env.PADDLE_API_BASE);
  secretsByConfig.set(config,{apiKey,webhookSecret,apiBase});
  return Object.freeze(config);
}

function publicPaymentConfig(config) {
  return {
    enabled:config.enabled,
    configured:config.configured,
    productId:config.productId,
    priceId:config.priceId,
    clientToken:config.clientToken,
    price:{...config.price}
  };
}

function webhookSecretFor(config) {
  return secretsByConfig.get(config)?.webhookSecret||"";
}

function parseSignatureHeader(header) {
  const values={ts:[],h1:[]};
  for (const segment of clean(header).split(";")) {
    const separator=segment.indexOf("=");
    if (separator<1) continue;
    const key=segment.slice(0,separator).trim();
    const value=segment.slice(separator+1).trim();
    if (key in values&&value) values[key].push(value);
  }
  if (values.ts.length!==1||!/^\d+$/.test(values.ts[0])||!values.h1.length) return null;
  const timestamp=Number(values.ts[0]);
  if (!Number.isSafeInteger(timestamp)) return null;
  return {timestamp,signatures:values.h1};
}

function verifyPaddleSignature(rawBody,header,secret,{now=Math.floor(Date.now()/1000),toleranceSeconds=5}={}) {
  if (!secret) return false;
  const parsed=parseSignatureHeader(header);
  if (!parsed) return false;
  const nowSeconds=now>10_000_000_000?Math.floor(now/1000):Math.floor(now);
  if (Math.abs(nowSeconds-parsed.timestamp)>toleranceSeconds) return false;
  const body=Buffer.isBuffer(rawBody)?rawBody:Buffer.from(String(rawBody));
  const prefix=Buffer.from(`${parsed.timestamp}:`);
  const expected=createHmac("sha256",secret).update(Buffer.concat([prefix,body])).digest();
  return parsed.signatures.some((candidate) => {
    if (!/^[a-f0-9]{64}$/i.test(candidate)) return false;
    const actual=Buffer.from(candidate,"hex");
    return actual.length===expected.length&&timingSafeEqual(actual,expected);
  });
}

async function createPaddleTransaction(config,{userId}={},fetchImpl=globalThis.fetch) {
  const secrets=secretsByConfig.get(config);
  if (!config?.enabled||!secrets?.apiKey) {
    throw Object.assign(new Error("Checkout is not available yet."),{status:503,code:"CHECKOUT_UNAVAILABLE"});
  }
  if (!userId) throw Object.assign(new Error("Sign in required."),{status:401,code:"SIGN_IN_REQUIRED"});
  let response;
  try {
    response=await fetchImpl(`${secrets.apiBase}/transactions`,{
      method:"POST",
      headers:{
        Authorization:`Bearer ${secrets.apiKey}`,
        "Content-Type":"application/json",
        "Paddle-Version":"1"
      },
      signal:timeoutSignal(10_000),
      body:JSON.stringify({
        items:[{price_id:config.priceId,quantity:1}],
        collection_mode:"automatic",
        custom_data:{strata_user_id:userId,strata_version:1}
      })
    });
  } catch {
    throw Object.assign(new Error("Paddle could not be reached. Please try again."),{status:502,code:"PADDLE_UNAVAILABLE"});
  }
  if (!response?.ok) {
    throw Object.assign(new Error("Checkout could not be prepared. Please try again."),{status:502,code:"PADDLE_REQUEST_FAILED"});
  }
  let payload;
  try { payload=await response.json(); } catch { payload=null; }
  const transactionId=payload?.data?.id;
  if (!/^txn_[a-z0-9]{20,}$/.test(String(transactionId||""))) {
    throw Object.assign(new Error("Checkout could not be prepared. Please try again."),{status:502,code:"PADDLE_INVALID_RESPONSE"});
  }
  return {transactionId,status:payload.data.status||"draft"};
}

async function fetchPaddleIpv4Cidrs(config,fetchImpl=globalThis.fetch) {
  const secrets=secretsByConfig.get(config);
  if (!secrets?.apiKey) throw new Error("Paddle IP verification is not configured.");
  let response;
  try {
    response=await fetchImpl(`${secrets.apiBase}/ips`,{
      headers:{Authorization:`Bearer ${secrets.apiKey}`,"Paddle-Version":"1"},
      signal:timeoutSignal(3_000)
    });
  } catch {
    throw new Error("Paddle IP verification is temporarily unavailable.");
  }
  if (!response?.ok) throw new Error("Paddle IP verification is temporarily unavailable.");
  let payload;
  try { payload=await response.json(); } catch { payload=null; }
  const cidrs=payload?.data?.ipv4_cidrs;
  if (!Array.isArray(cidrs)||!cidrs.length||!cidrs.every((value)=>/^\d{1,3}(?:\.\d{1,3}){3}\/\d{1,2}$/.test(value))) {
    throw new Error("Paddle returned an invalid IP allowlist.");
  }
  return [...new Set(cidrs)];
}

function ipv4Number(value) {
  const parts=String(value||"").replace(/^::ffff:/i,"").split(".");
  if (parts.length!==4||parts.some((part)=>!/^\d{1,3}$/.test(part)||Number(part)>255)) return null;
  return parts.reduce((result,part)=>((result<<8)|Number(part))>>>0,0);
}

function isPaddleWebhookAddress(address,cidrs) {
  const candidate=ipv4Number(address);
  if (candidate===null||!Array.isArray(cidrs)) return false;
  return cidrs.some((cidr) => {
    const [networkText,bitsText]=String(cidr).split("/");
    const network=ipv4Number(networkText),bits=Number(bitsText);
    if (network===null||!Number.isInteger(bits)||bits<0||bits>32) return false;
    const mask=bits===0?0:(0xffffffff<<(32-bits))>>>0;
    return (candidate&mask)===(network&mask);
  });
}

function validateCompletedTransaction(data,config) {
  if (!data||data.status!=="completed") return {ok:false,reason:"status"};
  if (data.subscription_id!=null) return {ok:false,reason:"subscription"};
  if (data.collection_mode&&data.collection_mode!=="automatic") return {ok:false,reason:"collection"};
  if (!Array.isArray(data.items)||data.items.length!==1) return {ok:false,reason:"items"};
  const item=data.items[0]||{};
  const price=item.price||{};
  if (Number(item.quantity)!==1) return {ok:false,reason:"quantity"};
  if (price.id!==config.priceId) return {ok:false,reason:"price"};
  if (price.product_id!==config.productId) return {ok:false,reason:"product"};
  if (price.billing_cycle!=null) return {ok:false,reason:"recurring"};
  return {ok:true};
}

function fullRevocationFromAdjustment(data) {
  if (!data||data.status!=="approved"||data.type!=="full") return null;
  if (!new Set(["refund","chargeback"]).has(data.action)) return null;
  const transactionId=clean(data.transaction_id);
  if (!transactionId) return null;
  return {transactionId,reason:data.action};
}

module.exports={
  DEFAULT_PRODUCT_ID,
  DEFAULT_PRICE_ID,
  LIVE_API_BASE,
  getPaymentConfig,
  publicPaymentConfig,
  webhookSecretFor,
  verifyPaddleSignature,
  createPaddleTransaction,
  fetchPaddleIpv4Cidrs,
  isPaddleWebhookAddress,
  validateCompletedTransaction,
  fullRevocationFromAdjustment
};
