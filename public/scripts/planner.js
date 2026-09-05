"use strict";

const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const GROUPS=["all","chest","back","shoulders","arms","legs","glutes","calves","core"];
const REST_PREFERENCE=["Sunday","Thursday","Wednesday","Saturday","Friday","Tuesday","Monday"];
const LIBRARY_DESKTOP_PAGE_SIZE=32;
const LIBRARY_MOBILE_PAGE_SIZE=16;
const SEARCH_DEBOUNCE_MS=180;
const GUEST_PLAN_KEY="strata_guest_plan_v1";
const state={
  exercises:[],plan:null,user:null,query:"",group:"all",drag:null,selectedDay:"Monday",
  ready:false,guest:false,saveTimer:null,savePromise:null,lastSaveError:null,planUpdatedAt:0,revision:0,savedRevision:0,navigating:false,libraryLimit:LIBRARY_DESKTOP_PAGE_SIZE,
  conflictDraft:null,conflictLatest:null,conflictReview:false,csrfToken:"",sharedPlans:[],sharedPlansLoaded:false,sharedPlansRequest:0,shareBusy:false,pendingUnpublish:""
};
const el=(id)=>document.getElementById(id);

async function api(path,options={}) {
  const method=String(options.method||"GET").toUpperCase(),changesState=method!=="GET"&&method!=="HEAD";
  let response;
  try {
    response=await fetch(path,{
      ...options,
      credentials:"same-origin",
      headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(changesState&&state.csrfToken?{"X-CSRF-Token":state.csrfToken}:{}),...(options.headers||{})}
    });
  } catch(cause) {
    throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{cause});
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const error=Object.assign(new Error(data.error||"Request failed."),{status:response.status,code:data.code||"REQUEST_FAILED",data});
    throw error;
  }
  return data;
}

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function exerciseById(id){return state.exercises.find((exercise)=>exercise.id===id);}
function itemByInstance(day,instanceId){return state.plan?.days?.[day]?.find((item)=>item.instanceId===instanceId);}
function makeId(){return globalThis.crypto?.randomUUID?.()||`item-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
function emptyPlan(){return{version:1,restDay:"Sunday",days:Object.fromEntries(DAYS.map((day)=>[day,[]]))};}
function guestPlan(){
  let input=null;
  try{input=JSON.parse(localStorage.getItem(GUEST_PLAN_KEY)||"null");}catch{/* Use a clean local plan if storage is malformed or unavailable. */}
  const plan=emptyPlan(),known=new Set(state.exercises.map((exercise)=>exercise.id)),seen=new Set();
  plan.restDay=DAYS.includes(input?.restDay)?input.restDay:"Sunday";
  for(const day of DAYS){
    const items=Array.isArray(input?.days?.[day])?input.days[day]:[];
    plan.days[day]=items.slice(0,40).flatMap((item)=>{
      if(!item||!known.has(String(item.exerciseId||"")))return[];
      let instanceId=String(item.instanceId||makeId()).replace(/[^a-zA-Z0-9_-]/g,"").slice(0,100)||makeId();
      if(seen.has(instanceId))instanceId=makeId();
      seen.add(instanceId);
      const sets=Math.max(1,Math.min(10,Math.round(Number(item.sets)||3)));
      const reps=String(item.reps||"8–12").trim().slice(0,20)||"8–12";
      return[{instanceId,exerciseId:String(item.exerciseId),sets,reps}];
    });
  }
  return plan;
}
function saveGuestPlan(){
  try{localStorage.setItem(GUEST_PLAN_KEY,JSON.stringify(state.plan));return true;}
  catch{return false;}
}
function copyPlan(plan){return JSON.parse(JSON.stringify(plan));}
function focusSoon(selector){if(!selector)return;requestAnimationFrame(()=>document.querySelector(selector)?.focus());}
function instanceSelector(attribute,instanceId){return `[${attribute}="${String(instanceId).replace(/[^a-zA-Z0-9_-]/g,"")}"]`;}

function setReady(ready){
  state.ready=ready;
  el("plannerSearch").disabled=!ready;
  el("recommendRest").disabled=!ready;
  el("exportWeeklyPlan").disabled=!ready;
  el("shareWeeklyPlan").disabled=!ready;
  el("retryPlanSave").disabled=!ready;
  if(!ready)el("retryPlanSave").hidden=true;
  el("plannerShell").setAttribute("aria-busy",String(!ready));
  el("libraryPanel").setAttribute("aria-busy",String(!ready));
  el("weekBoard").setAttribute("aria-busy",String(!ready));
}

function renderDayNav(){
  const nav=el("plannerDayNav");
  if(!state.plan){nav.innerHTML="";return;}
  el("quickAddDayValue").textContent=state.selectedDay;
  nav.innerHTML=DAYS.map((day)=>{
    const selected=state.selectedDay===day,rest=state.plan.restDay===day;
    const label=rest?`${day}, recovery day`:selected?`${day}, selected for new exercises`:`Add new exercises to ${day}`;
    return `<button class="planner-day-chip ${selected?"active":""} ${rest?"recovery":""}" data-select-day="${day}" data-day-chip="${day}" type="button" aria-label="${label}" aria-pressed="${selected}" ${rest?"disabled":""}>${day.slice(0,3)}</button>`;
  }).join("");
}

function downloadWeeklyPlan(){
  if(!state.ready||!state.plan)return;
  const exported={format:"strata-weekly-plan",version:1,exportedAt:new Date().toISOString(),plan:state.plan};
  const blob=new Blob([JSON.stringify(exported,null,2)],{type:"application/json"});
  const url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=`strata-weekly-plan-${new Date().toISOString().slice(0,10)}.json`;link.hidden=true;
  document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  showToast("Weekly plan file downloaded. You can import it in Strata+.");
}

function planMovementCount(plan=state.plan){
  return DAYS.reduce((total,day)=>total+(Array.isArray(plan?.days?.[day])?plan.days[day].length:0),0);
}

function setShareStatus(message="",type=""){
  const status=el("sharePlanStatus");
  status.textContent=message;
  status.classList.toggle("error",type==="error");
  status.classList.toggle("success",type==="success");
}

function shareDate(value){
  const date=new Date(value);
  if(!Number.isFinite(date.getTime()))return "Recently updated";
  try{return `Updated ${new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(date)}`;}
  catch{return `Updated ${date.toISOString().slice(0,10)}`;}
}

function currentSharedPlan(){
  return state.sharedPlans.find((plan)=>plan&&plan.published!==false)||null;
}

function syncShareForm(plan=currentSharedPlan()){
  const publishButton=el("publishWeeklyPlan");
  publishButton.innerHTML=plan?'Update Strata+ copy <span aria-hidden="true">↗</span>':'Publish to Strata+ <span aria-hidden="true">↗</span>';
  if(!plan)return;
  if(!el("sharePlanTitle").value.trim())el("sharePlanTitle").value=String(plan.title||"").slice(0,80);
  if(!el("sharePlanDescription").value.trim())el("sharePlanDescription").value=String(plan.description||"").slice(0,240);
  el("shareDescriptionCount").textContent=`${el("sharePlanDescription").value.length} / 240`;
}

function renderOwnSharedPlans({focusId=""}={}){
  const container=el("ownSharedPlans"),plans=state.sharedPlans.filter((plan)=>plan&&plan.published!==false);
  if(!plans.length){
    state.pendingUnpublish="";
    container.innerHTML='<p class="share-list-empty">You have not shared a week yet. Publish the plan on this page when it is ready.</p>';
    syncShareForm(null);
    return;
  }
  container.innerHTML=plans.map((plan)=>{
    const id=escapeHtml(plan.id),title=escapeHtml(plan.title||"Shared week"),description=escapeHtml(plan.description||"No description added."),movementCount=planMovementCount(plan.plan),confirming=state.pendingUnpublish===String(plan.id);
    return `<article class="own-share-card"><div><h4>${title}</h4><p>${description}</p></div><div class="own-share-meta"><span>${movementCount} movement${movementCount===1?"":"s"}</span><span>${escapeHtml(shareDate(plan.updatedAt||plan.createdAt))}</span><span>By ${escapeHtml(plan.authorName||state.user?.name||"You")}</span></div><button class="unpublish-plan" data-unpublish-plan="${id}" type="button" ${state.shareBusy?"disabled":""}>${confirming?"Confirm unpublish":"Unpublish"}</button></article>`;
  }).join("");
  syncShareForm(plans[0]);
  if(focusId)focusSoon(`[data-unpublish-plan="${String(focusId).replace(/[^a-zA-Z0-9_-]/g,"")}"]`);
}

function renderShareAccess(){
  el("sharePlanGuest").hidden=!state.guest;
  el("sharePlanAccount").hidden=state.guest;
  if(!state.guest){
    if(state.sharedPlansLoaded)renderOwnSharedPlans();
    else el("ownSharedPlans").innerHTML='<p class="share-list-empty">Loading your shared plan…</p>';
  }
}

async function loadSharedPlans({announce=false}={}){
  if(state.guest||state.shareBusy)return false;
  const requestId=++state.sharedPlansRequest;
  const container=el("ownSharedPlans");
  container.setAttribute("aria-busy","true");
  if(!state.sharedPlansLoaded)container.innerHTML='<p class="share-list-empty">Loading your shared plan…</p>';
  try{
    const result=await api("/api/community-plans/mine");
    if(requestId!==state.sharedPlansRequest)return false;
    state.csrfToken=String(result.csrfToken||state.csrfToken||"");
    state.sharedPlans=Array.isArray(result.plans)?result.plans:result.plan?[result.plan]:[];
    state.sharedPlansLoaded=true;state.pendingUnpublish="";
    renderOwnSharedPlans();
    if(announce)setShareStatus("Your shared plan is up to date.","success");
    return true;
  }catch(error){
    if(requestId!==state.sharedPlansRequest)return false;
    container.innerHTML=`<p class="share-list-empty">${escapeHtml(error.message||"Your shared plan could not be loaded.")}</p>`;
    if(announce){setShareStatus(error.message||"Your shared plan could not be loaded.","error");showToast(error.message||"Could not refresh your shared plan.");}
    return false;
  }finally{if(requestId===state.sharedPlansRequest)container.setAttribute("aria-busy","false");}
}

function openSharePanel(){
  const panel=el("shareWeeklyPanel");
  panel.hidden=false;
  el("shareWeeklyPlan").setAttribute("aria-expanded","true");
  renderShareAccess();
  focusSoon("#shareWeeklyTitle");
  panel.scrollIntoView?.({behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth",block:"start"});
  if(!state.guest&&!state.sharedPlansLoaded)void loadSharedPlans();
}

function closeSharePanel(){
  el("shareWeeklyPanel").hidden=true;
  el("shareWeeklyPlan").setAttribute("aria-expanded","false");
  el("shareWeeklyPlan").focus?.();
}

function shareValidation(){
  const title=el("sharePlanTitle").value.trim(),description=el("sharePlanDescription").value.trim();
  if(state.guest)return{error:"Sign in to publish your week."};
  if(!state.csrfToken)return{error:"Your secure session is not ready. Refresh the page and try again."};
  if(title.length<3)return{error:"Give your plan a title using at least 3 characters.",focus:"sharePlanTitle"};
  if(title.length>80)return{error:"Keep the plan title to 80 characters or fewer.",focus:"sharePlanTitle"};
  if(description.length>240)return{error:"Keep the description to 240 characters or fewer.",focus:"sharePlanDescription"};
  if(planMovementCount()===0)return{error:"Add at least one workout to your week before publishing."};
  if(hasRestConflict())return{error:`Move all exercises off ${state.plan.restDay} before publishing.`};
  if(!el("sharePlanConfirm").checked)return{error:"Confirm the community privacy notice before publishing.",focus:"sharePlanConfirm"};
  return{title,description};
}

function clearShareValidation(){
  for(const control of [el("sharePlanTitle"),el("sharePlanDescription"),el("sharePlanConfirm")])control.removeAttribute?.("aria-invalid");
}

async function publishWeeklyPlan(){
  if(state.shareBusy)return;
  clearShareValidation();
  const input=shareValidation();
  if(input.error){setShareStatus(input.error,"error");if(input.focus){el(input.focus).setAttribute?.("aria-invalid","true");el(input.focus).focus?.();}return;}
  state.shareBusy=true;el("publishWeeklyPlan").disabled=true;el("refreshSharedPlans").disabled=true;
  state.sharedPlansRequest+=1;
  setShareStatus("Saving your private plan before publishing…");
  try{
    if(!await flushSave({silent:true}))throw state.lastSaveError||new Error("Your private plan could not be saved. Fix that first, then publish again.");
    setShareStatus("Publishing your week to Strata+…");
    const result=await api("/api/community-plans",{method:"POST",body:JSON.stringify({title:input.title,description:input.description,expectedPlanUpdatedAt:state.planUpdatedAt})});
    const shared=result.plan||result.communityPlan;
    if(shared)state.sharedPlans=[shared];
    else await loadSharedPlans();
    state.sharedPlansLoaded=true;state.pendingUnpublish="";el("sharePlanConfirm").checked=false;clearShareValidation();
    setShareStatus("Your week is now available in the Strata+ community library.","success");
    showToast("Your week was published to Strata+.");
  }catch(error){
    if(error.status===401)setShareStatus("Your session ended. Sign in again before publishing.","error");
    else if(error.code==="COMMUNITY_PLAN_CHANGED"||error.code==="PLAN_CHANGED")setShareStatus("Your saved Plan changed on another device or tab. Refresh this page and review it before publishing.","error");
    else setShareStatus(error.message||"Your week could not be published.","error");
    showToast(error.message||"Your week could not be published.");
  }finally{
    state.shareBusy=false;el("publishWeeklyPlan").disabled=false;el("refreshSharedPlans").disabled=false;el("ownSharedPlans").setAttribute("aria-busy","false");renderOwnSharedPlans();
  }
}

async function unpublishSharedPlan(id){
  const plan=state.sharedPlans.find((item)=>String(item?.id)===String(id));
  if(!plan||state.shareBusy)return;
  if(state.pendingUnpublish!==String(id)){
    state.pendingUnpublish=String(id);renderOwnSharedPlans({focusId:id});
    setShareStatus("Press Confirm unpublish to remove this week from Strata+. Your private Plan will stay unchanged.");
    return;
  }
  state.shareBusy=true;state.sharedPlansRequest+=1;el("publishWeeklyPlan").disabled=true;el("refreshSharedPlans").disabled=true;renderOwnSharedPlans();setShareStatus("Removing your week from Strata+…");
  let removed=false;
  try{
    await api(`/api/community-plans/${encodeURIComponent(id)}`,{method:"DELETE"});
    state.sharedPlans=state.sharedPlans.filter((item)=>String(item?.id)!==String(id));state.pendingUnpublish="";
    setShareStatus("Your week was removed from Strata+. Your private Plan is unchanged.","success");showToast("Shared week unpublished.");removed=true;
  }catch(error){
    state.pendingUnpublish="";setShareStatus(error.message||"Your shared week could not be removed.","error");showToast(error.message||"Could not unpublish the week.");
  }finally{state.shareBusy=false;el("publishWeeklyPlan").disabled=false;el("refreshSharedPlans").disabled=false;el("ownSharedPlans").setAttribute("aria-busy","false");renderOwnSharedPlans();if(removed)el("refreshSharedPlans").focus?.();}
}

function renderFilters(focusGroup=null){
  el("plannerFilters").innerHTML=GROUPS.map((group)=>`<button class="planner-filter ${state.group===group?"active":""}" data-library-group="${group}" type="button" aria-pressed="${state.group===group}">${group==="all"?"All":group}</button>`).join("");
  if(focusGroup)focusSoon(`[data-library-group="${focusGroup}"]`);
}

function filteredExercises(){
  const query=state.query.trim().toLowerCase();
  return state.exercises
    .filter((exercise)=>state.group==="all"||exercise.group===state.group)
    .filter((exercise)=>!query||`${exercise.name} ${exercise.sub} ${exercise.equipment}`.toLowerCase().includes(query))
    .sort((a,b)=>b.score-a.score);
}

function libraryPageSize(){return window.matchMedia?.("(max-width: 760px)")?.matches?LIBRARY_MOBILE_PAGE_SIZE:LIBRARY_DESKTOP_PAGE_SIZE;}
function resetLibraryWindow(){state.libraryLimit=libraryPageSize();}

function renderLibrary(){
  const items=filteredExercises(),visibleItems=items.slice(0,state.libraryLimit),remaining=Math.max(0,items.length-visibleItems.length),nextCount=Math.min(libraryPageSize(),remaining);
  el("libraryCount").textContent=items.length;
  el("libraryResultStatus").textContent=items.length?`Showing ${visibleItems.length} of ${items.length} matching movement${items.length===1?"":"s"}.`:`No matching movements.`;
  el("libraryList").innerHTML=items.length?visibleItems.map((exercise,index)=>{
    const id=escapeHtml(exercise.id),name=escapeHtml(exercise.name),sub=escapeHtml(exercise.sub),equipment=escapeHtml(exercise.equipment),youtube=escapeHtml(exercise.youtube);
    return `<article class="library-card" draggable="true" data-library-id="${id}" data-library-index="${index}"><div class="library-score"><span aria-hidden="true">${escapeHtml(exercise.score)}</span><span class="sr-only">STRATA score ${escapeHtml(exercise.score)}</span></div><div><h3>${name}</h3><p>${sub} · ${equipment}</p></div><div class="library-actions"><button data-quick-add="${id}" type="button" aria-label="Add ${name} to ${escapeHtml(state.selectedDay)}">Add</button><a class="yt-link" href="${youtube}" target="_blank" rel="noreferrer" aria-label="Find ${name} tutorials on YouTube">Video</a></div></article>`;
  }).join("")+(!remaining?"":`<div class="library-load-more"><span>${visibleItems.length} of ${items.length}</span><button data-load-more-library type="button" aria-controls="libraryList">Load ${nextCount} more <span aria-hidden="true">↓</span></button></div>`):`<div class="loading">No matching movements.</div>`;
}

function scheduledMarkup(item,day,index,count){
  const exercise=exerciseById(item.exerciseId);
  if(!exercise)return"";
  const instanceId=escapeHtml(item.instanceId),name=escapeHtml(exercise.name),titleId=`scheduled-${instanceId}`;
  const options=DAYS.map((option)=>`<option value="${option}" ${option===day?"selected":""}>${option}${option===state.plan.restDay?" — recovery":""}</option>`).join("");
  return `<article class="scheduled-card" draggable="true" data-instance-id="${instanceId}" aria-labelledby="${titleId}"><div class="scheduled-card-head"><div><h3 id="${titleId}">${name}</h3><small>${escapeHtml(exercise.sub)} · ${escapeHtml(exercise.equipment)}</small></div><div class="card-actions"><a href="${escapeHtml(exercise.youtube)}" target="_blank" rel="noreferrer" aria-label="Find ${name} tutorials on YouTube">▶</a><button data-remove-item="${instanceId}" type="button" aria-label="Remove ${name} from ${day}">×</button></div></div><div class="prescription"><label>Sets<input data-item-sets="${instanceId}" type="number" min="1" max="10" step="1" inputmode="numeric" value="${escapeHtml(item.sets)}" aria-label="Sets for ${name} on ${day}" /></label><label>Reps / time<input data-item-reps="${instanceId}" type="text" maxlength="20" value="${escapeHtml(item.reps)}" aria-label="Reps or time for ${name} on ${day}" /></label></div><div class="card-move"><label><span>Day</span><select data-item-day="${instanceId}" aria-label="Move ${name} to another day">${options}</select></label><div class="move-buttons" role="group" aria-label="Reorder ${name}"><button data-move-item="${instanceId}" data-move-direction="-1" type="button" aria-label="Move ${name} earlier on ${day}" ${index===0?"disabled":""}>↑</button><button data-move-item="${instanceId}" data-move-direction="1" type="button" aria-label="Move ${name} later on ${day}" ${index===count-1?"disabled":""}>↓</button></div></div></article>`;
}

function renderWeek(focusSelector=null){
  el("weekBoard").innerHTML=DAYS.map((day,index)=>{
    const items=state.plan.days[day],rest=state.plan.restDay===day,selected=state.selectedDay===day,conflict=rest&&items.length>0;
    const targetText=rest?"Recovery day":selected?"Adding here":"Add here";
    const restText=rest?"Current recovery day":items.length?"Clear day to make rest":"Make rest day";
    const emptyText=rest?"Recovery day · keep clear":selected?'Ready for exercises · use “Add” in the library':'Choose “Add here,” then add an exercise';
    return `<section class="day-column ${rest?"rest-day":""} ${selected?"selected-day":""} ${conflict?"rest-conflict":""}" data-day="${day}" aria-labelledby="day-title-${index}"><header class="day-head"><div class="day-index"><span>Day ${String(index+1).padStart(2,"0")}</span><span>${items.length} movement${items.length===1?"":"s"}</span></div><div class="day-title-row"><h2 id="day-title-${index}" tabindex="-1">${day}</h2><button class="day-target ${selected?"active":""}" data-select-day="${day}" type="button" aria-pressed="${selected}" ${rest?"disabled":""}>${targetText}</button></div>${rest?`<span class="rest-badge">${conflict?"Recovery day needs clearing":"Recommended rest"}</span>`:""}</header><button class="rest-toggle" data-set-rest="${day}" type="button" aria-pressed="${rest}" ${rest||items.length?"disabled":""}>${restText}</button>${rest?`<div class="rest-callout"><strong>${conflict?"Clear this day":"Recover"}</strong><p>${conflict?"Move every scheduled exercise to another day before saving further recovery changes.":"Keep this day free or use gentle mobility and walking."}</p></div>`:""}<div class="day-dropzone" data-drop-day="${day}" aria-label="${day} exercises">${items.length?items.map((item,itemIndex)=>scheduledMarkup(item,day,itemIndex,items.length)).join(""):`<div class="day-empty">${emptyText}</div>`}</div></section>`;
  }).join("");
  renderDayNav();
  renderSummary();
  focusSoon(focusSelector);
}

function renderSummary(){
  const total=DAYS.reduce((sum,day)=>sum+state.plan.days[day].length,0);
  const trainingDays=DAYS.filter((day)=>state.plan.days[day].length).length;
  const totalSets=DAYS.reduce((sum,day)=>sum+state.plan.days[day].reduce((count,item)=>count+Number(item.sets||0),0),0);
  const restConflict=state.plan.days[state.plan.restDay].length>0;
  el("weekSummary").innerHTML=`<div class="summary-stat"><span>Scheduled movements</span><strong>${total}</strong></div><div class="summary-stat"><span>Training days</span><strong>${trainingDays}</strong></div><div class="summary-stat"><span>Working sets</span><strong>${totalSets}</strong></div><div class="summary-stat ${restConflict?"summary-warning":""}"><span>Recovery day</span><strong>${state.plan.restDay}${restConflict?" · clear":""}</strong></div>`;
}

function hasRestConflict(){return Boolean(state.plan?.days?.[state.plan.restDay]?.length);}

function chooseRestDay(excluded=null){
  return REST_PREFERENCE.find((day)=>day!==excluded&&state.plan.days[day].length===0)||null;
}

function repairLegacyRestDay(){
  const current=state.plan.restDay;
  if(!state.plan.days[current].length)return null;
  const replacement=chooseRestDay(current);
  if(!replacement)return null;
  state.plan.restDay=replacement;
  return replacement;
}

function setRestDay(day,{recommended=false}={}){
  if(!state.ready||!DAYS.includes(day))return false;
  if(state.plan.days[day].length){showToast(`Move exercises off ${day} before making it a recovery day.`);return false;}
  if(state.plan.restDay===day){showToast(`${day} is already your recovery day.`);return true;}
  state.plan.restDay=day;
  if(state.selectedDay===day)state.selectedDay=DAYS.find((name)=>name!==day)||"Monday";
  renderWeek(`#day-title-${DAYS.indexOf(day)}`);
  renderLibrary();
  queueSave();
  showToast(recommended?`${day} is your recommended recovery day.`:`${day} set as recovery day.`);
  return true;
}

