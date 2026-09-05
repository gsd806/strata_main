"use strict";

const el=(id)=>document.getElementById(id);
const USER_LIMIT=20;
const SUPPORT_LIMIT=20;
const SECTION_NAMES=new Set(["overview","people","support","activity"]);
const SUPPORT_STATES=new Set(["new","open","waiting","resolved"]);
const state={
  admin:null,
  csrfToken:"",
  elevated:false,
  elevatedUntil:0,
  activeSection:"overview",
  loaded:new Set(),
  users:{query:"",offset:0,total:0,items:[],request:0},
  support:{status:"",offset:0,total:0,items:[],request:0},
  selectedUser:null,
  selectedTicket:null,
  pendingAction:null,
  actionTrigger:null,
  userDialogTrigger:null,
  supportDialogTrigger:null
};
let elevationTimer;

function create(tag,className="",text="") {
  const node=document.createElement(tag);
  if(className)node.className=className;
  if(text!=="")node.textContent=String(text);
  return node;
}

function cleanString(value,fallback="—") {
  const result=String(value??"").replace(/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,"").trim();
  return result||fallback;
}

function firstValue(source,keys,fallback=undefined) {
  for(const key of keys)if(source&&source[key]!==undefined&&source[key]!==null)return source[key];
  return fallback;
}

function numberValue(value,fallback=0) {
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?parsed:fallback;
}

function booleanValue(source,keys) {
  const value=firstValue(source,keys,undefined);
  if(value===undefined)return undefined;
  return value===true||value===1||value==="true"||value==="active"||value==="enabled"||value==="configured";
}

function formatCount(value) {
  const parsed=Number(value);
  return Number.isFinite(parsed)&&parsed>=0?Math.round(parsed).toLocaleString():"—";
}

function formatDate(value) {
  if(value===undefined||value===null||value==="")return "—";
  const numeric=Number(value);
  const date=new Date(Number.isFinite(numeric)&&numeric>0&&numeric<1e12?numeric*1000:value);
  if(Number.isNaN(date.getTime()))return cleanString(value);
  return new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date);
}

function friendlyError(error) {
  if(error?.code==="network")return "Could not reach STRATA. Check the connection and try again.";
  if(error?.status===401)return "Your session expired. Sign in again to continue.";
  if(error?.status===403)return "This verified account does not have administrator access.";
  if(error?.code==="SUPPORT_STATE_CHANGED"||error?.code==="SUPPORT_VERSION_REQUIRED")return "This help request changed. Close it, refresh the help desk, and try again.";
  if(error?.code==="SUPPORT_RESPONSE_DELIVERY_FAILED")return "The workflow was saved, but the email response was not sent. Refresh the request and try the response again.";
  if(error?.status===429)return "Too many requests were made. Wait a moment and try again.";
  if(Number(error?.status)>=500)return "The administration service is temporarily unavailable. Try again shortly.";
  return cleanString(error?.message,"The request could not be completed.");
}

async function api(path,options={}) {
  const method=String(options.method||"GET").toUpperCase();
  const headers={Accept:"application/json",...(options.body!==undefined?{"Content-Type":"application/json"}:{}),...(options.headers||{})};
  if(!["GET","HEAD"].includes(method)&&state.csrfToken)headers["X-CSRF-Token"]=state.csrfToken;
  let response;
  try{
    response=await fetch(path,{...options,method,headers,credentials:"same-origin"});
  }catch(cause){
    throw Object.assign(new Error("Network request failed."),{code:"network",cause});
  }
  const type=String(response.headers.get("content-type")||"").toLowerCase();
  const data=type.includes("json")?await response.json().catch(()=>null):null;
  if(!response.ok){
    throw Object.assign(new Error(data?.error||`Request failed with status ${response.status}.`),{status:response.status,code:data?.code,data});
  }
  return data&&typeof data==="object"?data:{};
}

function setBusy(node,busy) {
  node?.setAttribute("aria-busy",busy?"true":"false");
}

function setSectionStatus(id,message,{error=false}={}) {
  const node=el(id);
  node.textContent=message;
  node.classList.toggle("error",error);
}

let globalMessageTimer;
function showGlobal(message,{error=false,warn=false,focus=false,persist=false}={}) {
  const node=el("globalMessage");
  clearTimeout(globalMessageTimer);
  node.textContent=message;
  node.classList.toggle("error",error);
  node.classList.toggle("warn",warn&&!error);
  node.hidden=!message;
  if(message&&focus)requestAnimationFrame(()=>node.focus({preventScroll:false}));
  if(message&&!persist&&!error&&!focus)globalMessageTimer=setTimeout(()=>{node.hidden=true;},7000);
}

function setLastUpdated() {
  el("lastUpdated").textContent=`Last refreshed ${new Intl.DateTimeFormat(undefined,{hour:"numeric",minute:"2-digit",second:"2-digit"}).format(new Date())}`;
}

