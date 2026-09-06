"use strict";

const el=(id)=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const requestedMode=params.get("mode");
const mode=requestedMode==="login"?"login":"signup";
const add=params.get("add");
const queryError=params.get("error");
const authForms={signup:el("signupForm"),login:el("loginForm")};
const authMessages={signup:el("signupMessage"),login:el("loginMessage")};
const authButtons={signup:el("signupSubmit"),login:el("loginSubmit")};
const authFields={
  signup:[el("signupName"),el("signupEmail"),el("signupPassword")],
  login:[el("loginEmail"),el("loginPassword")]
};
let navigating=false;
let currentCsrfToken="";

function safeNext(raw,exerciseId){
  const addIsSafe=Boolean(exerciseId&&/^[a-z0-9-]{2,80}$/.test(exerciseId));
  if(raw==="planner"||raw==="/planner.html")return addIsSafe?`/planner.html?add=${encodeURIComponent(exerciseId)}`:"/planner.html";
  if(/^\/planner\.html\?add=[a-z0-9-]{2,80}$/.test(raw||""))return raw;
  if(raw==="pricing"||raw==="/pricing"||raw==="/pricing.html")return "/pricing";
  if(raw==="discover"||raw==="/discover.html")return "/discover.html";
  if(raw==="admin"||raw==="/admin"||raw==="/admin.html")return "/admin";
  if(raw==="workout"||raw==="/workout.html")return "/workout.html";
  if(raw==="onboarding"||raw==="/onboarding.html")return "/onboarding.html";
  return "/planner.html";
}

function verificationLocation(destination,{deliveryState="",purpose="signup"}={}){
  const query=new URLSearchParams();
  if(destination==="/pricing")query.set("next","pricing");
  else if(destination==="/discover.html")query.set("next","discover");
  else if(destination==="/admin")query.set("next","admin");
  else if(destination==="/workout.html")query.set("next","workout");
  else if(destination==="/onboarding.html")query.set("next","onboarding");
  else{
    query.set("next","planner");
    const add=new URL(destination,"https://strata.local").searchParams.get("add");
    if(add&&/^[a-z0-9-]{2,80}$/.test(add))query.set("add",add);
  }
  query.set("purpose",purpose==="login"?"login":"signup");
  if(deliveryState==="failed")query.set("delivery","failed");
  return `/verify-email.html?${query}`;
}

function rememberVerification(value,purpose="signup"){
  try{
    const masked=String(value||"").replace(/[\u0000-\u001f\u007f]/g,"").trim().slice(0,254);
    if(masked)globalThis.sessionStorage?.setItem("strata.verification.maskedEmail",masked);
    else globalThis.sessionStorage?.removeItem("strata.verification.maskedEmail");
    globalThis.sessionStorage?.setItem("strata.verification.purpose",purpose==="login"?"login":"signup");
  }catch{}
}

const next=safeNext(params.get("next"),add);
const preferredPanel=el(mode==="login"?"loginPanel":"signupPanel");
preferredPanel.classList.add("active");
if(mode==="login")document.querySelector(".auth-grid").prepend(preferredPanel);
el("signupNext").value=next;
el("loginNext").value=next;

const knownErrors=new Set([
  "Cross-origin request rejected.","Too many attempts. Try again later.",
  "Use a valid name, email, and password of 10–128 characters.",
  "An account with that email already exists.","Email or password is incorrect.",
  "This account is temporarily paused. Contact STRATA support for help.",
  "Admin ownership is secured. Sign in again to continue.","Administrator access required.",
  "Unable to complete the account request.","Account storage is temporarily unavailable. Please try again.",
  "Email verification is temporarily unavailable. Please try again later."
]);
let pendingQueryError=queryError?(knownErrors.has(queryError)?queryError:"Unable to complete the account request. Please try again."):"";
if(queryError){
  const cleanUrl=new URL(location.href);
  cleanUrl.searchParams.delete("error");
  history.replaceState({},"",`${cleanUrl.pathname}${cleanUrl.search}${cleanUrl.hash}`);
}