function prepareRecoveryForTarget(day){
  if(state.plan.restDay!==day)return{ok:true,movedTo:null};
  const replacement=chooseRestDay(day);
  if(!replacement){showToast("Clear another day before adding training to your recovery day.");return{ok:false,movedTo:null};}
  state.plan.restDay=replacement;
  return{ok:true,movedTo:replacement};
}

function addExercise(exerciseId,day){
  if(!state.ready||!DAYS.includes(day))return false;
  const exercise=exerciseById(exerciseId);
  if(!exercise)return false;
  const recovery=prepareRecoveryForTarget(day);
  if(!recovery.ok)return false;
  const setMatch=String(exercise.sets||"").match(/\d+/);
  state.plan.days[day].push({instanceId:makeId(),exerciseId,sets:Number(setMatch?.[0]||3),reps:String(exercise.reps||"8–12")});
  renderWeek();
  queueSave();
  showToast(recovery.movedTo?`${exercise.name} added to ${day}; recovery moved to ${recovery.movedTo}.`:`${exercise.name} added to ${day}.`);
  return true;
}

function moveItem(sourceDay,targetDay,instanceId,{focus=true}={}){
  if(!state.ready||!DAYS.includes(sourceDay)||!DAYS.includes(targetDay))return false;
  const source=state.plan.days[sourceDay],index=source.findIndex((item)=>item.instanceId===instanceId);
  if(index<0)return false;
  const [item]=source.splice(index,1);
  const recovery=prepareRecoveryForTarget(targetDay);
  if(!recovery.ok){source.splice(index,0,item);return false;}
  state.plan.days[targetDay].push(item);
  if(state.selectedDay===state.plan.restDay)state.selectedDay=targetDay;
  renderWeek(focus?instanceSelector("data-item-day",instanceId):null);
  renderLibrary();
  queueSave();
  const exercise=exerciseById(item.exerciseId);
  showToast(recovery.movedTo?`${exercise?.name||"Exercise"} moved to ${targetDay}; recovery moved to ${recovery.movedTo}.`:`${exercise?.name||"Exercise"} moved to ${targetDay}.`);
  return true;
}

