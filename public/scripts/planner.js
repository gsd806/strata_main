"use strict";

const DAYS=["Monday","Tuesday","Wednesday","Thursday","Friday","Saturday","Sunday"];
const GROUPS=["all","chest","back","shoulders","arms","legs","glutes","calves","core"];
const REST_PREFERENCE=["Sunday","Thursday","Wednesday","Saturday","Friday","Tuesday","Monday"];
const LIBRARY_DESKTOP_PAGE_SIZE=32;
const LIBRARY_MOBILE_PAGE_SIZE=16;
const SEARCH_DEBOUNCE_MS=180;
const state={
  exercises:[],plan:null,user:null,query:"",group:"all",drag:null,selectedDay:"Monday",
  ready:false,saveTimer:null,savePromise:null,revision:0,savedRevision:0,navigating:false,libraryLimit:LIBRARY_DESKTOP_PAGE_SIZE
};
const el=(id)=>document.getElementById(id);

async function api(path,options={}) {
  let response;
  try {
    response=await fetch(path,{
      ...options,
      credentials:"same-origin",
      headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}
    });
  } catch(cause) {
    throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{cause});
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok) {
    const error=Object.assign(new Error(data.error||"Request failed."),{status:response.status});
    if(response.status===401&&path!=="/api/logout")window.location.replace("/");
    throw error;
  }
  return data;
}

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function exerciseById(id){return state.exercises.find((exercise)=>exercise.id===id);}
function itemByInstance(day,instanceId){return state.plan?.days?.[day]?.find((item)=>item.instanceId===instanceId);}
function makeId(){return globalThis.crypto?.randomUUID?.()||`item-${Date.now()}-${Math.random().toString(16).slice(2)}`;}
function focusSoon(selector){if(!selector)return;requestAnimationFrame(()=>document.querySelector(selector)?.focus());}
function instanceSelector(attribute,instanceId){return `[${attribute}="${String(instanceId).replace(/[^a-zA-Z0-9_-]/g,"")}"]`;}

function setReady(ready){
  state.ready=ready;
  el("plannerSearch").disabled=!ready;
  el("recommendRest").disabled=!ready;
  el("plannerShell").setAttribute("aria-busy",String(!ready));
  el("libraryPanel").setAttribute("aria-busy",String(!ready));
  el("weekBoard").setAttribute("aria-busy",String(!ready));
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
    return `<article class="library-card" draggable="true" data-library-id="${id}" data-library-index="${index}"><div class="library-score">${escapeHtml(exercise.score)}</div><div><h3>${name}</h3><p>${sub} · ${equipment}</p></div><div class="library-actions"><button data-quick-add="${id}" type="button" aria-label="Add ${name} to ${escapeHtml(state.selectedDay)}">+</button><a class="yt-link" href="${youtube}" target="_blank" rel="noreferrer" aria-label="Find ${name} tutorials on YouTube">▶</a></div></article>`;
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
    const targetText=rest?"Recovery day":selected?"Tap-add target":"Use for tap-add";
    const restText=rest?"Current recovery day":items.length?"Clear day to make rest":"Make rest day";
    return `<section class="day-column ${rest?"rest-day":""} ${selected?"selected-day":""} ${conflict?"rest-conflict":""}" data-day="${day}" aria-labelledby="day-title-${index}"><header class="day-head"><div class="day-index"><span>Day ${String(index+1).padStart(2,"0")}</span><span>${items.length} movement${items.length===1?"":"s"}</span></div><div class="day-title-row"><h2 id="day-title-${index}" tabindex="-1">${day}</h2><button class="day-target ${selected?"active":""}" data-select-day="${day}" type="button" aria-pressed="${selected}" ${rest?"disabled":""}>${targetText}</button></div>${rest?`<span class="rest-badge">${conflict?"Recovery day needs clearing":"Recommended rest"}</span>`:""}</header><button class="rest-toggle" data-set-rest="${day}" type="button" aria-pressed="${rest}" ${rest||items.length?"disabled":""}>${restText}</button>${rest?`<div class="rest-callout"><strong>${conflict?"Clear this day":"Recover"}</strong><p>${conflict?"Move every scheduled exercise to another day before saving further recovery changes.":"Keep this day free or use gentle mobility and walking."}</p></div>`:""}<div class="day-dropzone" data-drop-day="${day}" aria-label="${day} exercises">${items.length?items.map((item,itemIndex)=>scheduledMarkup(item,day,itemIndex,items.length)).join(""):`<div class="day-empty">${rest?"Recovery day · keep clear":"Drop exercises here"}</div>`}</div></section>`;
  }).join("");
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
  setSaveStatus("Unsaved changes");
  state.saveTimer=setTimeout(()=>{void flushSave();},500);
}

function setSaveStatus(message,error=false){
  el("saveStatus").textContent=message;
  el("saveStatus").parentElement.classList.toggle("error",error);
}