function clearAdminData() {
  if(elevationTimer){clearTimeout(elevationTimer);elevationTimer=undefined;}
  state.elevatedUntil=0;
  state.loaded.clear();
  state.users.items=[];state.users.total=0;state.users.offset=0;
  state.support.items=[];state.support.total=0;state.support.offset=0;
  state.selectedUser=null;state.selectedTicket=null;state.pendingAction=null;
  state.actionTrigger=null;state.userDialogTrigger=null;state.supportDialogTrigger=null;
  for(const dialog of document.querySelectorAll("dialog[open]"))dialog.close();
  syncDialogLock();
  el("userResults").replaceChildren();el("supportResults").replaceChildren();el("auditResults").replaceChildren();
  el("userFacts").replaceChildren();el("supportFacts").replaceChildren();
  el("ticketMessage").textContent="";el("ticketNote").value="";el("ticketResponse").value="";
  el("actionReason").value="";el("actionConfirmation").value="";
  for(const id of ["totalUsersStat","verifiedUsersStat","discoveryUsersStat","openSupportStat","suspendedUsersStat","activeSessionsStat","pendingPaymentsStat","pendingDeletionsStat"])el(id).textContent="—";
}

function showAccess(message,{signedOut=false,focus=false}={}) {
  clearAdminData();
  state.admin=null;
  state.csrfToken="";
  state.elevated=false;
  document.body.classList.remove("admin-ready");
  el("dashboard").hidden=true;
  el("elevationPanel").hidden=true;
  el("accessPanel").hidden=false;
  el("adminIdentity").textContent=signedOut?"No administrator session":"Access unavailable";
  el("lastUpdated").textContent="Private data is locked.";
  el("accessTitle").textContent=signedOut?"SIGN IN REQUIRED.":"ADMIN ACCESS REQUIRED.";
  el("accessMessage").textContent=message;
  el("accessActions").hidden=false;
  el("adminMain").setAttribute("aria-busy","false");
  if(focus)requestAnimationFrame(()=>el("accessTitle").focus({preventScroll:false}));
}

function showElevation(message="Enter your current STRATA password to unlock private administration.") {
  clearAdminData();
  state.elevated=false;
  document.body.classList.remove("admin-ready");
  el("dashboard").hidden=true;
  el("accessPanel").hidden=true;
  el("elevationPanel").hidden=false;
  el("elevationMessage").hidden=true;
  el("elevationMessage").textContent="";
  el("elevationPassword").value="";
  el("adminMain").setAttribute("aria-busy","false");
  el("lastUpdated").textContent=message;
  requestAnimationFrame(()=>el("elevationTitle").focus({preventScroll:false}));
}

function handleAuthorizationFailure(error) {
  const code=String(error?.code||"").toUpperCase();
  if(error?.status===428||code==="ADMIN_ELEVATION_REQUIRED"){
    showElevation("Administrator confirmation expired. Confirm your password again to continue.");
    return true;
  }
  if(code==="ADMIN_RELOGIN_REQUIRED"||code==="ADMIN_SESSION_CHANGED"){
    showAccess("Administrator ownership was secured or your session changed. Sign in again to continue.",{signedOut:true,focus:true});
    return true;
  }
  if(error?.status===401){showAccess("Your private session ended. Sign in with the verified administrator account to continue.",{signedOut:true,focus:true});return true;}
  if(error?.status===403){showAccess("This account is signed in, but it is not an approved STRATA administrator.",{focus:true});return true;}
  return false;
}

function normalizedOverview(data) {
  return data?.overview||data?.stats||data||{};
}

function overviewNumber(source,keys) {
  const value=firstValue(source,keys,undefined);
  return value===undefined?"—":formatCount(value);
}

function setService(nodeId,message,stateName="warn") {
  const node=el(nodeId);
  node.textContent=message;
  const row=node.closest("li");
  row.classList.remove("good","warn","bad");
  row.classList.add(stateName);
}

function renderSystemStatus(data) {
  const stats=normalizedOverview(data);
  const system=data?.system||data?.health||data?.status||stats?.services||stats?.system||{};
  const storage=firstValue(system,["storage","storageKind"],firstValue(data,["storage"],"unknown"));
  const persistent=booleanValue(system,["persistent","storagePersistent"])??booleanValue(data,["persistent"]);
  if(persistent===true)setService("storageStatus",`${cleanString(storage,"Persistent")} · persistent`,"good");
  else if(persistent===false)setService("storageStatus",`${cleanString(storage,"Storage")} · not persistent`,"bad");
  else setService("storageStatus",cleanString(storage,"Status unavailable"),"warn");

  const email=booleanValue(system,["email","emailConfigured","emailVerificationConfigured","emailReady"])??booleanValue(data,["emailConfigured","emailVerificationConfigured"]);
  setService("emailStatus",email===true?"Configured":email===false?"Not configured":"Status unavailable",email===true?"good":email===false?"bad":"warn");

  const payments=booleanValue(system,["checkout","paymentsConfigured","checkoutEnabled","paymentsReady"])??booleanValue(data,["paymentsConfigured","checkoutEnabled"]);
  setService("paymentStatus",payments===true?"Live checkout configured":payments===false?"Checkout unavailable":"Status unavailable",payments===true?"good":payments===false?"bad":"warn");

  const webhook=booleanValue(system,["webhookProtection","webhookIpAllowlist","webhookProtected"])??booleanValue(data,["webhookIpAllowlist"]);
  setService("webhookStatus",webhook===true?"Source allowlist enabled":webhook===false?"IP allowlist disabled":"Status unavailable",webhook===true?"good":webhook===false?"warn":"warn");
}