function moveWithinDay(day,instanceId,direction){
  const items=state.plan.days[day],index=items.findIndex((item)=>item.instanceId===instanceId),next=index+direction;
  if(index<0||next<0||next>=items.length)return false;
  [items[index],items[next]]=[items[next],items[index]];
  renderWeek(instanceSelector("data-item-day",instanceId));
  queueSave();
  return true;
}

function queueSave(){
  if(!state.ready)return;
  state.revision+=1;
  clearTimeout(state.saveTimer);
  if(hasRestConflict()){setSaveStatus("Clear recovery day to save",true);return;}
  if(state.conflictReview){setSaveStatus("Review recovered changes · save when ready",true);return;}
  setSaveStatus("Unsaved changes");
  state.saveTimer=setTimeout(()=>{void flushSave();},500);
}

function setSaveStatus(message,error=false){
  const status=el("saveStatus"),retry=el("retryPlanSave");
  status.textContent=message;
  status.parentElement.classList.toggle("error",error);
  if(state.conflictDraft){retry.textContent="Review my changes";retry.hidden=false;return;}
  if(state.conflictReview){retry.textContent="Save reviewed changes";retry.hidden=false;return;}
  retry.textContent="Retry save";
  retry.hidden=!(error&&state.ready&&state.savedRevision<state.revision&&!hasRestConflict());
}

