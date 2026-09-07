// @ts-check
"use strict";

const {randomUUID}=require("node:crypto");
const {MAX_WEBHOOK_BYTES,bodyBuffer:readBodyBuffer}=require("./http");
const {
  STRATA_PLUS_TRIAL_MS,
  publicPaymentConfig,
  webhookSecretFor,
  verifyPaddleSignature,
  createPaddleTransaction,
  fetchPaddleTransaction,
  cancelPaddleTransaction,
  validateCheckoutTransaction,
  validateCheckoutRecoveryTransaction,
  findPaddleCheckoutTransaction,
  fetchPaddleIpv4Cidrs,
  isPaddleWebhookAddress,
  validateCompletedTransaction,
  validateSubscription,
  createCustomerPortalSession,
  fullRevocationFromAdjustment
}=require("./payments");
const {cleanText}=require("./plans");

const ABANDONED_CHECKOUT_MS=30*60*1000;
const CHECKOUT_CREATION_CLAIM_MS=60*1000;
const MAX_DELETION_RECONCILIATIONS=8;
const PADDLE_IP_CACHE_MS=6*60*60*1000;
const PADDLE_TRANSACTION_STATUSES=new Set(["draft","ready","billed","paid","completed","canceled","past_due"]);
const PADDLE_STATUS_EVENTS=new Set([
  "transaction.created","transaction.ready","transaction.billed","transaction.paid",
  "transaction.past_due","transaction.payment_failed","transaction.canceled",
  "transaction.revised","transaction.updated"
]);
const PADDLE_CANCELABLE_STALE_STATUSES=new Set(["draft","ready","billed"]);

/**
 * Bound a stored trial to the server-owned 30-minute maximum. Old or malformed
 * rows can never extend access, even if their stored expiry is later.
 * @param {import("./domain-types").DiscoveryTrialRow|null|undefined} trial
 * @param {number} [now]
 * @returns {import("./domain-types").DiscoveryTrialState}
 */
function discoveryTrialState(trial,now=Date.now()) {
  const startedAt=trial?Number(trial.started_at):null;
  const storedExpiresAt=trial?Number(trial.expires_at):null;
  const maximumExpiresAt=Number.isSafeInteger(startedAt)&&Number.isSafeInteger(Number(startedAt)+STRATA_PLUS_TRIAL_MS)
    ? Number(startedAt)+STRATA_PLUS_TRIAL_MS
    : null;
  const expiresAt=Number.isSafeInteger(storedExpiresAt)&&maximumExpiresAt!==null
    ? Math.min(Number(storedExpiresAt),maximumExpiresAt)
    : null;
  return {eligible:!trial,active:expiresAt!==null&&expiresAt>now,startedAt,expiresAt};
}

/** @param {unknown} value @param {number} [fallback] */
function eventTime(value,fallback=Date.now()) {
  const parsed=Date.parse(String(value||""));
  return Number.isFinite(parsed)?parsed:fallback;
}

/**
 * Paddle checkout, entitlement, trial, webhook, and account-deletion
 * reconciliation boundary. The composition root supplies account/session
 * policy and storage capabilities; provider details only point downward.
 * @param {import("./domain-types").BillingServiceDependencies} dependencies
 * @returns {import("./domain-types").BillingService}
 */