async function readJson(path,options={}){
  let response;
  try{
    if(typeof globalThis.fetch!=="function")throw new TypeError("Fetch is unavailable.");
    response=await globalThis.fetch(path,{...options,credentials:"same-origin",headers:{Accept:"application/json",...(options.headers||{})}});
  }catch(cause){
    throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{code:"network",cause});
  }
  const contentType=String(response.headers?.get?.("content-type")||"").toLowerCase();
  const isJson=contentType.includes("json");
  const data=isJson?await response.json().catch(()=>null):null;
  if(!response.ok)throw Object.assign(new Error(data?.error||"Request failed."),{
    status:response.status,
    code:data?.code,
    verificationRequired:data?.verificationRequired===true,
    maskedEmail:data?.maskedEmail,
    purpose:data?.purpose==="login"?"login":"signup",
    deliveryState:["sent","failed","pending"].includes(data?.deliveryState)?data.deliveryState:""
  });
  if(!data||typeof data!=="object")throw Object.assign(new Error("The account service returned an unexpected response."),{code:"invalid-response",status:502});
  return data;
}

function clearFormError(authMode){
  const message=authMessages[authMode];
  message.hidden=true;
  message.textContent="";
  authFields[authMode].forEach((field)=>field.removeAttribute("aria-invalid"));
}

function clearAllFormErrors(){
  clearFormError("signup");
  clearFormError("login");
}

function setButtonBusy(button,busy,label=""){
  if(!button)return;
  if(busy){
    button.dataset.busy="true";
    if(label)button.setAttribute("aria-label",label);
  }else{
    delete button.dataset.busy;
    button.removeAttribute("aria-label");
  }
}

function setupPasswordToggle(inputId,buttonId,description){
  const input=el(inputId),button=el(buttonId);
  if(!input||!button)return;
  button.addEventListener("click",()=>{
    const show=button.getAttribute("aria-pressed")!=="true";
    input.type=show?"text":"password";
    button.setAttribute("aria-pressed",show?"true":"false");
    button.setAttribute("aria-label",`${show?"Hide":"Show"} ${description}`);
    button.textContent=show?"Hide":"Show";
  });
}

function showFormError(authMode,message,{status,focus=false}={}){
  const node=authMessages[authMode];
  node.textContent=message;
  node.hidden=false;
  if(status===401&&authMode==="login")authFields.login.forEach((field)=>field.setAttribute("aria-invalid","true"));
  if(status===409&&authMode==="signup")el("signupEmail").setAttribute("aria-invalid","true");
  if(focus)requestAnimationFrame(()=>node.focus({preventScroll:false}));
}

function friendlyAuthError(error,authMode){
  if(knownErrors.has(error?.message))return error.message;
  const code=String(error?.code||"").toUpperCase();
  if(code==="EMAIL_VERIFICATION_UNAVAILABLE")return "Email verification is temporarily unavailable. Please try again later.";
  if(code.includes("EMAIL")&&(code.includes("PROVIDER")||code.includes("DELIVERY")||code.includes("SEND")||code.includes("VERIFICATION")))return "We could not send your verification email right now. Please try again in a moment.";
  if(error?.status===404)return "The account service is unavailable. Deploy STRATA as a Node Web Service and try again.";
  if(error?.code==="invalid-response")return "The account service is unavailable on this deployment. Please try again after the server is connected.";
  if(error?.code==="network")return "Could not reach the account service. Check your connection and try again.";
  if(Number(error?.status)>=500)return "Account storage is temporarily unavailable. Please try again.";
  return authMode==="signup"?"Could not create the account. Check the details and try again.":"Could not sign in. Check the details and try again.";
}

function showRequestedPanel(){
  if(requestedMode!=="login"&&requestedMode!=="signup")return;
  requestAnimationFrame(()=>{
    preferredPanel.scrollIntoView?.({block:"start"});
    el(`${mode}Title`).focus({preventScroll:true});
  });
}

function showAccess(sessionError=""){
  currentCsrfToken="";
  el("accountLoading").hidden=true;
  el("signedInCard").hidden=true;
  el("accountAccess").hidden=false;
  el("accountPage").setAttribute("aria-busy","false");
  const message=pendingQueryError||sessionError;
  pendingQueryError="";
  if(message)showFormError(mode,message,{focus:true});
  else showRequestedPanel();
}

