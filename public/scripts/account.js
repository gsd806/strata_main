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
let dashboardRequest=0;
let sessionListRequest=0;
const WEEKDAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];

function safeNext(raw,exerciseId){
  const addIsSafe=Boolean(exerciseId&&/^[a-z0-9-]{2,80}$/.test(exerciseId));
  if(raw==="planner"||raw==="/planner.html")return addIsSafe?`/planner.html?add=${encodeURIComponent(exerciseId)}`:"/planner.html";
  if(/^\/planner\.html\?add=[a-z0-9-]{2,80}$/.test(raw||""))return raw;
  if(raw==="pricing"||raw==="/pricing"||raw==="/pricing.html")return "/pricing";
  if(raw==="discover"||raw==="/discover.html")return "/discover.html";
  if(raw==="admin"||raw==="/admin"||raw==="/admin.html")return "/admin";
  if(/^\/workout\.html\?day=(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)$/.test(raw||""))return raw;
  if(raw==="workout"||raw==="/workout.html")return "/workout.html";
  if(raw==="onboarding"||raw==="/onboarding.html")return "/onboarding.html";
  return "/planner.html";
}

function verificationLocation(destination,{deliveryState="",purpose="signup"}={}){
  const query=new URLSearchParams();
  if(destination==="/pricing")query.set("next","pricing");
  else if(destination==="/discover.html")query.set("next","discover");
  else if(destination==="/admin")query.set("next","admin");
  else if(destination.startsWith("/workout.html"))query.set("next",destination==="/workout.html"?"workout":destination);
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
  dashboardRequest+=1;
  sessionListRequest+=1;
  document.body?.classList.remove("account-signed-in");
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

function escapeHtml(value){
  return String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"})[character]);
}

function localDateKey(date){
  const year=date.getFullYear(),month=String(date.getMonth()+1).padStart(2,"0"),day=String(date.getDate()).padStart(2,"0");
  return `${year}-${month}-${day}`;
}

function localNoon(date,offset=0){
  return new Date(date.getFullYear(),date.getMonth(),date.getDate()+offset,12);
}

function weekContext(now=new Date()){
  const today=localNoon(now),todayIndex=(today.getDay()+6)%7,monday=localNoon(today,-todayIndex);
  const dates=WEEKDAYS.map((day,index)=>({day,date:localNoon(monday,index)}));
  return {today,todayIndex,monday,dates,dateKeys:new Set(dates.map(({date})=>localDateKey(date)))};
}

function readableDate(value){
  if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value))return "Saved session";
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?"Saved session":new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(date);
}

function readableExerciseId(value){
  const words=String(value||"").split(/[-_]+/).filter(Boolean).slice(0,8);
  return words.length?words.map((word)=>word.charAt(0).toUpperCase()+word.slice(1)).join(" "):"Repeat movement";
}

function validPlan(value){
  if(!value||typeof value!=="object"||!value.days||typeof value.days!=="object")return null;
  if(!WEEKDAYS.every((day)=>Array.isArray(value.days[day])))return null;
  return value;
}

function planSummary(plan){
  const scheduled=WEEKDAYS.filter((day)=>plan.days[day].length>0);
  const movements=scheduled.reduce((total,day)=>total+plan.days[day].length,0);
  return {scheduled,movements};
}

function completedThisWeek(workouts,week){
  return workouts.filter((workout)=>workout?.status==="completed"&&week.dateKeys.has(String(workout.date||"")));
}

function nextPlannedDay(plan,completedDays,week){
  for(let offset=0;offset<14;offset+=1){
    const index=(week.todayIndex+offset)%WEEKDAYS.length,day=WEEKDAYS[index],items=plan.days[day];
    if(items.length&&(offset>=7||!completedDays.has(day)))return {day,items,offset,date:localNoon(week.today,offset)};
  }
  return null;
}

function formatDuration(seconds){
  const safe=Math.max(0,Math.round(Number(seconds)||0));
  if(safe<60)return `${safe} sec`;
  const minutes=Math.floor(safe/60),remaining=safe%60;
  return remaining?`${minutes}m ${remaining}s`:`${minutes} min`;
}

function recordMetric(summary){
  if(!summary||Number(summary.completedSets)<=0||summary.loadType==="assisted")return null;
  if(summary.measurement==="timed"&&Number.isFinite(Number(summary.maxSeconds))&&Number(summary.maxSeconds)>0){
    return {key:"time",value:Number(summary.maxSeconds),label:"Longest set",formatted:formatDuration(summary.maxSeconds)};
  }
  if(summary.loadType==="external"&&Number.isFinite(Number(summary.maxWeight))&&Number(summary.maxWeight)>0){
    const unit=summary.unit==="lb"?"lb":"kg";
    return {key:`load:${unit}`,value:Number(summary.maxWeight),label:"Top load",formatted:`${Number(summary.maxWeight).toLocaleString()} ${unit}`};
  }
  if(summary.loadType==="bodyweight"&&Number.isFinite(Number(summary.maxReps))&&Number(summary.maxReps)>0){
    return {key:"reps",value:Number(summary.maxReps),label:"Most reps in a set",formatted:`${Number(summary.maxReps).toLocaleString()} reps`};
  }
  return null;
}

