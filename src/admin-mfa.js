"use strict";

function createAdminMfa({clean,normalizedEmail,mailboxAddress,escapeHtml,digest,safeDigestEqual,secretsFor,timeoutSignal}){
  if(![clean,normalizedEmail,mailboxAddress,escapeHtml,digest,safeDigestEqual,secretsFor,timeoutSignal].every(value=>typeof value==="function")){
    throw new TypeError("Administrator MFA requires email security and transport capabilities.");
  }

  function adminMfaChallenge(config,{sessionTokenHash,challengeId,expiresAt}){
    const sessionHash=clean(sessionTokenHash,128),id=clean(challengeId,100),expiry=Number(expiresAt);
    if(!/^[a-f0-9]{64}$/i.test(sessionHash)||!/^[A-Za-z0-9_-]{16,100}$/.test(id)||!Number.isSafeInteger(expiry)||expiry<=0){
      throw new TypeError("Invalid administrator MFA challenge input.");
    }
    const signature=digest(config,"admin-mfa-challenge-v1",[sessionHash,id,expiry]);
    const codeSeed=digest(config,"admin-mfa-code-v1",[sessionHash,id,expiry]);
    const code=String(Number(BigInt(`0x${codeSeed.slice(0,12)}`)%1_000_000n)).padStart(6,"0");
    return{challengeId:id,expiresAt:expiry,signature,code};
  }

  function verifyAdminMfaChallenge(config,{sessionTokenHash,challengeId,expiresAt,signature,code}){
    let expected;
    try{expected=adminMfaChallenge(config,{sessionTokenHash,challengeId,expiresAt});}
    catch{return false;}
    return safeDigestEqual(signature,expected.signature)&&safeDigestEqual(String(code||"").trim(),expected.code);
  }

  function maskEmail(value){
    const email=normalizedEmail(value),separator=email.lastIndexOf("@");
    if(separator<1)return"your email address";
    const local=email.slice(0,separator),domain=email.slice(separator+1);
    const masked=local.length===1?"*":local.length===2?`${local[0]}*`:`${local[0]}${"*".repeat(Math.min(6,local.length-2))}${local.at(-1)}`;
    return`${masked}@${domain}`;
  }

  async function sendAdminMfaEmail(config,message,fetchImpl=globalThis.fetch){
    const secrets=secretsFor(config);
    if(!config?.enabled||!config.configured||!secrets?.apiKey){
      throw Object.assign(new Error("Administrator security email is unavailable."),{status:503,code:"ADMIN_MFA_UNAVAILABLE"});
    }
    const to=normalizedEmail(message?.to),name=clean(message?.name,80)||"there",code=String(message?.code||""),challengeId=clean(message?.challengeId,100);
    const expiresInMinutes=Math.max(1,Math.min(15,Math.ceil(Number(message?.expiresInMinutes)||10)));
    if(!mailboxAddress(to)||!/^[0-9]{6}$/.test(code)||!/^[A-Za-z0-9_-]{16,100}$/.test(challengeId))throw new TypeError("Invalid administrator MFA email input.");
    const subject="Your STRATA Admin security code";
    const text=[`Hi ${name},`,"",`Your STRATA Admin security code is ${code}.`,`It expires in ${expiresInMinutes} minutes and works only in the browser session that requested it.`,"","If you did not try to unlock STRATA Admin, change your STRATA password and secure your email account."].join("\n");
    const html=`<!doctype html><html><body style="margin:0;padding:24px;background:#f4f2ec;color:#10110f;font-family:Arial,sans-serif"><main style="max-width:560px;margin:auto;background:#fff;padding:32px;border:1px solid #bbb"><p>Hi ${escapeHtml(name)},</p><h1 style="font-size:24px">Confirm STRATA Admin</h1><p>Your six-digit security code is:</p><p style="font-size:36px;font-weight:700;letter-spacing:8px">${escapeHtml(code)}</p><p>It expires in ${expiresInMinutes} minutes and works only in the browser session that requested it.</p><p>If you did not try to unlock STRATA Admin, change your STRATA password and secure your email account.</p></main></body></html>`;
    const idempotencyDigest=digest(config,"admin-mfa-delivery-v1",[challengeId,to]),body={from:config.from,to:[to],subject,text,html};
    if(config.replyTo)body.reply_to=config.replyTo;
    let response;
    try{
      response=await fetchImpl(`${secrets.apiBase}/emails`,{method:"POST",headers:{Authorization:`Bearer ${secrets.apiKey}`,"Content-Type":"application/json","Idempotency-Key":`strata-admin-${idempotencyDigest}`},signal:timeoutSignal(10_000),body:JSON.stringify(body)});
    }catch{
      throw Object.assign(new Error("The administrator security code could not be sent. Try again."),{status:502,code:"ADMIN_MFA_DELIVERY_UNAVAILABLE"});
    }
    if(!response?.ok)throw Object.assign(new Error("The administrator security code could not be sent. Try again."),{status:502,code:"ADMIN_MFA_DELIVERY_FAILED"});
    let payload;
    try{payload=await response.json();}catch{payload=null;}
    return{messageId:clean(payload?.id,200)};
  }

  return{adminMfaChallenge,maskEmail,sendAdminMfaEmail,verifyAdminMfaChallenge};
}

module.exports={createAdminMfa};