async function loadOverview() {
  const button=el("refreshOverview");
  button.disabled=true;
  setSectionStatus("overviewStatus","Loading current account and service totals…");
  try{
    const data=await api("/api/admin/overview");
    if(!state.elevated)return;
    const stats=normalizedOverview(data);
    const accounts=stats.accounts||stats;
    const discovery=stats.discovery||stats;
    const support=stats.support||stats;
    el("totalUsersStat").textContent=overviewNumber(accounts,["total","totalUsers","total_users","users"]);
    el("verifiedUsersStat").textContent=overviewNumber(accounts,["verified","verifiedUsers","verified_users"]);
    el("discoveryUsersStat").textContent=overviewNumber(discovery,["activeUsers","active_users","discoveryUsers","discovery_users","activeDiscoveryUsers","discoveryActive"]);
    el("openSupportStat").textContent=overviewNumber(support,["open","openSupport","open_support","openTickets","supportOpen"]);
    el("suspendedUsersStat").textContent=overviewNumber(accounts,["suspended","suspendedUsers","suspended_users"]);
    el("activeSessionsStat").textContent=overviewNumber(accounts,["activeSessions","active_sessions"]);
    el("pendingPaymentsStat").textContent=overviewNumber(discovery,["pendingPayments","pending_payments"]);
    el("pendingDeletionsStat").textContent=overviewNumber(support,["pendingDeletions","pending_deletions"]);
    const total=numberValue(firstValue(accounts,["total","totalUsers","total_users","users"],0));
    const verified=numberValue(firstValue(accounts,["verified","verifiedUsers","verified_users"],0));
    el("verifiedUsersNote").textContent=total>0?`${Math.round((verified/total)*100)}% of registered accounts`:"Confirmed accounts";
    renderSystemStatus(data);
    state.loaded.add("overview");
    setLastUpdated();
    setSectionStatus("overviewStatus","Overview is current.");
  }catch(error){
    if(!handleAuthorizationFailure(error))setSectionStatus("overviewStatus",friendlyError(error),{error:true});
  }finally{button.disabled=false;}
}

function userId(user) {
  return cleanString(firstValue(user,["id","userId","user_id"],""),"");
}

function userEmail(user) {
  return cleanString(firstValue(user,["email","accountEmail","account_email"],""),"Email unavailable");
}

function userName(user) {
  return cleanString(firstValue(user,["name","displayName","display_name"],""),"Unnamed account");
}

function userVerified(user) {
  const explicit=booleanValue(user,["verified","emailVerified","email_verified"]);
  return explicit??Boolean(firstValue(user,["verifiedAt","emailVerifiedAt","email_verified_at"],null));
}

function userSuspended(user) {
  const explicit=booleanValue(user,["suspended","isSuspended","is_suspended"]);
  return explicit??(Boolean(firstValue(user,["suspendedAt","suspended_at"],null))||String(user?.status||"").toLowerCase()==="suspended");
}

function discoveryActive(user) {
  const discovery=user?.discovery||{};
  return booleanValue(discovery,["active","hasAccess"])??booleanValue(user,["discoveryActive","discovery_active","hasDiscovery"])??(numberValue(firstValue(user,["activePurchaseCount","active_purchase_count"],0))>0);
}

function deletionPending(user) {
  const deletion=user?.accountDeletion||user?.deletion||{};
  return booleanValue(deletion,["pending","active"])??booleanValue(user,["deletionPending","deletion_pending"])??Boolean(firstValue(user,["deletionExpiresAt","deletion_expires_at","deletionRequestId","deletion_request_id"],null));
}

function appendBadge(parent,label,tone="") {
  const badge=create("span",`badge${tone?` ${tone}`:""}`,label);
  parent.append(badge);
}

function renderUsers(items,total) {
  const list=el("userResults");
  list.replaceChildren();
  for(const user of items){
    const item=create("li","record-card");
    const button=create("button");
    button.type="button";
    button.setAttribute("aria-label",`Open ${userName(user)}, ${userEmail(user)}`);
    const primary=create("div","record-primary");
    primary.append(create("span","",userId(user)||"Account"),create("strong","",userName(user)),create("p","",userEmail(user)));
    const meta=create("div","record-meta");
    appendBadge(meta,userVerified(user)?"Verified":"Unverified",userVerified(user)?"good":"warn");
    appendBadge(meta,discoveryActive(user)?"Strata+":"Free",discoveryActive(user)?"good":"");
    if(deletionPending(user))appendBadge(meta,"Deletion pending","bad");
    if(userSuspended(user))appendBadge(meta,"Suspended","bad");
    primary.append(meta);
    button.append(primary,create("span","record-arrow","→"));
    button.addEventListener("click",()=>openUserDialog(user,button));
    item.append(button);list.append(item);
  }
  const start=items.length?state.users.offset+1:0;
  const end=state.users.offset+items.length;
  el("userResultCount").textContent=total?`Showing ${start}–${end} of ${total} accounts.`:"No matching accounts.";
  el("userEmpty").hidden=items.length!==0;
  el("previousUsers").disabled=state.users.offset===0;
  el("nextUsers").disabled=end>=total||items.length===0;
}

