"use strict";

const el=(id)=>document.getElementById(id);
const params=new URLSearchParams(location.search);
const mode=params.get("mode")==="login"?"login":"signup";
const add=params.get("add");
const queryError=params.get("error");
const authForms={signup:el("signupForm"),login:el("loginForm")};
const authMessages={signup:el("signupMessage"),login:el("loginMessage")};
const authButtons={signup:el("signupSubmit"),login:el("loginSubmit")};
const authFields={
  signup:[el("signupName"),el("signupEmail"),el("signupPassword")],
  login:[el("loginEmail"),el("loginPassword")]
};

function safeNext(raw,exerciseId){
  const addIsSafe=Boolean(exerciseId&&/^[a-z0-9-]{2,80}$/.test(exerciseId));
  if(raw==="planner"||raw==="/planner.html")return addIsSafe?`/planner.html?add=${encodeURIComponent(exerciseId)}`:"/planner.html";
  if(/^\/planner\.html\?add=[a-z0-9-]{2,80}$/.test(raw||""))return raw;
  if(raw==="pricing"||raw==="/pricing"||raw==="/pricing.html")return "/pricing";
  if(raw==="discover"||raw==="/discover.html")return "/discover.html";
  return "/planner.html";
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
  "Unable to complete the account request.","Account storage is temporarily unavailable. Please try again."
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
  if(!response.ok)throw Object.assign(new Error(data?.error||"Request failed."),{status:response.status});
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
  if(error?.status===404)return "The account service is unavailable. Deploy STRATA as a Node Web Service and try again.";
  if(error?.code==="invalid-response")return "The account service is unavailable on this deployment. Please try again after the server is connected.";
  if(error?.code==="network")return "Could not reach the account service. Check your connection and try again.";
  if(Number(error?.status)>=500)return "Account storage is temporarily unavailable. Please try again.";
  return authMode==="signup"?"Could not create the account. Check the details and try again.":"Could not sign in. Check the details and try again.";
}

function showRequestedPanel(){
  if(mode!=="login")return;
  const compact=globalThis.matchMedia?.("(max-width: 720px)").matches;
  if(!compact)return;
  requestAnimationFrame(()=>el("loginTitle").focus({preventScroll:false}));
}

function showAccess(sessionError=""){
  el("accountLoading").hidden=true;
  el("signedInCard").hidden=true;
  el("accountAccess").hidden=false;
  el("accountPage").setAttribute("aria-busy","false");
  const message=pendingQueryError||sessionError;
  pendingQueryError="";
  if(message)showFormError(mode,message,{focus:true});
  else showRequestedPanel();
}

function showSignedIn(user){
  el("accountLoading").hidden=true;
  el("accountAccess").hidden=true;
  el("signedInCard").hidden=false;
  el("signedInIdentity").textContent=`${user.name} · ${user.email}`;
  const discoveryActive=user?.discovery?.active===true;
  const discoveryPending=Number(user?.discovery?.pendingPurchaseCount||0)>0;
  const discoveryAction=el("accountDiscoveryAction");
  discoveryAction.href=discoveryActive?"/discover.html":"/pricing";
  discoveryAction.textContent=discoveryActive?"Open Discovery studio →":discoveryPending?"Check Discovery purchase →":"Unlock Discovery →";
  el("accountDiscoveryStatus").textContent=discoveryActive
    ?"Discovery is unlocked on this account."
    :discoveryPending
      ?"A Discovery checkout is pending. Open Pricing to finish checkout or check confirmation."
      :"The exercise index and weekly planner are free. Discovery is available as a $5.99 USD one-time purchase.";
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
  el("accountRetry").hidden=true;
  el("accountLoadingMessage").textContent="Confirming whether you are already signed in.";
  void updateStorageStatus();
  try{
    const result=await readJson("/api/me");
    showSignedIn(result.user);
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
    if(form.dataset.submitting==="true")return;
    clearFormError(authMode);
    form.dataset.submitting="true";
    form.setAttribute("aria-busy","true");
    button.disabled=true;
    try{
      const result=await readJson(`/api/${authMode}`,{
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body:JSON.stringify(payloadFor(authMode,form))
      });
      if(!result.user?.id)throw Object.assign(new Error("The account service returned an unexpected response."),{code:"invalid-response",status:502});
      location.assign(next);
    }catch(error){
      showFormError(authMode,friendlyAuthError(error,authMode),{status:error.status,focus:true});
    }finally{
      delete form.dataset.submitting;
      form.removeAttribute("aria-busy");
      button.disabled=false;
    }
  });
}

el("accountRetry").addEventListener("click",()=>{void initialize();});
el("accountLogout").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  button.disabled=true;
  el("signedInMessage").hidden=true;
  try{await readJson("/api/logout",{method:"POST"});location.replace("/");}
  catch(error){
    if(error.status===401){location.replace("/");return;}
    button.disabled=false;
    el("signedInMessage").textContent="Could not sign out. Check your connection and try again.";
    el("signedInMessage").hidden=false;
  }
});

if(typeof globalThis.fetch==="function"&&typeof globalThis.FormData==="function"){
  enhanceForm("signup");
  enhanceForm("login");
}

initialize();
