"use strict";

const {randomUUID}=require("node:crypto");
const {cleanText,defaultPlan,sanitizePlan,planStats}=require("./plans");

const ADMIN_ELEVATION_MS=30*60*1000;

/**
 * Typed dependency-injection boundary for privileged account operations.
 * @param {import("./domain-types").AdminServiceDependencies} dependencies
 * @returns {import("./domain-types").AdminService}
 */
function createAdminService({
  store,
  adminEmail,
  auth,
  emailConfig,
  paymentConfig,
  enforcePaddleIps=false,
  trustedAuthOrigin,
  rateAllowed,
  http,
  environment=process.env
}){
  if(!store||!auth||!emailConfig||!paymentConfig||typeof trustedAuthOrigin!=="function"||typeof rateAllowed!=="function"||!http){
    throw new TypeError("Admin service requires store, auth, service configuration, request guards, and HTTP helpers.");
  }
  const {json,bodyJson}=http;

  function adminPrincipalMatches(principal){
    return Boolean(
      adminEmail&&principal&&
      auth.normalizeEmail(principal.configured_email)===adminEmail&&
      auth.normalizeEmail(principal.email)===adminEmail&&
      Number(principal.email_verified_at)&&
      !principal.suspended_at
    );
  }

  async function adminIdentity(session,{allowBootstrap=false}={}){
    if(!adminEmail||!session||!Number(session.email_verified_at)||session.suspended_at)return {active:false,boundNow:false,principal:null};
    let principal=await store.adminPrincipal(),boundNow=false;
    if(!principal&&allowBootstrap&&auth.normalizeEmail(session.email)===adminEmail){
      const claimed=await store.claimAdminPrincipal(session.id,adminEmail,Date.now());
      principal=claimed.principal;
      boundNow=claimed.boundNow;
    }
    return {active:adminPrincipalMatches(principal)&&principal.user_id===session.id,boundNow,principal};
  }

  async function maybeClaimAdminForLogin(user){
    if(!adminEmail||!user||auth.normalizeEmail(user.email)!==adminEmail||!Number(user.email_verified_at)||user.suspended_at)return user;
    await store.claimAdminPrincipal(user.id,adminEmail,Date.now());
    return store.userById(user.id);
  }

  async function requireAdmin(req,res,{elevated=true,allowBootstrap=false}={}){
    const session=await auth.requireSession(req,res);
    if(!session)return null;
    const identity=await adminIdentity(session,{allowBootstrap});
    if(identity.boundNow){
      json(res,409,{error:"Admin ownership is secured. Sign in again to continue.",code:"ADMIN_RELOGIN_REQUIRED"},{"Set-Cookie":auth.sessionCookie("",0)});
      return null;
    }
    if(!identity.active){json(res,403,{error:"Administrator access required.",code:"ADMIN_REQUIRED"});return null;}
    if(elevated&&!await store.adminElevation(session.token_hash,Date.now())){
      json(res,428,{error:"Confirm your password to continue in Admin.",code:"ADMIN_ELEVATION_REQUIRED"});
      return null;
    }
    return session;
  }

  function requireAdminMutation(req,res,session){
    if(!trustedAuthOrigin(req)){json(res,403,{error:"Admin security check failed. Refresh and try again.",code:"ADMIN_ORIGIN_REQUIRED"});return false;}
    if(!auth.validCsrf(req,session)){json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});return false;}
    if(!String(req.headers["content-type"]||"").toLowerCase().startsWith("application/json")){
      json(res,415,{error:"Admin requests must use JSON.",code:"JSON_REQUIRED"});return false;
    }
    return true;
  }

  function sensitiveAdminText(value){
    const text=String(value||"");
    return /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i.test(text)
      || /\b(?:password|passcode|secret|token|api[\s_-]*key)\s*[:=]\s*\S{6,}/i.test(text)
      || /\b(?:verification|security|recovery)\s+code\s*[:=]?\s*\d{6}\b/i.test(text)
      || /\b(?:re_|pdl_(?:live|sdbx|ntfset)_|live_)[A-Za-z0-9_-]{12,}/i.test(text)
      || /(?:[#?&](?:token|code)=)[A-Za-z0-9_-]{6,}/i.test(text);
  }
  function adminReason(value){
    const reason=cleanText(value,200);
    if(reason.length<4)throw Object.assign(new Error("Add a short reason for this admin action."),{status:400,code:"ADMIN_REASON_REQUIRED"});
    if(sensitiveAdminText(reason))throw Object.assign(new Error("Do not put passwords, codes, API keys, tokens, or private action links in an admin reason."),{status:400,code:"ADMIN_SENSITIVE_REASON"});
    return reason;
  }
  function cleanAdminTarget(value){const id=cleanText(value,100);return /^[A-Za-z0-9_-]{8,100}$/.test(id)?id:"";}
  function adminAuditEvent(actorUserId,targetUserId,action,reason,result="success"){
    return {id:randomUUID(),actorUserId,targetUserId,action,reason,result,createdAt:Date.now()};
  }
  async function recordAdminAudit(actorUserId,targetUserId,action,reason,result="success"){
    await store.recordAdminAudit(adminAuditEvent(actorUserId,targetUserId,action,reason,result));
  }

  function numericAdminRow(row){
    const output={...row};
    for(const key of ["created_at","email_verified_at","suspended_at","active_session_count","active_purchase_count","pending_purchase_count","purchase_count","rating_count","latest_purchase_at","deletion_expires_at","updated_at","last_response_at","bound_at"]){
      if(output[key]!=null)output[key]=Number(output[key]);
    }
    return output;
  }
  function adminUserPayload(row,{detail=false}={}){
    if(!row)return null;
    const output=numericAdminRow(row);
    const result={
      id:output.id,name:output.name,email:output.email,createdAt:output.created_at,verifiedAt:output.email_verified_at??null,suspendedAt:output.suspended_at??null,
      activeSessions:Number(output.active_session_count||0),
      discovery:{active:Number(output.active_purchase_count||0)>0,activePurchaseCount:Number(output.active_purchase_count||0),pendingPurchaseCount:Number(output.pending_purchase_count||0),purchaseCount:Number(output.purchase_count||0),latestPurchaseAt:output.latest_purchase_at??null,transactionId:output.transaction_id||null,transactionStatus:output.transaction_status||null},
      accountDeletion:{pending:Boolean(output.deletion_expires_at),expiresAt:output.deletion_expires_at??null}
    };
    if(detail){
      let plan=defaultPlan();
      try{if(output.plan_json)plan=sanitizePlan(JSON.parse(output.plan_json),{repair:true});}catch{/* Return safe default plan stats. */}
      Object.assign(result,planStats(plan),{ratingCount:Number(output.rating_count||0)});
    }
    return result;
  }
  function adminOverviewPayload(row){
    const value=(key)=>Number(row?.[key]||0);
    return {
      accounts:{total:value("total_users"),verified:value("verified_users"),suspended:value("suspended_users"),activeSessions:value("active_sessions")},
      discovery:{activeUsers:value("discovery_users"),pendingPayments:value("pending_payments")},
      support:{open:value("open_support"),pendingDeletions:value("pending_deletions")},
      services:{storage:store.kind,persistent:store.kind==="turso"||environment.NODE_ENV!=="production",email:emailConfig.enabled,checkout:paymentConfig.enabled,webhookProtection:enforcePaddleIps}
    };
  }

  function validAdminConfirmation(action,value,target){
    const expected={"send-password-reset":"SEND RESET","send-delete-link":target?.email||"","cancel-deletion":"CANCEL","revoke-sessions":"REVOKE",suspend:"SUSPEND",restore:"RESTORE"}[action];
    return Boolean(expected&&String(value||"").trim()===expected);
  }
  async function performAdminUserAction(session,targetId,input){
    const target=await store.adminUserById(targetId,Date.now());
    if(!target)throw Object.assign(new Error("Account not found."),{status:404,code:"ADMIN_TARGET_NOT_FOUND"});
    const principal=await store.adminPrincipal();
    if(principal?.user_id===target.id)throw Object.assign(new Error("Use Account Security for the primary administrator account."),{status:409,code:"ADMIN_SELF_PROTECTED"});
    const action=cleanText(input?.action,40);
    if(!["send-password-reset","send-delete-link","cancel-deletion","revoke-sessions","suspend","restore"].includes(action))throw Object.assign(new Error("Unknown admin action."),{status:400,code:"UNKNOWN_ADMIN_ACTION"});
    const reason=adminReason(input?.reason);
    if(!validAdminConfirmation(action,input?.confirmation,target))throw Object.assign(new Error("The confirmation text does not match this action."),{status:400,code:"ADMIN_CONFIRMATION_REQUIRED"});
    if(action==="send-password-reset"||action==="send-delete-link"){
      const purpose=action==="send-password-reset"?"password_reset":"account_delete";
      await recordAdminAudit(session.id,target.id,action,reason,"requested");
      const delivery=await auth.requestSignedInAccountAction(target,purpose);
      const label=purpose==="password_reset"?"Password-reset":"Deletion-confirmation";
      return {ok:true,message:`${label} email sent to ${delivery.maskedEmail}.`,user:adminUserPayload(await store.adminUserById(target.id,Date.now()),{detail:true})};
    }
    let message="Action completed.";
    if(action==="cancel-deletion"){
      const canceled=await store.cancelAccountDeletionWithAudit(target.id,adminAuditEvent(session.id,target.id,action,reason));
      if(!canceled)throw Object.assign(new Error("This account has no pending deletion request."),{status:409,code:"NO_PENDING_DELETION"});
      message="Pending account deletion canceled.";
    }else if(action==="revoke-sessions"){
      const result=await store.revokeUserSessions(target.id,adminAuditEvent(session.id,target.id,action,reason));
      if(!result)throw Object.assign(new Error("Account not found."),{status:404,code:"ADMIN_TARGET_NOT_FOUND"});
      message=`Signed the account out on ${result.revoked} active ${result.revoked===1?"session":"sessions"}.`;
    }else if(action==="suspend"){
      if(target.suspended_at)throw Object.assign(new Error("This account is already paused."),{status:409,code:"ACCOUNT_ALREADY_SUSPENDED"});
      if(!await store.suspendUser(target.id,Date.now(),adminAuditEvent(session.id,target.id,action,reason)))throw Object.assign(new Error("The account state changed. Refresh and try again."),{status:409,code:"ADMIN_STATE_CHANGED"});
      message="Account paused and all sessions revoked.";
    }else if(action==="restore"){
      if(!target.suspended_at)throw Object.assign(new Error("This account is already active."),{status:409,code:"ACCOUNT_ALREADY_ACTIVE"});
      if(!await store.restoreUser(target.id,adminAuditEvent(session.id,target.id,action,reason)))throw Object.assign(new Error("The account state changed. Refresh and try again."),{status:409,code:"ADMIN_STATE_CHANGED"});
      message="Account restored. The user can sign in again.";
    }
    return {ok:true,message,user:adminUserPayload(await store.adminUserById(target.id,Date.now()),{detail:true})};
  }

  async function handleApi(req,res,url){
    if(!url.pathname.startsWith("/api/admin/")||url.pathname.startsWith("/api/admin/support"))return false;
    if(url.pathname==="/api/admin/session"&&req.method==="GET"){
      const session=await requireAdmin(req,res,{elevated:false,allowBootstrap:true});if(!session)return true;
      const elevation=await store.adminElevation(session.token_hash,Date.now());
      json(res,200,{admin:true,elevated:Boolean(elevation),elevatedUntil:elevation?Number(elevation.expires_at):null});return true;
    }
    if(url.pathname==="/api/admin/elevate"&&req.method==="POST"){
      const session=await requireAdmin(req,res,{elevated:false,allowBootstrap:true});if(!session)return true;
      if(!requireAdminMutation(req,res,session))return true;
      if(!rateAllowed(req,`admin-elevate:${session.id}`,8,15*60*1000)){json(res,429,{error:"Too many admin confirmation attempts. Wait and try again.",code:"ADMIN_RATE_LIMIT"});return true;}
      const input=await bodyJson(req),password=String(input?.password||""),user=await store.accountCredentialsById(session.id);
      if(!user||password.length<1||password.length>128||!await auth.passwordMatches(password,user)){json(res,401,{error:"Password is incorrect.",code:"ADMIN_PASSWORD_INCORRECT"});return true;}
      const now=Date.now(),elevatedUntil=now+ADMIN_ELEVATION_MS,nextSession=auth.prepareSession(session.id,now,session.auth_version);
      const rotated=await store.rotateAdminSessionForElevation(session.token_hash,nextSession.record,elevatedUntil,adminAuditEvent(session.id,session.id,"admin-elevated","Owner password confirmed"),now);
      if(!rotated){json(res,409,{error:"Your session changed. Sign in and try again.",code:"ADMIN_SESSION_CHANGED"});return true;}
      json(res,200,{ok:true,elevatedUntil,csrfToken:nextSession.csrfToken},{"Set-Cookie":auth.sessionCookie(nextSession.token)});return true;
    }
    if(url.pathname==="/api/admin/overview"&&req.method==="GET"){
      const session=await requireAdmin(req,res);if(!session)return true;
      json(res,200,{overview:adminOverviewPayload(await store.adminOverview(Date.now()))});return true;
    }
    if(url.pathname==="/api/admin/users"&&req.method==="GET"){
      const session=await requireAdmin(req,res);if(!session)return true;
      const query=cleanText(url.searchParams.get("q"),100),limit=Math.max(1,Math.min(50,Math.floor(Number(url.searchParams.get("limit"))||20))),offset=Math.max(0,Math.min(10000,Math.floor(Number(url.searchParams.get("offset"))||0)));
      const result=await store.adminUsers(query,limit,offset,Date.now());
      json(res,200,{users:result.users.map((user)=>adminUserPayload(user)),total:result.total,limit,offset});return true;
    }
    const userDetailMatch=url.pathname.match(/^\/api\/admin\/users\/([^/]+)$/);
    if(userDetailMatch&&req.method==="GET"){
      const session=await requireAdmin(req,res);if(!session)return true;
      const targetId=cleanAdminTarget(userDetailMatch[1]),user=targetId?await store.adminUserById(targetId,Date.now()):null;
      if(!user)json(res,404,{error:"Account not found.",code:"ADMIN_TARGET_NOT_FOUND"});
      else json(res,200,{user:adminUserPayload(user,{detail:true})});
      return true;
    }
    const actionMatch=url.pathname.match(/^\/api\/admin\/users\/([^/]+)\/actions$/);
    if(actionMatch&&req.method==="POST"){
      const session=await requireAdmin(req,res);if(!session)return true;
      if(!requireAdminMutation(req,res,session))return true;
      if(!rateAllowed(req,`admin-user-action:${session.id}`,30,15*60*1000)){json(res,429,{error:"Too many admin actions. Wait and try again.",code:"ADMIN_RATE_LIMIT"});return true;}
      const targetId=cleanAdminTarget(actionMatch[1]);
      if(!targetId){json(res,404,{error:"Account not found.",code:"ADMIN_TARGET_NOT_FOUND"});return true;}
      try{json(res,200,await performAdminUserAction(session,targetId,await bodyJson(req)));}
      catch(error){if(!error.status)throw error;json(res,error.status,{error:error.message,code:error.code||"ADMIN_ACTION_FAILED"});}
      return true;
    }
    if(url.pathname==="/api/admin/audit"&&req.method==="GET"){
      const session=await requireAdmin(req,res);if(!session)return true;
      const limit=Math.max(1,Math.min(100,Math.floor(Number(url.searchParams.get("limit"))||40)));
      const events=(await store.adminAudit(limit)).map((event)=>({id:event.id,action:event.action,reason:event.reason,result:event.result,createdAt:Number(event.created_at),actor:{id:event.actor_id,name:event.actor_name,email:event.actor_email},target:event.target_id||event.target_user_id?{id:event.target_id||event.target_user_id,name:event.target_name||null,email:event.target_email||null}:null}));
      json(res,200,{events,limit});return true;
    }
    return false;
  }

  async function bootstrap(){
    if(!adminEmail)return;
    const configuredUser=await store.userByEmail(adminEmail);
    if(configuredUser&&Number(configuredUser.email_verified_at)&&!configuredUser.suspended_at){
      await store.claimAdminPrincipal(configuredUser.id,adminEmail,Date.now());
    }
  }
  async function cleanup(now=Date.now()){await store.deleteExpiredAdminElevations(now);}

  return Object.freeze({
    handleApi,bootstrap,cleanup,adminIdentity,maybeClaimAdminForLogin,requireAdmin,requireAdminMutation,
    sensitiveAdminText,cleanAdminTarget,adminAuditEvent,recordAdminAudit,adminUserPayload
  });
}

module.exports={createAdminService};