async function loadUsers() {
  const request=++state.users.request;
  const params=new URLSearchParams({limit:String(USER_LIMIT),offset:String(state.users.offset)});
  if(state.users.query)params.set("q",state.users.query);
  setBusy(el("userResults"),true);
  setSectionStatus("usersStatus","Loading accounts…");
  el("userSearchButton").disabled=true;
  try{
    const data=await api(`/api/admin/users?${params}`);
    if(request!==state.users.request||!state.elevated)return;
    const items=Array.isArray(data.users)?data.users:Array.isArray(data.items)?data.items:[];
    const total=numberValue(firstValue(data,["total","totalUsers","count"],items.length),items.length);
    state.users.items=items;
    state.users.total=Math.max(total,state.users.offset+items.length);
    renderUsers(items,state.users.total);
    state.loaded.add("people");
    setLastUpdated();
    setSectionStatus("usersStatus",items.length?"Select an account to inspect it and open audited controls.":"");
  }catch(error){
    if(request!==state.users.request)return;
    if(!handleAuthorizationFailure(error))setSectionStatus("usersStatus",friendlyError(error),{error:true});
  }finally{
    if(request===state.users.request){setBusy(el("userResults"),false);el("userSearchButton").disabled=false;}
  }
}

function addFact(container,label,value) {
  const wrapper=create("div");
  wrapper.append(create("dt","",label),create("dd","",cleanString(value)));
  container.append(wrapper);
}

function planSummary(user) {
  const exercises=firstValue(user,["planCount","plan_count","exerciseCount"],undefined);
  const days=firstValue(user,["workoutDays","workout_days"],undefined);
  if(exercises===undefined&&days===undefined)return "—";
  return `${formatCount(exercises??0)} exercises · ${formatCount(days??0)} workout days`;
}

function setActionAvailability(user,{actionsReady=true}={}) {
  const suspended=userSuspended(user);
  const isSelf=userId(user)&&userId(user)===userId(state.admin||{});
  for(const button of document.querySelectorAll("[data-user-action]")){
    const action=button.dataset.userAction;
    let disabled=false;
    let title="";
    if(action==="cancel-deletion"&&!deletionPending(user)){disabled=true;title="There is no active deletion request.";}
    if(action==="suspend"&&suspended){disabled=true;title="This account is already suspended.";}
    if(action==="restore"&&!suspended){disabled=true;title="This account is not suspended.";}
    if(isSelf){disabled=true;title="Use Account Security for the sole administrator account.";}
    if(!actionsReady){disabled=true;title="Full account details are still loading.";}
    button.disabled=disabled;
    button.title=title;
  }
}

function renderUserDetails(user,{actionsReady=true}={}) {
  state.selectedUser=user;
  el("userDialogTitle").textContent=userName(user);
  el("userDialogEmail").textContent=userEmail(user);
  const facts=el("userFacts");facts.replaceChildren();
  addFact(facts,"User ID",userId(user));
  addFact(facts,"Joined",formatDate(firstValue(user,["createdAt","created_at","joinedAt"])));
  addFact(facts,"Email status",userVerified(user)?"Verified":"Unverified");
  addFact(facts,"Account status",userSuspended(user)?"Suspended":"Active");
  addFact(facts,"Strata+",discoveryActive(user)?"Unlocked":"Not unlocked");
  addFact(facts,"Purchase records",`${formatCount(firstValue(user?.discovery||{},["purchaseCount","purchase_count"],0))} total · ${formatCount(firstValue(user?.discovery||{},["pendingPurchaseCount","pending_purchase_count"],0))} pending`);
  addFact(facts,"Latest purchase activity",formatDate(firstValue(user?.discovery||{},["latestPurchaseAt","latest_purchase_at"],null)));
  addFact(facts,"Weekly plan",planSummary(user));
  addFact(facts,"Ratings",formatCount(firstValue(user,["ratingCount","rating_count","ratings"],0)));
  addFact(facts,"Active sessions",formatCount(firstValue(user,["activeSessions","activeSessionCount","active_session_count","sessions"],0)));
  addFact(facts,"Deletion request",deletionPending(user)?"Pending confirmation":"None");
  setActionAvailability(user,{actionsReady});
}

async function openUserDialog(user,trigger) {
  state.userDialogTrigger=trigger;
  renderUserDetails(user,{actionsReady:false});
  el("userDetailStatus").textContent="Loading full account details…";
  el("userDetailStatus").classList.remove("error");
  const dialog=el("userDialog");setBusy(dialog,true);dialog.showModal();syncDialogLock();
  requestAnimationFrame(()=>el("userDialogTitle").focus?.({preventScroll:true}));
  const targetId=userId(user);
  try{
    const result=await api(`/api/admin/users/${encodeURIComponent(targetId)}`);
    if(!state.elevated||!dialog.open||userId(state.selectedUser)!==targetId)return;
    if(!result.user)throw new Error("Full account details were not returned.");
    renderUserDetails(result.user,{actionsReady:true});
    el("userDetailStatus").textContent="Account details are current.";
    el("userDetailStatus").classList.remove("error");
  }catch(error){
    if(!handleAuthorizationFailure(error)&&dialog.open){
      setActionAvailability(state.selectedUser||user,{actionsReady:false});
      el("userDetailStatus").textContent=`Account actions remain locked. ${friendlyError(error)}`;
      el("userDetailStatus").classList.add("error");
    }
  }finally{
    setBusy(dialog,false);
  }
}

const actionDetails={
  "send-password-reset":{title:"SEND PASSWORD RESET?",phrase:"SEND RESET",description:"A single-use password-reset link will be emailed to the account’s registered address. The link itself will not be shown here."},
  "send-delete-link":{title:"SEND DELETION LINK?",phrase:"",description:"A deletion-confirmation link will be emailed to the registered address. Opening the link alone does not delete the account."},
  "cancel-deletion":{title:"CANCEL DELETION?",phrase:"CANCEL",description:"The pending deletion request will be revoked and its emailed link will stop working."},
  "revoke-sessions":{title:"REVOKE ALL SESSIONS?",phrase:"REVOKE",description:"Every active session for this account will be signed out. The account owner can sign in again with the current password."},
  suspend:{title:"SUSPEND ACCOUNT?",phrase:"SUSPEND",description:"The account will lose signed-in access until an administrator restores it. Existing payment records must remain intact."},
  restore:{title:"RESTORE ACCOUNT?",phrase:"RESTORE",description:"Signed-in access will be restored. This does not create or change Strata+ payment entitlement."}
};