function createBillingService({
  store,paymentConfig,enforcePaddleIps,requestAddress,rateAllowed,
  isUniqueViolation,getAuth,getUserPayload,http,logger,
  now=Date.now,makeId=randomUUID
}) {
  if(!store||!paymentConfig||typeof requestAddress!=="function"||typeof rateAllowed!=="function"||
    typeof isUniqueViolation!=="function"||typeof getAuth!=="function"||typeof getUserPayload!=="function"||
    !http||!logger) {
    throw new TypeError("Billing service requires storage, payment configuration, account policy, request guards, HTTP helpers, and a logger.");
  }
  const {json,bodyJson}=http;
  /** @type {{cidrs:string[];expiresAt:number;pending:Promise<string[]>|null}} */
  let paddleIpCache={cidrs:[],expiresAt:0,pending:null};

  function authService() {
    const service=getAuth();
    if(!service) throw new Error("Billing account policy is unavailable.");
    return service;
  }

  /** @param {string} userId @param {number} [timestamp] */
  function hasCurrentPaidAccess(userId,timestamp=now()) {
    return store.hasCurrentPaidDiscoveryAccess(userId,paymentConfig.priceId,paymentConfig.productId,timestamp);
  }

  /** @param {string} userId @param {number} [timestamp] */
  async function hasCurrentAccess(userId,timestamp=now()) {
    const [paid,trial]=await Promise.all([hasCurrentPaidAccess(userId,timestamp),store.discoveryTrial(userId)]);
    return Boolean(paid||discoveryTrialState(trial,timestamp).active);
  }

  /** @param {string} userId @param {number} [timestamp] */
  function accessSummaryForUser(userId,timestamp=now()) {
    return store.currentDiscoveryAccessSummary(userId,paymentConfig.priceId,paymentConfig.productId,timestamp);
  }

  /** @param {import("./domain-types").SubscriptionRow|null} row @param {number} [timestamp] */
  function subscriptionSummary(row,timestamp=now()) {
    if(!row)return null;
    const status=row.status,periodEndsAt=Number(row.current_period_ends_at),scheduledEndsAt=Number(row.scheduled_change_at);
    const scheduledTerminal=row.scheduled_change_action==="cancel"||row.scheduled_change_action==="pause";
    const active=["active","trialing","past_due"].includes(status)&&Number.isSafeInteger(periodEndsAt)&&periodEndsAt>timestamp&&(!scheduledTerminal||(Number.isSafeInteger(scheduledEndsAt)&&scheduledEndsAt>timestamp));
    return {
      id:row.subscription_id,status,active,
      pastDue:status==="past_due",
      scheduledChange:row.scheduled_change_action?{
        action:row.scheduled_change_action,effectiveAt:row.scheduled_change_at
      }:null,
      currentPeriodEndsAt:row.current_period_ends_at
    };
  }

  /** @param {string} userId */
  async function subscriptionForUser(userId) {
    return subscriptionSummary(await store.subscriptionForUser(userId));
  }

  async function currentPaddleIps() {
    const timestamp=now();
    if(paddleIpCache.cidrs.length&&paddleIpCache.expiresAt>timestamp)return paddleIpCache.cidrs;
    if(paddleIpCache.pending)return paddleIpCache.pending;
    paddleIpCache.pending=fetchPaddleIpv4Cidrs(paymentConfig)
      .then((cidrs)=>{
        paddleIpCache={cidrs,expiresAt:now()+PADDLE_IP_CACHE_MS,pending:null};
        return cidrs;
      })
      .finally(()=>{paddleIpCache.pending=null;});
    return paddleIpCache.pending;
  }

  /** @param {import("./domain-types").HttpRequest} req */
  async function webhookSourceAllowed(req) {
    if(!enforcePaddleIps)return true;
    let cidrs;
    try{cidrs=await currentPaddleIps();}
    catch{throw Object.assign(new Error("Webhook source verification is temporarily unavailable."),{status:503});}
    return isPaddleWebhookAddress(requestAddress(req),cidrs);
  }

  /** @param {string} message @param {string} [code] */
  function reconciliationError(message,code="PURCHASE_RECONCILIATION_UNAVAILABLE") {
    return authService().accountActionError(message,503,code);
  }

  /** @param {import("./domain-types").CheckoutClaimRow} claim @param {string|null} [expectedTransactionId] */
  async function releaseCheckoutClaim(claim,expectedTransactionId=null) {
    if(await store.releaseCheckoutCreation(claim.user_id,claim.claim_id,expectedTransactionId))return true;
    // A concurrent recovery may already have removed this claim. Preserve any
    // replacement or newly bound claim for the next reconciliation attempt.
    return !(await store.checkoutCreationForUser(claim.user_id));
  }

  /** @param {import("./domain-types").PaddleFetchedTransactionResult} remote @param {import("./domain-types").PurchaseRow} purchase */
  function validatePurchaseCheckoutForCancellation(remote,purchase) {
    const checkoutId=cleanText(remote.data.custom_data?.strata_checkout_id,100);
    return validateCheckoutTransaction(remote.data,paymentConfig,{
      userId:purchase.user_id,checkoutId,priceId:purchase.price_id,productId:purchase.product_id
    });
  }

  /** @param {import("./domain-types").CheckoutClaimRow} claim */
  async function transactionForCheckoutClaim(claim) {
    const validationOptions={
      userId:claim.user_id,checkoutId:claim.claim_id,priceId:claim.price_id,productId:paymentConfig.productId
    };
    /** @type {import("./domain-types").PaddleFetchedTransactionResult|null} */
    let remote;
    try{
      remote=claim.transaction_id
        ?await fetchPaddleTransaction(paymentConfig,claim.transaction_id)
        :await findPaddleCheckoutTransaction(paymentConfig,{...validationOptions,createdAt:Number(claim.created_at)});
    }catch{
      throw reconciliationError("STRATA could not safely confirm an interrupted Strata+ checkout. Please try again later.");
    }
    if(!remote)return null;
    const validation=validateCheckoutRecoveryTransaction(remote.data,paymentConfig,validationOptions);
    if(!validation.ok){
      throw reconciliationError("STRATA could not safely validate an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
    }
    if(!claim.transaction_id){
      const recorded=await store.recordCheckoutCreationTransaction(claim.user_id,claim.claim_id,remote.transactionId,now());
      if(!recorded){
        const attached=await store.purchaseByTransaction(remote.transactionId);
        if(attached?.user_id!==claim.user_id){
          throw reconciliationError("The interrupted checkout changed while it was being recovered. Please try again.");
        }
      }
    }
    return remote;
  }

  /** @param {import("./domain-types").CheckoutClaimRow} claim @returns {Promise<import("./domain-types").CheckoutRecovery>} */
  async function recoverCheckoutCreation(claim) {
    const remote=await transactionForCheckoutClaim(claim);
    if(!remote){
      if(Number(claim.expires_at)>now())return {state:"waiting"};
      return await releaseCheckoutClaim(claim,null)?{state:"replace"}:{state:"waiting"};
    }
    let purchase=await store.purchaseByTransaction(remote.transactionId);
    if(purchase&&purchase.user_id!==claim.user_id){
      throw reconciliationError("STRATA could not safely attach an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
    }
    if(remote.status==="canceled"){
      if(purchase)await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(now(),Number(purchase.updated_at)+1));
      return await releaseCheckoutClaim(claim,remote.transactionId)?{state:"replace"}:{state:"waiting"};
    }
    if(!purchase){
      const createdAt=eventTime(remote.data.created_at,Number(claim.created_at)||now());
      const updatedAt=Math.max(createdAt,eventTime(remote.data.updated_at,now()));
      try{
        purchase=await store.insertPendingPurchase({
          transactionId:remote.transactionId,userId:claim.user_id,priceId:claim.price_id,
          productId:cleanText(remote.data.items?.[0]?.price?.product_id,100)||paymentConfig.productId,
          paddleStatus:remote.status,createdAt,updatedAt
        });
      }catch(error){
        if(!isUniqueViolation(error))throw error;
        purchase=await store.purchaseByTransaction(remote.transactionId);
      }
    }
    if(!purchase)return await store.activeAccountDeletion(claim.user_id,now())?{state:"deletion"}:{state:"blocked"};
    let entitled=false;
    if(remote.status==="completed"){
      const validation=validateCompletedTransaction(remote.data,{...paymentConfig,priceId:claim.price_id});
      if(!validation.ok)throw reconciliationError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      const completedAt=eventTime(remote.data.updated_at,now());
      const subscriptionId=cleanText(remote.data.subscription_id,100);
      const completed=await store.completePurchase(remote.transactionId,{customerId:cleanText(remote.data.customer_id,100)||null,subscriptionId,completedAt,updatedAt:completedAt});
      if(completed?.subscription_id!==subscriptionId)throw reconciliationError("STRATA could not safely attach the completed Strata+ subscription. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      entitled=await hasCurrentPaidAccess(claim.user_id);
    }else if(purchase.paddle_status!==remote.status){
      await store.updatePurchaseStatus(remote.transactionId,remote.status,Math.max(now(),Number(purchase.updated_at)+1));
    }
    const released=await releaseCheckoutClaim(claim,remote.transactionId);
    if(remote.status==="completed"){
      if(entitled)return {state:"entitled"};
      // Paddle may deliver transaction.completed before subscription.created.
      // Keep the completed purchase as a durable barrier so a retry cannot
      // open a second subscription while ownership is still being linked.
      return released?{state:"pending"}:{state:"waiting"};
    }
    if(!released)return {state:"waiting"};
    if(remote.status==="draft"||remote.status==="ready")return {state:"transaction",transactionId:remote.transactionId};
    return {state:"pending"};
  }

  /** @param {string} userId */
  async function reconcileCheckoutCreationBeforeDeletion(userId) {
    const claim=await store.checkoutCreationForUser(userId);
    if(!claim)return 0;
    const remote=await transactionForCheckoutClaim(claim);
    if(!remote){
      if(Number(claim.expires_at)<=now())return await releaseCheckoutClaim(claim,null)?0:1;
      return 1;
    }
    const purchase=await store.purchaseByTransaction(remote.transactionId);
    if(purchase&&purchase.user_id!==userId){
      throw reconciliationError("STRATA could not safely attach an interrupted Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
    }
    if(remote.status==="canceled"){
      if(purchase)await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(now(),Number(purchase.updated_at)+1));
      return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
    }
    if(PADDLE_CANCELABLE_STALE_STATUSES.has(remote.status)){
      try{await cancelPaddleTransaction(paymentConfig,remote.transactionId);}
      catch{throw reconciliationError("STRATA could not safely close an interrupted Strata+ checkout. Please try again later.");}
      if(purchase)await store.updatePurchaseStatus(remote.transactionId,"canceled",Math.max(now(),Number(purchase.updated_at)+1));
      return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
    }
    if(remote.status==="completed"){
      const validation=validateCompletedTransaction(remote.data,{...paymentConfig,priceId:claim.price_id});
      if(!validation.ok)throw reconciliationError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      if(!purchase)throw reconciliationError("STRATA could not safely attach a completed Strata+ checkout while account deletion is pending. Please cancel deletion and contact support.","PURCHASE_RECONCILIATION_INVALID");
      const completedAt=eventTime(remote.data.updated_at,now());
      const subscriptionId=cleanText(remote.data.subscription_id,100);
      const completed=await store.completePurchase(remote.transactionId,{customerId:cleanText(remote.data.customer_id,100)||null,subscriptionId,completedAt,updatedAt:completedAt});
      if(completed?.subscription_id!==subscriptionId)throw reconciliationError("STRATA could not safely attach the completed Strata+ subscription. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      return await releaseCheckoutClaim(claim,remote.transactionId)?0:1;
    }
    const timestamp=now();
    await store.extendCheckoutCreation(userId,claim.claim_id,timestamp+CHECKOUT_CREATION_CLAIM_MS,timestamp);
    return 1;
  }

  /** @param {string} userId */
  async function reconcileUnsettledPurchases(userId) {
    const subscription=await store.subscriptionForUser(userId);
    if(subscription&&["active","trialing","past_due","paused"].includes(subscription.status)){
      const cancelAt=Number(subscription.scheduled_change_at);
      const scheduled=subscription.scheduled_change_action==="cancel"&&Number.isSafeInteger(cancelAt)&&cancelAt>0
        ?` It remains active until ${new Date(cancelAt).toISOString()}.`
        :subscription.status==="paused"
          ?" It can still resume billing, so cancel it from subscription management first."
          :" Cancel it from subscription management first.";
      throw authService().accountActionError(
        `Your Strata+ monthly subscription has not ended.${scheduled} Nothing was deleted.`,
        409,"SUBSCRIPTION_ACTIVE"
      );
    }
    const purchases=await store.unsettledPurchasesForUser(userId);
    const timestamp=now();
    const staleBefore=timestamp-ABANDONED_CHECKOUT_MS;
    const stale=purchases
      .filter((purchase)=>purchase.paddle_status==="past_due"||Number(purchase.updated_at)<=staleBefore)
      .slice(0,MAX_DELETION_RECONCILIATIONS);
    const reconciled=await Promise.allSettled(stale.map(async(purchase)=>{
      let remote;
      try{remote=await fetchPaddleTransaction(paymentConfig,purchase.transaction_id);}
      catch{
        throw authService().accountActionError("STRATA could not safely confirm an older Strata+ checkout. Please try again later.",503,"PURCHASE_RECONCILIATION_UNAVAILABLE");
      }
      const reconciledAt=Math.max(now(),Number(purchase.updated_at)+1);
      if(remote.status==="canceled"){
        await store.updatePurchaseStatus(purchase.transaction_id,"canceled",reconciledAt);
        return;
      }
      if(PADDLE_CANCELABLE_STALE_STATUSES.has(remote.status)){
        const validation=validatePurchaseCheckoutForCancellation(remote,purchase);
        if(!validation.ok)throw authService().accountActionError("STRATA could not safely validate an abandoned Strata+ checkout. Please contact support.",503,"PURCHASE_RECONCILIATION_INVALID");
        try{await cancelPaddleTransaction(paymentConfig,purchase.transaction_id);}
        catch{throw authService().accountActionError("STRATA could not safely close an abandoned Strata+ checkout. Please try again later.",503,"PURCHASE_RECONCILIATION_UNAVAILABLE");}
        await store.updatePurchaseStatus(purchase.transaction_id,"canceled",reconciledAt);
        return;
      }
      if(remote.status==="completed"){
        const validation=validateCompletedTransaction(remote.data,{...paymentConfig,priceId:purchase.price_id,productId:purchase.product_id});
        const claimedUser=cleanText(remote.data.custom_data?.strata_user_id,100);
        if(!validation.ok||claimedUser!==purchase.user_id){
          throw authService().accountActionError("STRATA could not safely validate a completed Strata+ checkout. Please contact support.",503,"PURCHASE_RECONCILIATION_INVALID");
        }
        const completedAt=eventTime(remote.data.updated_at,now());
        const subscriptionId=cleanText(remote.data.subscription_id,100);
        const completed=await store.completePurchase(purchase.transaction_id,{customerId:cleanText(remote.data.customer_id,100)||null,subscriptionId,completedAt,updatedAt:completedAt});
        if(completed?.subscription_id!==subscriptionId)throw authService().accountActionError("STRATA could not safely attach the completed Strata+ subscription. Please contact support.",503,"PURCHASE_RECONCILIATION_INVALID");
      }
    }));
    const failure=reconciled.find((result)=>result.status==="rejected");
    if(failure&&failure.status==="rejected")throw failure.reason;
    return store.pendingPurchasesForUser(userId);
  }

  /** @param {import("./domain-types").BillingWebhookEvent} event */
  async function processPaddleEvent(event) {
    const eventId=cleanText(event?.event_id,100);
    const eventType=cleanText(event?.event_type,100);
    const data=event?.data;
    if(!/^evt_[a-z0-9]{20,}$/.test(eventId)||!eventType||!data||typeof data!=="object"){
      throw Object.assign(new Error("Invalid Paddle event."),{status:400});
    }
    if(await store.webhookEvent(eventId))return "replayed";
    const occurredAt=eventTime(event.occurred_at,Number.NaN);
    if(!Number.isSafeInteger(occurredAt)||occurredAt<0){
      throw Object.assign(new Error("Invalid Paddle event timestamp."),{status:400});
    }
    const timestamp=now();
    let outcome="ignored";
    if(eventType==="transaction.completed"){
      const transactionId=cleanText(data.id,100);
      const purchase=await store.purchaseByTransaction(transactionId);
      const validation=validateCompletedTransaction(data,purchase?{
        ...paymentConfig,priceId:purchase.price_id,productId:purchase.product_id
      }:paymentConfig);
      const claimedUser=cleanText(data.custom_data?.strata_user_id,100);
      if(purchase&&validation.ok&&claimedUser===purchase.user_id){
        const subscriptionId=cleanText(data.subscription_id,100);
        const completed=await store.completePurchase(transactionId,{
          customerId:cleanText(data.customer_id,100)||null,subscriptionId,
          completedAt:eventTime(data.updated_at||event.occurred_at,timestamp),updatedAt:occurredAt
        });
        outcome=completed?.subscription_id===subscriptionId?"subscription-payment-recorded":"rejected:subscription-link";
      }else outcome=purchase?`rejected:${validation.ok?"account":validation.reason}`:"ignored:unknown-transaction";
    }else if(eventType==="subscription.created"){
      const transactionId=cleanText(data.transaction_id,100);
      const purchase=await store.purchaseByTransaction(transactionId);
      const validation=validateSubscription(data,paymentConfig,{
        userId:purchase?.user_id,transactionId,requireTransaction:true
      });
      if(purchase&&validation.ok){
        const saved=await store.createPaddleSubscription({
          subscriptionId:validation.subscriptionId,userId:purchase.user_id,transactionId,
          customerId:validation.customerId,status:validation.status,priceId:validation.priceId,
          productId:validation.productId,scheduledChangeAction:validation.scheduledChangeAction,
          scheduledChangeAt:validation.scheduledChangeAt,currentPeriodEndsAt:validation.currentPeriodEndsAt,
          eventOccurredAt:occurredAt,createdAt:occurredAt,updatedAt:timestamp
        });
        outcome=saved?(validation.entitled?"subscription-created":"subscription-catalog-changed"):"rejected:subscription-link";
      }else outcome=purchase?`rejected:${validation.ok?"subscription-link":validation.reason}`:"ignored:unknown-transaction";
    }else if(eventType==="subscription.updated"){
      const subscriptionId=cleanText(data.id,100);
      const existing=await store.subscriptionById(subscriptionId);
      const validation=validateSubscription(data,paymentConfig,{userId:existing?.user_id});
      if(existing&&validation.ok&&validation.customerId===existing.customer_id){
        const saved=await store.updatePaddleSubscription({
          subscriptionId,userId:existing.user_id,customerId:validation.customerId,status:validation.status,
          priceId:validation.priceId,productId:validation.productId,
          scheduledChangeAction:validation.scheduledChangeAction,scheduledChangeAt:validation.scheduledChangeAt,
          currentPeriodEndsAt:validation.currentPeriodEndsAt,eventOccurredAt:occurredAt,updatedAt:timestamp
        });
        outcome=saved?(validation.entitled?"subscription-updated":"subscription-catalog-changed"):"subscription-stale";
      }else if(!existing){
        // Updates can arrive before subscription.created. A retry after the
        // creation link is stored is safer than acknowledging and losing the
        // newer state forever.
        throw Object.assign(new Error("Subscription ownership is still being linked. Please retry."),{status:503,code:"SUBSCRIPTION_LINK_PENDING"});
      }else outcome=`rejected:${validation.ok?"customer":validation.reason}`;
    }else if(PADDLE_STATUS_EVENTS.has(eventType)){
      const transactionId=cleanText(data.id,100);
      const transactionStatus=cleanText(data.status,40);
      if(transactionStatus!=="completed"&&PADDLE_TRANSACTION_STATUSES.has(transactionStatus)&&await store.purchaseByTransaction(transactionId)){
        await store.updatePurchaseStatus(transactionId,transactionStatus,occurredAt);
        outcome="updated";
      }
    }else if(eventType==="adjustment.created"||eventType==="adjustment.updated"){
      const adjustmentId=cleanText(data.id,100);
      const transactionId=cleanText(data.transaction_id,100);
      const purchase=transactionId?await store.purchaseByTransaction(transactionId):null;
      if(adjustmentId&&transactionId&&purchase){
        const existing=await store.adjustmentById(adjustmentId);
        if(existing&&existing.transaction_id!==transactionId)outcome="rejected:adjustment-transaction";
        else{
          const adjustmentApplied=await store.upsertAdjustment({
            adjustmentId,transactionId,action:cleanText(data.action,40),type:cleanText(data.type,40),
            status:cleanText(data.status,40),occurredAt,updatedAt:timestamp
          });
          const revocation=fullRevocationFromAdjustment(data);
          if(revocation&&adjustmentApplied){
            await store.revokePurchase(transactionId,revocation.reason,occurredAt,timestamp);
            outcome="revoked";
          }else outcome="adjustment-recorded";
        }
      }
    }
    await store.recordWebhookEvent({
      eventId,notificationId:cleanText(event.notification_id,100)||null,eventType,
      occurredAt,processedAt:now()
    });
    return outcome;
  }

  /** @param {import("./domain-types").HttpRequest} req @param {import("./domain-types").HttpResponse} res */
  async function handleWebhook(req,res) {
    if(req.method!=="POST"){
      json(res,405,{error:"Method not allowed."},{Allow:"POST"});
      return;
    }
    if(!await webhookSourceAllowed(req)){
      json(res,403,{error:"Webhook source rejected."});
      return;
    }
    const secret=webhookSecretFor(paymentConfig);
    if(!secret){json(res,503,{error:"Webhook is not configured."});return;}
    const rawBody=await readBodyBuffer(req,MAX_WEBHOOK_BYTES);
    if(!verifyPaddleSignature(rawBody,req.headers["paddle-signature"],secret)){
      json(res,400,{error:"Invalid webhook signature."});
      return;
    }
    /** @type {import("./domain-types").BillingWebhookEvent} */
    let event;
    try{event=JSON.parse(rawBody.toString("utf8"));}
    catch{json(res,400,{error:"Invalid JSON."});return;}
    const outcome=await processPaddleEvent(event);
    json(res,200,{ok:true,outcome});
  }

  /** @param {import("./domain-types").HttpRequest} req @param {import("./domain-types").HttpResponse} res */
  async function startTrial(req,res) {
    const auth=authService();
    const session=await auth.requireSession(req,res);if(!session)return;
    if(!auth.validCsrf(req,session)){
      json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});return;
    }
    await bodyJson(req);
    if(await hasCurrentPaidAccess(session.id)){
      json(res,409,{error:"Strata+ is already active for this account.",code:"DISCOVERY_ALREADY_ACTIVE"});return;
    }
    const timestamp=now();
    if(await store.activeAccountDeletion(session.id,timestamp)){
      json(res,409,{error:"Cancel the pending account-deletion request before starting a trial.",code:"ACCOUNT_DELETION_PENDING"});return;
    }
    if(!rateAllowed(req,`discovery-trial:${session.id}`,5)){
      json(res,429,{error:"Too many trial attempts. Try again later."});return;
    }
    const created=await store.startDiscoveryTrial(session.id,timestamp,timestamp+STRATA_PLUS_TRIAL_MS);
    const trial=created||await store.discoveryTrial(session.id);
    if(!trial){json(res,409,{error:"The trial could not be started for this account.",code:"TRIAL_UNAVAILABLE"});return;}
    if(!created&&Number(trial.expires_at)<=timestamp){
      json(res,409,{error:"This account has already used its one-time Strata+ trial.",code:"TRIAL_ALREADY_USED"});return;
    }
    json(res,created?201:200,{ok:true,user:await getUserPayload(session)});
  }

  /** @param {import("./domain-types").HttpRequest} req @param {import("./domain-types").HttpResponse} res */
  async function beginCheckout(req,res) {
    const auth=authService();
    const session=await auth.requireSession(req,res);if(!session)return;
    if(!auth.validCsrf(req,session)){
      json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});return;
    }
    await bodyJson(req);
    if(!paymentConfig.enabled){json(res,503,{error:"Checkout is not available yet.",code:"CHECKOUT_UNAVAILABLE"});return;}
    if(await store.activeAccountDeletion(session.id,now())){
      json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"});return;
    }
    if(!rateAllowed(req,`checkout:${session.id}`,8)){
      json(res,429,{error:"Too many checkout attempts. Try again later."});return;
    }
    if(await hasCurrentPaidAccess(session.id)){
      json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"});return;
    }
    const interrupted=await store.checkoutCreationForUser(session.id);
    if(interrupted){
      const recovery=await recoverCheckoutCreation(interrupted);
      if(recovery.state==="transaction"){
        json(res,200,{transactionId:recovery.transactionId,reused:true,recovered:true});return;
      }
      if(recovery.state==="entitled"){
        json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"});return;
      }
      if(recovery.state==="deletion"){
        json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"});return;
      }
      if(recovery.state==="pending"||recovery.state==="blocked"){
        json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"});return;
      }
      if(recovery.state==="waiting"){
        json(res,409,{error:"Another checkout is already being prepared. Please try again in a moment.",code:"CHECKOUT_PREPARING"});return;
      }
    }
    const claimedAt=now(),claimId=makeId();
    const claim=await store.claimCheckoutCreation({
      userId:session.id,priceId:paymentConfig.priceId,claimId,
      expiresAt:claimedAt+CHECKOUT_CREATION_CLAIM_MS,now:claimedAt
    });
    if(!claim){
      const pending=await store.pendingPurchaseForUser(session.id,paymentConfig.priceId);
      if(pending){json(res,200,{transactionId:pending.transaction_id,reused:true});return;}
      json(res,409,{error:"Another checkout is already being prepared. Please try again in a moment.",code:"CHECKOUT_PREPARING"});return;
    }
    let preserveClaim=false;
    /** @type {string|null} */
    let releaseTransactionId=null;
    try{
      if(await store.activeAccountDeletion(session.id,now())){
        json(res,409,{error:"Cancel the pending account-deletion request before starting checkout.",code:"ACCOUNT_DELETION_PENDING"});return;
      }
      if(await hasCurrentPaidAccess(session.id)){
        json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"});return;
      }
      let pending=await store.pendingPurchaseForUser(session.id,paymentConfig.priceId);
      if(pending&&Number(pending.updated_at)>now()-ABANDONED_CHECKOUT_MS){
        json(res,200,{transactionId:pending.transaction_id,reused:true});return;
      }
      if(await store.pendingPurchasesForUser(session.id)>0){
        await reconcileUnsettledPurchases(session.id);
        if(await hasCurrentPaidAccess(session.id)){
          json(res,409,{error:"Strata+ is already unlocked for this account.",code:"ALREADY_ENTITLED"});return;
        }
        pending=await store.pendingPurchaseForUser(session.id,paymentConfig.priceId);
        if(pending){json(res,200,{transactionId:pending.transaction_id,reused:true});return;}
        if(await store.pendingPurchasesForUser(session.id)>0){
          json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"});return;
        }
      }
      // Once Paddle accepts create, retain this durable claim until a retry can
      // discover and bind the provider transaction by stable checkout ID.
      preserveClaim=true;
      const created=await createPaddleTransaction(paymentConfig,{userId:session.id,checkoutId:claimId});
      releaseTransactionId=created.transactionId;
      const timestamp=now();
      const recorded=await store.recordCheckoutCreationTransaction(session.id,claimId,created.transactionId,timestamp);
      if(!recorded){
        const recoveredPurchase=await store.purchaseByTransaction(created.transactionId);
        if(recoveredPurchase?.user_id===session.id){
          preserveClaim=false;
          json(res,201,{transactionId:created.transactionId,recovered:true});return;
        }
        throw reconciliationError("STRATA could not safely record the prepared Strata+ checkout. Please try again later.");
      }
      let storedPurchase;
      try{
        storedPurchase=await store.insertPendingPurchase({
          transactionId:created.transactionId,userId:session.id,priceId:paymentConfig.priceId,
          productId:paymentConfig.productId,paddleStatus:created.status,createdAt:timestamp,updatedAt:timestamp
        });
      }catch(error){
        if(isUniqueViolation(error))storedPurchase=await store.purchaseByTransaction(created.transactionId);
        if(storedPurchase?.user_id!==session.id)throw error;
        if(!storedPurchase)throw error;
      }
      if(!storedPurchase){
        if(await store.activeAccountDeletion(session.id,now())){
          json(res,409,{error:"Checkout could not be attached because account deletion is pending. Cancel deletion and try again.",code:"ACCOUNT_DELETION_PENDING"});return;
        }
        json(res,409,{error:"A previous Strata+ payment is still being confirmed. Please wait before starting another checkout.",code:"CHECKOUT_PENDING_CONFIRMATION"});return;
      }
      if(storedPurchase.user_id!==session.id){
        throw reconciliationError("STRATA could not safely attach the prepared Strata+ checkout. Please contact support.","PURCHASE_RECONCILIATION_INVALID");
      }
      preserveClaim=false;
      json(res,201,{transactionId:created.transactionId});
    }finally{
      try{
        if(preserveClaim){
          const timestamp=now();
          await store.extendCheckoutCreation(session.id,claimId,timestamp+CHECKOUT_CREATION_CLAIM_MS,timestamp);
        }else{
          const released=await releaseCheckoutClaim(claim,releaseTransactionId);
          if(!released)logger.error("billing.checkout_claim_release_race",{userId:session.id,transactionId:releaseTransactionId});
        }
      }catch(error){
        logger.error(preserveClaim?"billing.checkout_claim_extend_failed":"billing.checkout_claim_release_failed",{error});
      }
    }
  }

  /** @param {import("./domain-types").HttpRequest} req @param {import("./domain-types").HttpResponse} res */
  async function openPortal(req,res) {
    const auth=authService();
    const session=await auth.requireSession(req,res);if(!session)return;
    if(!auth.validCsrf(req,session)){
      json(res,403,{error:"Security check failed. Refresh and try again.",code:"INVALID_CSRF"});return;
    }
    await bodyJson(req);
    const subscription=await store.subscriptionForUser(session.id);
    if(!subscription){
      json(res,404,{error:"No Strata+ monthly subscription was found for this account.",code:"SUBSCRIPTION_NOT_FOUND"});return;
    }
    if(!rateAllowed(req,`billing-portal:${session.id}`,10,15*60*1000)){
      json(res,429,{error:"Too many subscription-management requests. Try again later."});return;
    }
    const links=await createCustomerPortalSession(paymentConfig,{
      customerId:subscription.customer_id,subscriptionId:subscription.subscription_id
    });
    json(res,200,{...links,subscription:subscriptionSummary(subscription)},{"Cache-Control":"private, no-store"});
  }

  /** @param {import("./domain-types").HttpRequest} req @param {import("./domain-types").HttpResponse} res @param {URL} url */
  async function handleApi(req,res,url) {
    if(url.pathname==="/api/billing/config"&&req.method==="GET"){
      json(res,200,publicPaymentConfig(paymentConfig));return true;
    }
    if(url.pathname==="/api/discovery/trial"&&req.method==="POST"){
      await startTrial(req,res);return true;
    }
    if(url.pathname==="/api/billing/checkout"&&req.method==="POST"){
      await beginCheckout(req,res);return true;
    }
    if(url.pathname==="/api/billing/subscription"&&req.method==="GET"){
      const session=await authService().requireSession(req,res);if(session){
        json(res,200,{subscription:await subscriptionForUser(session.id)},{"Cache-Control":"private, no-store"});
      }
      return true;
    }
    if(url.pathname==="/api/billing/portal"&&req.method==="POST"){
      await openPortal(req,res);return true;
    }
    return false;
  }

  async function warmProviderTrust() {
    if(enforcePaddleIps)await currentPaddleIps();
  }

  return {
    handleApi,handleWebhook,hasCurrentAccess,accessSummaryForUser,reconcileCheckoutCreationBeforeDeletion,
    reconcileUnsettledPurchases,subscriptionForUser,warmProviderTrust
  };
}

module.exports={createBillingService,discoveryTrialState};