function planConflictSummary(plan){
  const rows=DAYS.map((day)=>{
    const items=Array.isArray(plan?.days?.[day])?plan.days[day]:[];
    const detail=items.length?items.map((item)=>{
      const exercise=exerciseById(item.exerciseId);
      return `${escapeHtml(exercise?.name||"Unknown movement")} <span>${escapeHtml(item.sets)} × ${escapeHtml(item.reps)}</span>`;
    }).join(", "):"No movements";
    return `<li><strong>${escapeHtml(day)}${plan?.restDay===day?" · recovery":""}</strong><p>${detail}</p></li>`;
  }).join("");
  return `<p class="plan-conflict-total">${planMovementCount(plan)} movement${planMovementCount(plan)===1?"":"s"} · ${escapeHtml(plan?.restDay||"No")} recovery day</p><ul>${rows}</ul>`;
}

function renderPlanConflict(){
  const panel=el("planConflictPanel"),local=state.conflictDraft||state.conflictReview&&state.plan;
  if(!state.conflictLatest||!local){panel.hidden=true;return;}
  el("latestPlanSummary").innerHTML=planConflictSummary(state.conflictLatest);
  el("localPlanSummary").innerHTML=planConflictSummary(local);
  el("reviewLocalPlan").hidden=state.conflictReview;
  panel.hidden=false;
}