function recentRecords(workouts,hasMore){
  const completed=workouts.filter((workout)=>workout?.status==="completed").sort((a,b)=>Number(a.startedAt||0)-Number(b.startedAt||0));
  const previous=new Map(),records=[];
  for(const workout of completed){
    for(const summary of Array.isArray(workout.exerciseSummaries)?workout.exerciseSummaries:[]){
      const metric=recordMetric(summary);if(!metric)continue;
      const comparisonKey=`${String(summary.exerciseId||"")}:${String(summary.measurement||"")}:${String(summary.loadType||"")}:${metric.key}`;
      const earlier=previous.get(comparisonKey);
      if(Number.isFinite(earlier)&&metric.value>earlier)records.push({
        comparisonKey,exercise:readableExerciseId(summary.exerciseId),label:metric.label,value:metric.formatted,date:String(workout.date||""),startedAt:Number(workout.startedAt||0),scope:hasMore?"Recent-history best":"Saved-history best"
      });
      if(!Number.isFinite(earlier)||metric.value>earlier)previous.set(comparisonKey,metric.value);
    }
  }
  const latestByMetric=new Map();
  for(const record of records.sort((a,b)=>b.startedAt-a.startedAt))if(!latestByMetric.has(record.comparisonKey))latestByMetric.set(record.comparisonKey,record);
  return [...latestByMetric.values()].slice(0,2);
}

function renderWeekRail(plan,completedDays,week,{completionKnown}){
  el("accountWeekDays").innerHTML=WEEKDAYS.map((day,index)=>{
    const scheduled=plan.days[day].length>0,complete=completionKnown&&scheduled&&completedDays.has(day),today=index===week.todayIndex;
    const state=complete?"complete":scheduled?"scheduled":"recovery";
    const description=complete?"completed":scheduled?completionKnown?"planned":"scheduled":"recovery";
    return `<li class="${state}${today?" today":""}"${today?' aria-current="date"':""} aria-label="${day}, ${description}${today?", today":""}"><span>${day.slice(0,3)}</span><i aria-hidden="true">${complete?"✓":scheduled?"•":"—"}</i></li>`;
  }).join("");
}

function renderWins(workouts,hasMore){
  const completed=workouts.filter((workout)=>workout?.status==="completed"),latest=completed.slice().sort((a,b)=>Number(b.startedAt||0)-Number(a.startedAt||0))[0],records=recentRecords(workouts,hasMore),wins=[];
  if(latest)wins.push({title:"Session complete",detail:`${String(latest.title||"Workout")} · ${readableDate(latest.date)} · ${Math.max(0,Number(latest.completedSets)||0)} completed sets`});
  for(const record of records)wins.push({title:record.exercise,detail:`${record.scope} · ${record.label} ${record.value} · ${readableDate(record.date)}`});
  const list=el("accountWinsList"),empty=el("accountWinsEmpty");
  if(!wins.length){
    list.hidden=true;list.innerHTML="";empty.hidden=false;
    empty.textContent="Complete a session to start a private, saved progress trail.";
    return records;
  }
  list.innerHTML=wins.map((win,index)=>`<li><span aria-hidden="true">${index===0?"✓":"↑"}</span><div><strong>${escapeHtml(win.title)}</strong><small>${escapeHtml(win.detail)}</small></div></li>`).join("");
  list.hidden=false;empty.hidden=true;
  return records;
}