function openActionConfirmation(action,trigger) {
  const details=actionDetails[action];
  if(!details||!state.selectedUser)return;
  state.pendingAction=action;
  state.actionTrigger=trigger;
  const phrase=action==="send-delete-link"?userEmail(state.selectedUser):details.phrase;
  el("confirmTitle").textContent=details.title;
  el("confirmDescription").textContent=`${details.description} Target: ${userEmail(state.selectedUser)}.`;
  el("confirmationPhrase").textContent=phrase;
  el("actionReason").value="";
  el("actionConfirmation").value="";
  el("actionConfirmation").setAttribute("autocapitalize",action==="send-delete-link"?"none":"characters");
  el("actionConfirmation").inputMode=action==="send-delete-link"?"email":"text";
  el("confirmMessage").hidden=true;
  el("confirmMessage").textContent="";
  el("confirmDialog").showModal();syncDialogLock();
  requestAnimationFrame(()=>el("cancelAction").focus());
}

function closeDialog(dialog,returnFocus) {
  if(dialog.open)dialog.close();
  syncDialogLock();
  if(returnFocus&&document.contains(returnFocus))requestAnimationFrame(()=>returnFocus.focus());
}

function syncDialogLock() {
  document.body.classList.toggle("dialog-open",Boolean(document.querySelector("dialog[open]")));
}

async function submitUserAction(event) {
  event.preventDefault();
  const user=state.selectedUser;
  const action=state.pendingAction;
  const details=actionDetails[action];
  if(!user||!details)return;
  const reason=el("actionReason").value.trim();
  const confirmation=el("actionConfirmation").value.trim();
  const expected=action==="send-delete-link"?userEmail(user):details.phrase;
  const message=el("confirmMessage");
  if(reason.length<4){message.textContent="Enter a brief reason for the audit log.";message.className="dialog-message error";message.hidden=false;message.focus();return;}
  if(confirmation!==expected){message.textContent=`Type ${expected} exactly to continue.`;message.className="dialog-message error";message.hidden=false;message.focus();return;}
  const button=el("submitAction");button.disabled=true;
  message.textContent="Applying the audited account action…";message.className="dialog-message";message.hidden=false;
  try{
    const result=await api(`/api/admin/users/${encodeURIComponent(userId(user))}/actions`,{method:"POST",body:JSON.stringify({action,reason,confirmation})});
    closeDialog(el("confirmDialog"));
    closeDialog(el("userDialog"));
    showGlobal(cleanString(result.message,"The account action was completed and recorded."),{focus:true});
    state.loaded.delete("overview");state.loaded.delete("activity");
    await Promise.all([loadUsers(),loadOverview()]);
  }catch(error){
    if(!handleAuthorizationFailure(error)){message.textContent=friendlyError(error);message.className="dialog-message error";message.hidden=false;message.focus();}
  }finally{button.disabled=false;}
}

function supportId(ticket) {
  return cleanString(firstValue(ticket,["id","ticketId","ticket_id","reference"],""),"");
}

function supportReference(ticket) {
  return cleanString(firstValue(ticket,["reference","publicReference","public_reference","id"],""),"Help request");
}

function supportState(ticket) {
  const value=String(firstValue(ticket,["status","state"],"new")).toLowerCase().replace(/[_\s]+/g,"-");
  return value==="waiting-on-user"?"waiting":SUPPORT_STATES.has(value)?value:"new";
}

function supportStateLabel(value) {
  return ({new:"New",open:"Open",waiting:"Waiting on user",resolved:"Resolved"})[value]||"New";
}

function renderSupport(items,total) {
  const list=el("supportResults");list.replaceChildren();
  for(const ticket of items){
    const item=create("li","record-card");
    const button=create("button");button.type="button";
    const reference=supportReference(ticket);
    const subject=cleanString(firstValue(ticket,["subject","title"],""),"Support request");
    const email=cleanString(firstValue(ticket,["email","replyEmail","reply_email"],""),"Email unavailable");
    button.setAttribute("aria-label",`Open ${reference}: ${subject}`);
    const primary=create("div","record-primary");
    primary.append(create("span","",`${reference} · ${cleanString(firstValue(ticket,["category","type"],"General"))}`),create("strong","",subject),create("p","",`${email} · ${formatDate(firstValue(ticket,["updatedAt","updated_at","createdAt","created_at"]))}`));
    const meta=create("div","record-meta");
    const status=supportState(ticket);
    appendBadge(meta,supportStateLabel(status),status==="resolved"?"good":status==="new"?"bad":"warn");
    if(firstValue(ticket,["userId","user_id"],null))appendBadge(meta,"Linked account","good");
    primary.append(meta);button.append(primary,create("span","record-arrow","→"));
    button.addEventListener("click",()=>openSupportDialog(ticket,button));
    item.append(button);list.append(item);
  }
  const start=items.length?state.support.offset+1:0;
  const end=state.support.offset+items.length;
  el("supportResultCount").textContent=total?`Showing ${start}–${end} of ${total} help requests.`:"No matching help requests.";
  el("supportEmpty").hidden=items.length!==0;
  el("previousSupport").disabled=state.support.offset===0;
  el("nextSupport").disabled=end>=total||items.length===0;
}