function clearPlanConflict(){
  state.conflictDraft=null;
  state.conflictLatest=null;
  state.conflictReview=false;
  el("planConflictPanel").hidden=true;
  el("plannerShell").inert=false;
}

async function recoverPlanConflict(error,{silent=false}={}){
  let latest=error.data;
  if(!latest?.plan?.days||!Number.isSafeInteger(latest.planUpdatedAt)||latest.planUpdatedAt<0)latest=await api("/api/plan");
  if(!latest?.plan?.days||!Number.isSafeInteger(latest.planUpdatedAt)||latest.planUpdatedAt<0)throw new Error("The newer account plan could not be loaded. Refresh this page before editing again.");
  state.conflictDraft=copyPlan(state.plan);
  state.conflictLatest=copyPlan(latest.plan);
  state.conflictReview=false;
  state.plan=copyPlan(latest.plan);
  state.planUpdatedAt=latest.planUpdatedAt;
  state.lastSaveError=error;
  el("plannerShell").inert=true;
  renderWeek();renderLibrary();renderPlanConflict();
  setSaveStatus("Plan changed elsewhere · latest copy loaded",true);
  if(!silent)showToast("A newer account plan was loaded. Your unsaved changes are ready to review.");
  focusSoon("#planConflictTitle");
}

function reviewConflictDraft(){
  if(!state.conflictDraft)return false;
  state.plan=copyPlan(state.conflictDraft);
  state.conflictDraft=null;
  state.conflictReview=true;
  state.revision+=1;
  state.lastSaveError=null;
  el("plannerShell").inert=false;
  renderWeek();renderLibrary();renderPlanConflict();
  setSaveStatus("Review recovered changes · save when ready",true);
  showToast("Your unsaved changes are restored for review. Save them when you are ready.");
  focusSoon("#weekTitle");
  return true;
}