function showSignedIn(user,csrfToken=""){
  currentCsrfToken=String(csrfToken||"");
  el("accountLoading").hidden=true;
  el("accountAccess").hidden=true;
  el("signedInCard").hidden=false;
  el("signedInIdentity").textContent=`${user.name} · ${user.email}`;
  el("accountAdminAction").hidden=user?.isAdmin!==true;
  const discoveryActive=user?.discovery?.active===true;
  const discoveryPending=Number(user?.discovery?.pendingPurchaseCount||0)>0;
  const discoveryAction=el("accountDiscoveryAction");
  discoveryAction.href=discoveryActive?"/discover.html":"/pricing";
  discoveryAction.textContent=discoveryActive?"Open Strata+ studio →":discoveryPending?"Check Strata+ purchase →":"Unlock Strata+ →";
  el("accountDiscoveryStatus").textContent=discoveryActive
    ?"Strata+ is unlocked on this account."
    :discoveryPending
      ?"A Strata+ checkout is pending. Open Pricing to finish checkout or check confirmation."
      :"The exercise index and weekly planner are free. Strata+ is available as a $5.99 USD one-time purchase.";
  const deletionPending=user?.accountDeletion?.pending===true;
  el("accountDeleteCancel").hidden=!deletionPending;
  if(deletionPending)showSecurityStatus("An account-deletion confirmation is pending. You can use the emailed link or cancel the request here.");
  else showSecurityStatus("");
  el("accountPage").setAttribute("aria-busy","false");
}

function renderStorageState(node,state,message){
  node.classList.remove("good","warn","bad");
  node.classList.add(state);
  node.querySelector("span").textContent=message;
}

async function updateStorageStatus(){
  const node=el("storageState");
  const [statusProbe,healthProbe]=await Promise.allSettled([readJson("/api/status"),readJson("/healthz")]);
  const persistence=statusProbe.status==="fulfilled"
    ? statusProbe.value.persistent===true?"persistent":statusProbe.value.persistent===false?"temporary":"unknown"
    : "unavailable";
  const health=healthProbe.status==="fulfilled"&&healthProbe.value.ok===true?"healthy":healthProbe.status==="fulfilled"?"unhealthy":"unavailable";
  node.dataset.persistence=persistence;
  node.dataset.health=health;

  if(persistence==="persistent"&&health==="healthy")renderStorageState(node,"good","Permanent account storage is active");
  else if(health==="healthy"&&persistence==="temporary")renderStorageState(node,"warn","Account storage is temporary; accounts may be lost when the server restarts");
  else if(health==="healthy")renderStorageState(node,"warn","Account storage is reachable, but permanent storage could not be verified");
  else if(persistence==="persistent")renderStorageState(node,"bad","Permanent storage is configured but temporarily unreachable; you can still retry");
  else if(persistence==="unavailable"&&health==="unavailable")renderStorageState(node,"warn","Could not verify account storage; you can still try creating an account");
  else renderStorageState(node,"bad","Could not verify account storage; you can still try creating an account");
}

async function initialize(){
  el("accountPage").setAttribute("aria-busy","true");
  el("accountAccess").hidden=true;
  el("signedInCard").hidden=true;
  el("accountLoading").hidden=false;
  el("accountLoadingMessage").textContent="Confirming whether you are already signed in.";
  void updateStorageStatus();
  try{
    const result=await readJson("/api/me");
    showSignedIn(result.user,result.csrfToken);
  }catch(error){
    if(error.status===401){showAccess();return;}
    showAccess("We could not verify your current session. You can still try an account request.");
  }
}

function payloadFor(authMode,form){
  const data=new FormData(form);
  const payload={email:String(data.get("email")||""),password:String(data.get("password")||"")};
  if(authMode==="signup")payload.name=String(data.get("name")||"");
  return payload;
}