function renderDashboard(plan,user,{workouts=null,hasMore=false,historyError=false}={}){
  const summary=planSummary(plan),week=weekContext(),historyAvailable=Array.isArray(workouts),weekWorkouts=historyAvailable?completedThisWeek(workouts,week):[],completedDays=new Set(weekWorkouts.map((workout)=>String(workout.planDay||"")).filter((day)=>summary.scheduled.includes(day))),active=historyAvailable?workouts.find((workout)=>workout?.status==="active"):null;
  const discoveryActive=user?.discovery?.active===true,historyLoading=discoveryActive&&!historyAvailable&&!historyError;
  el("accountPlanCount").textContent=String(summary.movements);
  el("accountWorkoutDays").textContent=String(summary.scheduled.length);
  renderWeekRail(plan,completedDays,week,{completionKnown:historyAvailable});

  const progress=el("accountWeekProgress"),weekSets=weekWorkouts.reduce((total,workout)=>total+Math.max(0,Number(workout.completedSets)||0),0);
  if(historyAvailable&&summary.scheduled.length){
    progress.hidden=false;progress.max=summary.scheduled.length;progress.value=Math.min(completedDays.size,summary.scheduled.length);progress.textContent=`${Math.round(progress.value/progress.max*100)}%`;
    el("accountWeekScore").textContent=`${progress.value}/${progress.max}`;
    el("accountWeekDetail").textContent=progress.value===progress.max
      ?`Week complete: ${weekWorkouts.length} saved ${weekWorkouts.length===1?"session":"sessions"} and ${weekSets} completed ${weekSets===1?"set":"sets"}.`
      :`${weekWorkouts.length} saved ${weekWorkouts.length===1?"session":"sessions"} and ${weekSets} completed ${weekSets===1?"set":"sets"} this week.`;
  }else{
    progress.hidden=true;progress.value=0;progress.max=Math.max(1,summary.scheduled.length);
    el("accountWeekScore").textContent=summary.scheduled.length?`${summary.scheduled.length} ${summary.scheduled.length===1?"day":"days"}`:"No plan";
    el("accountWeekDetail").textContent=!summary.scheduled.length
      ?"No training days are scheduled yet."
      :historyLoading?"Checking your saved completion history…"
        :historyError?"Completion history could not be loaded. Your saved schedule is still shown."
          :"Your weekly structure is ready. Completion history is available in the Strata+ workout room.";
  }

  const primary=el("accountPrimaryAction"),primaryLabel=el("accountPrimaryLabel"),nextTitle=el("accountNextTitle"),nextDetail=el("accountNextDetail"),nextEyebrow=el("accountNextEyebrow"),nextMetrics=el("accountNextMetrics");
  nextMetrics.hidden=true;
  if(active){
    nextEyebrow.textContent="Workout in progress";nextTitle.textContent=String(active.title||"OPEN WORKOUT").toUpperCase();
    nextDetail.textContent=`Started ${readableDate(active.date)} · ${Math.max(0,Number(active.completedSets)||0)} of ${Math.max(0,Number(active.totalSets)||0)} sets completed.`;
    primary.href=`/workout.html#resume=${encodeURIComponent(active.id)}`;primaryLabel.textContent="Continue workout";
  }else if(!summary.scheduled.length){
    nextEyebrow.textContent="Start here";nextTitle.textContent="BUILD A WEEK YOU CAN REPEAT.";
    nextDetail.textContent="Choose your training days and movements before tracking progress.";
    primary.href=discoveryActive?"/onboarding.html":"/planner.html";primaryLabel.textContent="Build your week";
  }else{
    const next=nextPlannedDay(plan,completedDays,week),movements=next?.items.length||0,sets=(next?.items||[]).reduce((total,item)=>total+Math.max(0,Math.round(Number(item?.sets)||0)),0);
    const when=next?.offset===0?"Today":next?.offset===1?"Tomorrow":next?.offset>=7?`Next ${next.day}`:next?.day||"Next up";
    nextEyebrow.textContent=`${when} · ${next?new Intl.DateTimeFormat(undefined,{month:"short",day:"numeric"}).format(next.date):""}`;
    nextTitle.textContent=`${next?.day||"NEXT"} WORKOUT`;
    nextDetail.textContent=historyLoading?"Your plan is ready while STRATA checks saved completion history.":historyError?"Your plan is ready. Completion history is temporarily unavailable.":`${movements} ${movements===1?"movement":"movements"} in your saved plan.`;
    el("accountNextMovements").textContent=String(movements);el("accountNextSets").textContent=String(sets);nextMetrics.hidden=false;
    primary.href=discoveryActive?`/workout.html?day=${encodeURIComponent(next.day)}`:"/planner.html";
    primaryLabel.textContent=discoveryActive?"Open next workout":"Open your week";
  }

  const winsEmpty=el("accountWinsEmpty"),winsList=el("accountWinsList");
  let records=[];
  if(historyAvailable)records=renderWins(workouts,hasMore)||[];
  else{
    winsList.hidden=true;winsList.innerHTML="";winsEmpty.hidden=false;
    winsEmpty.textContent=historyLoading?"Loading recent saved sessions…":historyError?"Recent session history could not be loaded. Nothing was changed.":"Workout history is not available in this account view. Your saved plan is still ready.";
  }

  const adaptationTitle=el("accountAdaptationTitle"),adaptationDetail=el("accountAdaptationDetail");
  if(!summary.scheduled.length){
    adaptationTitle.textContent="START WITH A REPEATABLE WEEK.";adaptationDetail.textContent="A stable schedule makes future session comparisons meaningful. STRATA will not infer readiness from a plan alone.";
  }else if(historyLoading){
    adaptationTitle.textContent="BUILD A CLEAN BASELINE.";adaptationDetail.textContent="STRATA is checking repeat movements in your saved sessions. Recovery and form are never guessed from set totals.";
  }else if(historyError||!discoveryActive){
    adaptationTitle.textContent="YOUR WEEK HAS A SHAPE.";adaptationDetail.textContent=`${summary.scheduled.length} planned ${summary.scheduled.length===1?"day gives":"days give"} you a repeatable structure. No training adaptation is claimed without comparable session data.`;
  }else if(active){
    adaptationTitle.textContent="FINISH THE OPEN SESSION.";adaptationDetail.textContent="An in-progress workout is the clearest next signal. Finish or close it before changing the week.";
  }else if(!weekWorkouts.length&&!(workouts||[]).some((workout)=>workout?.status==="completed")){
    adaptationTitle.textContent="CREATE THE FIRST DATA POINT.";adaptationDetail.textContent="Complete one saved workout. A repeat in the same movement format and unit will make progress comparable.";
  }else if(records.length){
    adaptationTitle.textContent="PROGRESS IS MOVING.";adaptationDetail.textContent=`${records.length} repeat ${records.length===1?"movement exceeded":"movements exceeded"} an earlier saved result. Keep the format and unit consistent; recovery and form are not measured here.`;
  }else if(summary.scheduled.length&&completedDays.size===summary.scheduled.length){
    adaptationTitle.textContent="YOUR SCHEDULE IS COMPLETE.";adaptationDetail.textContent="Every planned day has a saved completion this week. Review recovery and notes before changing volume; this dashboard does not measure readiness.";
  }else{
    adaptationTitle.textContent="KEEP THE COMPARISON CLEAN.";adaptationDetail.textContent="Repeat key movements in the same format and unit. STRATA will surface a saved result only when it exceeds an earlier comparable session.";
  }
}