function keepLatestPlan(){
  if(!state.conflictLatest)return false;
  state.plan=copyPlan(state.conflictLatest);
  state.savedRevision=state.revision;
  state.lastSaveError=null;
  clearPlanConflict();
  renderWeek();renderLibrary();
  setSaveStatus("Latest account plan kept");
  showToast("The latest account plan was kept. Your unsaved copy was discarded.");
  focusSoon("#weekTitle");
  return true;
}

async function performSave({keepalive=true,silent=false}={}){
  if(state.savePromise)return state.savePromise;
  if(!state.ready||state.savedRevision>=state.revision)return true;
  const revision=state.revision,payload=JSON.stringify({plan:state.plan,expectedPlanUpdatedAt:state.planUpdatedAt});
  setSaveStatus("Saving…");
  const operation=(async()=>{
    // Defer both the account and guest branches until savePromise owns this
    // operation. Without the yield, a synchronous guest save can clear the
    // field before assignment and leave an already-resolved promise stuck in it.
    await Promise.resolve();
    try{
      let result;
      if(state.guest){
        if(!saveGuestPlan())throw new Error("This browser blocked local storage, so the plan could not be saved.");
        result={plan:state.plan,planUpdatedAt:state.planUpdatedAt};
      }else result=await api("/api/plan",{method:"PUT",body:payload,keepalive});
      state.savedRevision=Math.max(state.savedRevision,revision);
      if(state.revision===revision)state.plan=result.plan;
      state.planUpdatedAt=Number(result.planUpdatedAt)||state.planUpdatedAt;state.lastSaveError=null;
      if(state.conflictReview&&state.savedRevision===state.revision)clearPlanConflict();
      setSaveStatus(state.savedRevision===state.revision?(state.guest?"Saved":"Saved to account"):"Unsaved changes");
      return true;
    }catch(error){
      let saveError=error;
      if(!state.guest&&error.status===409&&error.code==="PLAN_CHANGED"){
        try{await recoverPlanConflict(error,{silent});return false;}
        catch(recoveryError){saveError=recoveryError;}
      }
      state.lastSaveError=saveError;
      setSaveStatus("Save failed · retry needed",true);
      if(!silent)showToast(saveError.message);
      return false;
    }finally{
      state.savePromise=null;
    }
  })();
  state.savePromise=operation;
  return operation;
}

async function flushSave(options={}){
  clearTimeout(state.saveTimer);
  if(state.conflictDraft){
    setSaveStatus("Plan changed elsewhere · latest copy loaded",true);
    if(!options.silent)showToast("Review your unsaved changes before saving over the newer account plan.");
    return false;
  }
  if(state.conflictReview&&!options.confirmConflict){
    setSaveStatus("Review recovered changes · save when ready",true);
    if(!options.silent)showToast("Review your recovered changes, then choose Save reviewed changes.");
    return false;
  }
  if(hasRestConflict()){
    setSaveStatus("Clear recovery day to save",true);
    if(!options.silent)showToast(`Move all exercises off ${state.plan.restDay} before saving.`);
    return false;
  }
  while(state.ready&&state.savedRevision<state.revision){
    const saved=await performSave(options);
    if(!saved)return false;
  }
  return true;
}

function sendKeepaliveSave(){
  if(!state.ready||state.savedRevision>=state.revision||state.conflictDraft||state.conflictReview||hasRestConflict())return;
  clearTimeout(state.saveTimer);
  // Reuse the tracked save operation so beforeunload and pagehide cannot
  // launch two compare-and-swap writes with the same account revision. The
  // flush loop also follows an older in-flight save with any newer edit.
  void flushSave({keepalive:true,silent:true});
}

let toastTimer;
function showToast(message){
  const toast=el("plannerToast");
  toast.textContent=message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer=setTimeout(()=>toast.classList.remove("show"),3200);
}

function handlePendingAdd(){
  const id=new URLSearchParams(location.search).get("add");
  if(!id||!exerciseById(id))return;
  const day=DAYS.find((name)=>name!==state.plan.restDay)||"Monday";
  state.selectedDay=day;
  addExercise(id,day);
  history.replaceState({},"","/planner.html");
}

function renderLoadError(error){
  const message=escapeHtml(error.message||"Unable to load your plan.");
  el("libraryCount").textContent="0";
  el("plannerFilters").innerHTML="";
  el("libraryList").innerHTML=`<div class="loading">${message}</div>`;
  el("libraryResultStatus").textContent="Exercise library could not be loaded.";
  el("plannerDayNav").innerHTML="";
  el("quickAddDayValue").textContent="Unavailable";
  el("weekSummary").innerHTML="";
  el("weekBoard").innerHTML=`<div class="planner-load-state planner-error" role="alert"><strong>Plan unavailable</strong><p>${message}</p><button type="button" data-retry-init>Try again</button></div>`;
  el("weekBoard").setAttribute("aria-busy","false");
}