async function performSave({keepalive=false,silent=false}={}){
  if(state.savePromise)return state.savePromise;
  if(!state.ready||state.savedRevision>=state.revision)return true;
  const revision=state.revision,payload=JSON.stringify({plan:state.plan});
  setSaveStatus("Saving…");
  const operation=(async()=>{
    try{
      const result=await api("/api/plan",{method:"PUT",body:payload,keepalive});
      state.savedRevision=Math.max(state.savedRevision,revision);
      if(state.revision===revision)state.plan=result.plan;
      setSaveStatus(state.savedRevision===state.revision?"Saved to account":"Unsaved changes");
      return true;
    }catch(error){
      setSaveStatus("Save failed · retry needed",true);
      if(!silent)showToast(error.message);
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
  if(!state.ready||state.savedRevision>=state.revision||hasRestConflict())return;
  clearTimeout(state.saveTimer);
  const body=JSON.stringify({plan:state.plan});
  void fetch("/api/plan",{method:"PUT",body,keepalive:true,credentials:"same-origin",headers:{Accept:"application/json","Content-Type":"application/json"}}).catch(()=>{});
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
  const filter=event.target.closest("[data-library-group]"),quick=event.target.closest("[data-quick-add]"),select=event.target.closest("[data-select-day]"),remove=event.target.closest("[data-remove-item]"),rest=event.target.closest("[data-set-rest]"),move=event.target.closest("[data-move-item]"),loadMore=event.target.closest("[data-load-more-library]"),retry=event.target.closest("[data-retry-init]");
  if(filter){state.group=filter.dataset.libraryGroup;resetLibraryWindow();renderFilters(state.group);renderLibrary();}
  else if(quick){addExercise(quick.dataset.quickAdd,state.selectedDay);}
  else if(select){state.selectedDay=select.dataset.selectDay;renderWeek(instanceSelector("data-select-day",state.selectedDay));renderLibrary();showToast(`${state.selectedDay} selected for tap-add.`);}
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
});

document.addEventListener("change",(event)=>{
  const column=event.target.closest("[data-day]");
  if(!column||!state.ready)return;
  const day=column.dataset.day;
  if(event.target.dataset.itemDay){
    const sourceDay=day,targetDay=event.target.value,instanceId=event.target.dataset.itemDay;
    if(sourceDay!==targetDay&&!moveItem(sourceDay,targetDay,instanceId))event.target.value=sourceDay;
    return;
  }
  if(event.target.dataset.itemSets){
    const item=itemByInstance(day,event.target.dataset.itemSets);
    if(!item)return;
    const numeric=Number(event.target.value),normalized=Math.max(1,Math.min(10,Number.isFinite(numeric)?Math.round(numeric):1));
    item.sets=normalized;event.target.value=String(normalized);
  }else if(event.target.dataset.itemReps){
    const item=itemByInstance(day,event.target.dataset.itemReps);
    if(!item)return;
    item.reps=event.target.value.trim().slice(0,20)||"8–12";event.target.value=item.reps;
  }else return;
  renderSummary();queueSave();
});

let librarySearchTimer=null;
el("plannerSearch").addEventListener("input",(event)=>{const query=event.target.value;clearTimeout(librarySearchTimer);librarySearchTimer=setTimeout(()=>{state.query=query;resetLibraryWindow();renderLibrary();},SEARCH_DEBOUNCE_MS);});
el("recommendRest").addEventListener("click",()=>{
  if(!state.ready)return;
  const day=chooseRestDay();
  if(!day){showToast("Clear a day before requesting a recovery-day recommendation.");return;}
  setRestDay(day,{recommended:true});
});
el("logoutButton").addEventListener("click",async(event)=>{
  const button=event.currentTarget;
  button.disabled=true;
  const saved=await flushSave();
  if(!saved){button.disabled=false;showToast("Your plan is still unsaved. Retry saving before signing out.");return;}
  try{await api("/api/logout",{method:"POST"});window.location.replace("/");}
  catch(error){if(error.status===401)window.location.replace("/");else{button.disabled=false;showToast("Could not sign out. Check your connection and try again.");}}
});

document.addEventListener("click",(event)=>{
  if(event.defaultPrevented||event.button!==0||event.metaKey||event.ctrlKey||event.shiftKey||event.altKey||state.navigating)return;
  const link=event.target.closest("a[href]");
  if(!link||link.target||link.hasAttribute("download")||!state.ready||state.savedRevision>=state.revision)return;
  const destination=new URL(link.href,location.href);
  if(destination.origin!==location.origin)return;
  event.preventDefault();
  state.navigating=true;
  void (async()=>{
    const saved=await flushSave();
    if(saved)location.assign(destination.href);
    else{state.navigating=false;showToast("Your plan is still unsaved. Retry before leaving this page.");}
  })();
});

window.addEventListener("pagehide",sendKeepaliveSave);
window.addEventListener("beforeunload",(event)=>{if(state.ready&&state.savedRevision<state.revision){sendKeepaliveSave();event.preventDefault();event.returnValue="";}});

async function init(){
  setReady(false);
  setSaveStatus("Loading plan…");
  el("libraryList").innerHTML='<div class="loading">Loading movements…</div>';
  el("weekSummary").innerHTML="";
  el("weekBoard").innerHTML='<div class="planner-load-state">Loading your weekly plan…</div>';
  try{
    const [exercises,result]=await Promise.all([api("/exercises.json?v=6.7.0"),api("/api/plan")]);
    if(!Array.isArray(exercises)||!result.plan?.days)throw new Error("STRATA returned an incomplete plan.");
    state.exercises=exercises;state.plan=result.plan;state.user=result.user;
    state.revision=0;state.savedRevision=0;state.savePromise=null;
    const repairedRest=repairLegacyRestDay();
    state.selectedDay=DAYS.find((day)=>day!==state.plan.restDay)||"Monday";
    el("userName").textContent=result.user.name;
    setReady(true);
    resetLibraryWindow();renderFilters();renderLibrary();renderWeek();setSaveStatus("Saved to account");
    if(repairedRest){queueSave();showToast(`Recovery moved to empty ${repairedRest} to keep it clear.`);}
    handlePendingAdd();
  }catch(error){
    state.ready=false;
    el("plannerSearch").disabled=true;el("recommendRest").disabled=true;
    el("plannerShell").setAttribute("aria-busy","false");el("libraryPanel").setAttribute("aria-busy","false");
    setSaveStatus("Unable to load",true);renderLoadError(error);
  }
}

init();