function renderDashboardUnavailable(){
  el("accountNextEyebrow").textContent="Saved week unavailable";el("accountNextTitle").textContent="YOUR ACCOUNT IS STILL SAFE.";el("accountNextDetail").textContent="STRATA could not load your plan right now. Refresh or open My Plan to retry.";el("accountNextMetrics").hidden=true;
  el("accountWeekScore").textContent="—";el("accountWeekProgress").hidden=true;el("accountWeekDetail").textContent="Weekly progress could not be loaded.";el("accountWeekDays").innerHTML="";
  el("accountWinsList").hidden=true;el("accountWinsList").innerHTML="";el("accountWinsEmpty").hidden=false;el("accountWinsEmpty").textContent="Recent activity could not be loaded. Nothing was changed.";
  el("accountAdaptationTitle").textContent="KEEP YOUR CURRENT PLAN.";el("accountAdaptationDetail").textContent="There is not enough verified data to suggest a training change right now.";
  el("accountPrimaryAction").href="/planner.html";el("accountPrimaryLabel").textContent="Open My Plan";
}

function subscriptionFor(user){
  const subscription=user?.discovery?.subscription;
  return subscription&&typeof subscription==="object"&&subscription.id?subscription:null;
}

function grandfatheredAccess(user){
  const discovery=user?.discovery||{},accessType=String(discovery.accessType||"");
  return discovery.active===true&&!subscriptionFor(user)&&["lifetime","paid"].includes(accessType);
}

function billingDate(value){
  const timestamp=Number(value),date=new Date(timestamp);
  return Number.isFinite(timestamp)&&timestamp>0&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(date):"the date Paddle shows";
}

function accountAccessSummary(user,pending=false){
  const discovery=user?.discovery||{},subscription=subscriptionFor(user),status=String(subscription?.status||"");
  const trialActive=discovery.active===true&&discovery.accessType==="trial";
  if(trialActive){
    const expiresAt=Number(discovery.trial?.expiresAt),remaining=Math.max(0,expiresAt-Date.now());
    return{state:"Trial",detail:remaining>=60000?`${Math.ceil(remaining/60000)} min remaining`:`${Math.ceil(remaining/1000)} sec remaining`,message:"Your free 30-minute trial ends automatically and will never convert into a paid subscription."};
  }
  if(subscription){
    if(status==="paused")return{state:"Paused",detail:"Paid access inactive",message:"Your monthly subscription is paused and Strata+ paid access is inactive. Manage it in Paddle to review the available next steps."};
    if(status==="canceled")return{state:"Canceled",detail:"No future renewals",message:"Your monthly subscription is canceled and will not renew. Your free Rankings and weekly Plan remain available."};
    if(subscription.active!==true)return{state:"Inactive",detail:"Paid access inactive",message:"The last verified billing period or scheduled access window has ended. Open Paddle to review the subscription state."};
    if(subscription.scheduledChange?.action==="cancel")return{state:"Canceling",detail:`Access through ${billingDate(subscription.scheduledChange.effectiveAt)}`,message:`Your $0.99 USD monthly subscription is scheduled to cancel on ${billingDate(subscription.scheduledChange.effectiveAt)}. Access remains active until then and will not renew afterward.`};
    if(subscription.scheduledChange?.action==="pause")return{state:"Pausing",detail:`Access through ${billingDate(subscription.scheduledChange.effectiveAt)}`,message:`Your $0.99 USD monthly subscription is scheduled to pause on ${billingDate(subscription.scheduledChange.effectiveAt)}. Access remains active until then and stops when the pause takes effect.`};
    if(subscription.pastDue===true||status==="past_due")return{state:"Past due",detail:"Update payment method",message:"Your monthly payment is past due. Strata+ remains available for now; update payment in Paddle to avoid interruption."};
    if(subscription.active===true)return{state:"Active",detail:`$0.99/month · renews ${billingDate(subscription.currentPeriodEndsAt)}`,message:`Your $0.99 USD monthly subscription is active and renews on ${billingDate(subscription.currentPeriodEndsAt)} unless canceled.`};
    return{state:"Inactive",detail:"Review billing status",message:"Your monthly subscription is not providing paid access. Open Paddle to review its current state."};
  }
  if(grandfatheredAccess(user))return{state:"Lifetime",detail:"Grandfathered · no renewal",message:"Your prior lifetime Strata+ purchase is grandfathered. It stays active without a monthly subscription or recurring charge."};
  if(pending)return{state:"Pending",detail:"Checkout needs attention",message:"A Strata+ subscription checkout is pending. Open Pricing to finish checkout or check confirmation."};
  return{state:"Free",detail:"Rankings and Plan included",message:"The exercise index and weekly planner are free. Strata+ is available as a $0.99 USD monthly subscription."};
}