function enhanceForm(authMode){
  const form=authForms[authMode],button=authButtons[authMode];
  form.addEventListener("input",clearAllFormErrors);
  form.addEventListener("submit",async(event)=>{
    event.preventDefault();
    if(navigating||form.dataset.submitting==="true")return;
    clearFormError(authMode);
    form.dataset.submitting="true";
    form.setAttribute("aria-busy","true");
    button.disabled=true;
    setButtonBusy(button,true,authMode==="signup"?"Creating account, please wait":"Signing in, please wait");
    try{
      const result=await readJson(`/api/${authMode}`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payloadFor(authMode,form))
      });
      if(result.verificationRequired===true){
        const purpose=result.purpose==="login"?"login":authMode;
        rememberVerification(result.maskedEmail,purpose);
        navigating=true;
        location.assign(verificationLocation(next,{purpose}));
        return;
      }
      if(!result.user?.id)throw Object.assign(new Error("The account service returned an unexpected response."),{code:"invalid-response",status:502});
      navigating=true;
      location.assign(next);
    }catch(error){
      if(error.verificationRequired===true){
        const purpose=error.purpose==="login"?"login":authMode;
        rememberVerification(error.maskedEmail,purpose);
        const deliveryFailed=error.deliveryState==="failed"||["EMAIL_DELIVERY_UNAVAILABLE","EMAIL_DELIVERY_FAILED"].includes(String(error.code||"").toUpperCase());
        navigating=true;
        location.assign(verificationLocation(next,{deliveryState:deliveryFailed?"failed":"",purpose}));
        return;
      }
      showFormError(authMode,friendlyAuthError(error,authMode),{status:error.status,focus:true});
    }finally{
      if(!navigating){
        delete form.dataset.submitting;
        form.removeAttribute("aria-busy");
        button.disabled=false;
        setButtonBusy(button,false);
      }
    }
  });
}

function securityError(error){
  if(error?.code==="network")return "Could not reach STRATA. Check your connection and try again.";
  if(error?.status===409)return error.message||"Finish the pending checkout before deleting this account.";
  if(error?.status===429)return "Too many account emails were requested. Please wait and try again.";
  if(error?.status===401)return "Your session expired. Sign in again before changing account security.";
  if(error?.status===403)return "The security check expired. Refresh this page and try again.";
  return Number(error?.status)>=500?"Account email is temporarily unavailable. Please try again in a moment.":error?.message||"The account request could not be completed.";
}

function showSecurityStatus(message,{error=false}={}){
  const status=el("accountSecurityStatus");
  status.textContent=message;
  status.classList.remove("bad");
  if(error)status.classList.add("bad");
}

async function requestSecurityEmail(kind,event){
  const button=event.currentTarget;
  if(button.disabled)return;
  button.disabled=true;
  setButtonBusy(button,true,kind==="delete"?"Sending deletion link, please wait":"Sending password reset link, please wait");
  showSecurityStatus(kind==="delete"?"Preparing the deletion confirmation email…":"Preparing your password-reset email…");
  try{
    const path=kind==="delete"?"/api/account/delete/request":"/api/account/password-reset/request";
    const result=await readJson(path,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":currentCsrfToken},body:"{}"});
    showSecurityStatus(kind==="delete"
      ?`A deletion confirmation link was sent to ${result.maskedEmail||"your registered email"}. Nothing is deleted until you open it and type DELETE.`
      :`A password-reset link was sent to ${result.maskedEmail||"your registered email"}. The link expires after 30 minutes.`);
    if(kind==="delete")el("accountDeleteCancel").hidden=false;
  }catch(error){
    showSecurityStatus(securityError(error),{error:true});
  }finally{button.disabled=false;setButtonBusy(button,false);}
}

el("accountPasswordReset").addEventListener("click",(event)=>{void requestSecurityEmail("password",event);});
el("accountDeleteRequest").addEventListener("click",(event)=>{void requestSecurityEmail("delete",event);});
el("accountDeleteCancel").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  button.disabled=true;
  setButtonBusy(button,true,"Canceling deletion request, please wait");
  try{
    await readJson("/api/account/delete/cancel",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":currentCsrfToken},body:"{}"});
    button.hidden=true;
    showSecurityStatus("The pending deletion request was canceled. Any link from that email can no longer be used.");
  }catch(error){showSecurityStatus(securityError(error),{error:true});}
  finally{button.disabled=false;setButtonBusy(button,false);}
});

el("accountLogout").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  button.disabled=true;
  setButtonBusy(button,true,"Signing out, please wait");
  el("signedInMessage").hidden=true;
  try{await readJson("/api/logout",{method:"POST"});location.replace("/");}
  catch(error){
    if(error.status===401){location.replace("/");return;}
    button.disabled=false;
    setButtonBusy(button,false);
    el("signedInMessage").textContent="Could not sign out. Check your connection and try again.";
    el("signedInMessage").hidden=false;
  }
});

if(typeof globalThis.fetch==="function"&&typeof globalThis.FormData==="function"){
  enhanceForm("signup");
  enhanceForm("login");
}

setupPasswordToggle("signupPassword","signupPasswordToggle","signup password");
setupPasswordToggle("loginPassword","loginPasswordToggle","sign-in password");

initialize();