async function loadSupport() {
  const request=++state.support.request;
  const params=new URLSearchParams({limit:String(SUPPORT_LIMIT),offset:String(state.support.offset)});
  if(state.support.status)params.set("status",state.support.status);
  setBusy(el("supportResults"),true);setSectionStatus("supportStatus","Loading the help queue…");
  el("refreshSupport").disabled=true;
  try{
    const data=await api(`/api/admin/support?${params}`);
    if(request!==state.support.request||!state.elevated)return;
    const items=Array.isArray(data.tickets)?data.tickets:Array.isArray(data.items)?data.items:[];
    const total=numberValue(firstValue(data,["total","totalTickets","count"],items.length),items.length);
    state.support.items=items;state.support.total=Math.max(total,state.support.offset+items.length);
    renderSupport(items,state.support.total);
    state.loaded.add("support");setLastUpdated();setSectionStatus("supportStatus",items.length?"Select a request to update its workflow.":"");
  }catch(error){
    if(request!==state.support.request)return;
    if(!handleAuthorizationFailure(error))setSectionStatus("supportStatus",friendlyError(error),{error:true});
  }finally{if(request===state.support.request){setBusy(el("supportResults"),false);el("refreshSupport").disabled=false;}}
}

function openSupportDialog(ticket,trigger) {
  state.selectedTicket=ticket;state.supportDialogTrigger=trigger;
  el("supportDialogTitle").textContent=supportReference(ticket);
  el("supportDialogIdentity").textContent=`${cleanString(firstValue(ticket,["subject","title"],"Support request"))} · ${cleanString(firstValue(ticket,["email","replyEmail","reply_email"],"Email unavailable"))}`;
  const facts=el("supportFacts");facts.replaceChildren();
  addFact(facts,"Category",firstValue(ticket,["category","type"],"General"));
  addFact(facts,"Status",supportStateLabel(supportState(ticket)));
  addFact(facts,"Created",formatDate(firstValue(ticket,["createdAt","created_at"])));
  addFact(facts,"Last updated",formatDate(firstValue(ticket,["updatedAt","updated_at"])));
  addFact(facts,"Linked user",firstValue(ticket,["userId","user_id"],"Not linked"));
  addFact(facts,"Paddle / reference",firstValue(ticket,["customerReference","transactionId","transaction_id","orderReference","order_reference","referenceId","reference_id"],"Not provided"));
  el("ticketMessage").textContent=cleanString(firstValue(ticket,["message","body"],""),"No message was provided.");
  el("ticketStatus").value=supportState(ticket);
  el("ticketNote").value=cleanString(firstValue(ticket,["note","adminNote","admin_note"],""),"");el("ticketResponse").value="";
  updateSupportSubmitLabel();
  el("supportUpdateMessage").hidden=true;el("supportUpdateMessage").textContent="";
  el("supportDialog").showModal();syncDialogLock();
  requestAnimationFrame(()=>el("supportDialogTitle").focus({preventScroll:true}));
}

async function submitSupportUpdate(event) {
  event.preventDefault();
  const ticket=state.selectedTicket;if(!ticket)return;
  const status=el("ticketStatus").value;
  const note=el("ticketNote").value.trim();
  const response=el("ticketResponse").value.trim();
  const message=el("supportUpdateMessage");
  if(!SUPPORT_STATES.has(status)){message.textContent="Choose a valid request status.";message.className="dialog-message error";message.hidden=false;message.focus();return;}
  const existingNote=cleanString(firstValue(ticket,["note","adminNote","admin_note"],""),"");
  if(status===supportState(ticket)&&note===existingNote&&!response){message.textContent="Change the status, edit the private note, or write an email response before saving.";message.className="dialog-message error";message.hidden=false;message.focus();return;}
  const button=el("saveSupportUpdate");button.disabled=true;
  message.textContent=response?"Saving the workflow and sending the response…":"Saving the help-request workflow…";message.className="dialog-message";message.hidden=false;
  try{
    const expectedUpdatedAt=numberValue(firstValue(ticket,["updatedAt","updated_at"]),0);
    const result=await api(`/api/admin/support/${encodeURIComponent(supportId(ticket))}`,{method:"POST",body:JSON.stringify({status,note,response,expectedUpdatedAt})});
    closeDialog(el("supportDialog"));
    showGlobal(cleanString(result.message,response?"The update was saved and the response was sent.":"The help request was updated."),{focus:true});
    state.loaded.delete("overview");state.loaded.delete("activity");
    await Promise.all([loadSupport(),loadOverview()]);
  }catch(error){
    if(!handleAuthorizationFailure(error)){message.textContent=friendlyError(error);message.className="dialog-message error";message.hidden=false;message.focus();}
  }finally{button.disabled=false;}
}

function updateSupportSubmitLabel() {
  const sending=el("ticketResponse").value.trim().length>0;
  el("saveSupportUpdate").textContent=sending?"Save and send response →":"Save update →";
}