function renderAccountBilling(user){
  const section=el("accountBilling"),subscription=subscriptionFor(user),grandfathered=grandfatheredAccess(user);
  section.hidden=!subscription&&!grandfathered;
  el("accountBillingStatus").textContent="";el("accountBillingStatus").classList.remove("bad");
  if(section.hidden)return;
  const manage=el("accountManageSubscription"),update=el("accountUpdatePayment"),cancel=el("accountCancelSubscription");
  manage.hidden=grandfathered;update.hidden=true;cancel.hidden=true;
  if(grandfathered){
    el("accountBillingTitle").textContent="LIFETIME ACCESS";el("accountBillingBadge").textContent="Grandfathered";
    el("accountBillingDetail").textContent="Your prior lifetime purchase remains active under its original terms. It has no monthly renewal and does not need a subscription.";return;
  }
  const status=String(subscription.status||""),scheduled=subscription.scheduledChange;
  el("accountBillingTitle").textContent="MONTHLY SUBSCRIPTION";
  el("accountBillingBadge").textContent=status==="paused"?"Paused":status==="canceled"?"Canceled":subscription.active!==true?"Inactive":scheduled?.action==="cancel"?"Canceling":scheduled?.action==="pause"?"Pausing":status==="past_due"?"Past due":status.charAt(0).toUpperCase()+status.slice(1);
  if(status==="paused")el("accountBillingDetail").textContent="Paid access is inactive while this subscription is paused. Open Paddle to review resumption or cancellation options.";
  else if(status==="canceled")el("accountBillingDetail").textContent="This subscription is canceled, paid access is inactive, and there are no future renewals. Your free Plan remains available.";
  else if(subscription.active!==true)el("accountBillingDetail").textContent="Paid access is inactive because the last verified billing period or scheduled access window has ended. Open Paddle to review its current state.";
  else if(scheduled?.action==="cancel")el("accountBillingDetail").textContent=`Cancellation takes effect ${billingDate(scheduled.effectiveAt)}. Access remains available until then, with no renewal afterward.`;
  else if(scheduled?.action==="pause")el("accountBillingDetail").textContent=`The subscription pauses ${billingDate(scheduled.effectiveAt)}. Access remains available until then and stops when the pause takes effect.`;
  else if(status==="past_due")el("accountBillingDetail").textContent="Paddle could not collect the latest monthly payment. Update the payment method to avoid losing Strata+ access.";
  else el("accountBillingDetail").textContent=`$0.99 USD per month. The next renewal is ${billingDate(subscription.currentPeriodEndsAt)} unless you cancel.`;
  update.hidden=status!=="past_due";
  cancel.hidden=status==="canceled"||scheduled?.action==="cancel";
}

function showChangedAccount(){
  dashboardRequest+=1;sessionListRequest+=1;currentCsrfToken="";document.body?.classList.remove("account-signed-in");
  el("signedInCard").hidden=true;el("accountAccess").hidden=true;el("accountLoading").hidden=false;
  el("accountLoadingTitle").textContent="ACCOUNT CHANGED.";
  el("accountLoadingMessage").textContent="The signed-in account changed in another tab. Reload to open the current account without mixing private training data.";
  el("accountReload").hidden=false;el("accountPage").setAttribute("aria-busy","false");
}

function accountBoundaryChanged(error){return error?.status===401||error?.code==="account-changed";}

function sessionDate(value){
  const date=new Date(Number(value));
  return Number.isFinite(Number(value))&&!Number.isNaN(date.getTime())?new Intl.DateTimeFormat(undefined,{dateStyle:"medium",timeStyle:"short"}).format(date):"Unknown time";
}