document.addEventListener("dragstart",(event)=>{
  if(event.target.closest("button,a,input,select")){event.preventDefault();return;}
  const library=event.target.closest("[data-library-id]"),scheduled=event.target.closest("[data-instance-id]");
  if(library){state.drag={type:"library",exerciseId:library.dataset.libraryId};event.dataTransfer.effectAllowed="copy";}
  else if(scheduled){const day=scheduled.closest("[data-day]").dataset.day;state.drag={type:"schedule",day,instanceId:scheduled.dataset.instanceId};event.dataTransfer.effectAllowed="move";}
  else return;
  event.dataTransfer?.setData("text/plain",JSON.stringify(state.drag));
});
document.addEventListener("dragover",(event)=>{const zone=event.target.closest("[data-drop-day]");if(!zone||!state.ready)return;event.preventDefault();zone.closest(".day-column").classList.add("drag-over");});
document.addEventListener("dragleave",(event)=>{const column=event.target.closest(".day-column");if(column&&!column.contains(event.relatedTarget))column.classList.remove("drag-over");});
document.addEventListener("drop",(event)=>{
  const zone=event.target.closest("[data-drop-day]");
  if(!zone||!state.drag||!state.ready)return;
  event.preventDefault();
  document.querySelectorAll(".drag-over").forEach((node)=>node.classList.remove("drag-over"));
  const day=zone.dataset.dropDay,previousTarget=state.selectedDay;
  state.selectedDay=day;
  const moved=state.drag.type==="library"?addExercise(state.drag.exerciseId,day):moveItem(state.drag.day,day,state.drag.instanceId,{focus:false});
  if(!moved)state.selectedDay=previousTarget;
  else renderLibrary();
  state.drag=null;
});
document.addEventListener("dragend",()=>{state.drag=null;document.querySelectorAll(".drag-over").forEach((node)=>node.classList.remove("drag-over"));});

document.addEventListener("click",(event)=>{
  const filter=event.target.closest("[data-library-group]"),quick=event.target.closest("[data-quick-add]"),select=event.target.closest("[data-select-day]"),remove=event.target.closest("[data-remove-item]"),rest=event.target.closest("[data-set-rest]"),move=event.target.closest("[data-move-item]"),loadMore=event.target.closest("[data-load-more-library]"),retry=event.target.closest("[data-retry-init]"),unpublish=event.target.closest("[data-unpublish-plan]");
  if(filter){state.group=filter.dataset.libraryGroup;resetLibraryWindow();renderFilters(state.group);renderLibrary();}
  else if(quick){addExercise(quick.dataset.quickAdd,state.selectedDay);}
  else if(select){
    state.selectedDay=select.dataset.selectDay;
    const focusSelector=select.dataset.dayChip!==undefined?instanceSelector("data-day-chip",state.selectedDay):`#weekBoard ${instanceSelector("data-select-day",state.selectedDay)}`;
    renderWeek(focusSelector);renderLibrary();showToast(`New exercises will be added to ${state.selectedDay}.`);
  }
  else if(remove){
    const column=remove.closest("[data-day]"),day=column.dataset.day,items=state.plan.days[day],index=items.findIndex((item)=>item.instanceId===remove.dataset.removeItem),next=items[index+1]||items[index-1];
    if(index<0)return;
    const exercise=exerciseById(items[index].exerciseId);
    items.splice(index,1);
    renderWeek(next?instanceSelector("data-item-day",next.instanceId):`#day-title-${DAYS.indexOf(day)}`);
    queueSave();
    showToast(`${exercise?.name||"Exercise"} removed.`);
  }
  else if(rest){setRestDay(rest.dataset.setRest);}
  else if(move){const day=move.closest("[data-day]").dataset.day;moveWithinDay(day,move.dataset.moveItem,Number(move.dataset.moveDirection));}
  else if(loadMore){const firstNewIndex=state.libraryLimit;state.libraryLimit+=libraryPageSize();renderLibrary();requestAnimationFrame(()=>el("libraryList").querySelector(`[data-library-index="${firstNewIndex}"] [data-quick-add]`)?.focus());}
  else if(retry){void init();}
  else if(unpublish){void unpublishSharedPlan(unpublish.dataset.unpublishPlan);}
});

function updatePrescriptionInput(event,{normalize=false}={}){
  const column=event.target.closest("[data-day]");
  if(!column||!state.ready)return false;
  const day=column.dataset.day;
  let item,field,value;
  if(event.target.dataset.itemSets){
    item=itemByInstance(day,event.target.dataset.itemSets);field="sets";
    if(!item)return false;
    const raw=String(event.target.value).trim();
    if(!raw&&!normalize)return false;
    const numeric=Number(raw),normalized=Math.max(1,Math.min(10,Number.isFinite(numeric)&&raw?Math.round(numeric):1));
    value=normalized;
    if(normalize)event.target.value=String(normalized);
  }else if(event.target.dataset.itemReps){
    item=itemByInstance(day,event.target.dataset.itemReps);field="reps";
    if(!item)return false;
    value=String(event.target.value).trim().slice(0,20)||"8–12";
    if(normalize)event.target.value=value;
  }else return false;
  if(item[field]===value)return false;
  item[field]=value;
  renderSummary();queueSave();
  return true;
}

// Capture edits as they are typed so a background/pagehide save cannot miss a
// value merely because the field has not blurred and emitted `change` yet.
document.addEventListener("input",(event)=>{updatePrescriptionInput(event);});
document.addEventListener("change",(event)=>{
  const column=event.target.closest("[data-day]");
  if(!column||!state.ready)return;
  if(event.target.dataset.itemDay){
    const sourceDay=column.dataset.day,targetDay=event.target.value,instanceId=event.target.dataset.itemDay;
    if(sourceDay!==targetDay&&!moveItem(sourceDay,targetDay,instanceId))event.target.value=sourceDay;
    return;
  }
  updatePrescriptionInput(event,{normalize:true});
});

