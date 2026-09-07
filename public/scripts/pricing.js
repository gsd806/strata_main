"use strict";

(() => {
  const EXPECTED_PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";
  const RETIRED_ONE_TIME_PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
  const el=(id)=>document.getElementById(id);
  const panel=el("purchasePanel");
  const statusNode=el("purchaseStatus");
  const signupLink=el("purchaseSignup");
  const loginLink=el("purchaseLogin");
  const trialButton=el("trialDiscovery");
  const buyButton=el("buyDiscovery");
  const openLink=el("openDiscovery");
  const manageLink=el("manageSubscription");
  const checkButton=el("checkAccess");
  const pageReason=new URLSearchParams(location.search).get("reason");
  const trialRequested=new URLSearchParams(location.search).get("trial")==="1";
  const signal=name=>globalThis.StrataSignals?.record?.(name);

  const state={
    user:null,
    csrfToken:"",
    config:null,
    configError:"",
    paddleReady:false,
    busy:true,
    awaitingAccess:false,
    checkoutOpen:false,
    actionError:"",
    currentTransactionId:""
  };

  function setStatus(message,tone="",{focus=false}={}){
    statusNode.setAttribute("role",tone==="error"?"alert":"status");
    statusNode.textContent=state.config?.environment==="sandbox"?`TEST MODE · ${message}`:message;
    statusNode.classList.toggle("purchase-status-good",tone==="good");
    statusNode.classList.toggle("purchase-status-warn",tone==="warn");
    statusNode.classList.toggle("purchase-status-error",tone==="error");
    if(focus)requestAnimationFrame(()=>statusNode.focus({preventScroll:false}));
  }

  function discoveryIsActive(user){
    return user?.discovery?.active===true;
  }

  function subscriptionFor(user){
    const subscription=user?.discovery?.subscription;
    return subscription&&typeof subscription==="object"&&subscription.id?subscription:null;
  }

  function paidAccessType(user){
    return ["subscription","lifetime","paid"].includes(String(user?.discovery?.accessType||""));
  }

  function paidAccessReady(user){
    return subscriptionFor(user)?.active===true||paidAccessType(user);
  }

  function billingDate(value){
    const timestamp=Number(value),date=new Date(timestamp);
    return Number.isFinite(timestamp)&&timestamp>0&&!Number.isNaN(date.getTime())?date.toLocaleDateString([],{dateStyle:"medium"}):"the date Paddle shows";
  }

  async function requestJson(path,options={}){
    let response;
    try{
      response=await fetch(path,{
        ...options,
        credentials:"same-origin",
        headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}
      });
    }catch(cause){
      throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{code:"NETWORK_ERROR",cause});
    }
    const data=await response.json().catch(()=>null);
    if(!response.ok){
      throw Object.assign(new Error(data?.error||"The request could not be completed."),{status:response.status,code:data?.code||"REQUEST_FAILED"});
    }
    if(!data||typeof data!=="object")throw Object.assign(new Error("STRATA received an unexpected checkout response."),{code:"INVALID_RESPONSE"});
    return data;
  }

  function normalizedConfig(data){
    const config=data?.billing&&typeof data.billing==="object"?data.billing:data;
    return {
      enabled:config.enabled!==false&&config.configured!==false,
      environment:String(config.environment||config.mode||"live").toLowerCase(),
      clientToken:String(config.clientToken||config.client_token||config.token||""),
      productId:String(config.productId||config.product_id||config.product||""),
      priceId:String(config.priceId||config.price_id||(typeof config.price==="string"?config.price:"")||""),
      price:{
        amount:String(config.price?.amount||""),currency:String(config.price?.currency||"").toUpperCase(),
        interval:String(config.price?.interval||"").toLowerCase(),frequency:Number(config.price?.frequency)
      }
    };
  }

  function validateConfig(config){
    if(!config.enabled)throw new Error("Secure checkout is temporarily unavailable.");
    const sandbox=config.environment==="sandbox";
    if(!["live","production","sandbox"].includes(config.environment))throw new Error("Checkout has an unsupported Paddle environment.");
    if(!config.clientToken.startsWith(sandbox?"test_":"live_"))throw new Error("Checkout credentials do not match the Paddle environment.");
    if(sandbox){
      if(!/^pro_[a-z0-9]{20,}$/.test(config.productId)||!/^pri_[a-z0-9]{20,}$/.test(config.priceId)||config.productId===EXPECTED_PRODUCT_ID||config.priceId===RETIRED_ONE_TIME_PRICE_ID)throw new Error("Sandbox checkout requires its own recurring test product and price.");
    }else{
      if(config.productId!==EXPECTED_PRODUCT_ID)throw new Error("The configured Strata+ product does not match this release.");
      if(!/^pri_[a-z0-9]{20,}$/.test(config.priceId)||config.priceId===RETIRED_ONE_TIME_PRICE_ID)throw new Error("The configured Strata+ price is not the current recurring price.");
    }
    if(config.price.amount!=="0.99"||config.price.currency!=="USD"||config.price.interval!=="month"||config.price.frequency!==1)throw new Error("Checkout pricing does not match $0.99 USD per month.");
  }

  function initializePaddle(){
    if(state.paddleReady)return;
    if(!globalThis.Paddle?.Initialize||!globalThis.Paddle?.Checkout?.open)throw new Error("Secure Paddle checkout could not load. Check your connection and try again.");
    validateConfig(state.config);
    if(state.config.environment==="sandbox"){
      if(!globalThis.Paddle.Environment?.set)throw new Error("Sandbox checkout could not initialize safely.");
      globalThis.Paddle.Environment.set("sandbox");
    }
    globalThis.Paddle.Initialize({
      token:state.config.clientToken,
      // STRATA does not know a Paddle customer ID before a first subscription.
      // An empty object is Paddle's documented safe Retain value;
      // never substitute an internal user ID or email here.
      pwCustomer:{},
      eventCallback:(event)=>{void handleCheckoutEvent(event);}
    });
    state.paddleReady=true;
  }

  function renderPurchaseState(){
    const signedIn=Boolean(state.user?.id);
    const active=discoveryIsActive(state.user);
    const trial=state.user?.discovery?.trial;
    const subscription=subscriptionFor(state.user),subscriptionStatus=String(subscription?.status||"");
    const paid=paidAccessType(state.user),trialAccess=active&&state.user?.discovery?.accessType==="trial";
    const grandfathered=active&&!subscription&&["lifetime","paid"].includes(String(state.user?.discovery?.accessType||""));
    const trialEligible=signedIn&&!active&&!subscription&&trial?.eligible===true;
    const online=navigator.onLine!==false;
    const checkoutReady=Boolean(state.config&&!state.configError&&state.paddleReady&&online);
    const paused=subscriptionStatus==="paused",canceled=subscriptionStatus==="canceled";
    const canSubscribe=signedIn&&(!active||trialAccess)&&!paused;

    signupLink.hidden=signedIn;
    loginLink.hidden=signedIn;
    buyButton.hidden=!canSubscribe;
    trialButton.hidden=!trialEligible;
    openLink.hidden=!signedIn||!active;
    manageLink.hidden=!signedIn||!subscription;
    checkButton.hidden=!signedIn||paidAccessReady(state.user)||!state.awaitingAccess;
    buyButton.disabled=state.busy||state.awaitingAccess||state.checkoutOpen||!checkoutReady;
    trialButton.disabled=state.busy||navigator.onLine===false;
    checkButton.disabled=state.busy;
    buyButton.classList.toggle("button-dark",!trialEligible);
    buyButton.classList.toggle("button-light",trialEligible);
    buyButton.innerHTML=trialAccess?'Subscribe now · $0.99 USD / month <span aria-hidden="true">→</span>':canceled?'Restart Strata+ · $0.99 USD / month <span aria-hidden="true">→</span>':trialEligible?'Skip trial — subscribe · $0.99 USD / month <span aria-hidden="true">→</span>':'Subscribe · $0.99 USD / month <span aria-hidden="true">→</span>';
    panel.setAttribute("aria-busy",String(state.busy||state.awaitingAccess));

    if(state.busy&&state.awaitingAccess){setStatus("Your checkout completed. STRATA is securely confirming access…","warn");return;}
    if(state.busy){setStatus("Checking your account and secure checkout…");return;}
    if(state.awaitingAccess){setStatus("Your subscription checkout completed. Access is still being confirmed; check again before opening another checkout.","warn");return;}
    if(active){
      if(trial?.active&&!paid&&!subscription){
        const expiry=new Date(trial.expiresAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});
        setStatus(`Your free 30-minute Strata+ trial is active until ${expiry}. No card was charged, it will end automatically, and subscribing still requires your explicit approval.`,"good");
      }else if(grandfathered){
        setStatus("Your prior lifetime Strata+ purchase is grandfathered. It stays active with no monthly renewal or recurring charge.","good");
      }else if(subscription?.scheduledChange?.action==="cancel"){
        setStatus(`Your monthly subscription remains active until ${billingDate(subscription.scheduledChange.effectiveAt)}, when its cancellation takes effect. It will not renew after that date.`,"warn");
      }else if(subscription?.scheduledChange?.action==="pause"){
        setStatus(`Your monthly subscription remains active until ${billingDate(subscription.scheduledChange.effectiveAt)}, when its scheduled pause takes effect and paid access stops.`,"warn");
      }else if(subscription?.pastDue||subscriptionStatus==="past_due"){
        setStatus("Your monthly subscription is past due. Strata+ remains available for now; update your payment method from Account to avoid interruption.","warn");
      }else if(subscription){
        setStatus(`Your $0.99 USD monthly subscription is active and renews on ${billingDate(subscription.currentPeriodEndsAt)} unless canceled.`,"good");
      }else setStatus("Strata+ access is active on this account.","good");
      return;
    }
    if(!signedIn){
      const message=trialRequested
        ? "Sign in or create an account to start your one free 30-minute Strata+ trial. No card is required."
        : pageReason==="access"||pageReason==="discovery-required"
          ? "Sign in or create an account, then start the free trial or explicitly subscribe for $0.99 USD per month to continue."
          : "Create an account or sign in before starting the trial or subscribing, so access follows you across devices.";
      setStatus(message);
      return;
    }
    if(paused){setStatus("Your monthly subscription is paused and paid access is inactive. Open Account to manage it in Paddle.","warn");return;}
    if(canceled){setStatus("Your previous monthly subscription is canceled and will not renew. You can explicitly start a new subscription whenever you choose.","warn");return;}
    if(!online){setStatus("You are offline. Reconnect before starting a trial or opening secure checkout.","warn");return;}
    if(trial?.eligible){setStatus("Your account is eligible for one free 30-minute Strata+ trial. No card required and no automatic charge.");return;}
    if(state.configError){setStatus(state.configError,"error");return;}
    if(state.actionError){setStatus(state.actionError,"error");return;}
    if(state.checkoutOpen){setStatus("Secure checkout is open. Complete it with Paddle to unlock Strata+.");return;}
    if(pageReason==="access-revoked"){
      setStatus("Strata+ access is no longer active, usually because a subscription ended or a charge was refunded or reversed. You may subscribe again or contact STRATA if this is unexpected.","warn");
      return;
    }
    if(pageReason==="access"||pageReason==="discovery-required"){
      setStatus("Strata+ is $0.99 USD per month and renews monthly until canceled.");
      return;
    }
    if(trial&&trial.eligible===false) setStatus("This account has already used its free trial. Subscribe for $0.99 USD per month; it renews monthly until canceled.");
    else setStatus("Signed in and ready for secure Paddle checkout.");
  }

  async function startTrial(){
    if(state.busy)return;
    if(!state.user?.id){location.assign("/account.html?mode=login&next=pricing");return;}
    if(!state.csrfToken){setStatus("Your session needs refreshing before the trial can start.","error",{focus:true});return;}
    state.busy=true;state.actionError="";renderPurchaseState();
    try{
      const result=await requestJson("/api/discovery/trial",{method:"POST",headers:{"X-CSRF-Token":state.csrfToken},body:"{}"});
      state.user=result.user||await readAccount();
      renderPurchaseState();
      setStatus("Your free 30-minute Strata+ trial has started. No card was charged and it will end automatically.","good",{focus:true});
      signal("trial_started");
    }catch(error){
      if(error.status===401){location.assign("/account.html?mode=login&next=pricing");return;}
      state.actionError=error.message||"The trial could not be started.";
    }finally{state.busy=false;renderPurchaseState();if(state.actionError)setStatus(state.actionError,"error",{focus:true});}
  }

  async function readAccount(){
    try{
      const data=await requestJson("/api/me");
      state.user=data.user||null;
      state.csrfToken=String(data.csrfToken||data.csrf_token||data.user?.csrfToken||"");
      return state.user;
    }catch(error){
      if(error.status===401){state.user=null;state.csrfToken="";return null;}
      throw error;
    }
  }

  async function loadPageState(){
    state.busy=true;
    renderPurchaseState();
    const [accountResult,configResult]=await Promise.allSettled([
      readAccount(),
      requestJson("/api/billing/config")
    ]);

    if(accountResult.status==="rejected"){
      state.user=null;
      state.csrfToken="";
      state.configError="Your account status could not be checked. Refresh this page and try again.";
    }
    if(configResult.status==="fulfilled"){
      try{
        state.config=normalizedConfig(configResult.value);
        validateConfig(state.config);
        initializePaddle();
      }catch(error){
        state.configError=error.message;
      }
    }else{
      state.configError=configResult.reason?.message||"Secure checkout is temporarily unavailable.";
    }
    state.busy=false;
    renderPurchaseState();
  }

  function checkoutTransactionId(data){
    return String(data?.transactionId||data?.transaction_id||data?.id||"");
  }

  async function openCheckout(){
    if(state.busy||state.awaitingAccess)return;
    if(!state.user?.id){location.assign("/account.html?mode=signup&next=pricing");return;}
    const subscription=subscriptionFor(state.user),trialAccess=state.user?.discovery?.accessType==="trial";
    if((discoveryIsActive(state.user)&&!trialAccess)||subscription?.status==="paused"){renderPurchaseState();return;}
    if(!state.csrfToken){
      setStatus("Your session needs to be refreshed before checkout. Reload this page and try again.","error",{focus:true});
      return;
    }
    try{
      state.actionError="";
      state.checkoutOpen=false;
      state.busy=true;
      renderPurchaseState();
      setStatus("Preparing your secure checkout…");
      const result=await requestJson("/api/billing/checkout",{
        method:"POST",
        headers:{"X-CSRF-Token":state.csrfToken},
        body:"{}"
      });
      const transactionId=checkoutTransactionId(result);
      if(!/^txn_[a-z0-9]{26}$/.test(transactionId))throw Object.assign(new Error("STRATA could not prepare a valid checkout."),{code:"INVALID_TRANSACTION"});
      state.currentTransactionId=transactionId;
      initializePaddle();
      globalThis.Paddle.Checkout.open({
        transactionId,
        ...(state.user.email?{customer:{email:state.user.email}}:{}),
        settings:{displayMode:"overlay",variant:"one-page",theme:"light",allowLogout:false,showAddDiscounts:true}
      });
      state.checkoutOpen=true;
      signal("checkout_opened");
    }catch(error){
      if(error.status===401){location.assign("/account.html?mode=login&next=pricing");return;}
      if(error.code==="ALREADY_ENTITLED"||error.code==="DISCOVERY_ALREADY_ACTIVE"){
        await refreshAccess({focus:true});
        return;
      }
      if(error.code==="CHECKOUT_PENDING_CONFIRMATION"){
        await refreshAccess({focus:true});
        return;
      }
      if(error.code==="CHECKOUT_PREPARING"){
        state.actionError=error.message||"Another checkout is being prepared. Try again in a moment.";
        return;
      }
      const message=error.status===403
        ? "Your secure session expired. Refresh this page before trying checkout again."
        : error.message||"Secure checkout could not open. Please try again.";
      state.actionError=message;
    }finally{
      state.busy=false;
      renderPurchaseState();
      if(state.actionError)requestAnimationFrame(()=>statusNode.focus({preventScroll:false}));
    }
  }

  const wait=(milliseconds)=>new Promise((resolve)=>setTimeout(resolve,milliseconds));

  async function pollForAccess(){
    for(let attempt=0;attempt<12;attempt+=1){
      try{
        await readAccount();
        if(paidAccessReady(state.user))return true;
      }catch{
        // A temporary read failure should not turn a completed checkout into a failure.
      }
      await wait(attempt<4?1000:1800);
    }
    return false;
  }

  async function refreshAccess({focus=false}={}){
    state.busy=true;
    renderPurchaseState();
    try{
      await readAccount();
      if(paidAccessReady(state.user)){
        state.awaitingAccess=false;
        setStatus(subscriptionFor(state.user)?"Your monthly Strata+ subscription is confirmed.":"Strata+ is unlocked on this account.","good",{focus});
        signal("upgrade_activated");
      }else{
        state.awaitingAccess=true;
        setStatus("Access is still being confirmed. Wait a moment, then check again. You will not be charged twice.","warn",{focus});
      }
    }catch{
      state.awaitingAccess=true;
      setStatus("STRATA could not check access yet. Your Paddle transaction is not affected; try again shortly.","warn",{focus});
    }finally{
      state.busy=false;
      renderPurchaseState();
      if(focus)requestAnimationFrame(()=>statusNode.focus({preventScroll:false}));
    }
  }

  async function handleCheckoutEvent(event){
    if(!event||typeof event!=="object")return;
    if(event.name==="checkout.error"){
      state.busy=false;
      state.checkoutOpen=false;
      state.actionError="Paddle could not complete checkout. Review the checkout message or try again.";
      renderPurchaseState();
      requestAnimationFrame(()=>statusNode.focus({preventScroll:false}));
      return;
    }
    if(event.name==="checkout.closed"){
      state.checkoutOpen=false;
      renderPurchaseState();
      buyButton.focus({preventScroll:true});
      return;
    }
    if(event.name!=="checkout.completed")return;
    const eventTransaction=String(event.data?.transaction_id||event.data?.transactionId||"");
    if(state.currentTransactionId&&eventTransaction&&eventTransaction!==state.currentTransactionId)return;
    state.busy=true;
    state.checkoutOpen=false;
    state.actionError="";
    state.awaitingAccess=true;
    renderPurchaseState();
    setStatus("Payment completed. STRATA is securely confirming your Strata+ access…","warn",{focus:true});
    const unlocked=await pollForAccess();
    state.busy=false;
    state.awaitingAccess=!unlocked;
    renderPurchaseState();
    if(unlocked){setStatus("Subscription confirmed. Strata+ is now unlocked on this account.","good",{focus:true});signal("upgrade_activated");}
    else setStatus("Paddle completed the checkout, but access is still processing. Wait a moment, then choose Check access. Do not purchase again.","warn",{focus:true});
  }

  buyButton.addEventListener("click",()=>{void openCheckout();});
  trialButton.addEventListener("click",()=>{void startTrial();});
  checkButton.addEventListener("click",()=>{void refreshAccess({focus:true});});
  window.addEventListener("online",()=>{renderPurchaseState();});
  window.addEventListener("offline",()=>{renderPurchaseState();});

  signal("upgrade_viewed");
  void loadPageState();
})();