function showAccountControlStatus(id,message,{error=false,focus=false}={}){
  const status=el(id);status.textContent=message;status.classList.remove("bad");if(error)status.classList.add("bad");
  if(focus)status.focus({preventScroll:false});
}

function renderAccountSessions(sessions){
  const list=el("accountSessionList"),others=sessions.filter((session)=>session?.current!==true);
  list.innerHTML=sessions.map((session)=>{
    const current=session?.current===true,id=escapeHtml(session?.id||"");
    return `<li><div><strong>${current?"This session":"Other session"}</strong><small>Signed in ${escapeHtml(sessionDate(session?.createdAt))} · Expires ${escapeHtml(sessionDate(session?.expiresAt))}</small></div>${current?'<span class="account-current-session">Current</span>':`<button type="button" data-revoke-session="${id}" aria-label="Sign out session created ${escapeHtml(sessionDate(session?.createdAt))}">Sign out</button>`}</li>`;
  }).join("")||'<li class="account-session-loading">No active sessions were found. Refresh this page before making account changes.</li>';
  list.setAttribute("aria-busy","false");
  const revokeAll=el("accountRevokeOtherSessions");revokeAll.disabled=others.length===0;revokeAll.hidden=others.length===0;
}

async function loadAccountSessions(user){
  const request=++sessionListRequest,list=el("accountSessionList");
  list.setAttribute("aria-busy","true");list.innerHTML='<li class="account-session-loading">Checking active sessions…</li>';
  el("accountRevokeOtherSessions").disabled=true;
  try{
    const result=await readJson("/api/account/sessions",{cache:"no-store"});
    if(request!==sessionListRequest)return;
    if(String(result.userId||"")!==String(user?.id||"")||!Array.isArray(result.sessions))throw Object.assign(new Error("The signed-in account changed."),{code:"account-changed"});
    renderAccountSessions(result.sessions);showAccountControlStatus("accountSessionStatus","");
  }catch(error){
    if(request!==sessionListRequest)return;
    if(accountBoundaryChanged(error)){showChangedAccount();return;}
    list.setAttribute("aria-busy","false");list.innerHTML='<li class="account-session-loading">Active sessions could not be loaded. Nothing was changed.</li>';
    showAccountControlStatus("accountSessionStatus","Could not load signed-in sessions. Refresh to try again.",{error:true});
  }
}

async function loadAccountDashboard(user){
  const request=++dashboardRequest;
  try{
    const planResult=await readJson("/api/plan",{cache:"no-store"});
    if(request!==dashboardRequest)return;
    if(String(planResult.user?.id||"")!==String(user?.id||""))throw Object.assign(new Error("The signed-in account changed."),{code:"account-changed"});
    const plan=validPlan(planResult.plan);if(!plan)throw Object.assign(new Error("The saved plan response was incomplete."),{code:"invalid-response"});
    const currentUser=planResult.user||user;
    renderDashboard(plan,currentUser);
    if(currentUser?.discovery?.active!==true)return;
    try{
      const historyResult=await readJson("/api/workouts?limit=100&offset=0",{cache:"no-store"});
      if(request!==dashboardRequest)return;
      if(!Array.isArray(historyResult.workouts)||typeof historyResult.hasMore!=="boolean")throw Object.assign(new Error("Workout history returned an incomplete response."),{code:"invalid-response"});
      const identity=await readJson("/api/me",{cache:"no-store"});
      if(request!==dashboardRequest)return;
      if(String(identity.user?.id||"")!==String(currentUser.id)||!historyResult.csrfToken||String(historyResult.csrfToken)!==String(identity.csrfToken||""))throw Object.assign(new Error("The signed-in account changed."),{code:"account-changed"});
      currentCsrfToken=String(identity.csrfToken||currentCsrfToken);
      renderDashboard(plan,currentUser,{workouts:historyResult.workouts,hasMore:historyResult.hasMore});
    }catch(error){
      if(request!==dashboardRequest)return;
      if(accountBoundaryChanged(error)){showChangedAccount();return;}
      renderDashboard(plan,currentUser,{historyError:true});
    }
  }catch(error){
    if(request!==dashboardRequest)return;
    if(accountBoundaryChanged(error)){showChangedAccount();return;}
    renderDashboardUnavailable();
  }finally{
    if(request===dashboardRequest)el("signedInCard").setAttribute("aria-busy","false");
  }
}