let librarySearchTimer=null;
el("plannerSearch").addEventListener("input",(event)=>{const query=event.target.value;clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(()=>{state.query=query;resetLibraryWindow();renderLibrary();},SEARCH_DEBOUNCE_MS);});
el("recommendRest").addEventListener("click",()=>{
  if(!state.ready)return;
  const day=chooseRestDay(state.plan.restDay);
  if(!day){showToast("Clear a day before requesting a recovery-day recommendation.");return;}
  setRestDay(day,{recommended:true});
});
el("exportWeeklyPlan").addEventListener("click",downloadWeeklyPlan);
el("retryPlanSave").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  if(state.conflictDraft){reviewConflictDraft();return;}
  button.disabled=true;
  setSaveStatus(state.conflictReview?"Saving reviewed changes…":"Retrying save…");
  try{await flushSave({confirmConflict:state.conflictReview});}
  finally{button.disabled=false;}
});
el("reviewLocalPlan").addEventListener("click",reviewConflictDraft);
el("keepLatestPlan").addEventListener("click",keepLatestPlan);
el("shareWeeklyPlan").addEventListener("click",()=>{
  if(el("shareWeeklyPanel").hidden)openSharePanel();else closeSharePanel();
});
el("closeShareWeekly").addEventListener("click",closeSharePanel);
el("sharePlanTitle").addEventListener("input",(event)=>event.target.removeAttribute?.("aria-invalid"));
el("sharePlanDescription").addEventListener("input",(event)=>{event.target.removeAttribute?.("aria-invalid");el("shareDescriptionCount").textContent=`${event.target.value.length} / 240`;});
el("sharePlanConfirm").addEventListener("change",(event)=>event.target.removeAttribute?.("aria-invalid"));
el("sharePlanForm").addEventListener("submit",(event)=>{event.preventDefault();void publishWeeklyPlan();});
el("refreshSharedPlans").addEventListener("click",()=>void loadSharedPlans({announce:true}));
el("logoutButton").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  button.disabled=true;
  const saved=await flushSave();
  if(!saved){button.disabled=false;showToast("Your plan is still unsaved. Retry saving before signing out.");return;}
  try{await api("/api/logout",{method:"POST"});window.location.replace("/");}
  catch(error){if(error.status===401)window.location.replace("/");else{button.disabled=false;showToast("Could not sign out. Check your connection and try again.");}}
});

document.addEventListener("click",(event)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey)return;
  const link=event.target.closest("a[href]");
  if(!link||link.target||link.hasAttribute("download"))return;
  const destination=new URL(link.href,location.href);
  if(destination.origin!==location.origin)return;
  // A native second click would otherwise leave while the first click is still
  // waiting for its compare-and-swap save (and possibly a follow-up revision).
  if(state.navigating){event.preventDefault();return;}
  if(!state.ready||state.savedRevision>=state.revision)return;
  event.preventDefault();
  state.navigating=true;
  void (async()=>{
    const saved=await flushSave();
    if(saved)location.assign(destination.href);
    else{state.navigating=false;showToast("Your plan is still unsaved. Retry before leaving this page.");}
  })();
});

document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")sendKeepaliveSave();});
window.addEventListener("pagehide",sendKeepaliveSave);
window.addEventListener("beforeunload",(event)=>{if(state.ready&&state.savedRevision<state.revision){sendKeepaliveSave();event.preventDefault();event.returnValue="";}});

async function init(){
  setReady(false);
  setSaveStatus("Loading plan…");
  el("libraryList").innerHTML='<div class="loading">Loading movements…</div>';
  el("weekSummary").innerHTML="";
  el("weekBoard").innerHTML='<div class="planner-load-state">Loading your weekly plan…</div>';
  try{
    const exercises=await api("/exercises.json?v=6.9.6");
    if(!Array.isArray(exercises))throw new Error("STRATA returned an incomplete exercise library.");
    state.exercises=exercises;
    let result;
    try{result=await api("/api/plan");}
    catch(error){if(error.status!==401)throw error;result={plan:guestPlan(),user:null};}
    if(!result.plan?.days)throw new Error("STRATA returned an incomplete plan.");
    state.plan=result.plan;state.user=result.user;state.guest=!result.user?.id;state.csrfToken=String(result.csrfToken||"");state.planUpdatedAt=Number(result.planUpdatedAt)||0;state.sharedPlans=[];state.sharedPlansLoaded=false;state.sharedPlansRequest=0;state.shareBusy=false;state.pendingUnpublish="";
    clearPlanConflict();
    state.revision=0;state.savedRevision=0;state.savePromise=null;state.lastSaveError=null;
    const repairedRest=repairLegacyRestDay();
    state.selectedDay=DAYS.find((day)=>day!==state.plan.restDay)||"Monday";
    el("userName").textContent=state.guest?"Account":result.user.name;
    el("userName").hidden=state.guest;
    el("logoutButton").hidden=state.guest;
    el("plannerSignIn").hidden=!state.guest;
    el("plannerModeNotice").hidden=false;
    el("plannerModeNotice").innerHTML=state.guest
      ? '<strong>Guest plan.</strong> This week stays on this device. Signing in opens a separate synced account plan. <a href="/account.html?mode=login&amp;next=planner">Open my account plan</a>.'
      : '<strong>Account plan.</strong> Changes sync securely across your signed-in devices.';
    setReady(true);
    resetLibraryWindow();renderFilters();renderLibrary();renderWeek();renderShareAccess();setSaveStatus(state.guest?"Saved":"Saved to account");
    if(!state.guest)void loadSharedPlans();
    if(repairedRest){queueSave();showToast(`Recovery moved to empty ${repairedRest} to keep it clear.`);}
    handlePendingAdd();
  }catch(error){
    state.ready=false;
    el("plannerSearch").disabled=true;el("recommendRest").disabled=true;el("exportWeeklyPlan").disabled=true;el("shareWeeklyPlan").disabled=true;
    el("plannerShell").setAttribute("aria-busy","false");el("libraryPanel").setAttribute("aria-busy","false");
    setSaveStatus("Unable to load",true);renderLoadError(error);
  }
}

init();