function renderAudit(entries) {
  const list=el("auditResults");list.replaceChildren();
  for(const entry of entries){
    const item=create("li","audit-item");
    const header=create("div","audit-item-header");
    header.append(create("strong","",cleanString(firstValue(entry,["action","event","type"],"Admin action"))));
    const time=create("time","",formatDate(firstValue(entry,["createdAt","created_at","timestamp","at"])));
    const dateValue=firstValue(entry,["createdAt","created_at","timestamp","at"],null);
    if(dateValue){const parsed=new Date(dateValue);if(!Number.isNaN(parsed.getTime()))time.dateTime=parsed.toISOString();}
    header.append(time);
    const actor=cleanString(firstValue(entry,["adminEmail","admin_email","actorEmail","actor_email"],firstValue(entry?.actor||{},["email","name","id"],"Administrator")));
    const target=cleanString(firstValue(entry,["targetEmail","target_email","targetId","target_id"],firstValue(entry?.target||{},["email","name","id"],"No target")));
    const result=cleanString(firstValue(entry,["result","outcome","status"],"Recorded"));
    item.append(header,create("p","",`${actor} → ${target}`));
    const reason=firstValue(entry,["reason","note"],"");
    if(reason)item.append(create("p","",cleanString(reason)));
    item.append(create("small","",`${result}${firstValue(entry,["requestId","request_id"],null)?` · ${cleanString(firstValue(entry,["requestId","request_id"]))}`:""}`));
    list.append(item);
  }
  el("auditEmpty").hidden=entries.length!==0;
}

async function loadAudit() {
  const button=el("refreshAudit");button.disabled=true;setBusy(el("auditResults"),true);setSectionStatus("auditStatus","Loading the audit trail…");
  try{
    const data=await api("/api/admin/audit?limit=50");
    if(!state.elevated)return;
    const entries=Array.isArray(data.events)?data.events:Array.isArray(data.audit)?data.audit:Array.isArray(data.entries)?data.entries:Array.isArray(data.items)?data.items:[];
    renderAudit(entries);state.loaded.add("activity");setLastUpdated();setSectionStatus("auditStatus",entries.length?`Showing the ${entries.length} most recent recorded actions.`:"");
  }catch(error){if(!handleAuthorizationFailure(error))setSectionStatus("auditStatus",friendlyError(error),{error:true});}
  finally{setBusy(el("auditResults"),false);button.disabled=false;}
}

function loadSection(name,{force=false}={}) {
  if(!force&&state.loaded.has(name))return Promise.resolve();
  if(name==="overview")return loadOverview();
  if(name==="people")return loadUsers();
  if(name==="support")return loadSupport();
  if(name==="activity")return loadAudit();
  return Promise.resolve();
}

function activateSection(name,{focus=false,replaceHash=true}={}) {
  if(!SECTION_NAMES.has(name))name="overview";
  state.activeSection=name;
  for(const button of document.querySelectorAll("[data-section]")){
    const active=button.dataset.section===name;
    button.setAttribute("aria-selected",String(active));button.tabIndex=active?0:-1;
  }
  for(const panel of document.querySelectorAll("[data-panel]"))panel.hidden=panel.dataset.panel!==name;
  if(replaceHash)history.replaceState({},"",`#${name}`);
  if(focus)requestAnimationFrame(()=>el(`${name}Title`)?.focus?.());
  void loadSection(name);
}

function setupEvents() {
  const sectionButtons=[...document.querySelectorAll("[data-section]")];
  for(const button of sectionButtons){
    button.addEventListener("click",()=>activateSection(button.dataset.section,{replaceHash:true}));
    button.addEventListener("keydown",(event)=>{
      if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;
      event.preventDefault();
      const current=sectionButtons.indexOf(button);
      const index=event.key==="Home"?0:event.key==="End"?sectionButtons.length-1:event.key==="ArrowRight"?(current+1)%sectionButtons.length:(current-1+sectionButtons.length)%sectionButtons.length;
      sectionButtons[index].focus();activateSection(sectionButtons[index].dataset.section,{replaceHash:true});
    });
  }
  el("refreshOverview").addEventListener("click",()=>{void loadOverview();});
  el("userSearchForm").addEventListener("submit",(event)=>{event.preventDefault();state.users.query=el("userQuery").value.trim();state.users.offset=0;void loadUsers();});
  el("clearUserSearch").addEventListener("click",()=>{el("userQuery").value="";state.users.query="";state.users.offset=0;void loadUsers();el("userQuery").focus();});
  el("previousUsers").addEventListener("click",()=>{state.users.offset=Math.max(0,state.users.offset-USER_LIMIT);void loadUsers();});
  el("nextUsers").addEventListener("click",()=>{if(state.users.offset+USER_LIMIT<state.users.total){state.users.offset+=USER_LIMIT;void loadUsers();}});
  el("closeUserDialog").addEventListener("click",()=>closeDialog(el("userDialog"),state.userDialogTrigger));
  el("userDialog").addEventListener("close",syncDialogLock);
  for(const button of document.querySelectorAll("[data-user-action]"))button.addEventListener("click",()=>openActionConfirmation(button.dataset.userAction,button));
  el("confirmForm").addEventListener("submit",submitUserAction);
  el("closeConfirmDialog").addEventListener("click",()=>closeDialog(el("confirmDialog"),state.actionTrigger));
  el("cancelAction").addEventListener("click",()=>closeDialog(el("confirmDialog"),state.actionTrigger));
  el("confirmDialog").addEventListener("close",syncDialogLock);
  el("supportFilterForm").addEventListener("submit",(event)=>{event.preventDefault();state.support.status=el("supportStatusFilter").value;state.support.offset=0;void loadSupport();});
  el("refreshSupport").addEventListener("click",()=>{void loadSupport();});
  el("previousSupport").addEventListener("click",()=>{state.support.offset=Math.max(0,state.support.offset-SUPPORT_LIMIT);void loadSupport();});
  el("nextSupport").addEventListener("click",()=>{if(state.support.offset+SUPPORT_LIMIT<state.support.total){state.support.offset+=SUPPORT_LIMIT;void loadSupport();}});
  el("supportUpdateForm").addEventListener("submit",submitSupportUpdate);
  el("ticketResponse").addEventListener("input",updateSupportSubmitLabel);
  el("closeSupportDialog").addEventListener("click",()=>closeDialog(el("supportDialog"),state.supportDialogTrigger));
  el("cancelSupportUpdate").addEventListener("click",()=>closeDialog(el("supportDialog"),state.supportDialogTrigger));
  el("supportDialog").addEventListener("close",syncDialogLock);
  el("refreshAudit").addEventListener("click",()=>{void loadAudit();});
  el("elevationForm").addEventListener("submit",submitElevation);
}