function showSignedIn(user,csrfToken=""){
  document.body?.classList.add("account-signed-in");
  currentCsrfToken=String(csrfToken||"");
  el("accountLoading").hidden=true;
  el("accountAccess").hidden=true;
  el("signedInCard").hidden=false;
  el("signedInCard").setAttribute("aria-busy","true");
  el("signedInIdentity").textContent=`${user.name} · ${user.email}`;
  const firstName=String(user?.name||"").trim().split(/\s+/)[0]||"there",hour=new Date().getHours();
  el("accountGreeting").textContent=`Good ${hour<12?"morning":hour<18?"afternoon":"evening"}, ${firstName}`;
  const planCount=Math.max(0,Number(user?.planCount)||0);
  const workoutDays=Math.max(0,Number(user?.workoutDays)||0);
  el("accountPlanCount").textContent=String(planCount);
  el("accountWorkoutDays").textContent=String(workoutDays);
  const createdAt=Number(user?.createdAt);
  const createdDate=Number.isFinite(createdAt)&&createdAt>0?new Date(createdAt):null;
  el("accountMemberSince").textContent=createdDate&&!Number.isNaN(createdDate.getTime())
    ?new Intl.DateTimeFormat(undefined,{month:"short",year:"numeric"}).format(createdDate)
    :"Member";
  el("accountAdminAction").hidden=user?.isAdmin!==true;
  const discoveryActive=user?.discovery?.active===true;
  const discoveryPending=Number(user?.discovery?.pendingPurchaseCount||0)>0;
  const subscription=subscriptionFor(user),access=accountAccessSummary(user,discoveryPending);
  const discoveryAction=el("accountDiscoveryAction");
  const managedInactive=Boolean(subscription)&&!discoveryActive&&subscription?.status!=="canceled";
  discoveryAction.href=discoveryActive?"/discover.html":managedInactive?"#accountBilling":"/pricing";
  discoveryAction.textContent=discoveryActive?"Open Strata+ studio →":managedInactive?"Manage Strata+ billing →":subscription?.status==="canceled"?"Restart Strata+ →":discoveryPending?"Check Strata+ subscription →":"Unlock Strata+ →";
  el("accountDiscoveryStatus").textContent=access.message;
  el("accountAccessState").textContent=access.state;
  el("accountAccessDetail").textContent=access.detail;
  renderAccountBilling(user);
  const primaryAction=el("accountPrimaryAction");
  primaryAction.href=planCount>0?(discoveryActive?"/workout.html":"/planner.html"):discoveryActive?"/onboarding.html":"/planner.html";
  el("accountPrimaryLabel").textContent=planCount>0?(discoveryActive?"Start training":"Open your week"):"Build your week";
  const deletionPending=user?.accountDeletion?.pending===true;
  el("accountDeleteCancel").hidden=!deletionPending;
  if(deletionPending)showSecurityStatus("An account-deletion confirmation is pending. You can use the emailed link or cancel the request here.");
  else showSecurityStatus("");
  el("accountPage").setAttribute("aria-busy","false");
  void loadAccountDashboard(user);
  void loadAccountSessions(user);
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
  el("accountLoadingTitle").textContent="CHECKING YOUR ACCOUNT…";
  el("accountLoadingMessage").textContent="Confirming whether you are already signed in.";
  el("accountReload").hidden=true;
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

function selfServiceError(error,action){
  if(error?.code==="network")return "Could not reach STRATA. Check your connection and try again.";
  if(error?.status===401)return "Your session expired. Sign in again before continuing.";
  if(error?.status===403)return "The security check expired. Refresh this page and try again.";
  if(error?.status===429)return `Too many ${action} requests were made. Wait a moment and try again.`;
  return error?.message||`The ${action} request could not be completed.`;
}

async function revokeSessions(path,sessionId,button){
  if(button.disabled)return;
  button.disabled=true;setButtonBusy(button,true,"Signing out sessions, please wait");
  showAccountControlStatus("accountSessionStatus","Updating active sessions…");
  try{
    const result=await readJson(path,{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":currentCsrfToken},body:JSON.stringify(sessionId?{sessionId}:{})});
    if(!Array.isArray(result.sessions))throw Object.assign(new Error("The session response was incomplete."),{code:"invalid-response"});
    renderAccountSessions(result.sessions);
    const count=Math.max(0,Number(result.revoked)||0),bulk=path.endsWith("revoke-others");
    showAccountControlStatus("accountSessionStatus",bulk?`${count} other ${count===1?"session was":"sessions were"} signed out.`:"The selected session was signed out.");
  }catch(error){
    if(accountBoundaryChanged(error)){showChangedAccount();return;}
    showAccountControlStatus("accountSessionStatus",selfServiceError(error,"session"),{error:true,focus:true});
  }finally{button.disabled=button===el("accountRevokeOtherSessions")?button.hidden:false;setButtonBusy(button,false);}
}

async function downloadAccountExport(event){
  const button=event.currentTarget;if(button.disabled)return;
  button.disabled=true;setButtonBusy(button,true,"Preparing your account export, please wait");
  showAccountControlStatus("accountExportStatus","Collecting your account data…");
  try{
    let response;
    try{response=await globalThis.fetch("/api/account/export",{method:"POST",credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json","X-CSRF-Token":currentCsrfToken},body:"{}"});}
    catch(cause){throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{code:"network",cause});}
    if(!response.ok){const data=String(response.headers?.get?.("content-type")||"").includes("json")?await response.json().catch(()=>null):null;throw Object.assign(new Error(data?.error||"The export request failed."),{status:response.status,code:data?.code});}
    if(response.headers?.get?.("x-strata-export")!=="account-v1")throw Object.assign(new Error("The export response was incomplete."),{code:"invalid-response"});
    const blob=await response.blob(),href=URL.createObjectURL(blob),link=document.createElement("a"),disposition=String(response.headers?.get?.("content-disposition")||"");
    const filename=disposition.match(/filename="(strata-account-export-\d{4}-\d{2}-\d{2}\.json)"/)?.[1]||"strata-account-export-download.json";link.href=href;link.download=filename;
    link.hidden=true;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),0);
    showAccountControlStatus("accountExportStatus","Your JSON export was downloaded.");
  }catch(error){
    if(accountBoundaryChanged(error)){showChangedAccount();return;}
    showAccountControlStatus("accountExportStatus",selfServiceError(error,"export"),{error:true,focus:true});
  }finally{button.disabled=false;setButtonBusy(button,false);}
}

function safePortalUrl(value){
  try{
    const url=new URL(String(value||""));
    return url.protocol==="https:"&&url.hostname==="customer-portal.paddle.com"&&url.pathname.startsWith("/cpl_")&&!url.username&&!url.password?url.href:"";
  }catch{return "";}
}

function billingError(error){
  if(error?.code==="network")return "Could not reach STRATA. Check your connection and try again.";
  if(error?.code==="SUBSCRIPTION_NOT_FOUND"||error?.status===404)return "No monthly subscription was found for this account. Refresh to check the latest billing state.";
  if(error?.status===429)return "Too many billing requests were made. Wait a moment and try again.";
  if(error?.status===401)return "Your session expired. Sign in again before managing billing.";
  if(error?.status===403)return "The security check expired. Refresh this page before managing billing.";
  return error?.message||"Subscription management is temporarily unavailable. Please try again.";
}

async function openBillingPortal(kind,event){
  const buttons=[el("accountManageSubscription"),el("accountUpdatePayment"),el("accountCancelSubscription")],button=event.currentTarget,status=el("accountBillingStatus");
  if(button.disabled)return;
  if(!currentCsrfToken){status.textContent="Your session needs refreshing before billing can be opened.";status.classList.add("bad");status.focus({preventScroll:false});return;}
  buttons.forEach((control)=>{control.disabled=true;});status.classList.remove("bad");
  status.textContent=kind==="cancel"?"Preparing Paddle’s secure cancellation page…":kind==="payment"?"Preparing Paddle’s secure payment page…":"Preparing Paddle’s secure subscription portal…";
  try{
    const result=await readJson("/api/billing/portal",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":currentCsrfToken},body:"{}"});
    const field=kind==="cancel"?"cancelUrl":kind==="payment"?"updatePaymentMethodUrl":"overviewUrl",destination=safePortalUrl(result[field]);
    if(!destination)throw Object.assign(new Error("Paddle returned an invalid subscription-management link."),{code:"invalid-response"});
    status.textContent="Opening Paddle’s secure portal…";location.assign(destination);
  }catch(error){status.textContent=billingError(error);status.classList.add("bad");status.focus({preventScroll:false});}
  finally{buttons.forEach((control)=>{control.disabled=false;});}
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
      ?`A deletion confirmation link was sent to ${result.maskedEmail||"your registered email"}. Nothing is deleted until you open it and type DELETE. Deletion does not cancel a Paddle subscription or refund a charge.`
      :`A password-reset link was sent to ${result.maskedEmail||"your registered email"}. The link expires after 30 minutes.`);
    if(kind==="delete")el("accountDeleteCancel").hidden=false;
  }catch(error){
    showSecurityStatus(securityError(error),{error:true});
  }finally{button.disabled=false;setButtonBusy(button,false);}
}

el("accountPasswordReset").addEventListener("click",(event)=>{void requestSecurityEmail("password",event);});
el("accountDeleteRequest").addEventListener("click",(event)=>{void requestSecurityEmail("delete",event);});
el("accountManageSubscription").addEventListener("click",(event)=>{void openBillingPortal("overview",event);});
el("accountUpdatePayment").addEventListener("click",(event)=>{void openBillingPortal("payment",event);});
el("accountCancelSubscription").addEventListener("click",(event)=>{void openBillingPortal("cancel",event);});
el("accountSessionList").addEventListener("click",(event)=>{
  const button=event.target.closest?.("[data-revoke-session]"),sessionId=button?.dataset?.revokeSession;
  if(button&&sessionId)void revokeSessions("/api/account/sessions/revoke",sessionId,button);
});
el("accountRevokeOtherSessions").addEventListener("click",(event)=>{void revokeSessions("/api/account/sessions/revoke-others","",event.currentTarget);});
el("accountExportData").addEventListener("click",(event)=>{void downloadAccountExport(event);});
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

el("accountReload").addEventListener("click",()=>location.reload());

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
