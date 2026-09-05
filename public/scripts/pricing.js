"use strict";

(() => {
  const EXPECTED_PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";
  const EXPECTED_PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
  const el=(id)=>document.getElementById(id);
  const panel=el("purchasePanel");
  const statusNode=el("purchaseStatus");
  const signupLink=el("purchaseSignup");
  const loginLink=el("purchaseLogin");
  const trialButton=el("trialDiscovery");
  const buyButton=el("buyDiscovery");
  const openLink=el("openDiscovery");
  const checkButton=el("checkAccess");
  const pageReason=new URLSearchParams(location.search).get("reason");
  const trialRequested=new URLSearchParams(location.search).get("trial")==="1";

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
    statusNode.textContent=message;
    statusNode.classList.toggle("purchase-status-good",tone==="good");
    statusNode.classList.toggle("purchase-status-warn",tone==="warn");
    statusNode.classList.toggle("purchase-status-error",tone==="error");
    if(focus)requestAnimationFrame(()=>statusNode.focus({preventScroll:false}));
  }

  function discoveryIsActive(user){
    return user?.discovery?.active===true;
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
      priceId:String(config.priceId||config.price_id||config.price||"")
    };
  }

  function validateConfig(config){
    if(!config.enabled)throw new Error("Secure checkout is temporarily unavailable.");
    if(!config.clientToken.startsWith("live_"))throw new Error("Live checkout is not configured correctly.");
    if(config.environment!=="live"&&config.environment!=="production")throw new Error("Checkout is not configured for the live Paddle environment.");
    if(config.productId!==EXPECTED_PRODUCT_ID)throw new Error("The configured Strata+ product does not match this release.");
    if(config.priceId!==EXPECTED_PRICE_ID)throw new Error("The configured Strata+ price does not match $5.99 live access.");
  }

  function initializePaddle(){
    if(state.paddleReady)return;
    if(!globalThis.Paddle?.Initialize||!globalThis.Paddle?.Checkout?.open)throw new Error("Secure Paddle checkout could not load. Check your connection and try again.");
    validateConfig(state.config);
    globalThis.Paddle.Initialize({
      token:state.config.clientToken,
      // STRATA does not know a Paddle customer ID before a first one-time
      // purchase. An empty object is Paddle's documented safe Retain value;
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
    const paid=state.user?.discovery?.accessType==="paid";
    const trialEligible=signedIn&&!active&&trial?.eligible===true;
    const online=navigator.onLine!==false;
    const checkoutReady=Boolean(state.config&&!state.configError&&state.paddleReady&&online);

    signupLink.hidden=signedIn;
    loginLink.hidden=signedIn;
    buyButton.hidden=!signedIn||active;
    trialButton.hidden=!trialEligible;
    openLink.hidden=!signedIn||!active;
    checkButton.hidden=!signedIn||active||!state.awaitingAccess;
    buyButton.disabled=state.busy||state.awaitingAccess||state.checkoutOpen||!checkoutReady;
    trialButton.disabled=state.busy||navigator.onLine===false;
    checkButton.disabled=state.busy;
    buyButton.classList.toggle("button-dark",!trialEligible);
    buyButton.classList.toggle("button-light",trialEligible);
    buyButton.innerHTML=trialEligible?'Skip trial — buy now · $5.99 USD <span aria-hidden="true">→</span>':'Buy Strata+ · $5.99 USD <span aria-hidden="true">→</span>';
    panel.setAttribute("aria-busy",String(state.busy||state.awaitingAccess));

    if(state.busy&&state.awaitingAccess){setStatus("Your checkout completed. STRATA is securely confirming access…","warn");return;}
    if(state.busy){setStatus("Checking your account and secure checkout…");return;}
    if(active){
      if(trial?.active&&!paid){
        const expiry=new Date(trial.expiresAt).toLocaleString([], {dateStyle:"medium",timeStyle:"short"});
        setStatus(`Your Strata+ trial is active until ${expiry}. No card was charged and it will not renew automatically.`,"good");
      }else setStatus("Strata+ is unlocked on this account with no recurring subscription.","good");
      return;
    }
    if(!signedIn){
      const message=trialRequested
        ? "Sign in or create an account to start your one-time 10-day Strata+ trial. No card is required."
        : pageReason==="access"||pageReason==="discovery-required"
          ? "Sign in or create an account, then start a trial or purchase Strata+ to continue."
          : "Create an account or sign in before starting a trial or purchasing, so access follows you across devices.";
      setStatus(message);
      return;
    }
    if(!online){setStatus("You are offline. Reconnect before starting a trial or opening secure checkout.","warn");return;}
    if(trial?.eligible){setStatus("Your account is eligible for one free 10-day Strata+ trial. No card required and no automatic charge.");return;}
    if(state.configError){setStatus(state.configError,"error");return;}
    if(state.actionError){setStatus(state.actionError,"error");return;}
    if(state.awaitingAccess){setStatus("Your checkout completed. STRATA is securely confirming access…","warn");return;}
    if(state.checkoutOpen){setStatus("Secure checkout is open. Complete it with Paddle to unlock Strata+.");return;}
    if(pageReason==="access-revoked"){
      setStatus("Strata+ access is no longer active, usually because its purchase was refunded or reversed. You may purchase again or contact STRATA if this is unexpected.","warn");
      return;
    }
    if(pageReason==="access"||pageReason==="discovery-required"){
      setStatus("Strata+ requires a $5.99 USD one-time purchase on this account.");
      return;
    }
    if(trial&&trial.eligible===false) setStatus("This account has already used its free trial. One-time Strata+ access is available for $5.99 USD.");
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
      setStatus("Your 10-day Strata+ trial has started. No card was charged and it will end automatically.","good",{focus:true});
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
    if(discoveryIsActive(state.user)){renderPurchaseState();return;}
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
        if(discoveryIsActive(state.user))return true;
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
      if(discoveryIsActive(state.user)){
        state.awaitingAccess=false;
        setStatus("Strata+ is unlocked on this account.","good",{focus});
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
    if(unlocked)setStatus("Purchase confirmed. Strata+ is now unlocked on this account.","good",{focus:true});
    else setStatus("Paddle completed the checkout, but access is still processing. Wait a moment, then choose Check access. Do not purchase again.","warn",{focus:true});
  }

  buyButton.addEventListener("click",()=>{void openCheckout();});
  trialButton.addEventListener("click",()=>{void startTrial();});
  checkButton.addEventListener("click",()=>{void refreshAccess({focus:true});});
  window.addEventListener("online",()=>{renderPurchaseState();});
  window.addEventListener("offline",()=>{renderPurchaseState();});

  void loadPageState();
})();