function openDashboard(elevatedUntil=null,{focus=false}={}) {
  state.elevated=true;
  state.elevatedUntil=Number(elevatedUntil)||0;
  document.body.classList.add("admin-ready");
  el("accessPanel").hidden=true;el("elevationPanel").hidden=true;el("dashboard").hidden=false;
  el("adminMain").setAttribute("aria-busy","false");
  if(elevatedUntil)el("lastUpdated").textContent=`Admin controls confirmed until ${formatDate(elevatedUntil)}.`;
  if(elevationTimer)clearTimeout(elevationTimer);
  if(state.elevatedUntil>Date.now()){
    elevationTimer=setTimeout(()=>{
      if(state.elevated&&state.elevatedUntil<=Date.now())showElevation("Administrator confirmation expired. Confirm your password again to continue.");
    },Math.min(2_147_000_000,Math.max(1,state.elevatedUntil-Date.now()+25)));
  }
  const requested=location.hash.slice(1);
  const section=SECTION_NAMES.has(requested)?requested:"overview";
  activateSection(section,{replaceHash:!SECTION_NAMES.has(requested)});
  if(focus)requestAnimationFrame(()=>el(`${section}Tab`).focus({preventScroll:false}));
}

async function submitElevation(event) {
  event.preventDefault();
  const input=el("elevationPassword");
  const payload=JSON.stringify({password:input.value});
  input.value="";
  const button=el("elevationSubmit");
  const message=el("elevationMessage");
  button.disabled=true;message.textContent="Confirming the administrator account…";message.className="dialog-message";message.hidden=false;
  try{
    const result=await api("/api/admin/elevate",{method:"POST",body:payload});
    state.csrfToken=cleanString(result.csrfToken,"");
    if(!state.csrfToken)throw Object.assign(new Error("The secure administrator session could not be refreshed."),{status:409,code:"ADMIN_SESSION_CHANGED"});
    state.loaded.clear();
    message.hidden=true;message.textContent="";
    openDashboard(result.elevatedUntil,{focus:true});
    showGlobal("Administrator controls are unlocked for this session.");
  }catch(error){
    const authCode=String(error?.code||"").toUpperCase();
    if(error?.status===403){showAccess("This account is signed in, but it is not an approved STRATA administrator.",{focus:true});return;}
    if(error?.status===401&&["AUTH_REQUIRED","SESSION_REQUIRED","INVALID_SESSION"].includes(authCode)){showAccess("Your private session ended. Sign in again to continue.",{signedOut:true,focus:true});return;}
    message.textContent=error?.status===401?"That password is incorrect. Enter the current password for this STRATA account.":friendlyError(error);
    message.className="dialog-message error";message.hidden=false;message.focus();
  }finally{button.disabled=false;}
}

async function initialize() {
  try{
    const result=await api("/api/me");
    if(!result.user){showAccess("Sign in with the verified administrator account to continue.",{signedOut:true});return;}
    if(result.user.isAdmin!==true&&result.user.admin!==true){showAccess("This account is signed in, but it is not an approved STRATA administrator.");return;}
    state.admin=result.user;state.csrfToken=cleanString(result.csrfToken,"");
    el("adminIdentity").textContent=`${userName(result.user)} · ${userEmail(result.user)}`;
    el("elevationIdentity").textContent=userEmail(result.user);
    const adminSession=await api("/api/admin/session");
    if(adminSession.admin!==true){showAccess("This account is signed in, but it is not an approved STRATA administrator.");return;}
    if(adminSession.elevated!==true){showElevation();return;}
    openDashboard(adminSession.elevatedUntil);
  }catch(error){
    if(!handleAuthorizationFailure(error)){
      el("accessTitle").textContent="ADMIN SERVICE UNAVAILABLE.";
      el("accessMessage").textContent=friendlyError(error);
      el("accessActions").hidden=false;el("adminMain").setAttribute("aria-busy","false");
    }
  }
}

setupEvents();
document.addEventListener("visibilitychange",()=>{
  if(!document.hidden&&state.elevated&&state.elevatedUntil&&state.elevatedUntil<=Date.now())showElevation("Administrator confirmation expired. Confirm your password again to continue.");
});
window.addEventListener("pageshow",(event)=>{if(event.persisted)location.reload();});
void initialize();
