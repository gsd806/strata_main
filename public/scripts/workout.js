(function(){
  "use strict";
  const W=globalThis.StrataWorkout;
  const $=(id)=>document.getElementById(id);
  const esc=(value)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const number=(value)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const PREFERENCE_KEY="strata_workout_preferences_v1",REST_DURATIONS=[30,60,90,120,180,300];
  const state={mode:"",user:null,ownerId:"",contextId:W.id(),csrfToken:"",catalog:[],plan:null,day:W.dayFromSearch(location.search),workout:null,dirty:false,sequence:0,saving:null,saveTimer:null,blocked:false,conflict:null,pausedSeconds:null,timerAnnounced:false,draftKey:"",recoveries:[],history:[],offset:0,hasMore:false,historyBusy:false,detailBusy:false,loading:false,toastTimer:null};
  function toast(message){
    $("workoutToast").textContent=message;$("workoutToast").classList.add("is-visible");
    clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$("workoutToast").classList.remove("is-visible"),5000);
  }
  function status(message,kind=""){ $("saveStatus").textContent=message;$("saveStatus").dataset.state=kind; }
  function errorMessage(message){$("sessionError").textContent=message;$("sessionError").hidden=!message;}
  function exercise(id){return state.catalog.find((item)=>item.id===id)||{name:id,equipment:"",caution:""};}
  function owner(){return `account:${state.user.id}`;}
  function restorePreferences(){
    try{
      const saved=JSON.parse(localStorage.getItem(PREFERENCE_KEY)||"null");
      if(saved&&saved.version===1){
        if(typeof saved.autoRest==="boolean")$("autoRest").checked=saved.autoRest;
        if(REST_DURATIONS.includes(Number(saved.restDuration)))$("restDuration").value=String(saved.restDuration);
      }
    }catch{/* Keep the visible defaults when browser preferences are unavailable. */}
  }
  function rememberPreferences(){
    try{localStorage.setItem(PREFERENCE_KEY,JSON.stringify({version:1,autoRest:$("autoRest").checked,restDuration:Number($("restDuration").value)}));}
    catch{/* Preferences are optional; workout recovery uses a separate guarded path. */}
  }
  function saveError(error){
    if(error.status===401||error.code==="IDENTITY_CHANGED")return "Your account session changed. Your device draft has been kept. Reload and sign in to the original account to recover it.";
    if(error.status===403)return "Your secure session could not authorize the save. Reload, then review your recovered draft before saving again.";
    if(error.code==="NETWORK_ERROR")return "Not saved to your account. Check your connection, then choose Save now. Your device draft is kept where storage is available.";
    return error.message||"This session could not be saved. Your changes are still here.";
  }
  async function api(path,options={}){
    const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),15000);
    const method=options.method||"GET";
    let response;
    try{
      response=await fetch(path,{...options,signal:controller.signal,credentials:"same-origin",cache:"no-store",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(method!=="GET"?{"X-CSRF-Token":state.csrfToken,"X-Strata-User":String(state.user?.id||"")}:{}),...(options.headers||{})}});
      const data=await response.json().catch(()=>({}));
      if(response.status===401)blockSession();
      if(response.status===402)blockAccess();
      if(!response.ok)throw Object.assign(new Error(data.error||"STRATA could not complete this request."),{status:response.status,code:data.code,data});
      return data;
    }catch(error){
      if(error.status)throw error;
      throw Object.assign(new Error("Could not reach STRATA. Check your connection and try again."),{code:"NETWORK_ERROR",cause:error});
    }finally{clearTimeout(timeout);}
  }
  function blockSession(){
    state.blocked=true;clearTimeout(state.saveTimer);persistDraft();
    $("trainingRoom").hidden=true;$("historySection").hidden=true;$("recoveryPanel").hidden=true;$("conflictPanel").hidden=true;
    $("modeNotice").textContent="Your account session changed. Your draft belongs to the original account and has been kept on this device where storage is available.";
    $("loadError").hidden=false;$("loadErrorMessage").textContent="Reload the workout room to use the current account. Sign in to the original account to recover its draft. Account sessions never switch into guest mode automatically.";
    $("retryLoad").textContent="Reload workout room";
    if($("detailDialog").open)$("detailDialog").close();
    if($("finishDialog").open)$("finishDialog").close();
  }
  function blockAccess(){
    state.blocked=true;clearTimeout(state.saveTimer);persistDraft();
    $("trainingRoom").hidden=true;$("historySection").hidden=true;$("recoveryPanel").hidden=true;$("conflictPanel").hidden=true;$("accessPanel").hidden=false;
    $("modeNotice").textContent="Your Strata+ access ended. Saved sessions and device drafts are kept for when access resumes.";
    if($("detailDialog").open)$("detailDialog").close();if($("finishDialog").open)$("finishDialog").close();
  }
  async function assertIdentity(){
    if(state.mode!=="account")return;
    let current;
    try{current=await api("/api/me");}catch(error){if(error.status===401)blockSession();throw error;}
    if(String(current.user?.id)!==String(state.user.id)){
      blockSession();throw Object.assign(new Error("The signed-in account changed."),{code:"IDENTITY_CHANGED"});
    }
    if(current.user.discovery?.active!==true){blockAccess();throw Object.assign(new Error("Strata+ access is required. Your device draft has been kept."),{status:402});}
    state.csrfToken=String(current.csrfToken||"");
    if(!state.csrfToken)throw new Error("Your secure account session is not ready. Reload before saving.");
  }
  async function accountRead(path){
    const data=await api(path);
    await assertIdentity();
    return data;
  }
  function persistDraft(){
    if(!state.workout||!state.ownerId)return true;
    if(state.workout.status==="completed"&&!state.dirty)return true;
    if(!state.dirty&&Number.isInteger(state.workout.revision)){removeDraft();return true;}
    if(!state.draftKey)state.draftKey=`${W.draftPrefix(state.ownerId)}${state.contextId}:${state.workout.id}`;
    const record={ownerId:state.ownerId,contextId:state.contextId,workout:state.workout,dirty:state.dirty,pausedSeconds:state.pausedSeconds,savedAt:Date.now()};
    try{localStorage.setItem(state.draftKey,JSON.stringify(record));return true;}
    catch{return false;}
  }
  function removeDraft(key=state.draftKey){try{if(key)localStorage.removeItem(key);}catch{/* Keep the in-memory session when storage is unavailable. */}}
  function scanDrafts(){
    const items=[],staleKeys=[];
    try{
      const prefix=W.draftPrefix(state.ownerId);
      for(let index=0;index<localStorage.length;index++){
        const key=localStorage.key(index);
        if(!key?.startsWith(prefix))continue;
        const record=W.readDraft(localStorage.getItem(key),state.ownerId);
        if(record?.dirty)items.push({...record,key});
        else if(record)staleKeys.push(key);
      }
      staleKeys.forEach((key)=>localStorage.removeItem(key));
    }catch{toast("Device draft recovery is unavailable in this browser. Keep this tab open until your session is saved.");}
    state.recoveries=items.sort((a,b)=>b.savedAt-a.savedAt);
    renderRecovery();renderHistory();
  }
  function renderRecovery(){
    $("recoveryPanel").hidden=!state.recoveries.length||!!state.workout||state.blocked;
    $("recoveryList").innerHTML=state.recoveries.map((record,index)=>{
      const counts=W.progress(record.workout);
      return `<div class="recovery-item"><div><strong>${esc(record.workout.title)}</strong><small>${esc(record.workout.date)} · ${counts.completed}/${counts.total} sets · ${record.dirty?"Unsaved device changes":"Previously saved session"}</small></div><div class="actions"><button class="button secondary compact" data-recover="${index}" type="button">Review &amp; recover</button><button class="button quiet compact" data-discard="${index}" type="button">Remove device draft</button></div></div>`;
    }).join("");
  }
  function selectWorkout(workout,{dirty=false,pausedSeconds=null}={}){
    state.workout=W.copy(workout);state.dirty=dirty;state.sequence++;state.conflict=null;
    state.pausedSeconds=Number.isFinite(pausedSeconds)&&pausedSeconds>0?Math.min(3600,pausedSeconds):null;
    state.draftKey=`${W.draftPrefix(state.ownerId)}${state.contextId}:${workout.id}`;
    state.timerAnnounced=false;
    $("conflictPanel").hidden=true;$("celebration").hidden=true;$("recoveryPanel").hidden=true;
    $("startPanel").hidden=true;$("sessionPanel").hidden=false;
    errorMessage("");renderSession();persistDraft();
    status(dirty?"Recovered device draft. Review it, then choose Save now.":"Saved to your account",dirty?"error":"saved");
    $("sessionTitle").focus();
  }
  async function fetchWorkout(id){
    try{return(await accountRead(`/api/workouts/${encodeURIComponent(id)}`)).workout;}
    catch(error){if(error.status===404)return null;throw error;}
  }
  async function recover(index){
    const record=state.recoveries[index];if(!record||state.saving||state.workout)return;
    const buttons=[...$("recoveryList").querySelectorAll("button")];buttons.forEach((button)=>button.disabled=true);
    try{
      const latest=await fetchWorkout(record.workout.id);
      if(state.blocked)return;
      if(!record.dirty&&latest){
        if(latest.status==="completed"){removeDraft(record.key);scanDrafts();await openDetail(latest.id);return;}
        selectWorkout(latest,{pausedSeconds:latest.revision===record.workout.revision?record.pausedSeconds:null});
      }else{
        selectWorkout(record.workout,{dirty:!!record.dirty,pausedSeconds:record.pausedSeconds});
        if(latest&&latest.revision!==record.workout.revision)showConflict(latest);
        else if(!latest&&record.workout.revision)showConflict(null,"This session was removed from saved history. Keep your draft by explicitly saving it as a new session.");
        else if(latest&&W.matches(latest,record.workout)){state.workout.revision=latest.revision;state.dirty=false;status("Saved version recovered.","saved");persistDraft();}
      }
      if(persistDraft()&&record.key!==state.draftKey)removeDraft(record.key);
    }catch(error){toast(saveError(error));}
    finally{buttons.forEach((button)=>button.disabled=false);}
  }
  function renderPlan(){
    $("planDay").innerHTML=W.DAYS.map((day)=>`<option value="${day}"${day===state.day?" selected":""}>${day}${day===W.today()?" · today":""}</option>`).join("");
    const items=state.plan?.days?.[state.day]||[];
    const currentIndex=Math.max(0,W.DAYS.indexOf(state.day));
    const upcomingDays=[...W.DAYS.slice(currentIndex+1),...W.DAYS.slice(0,currentIndex)];
    const scheduledDay=upcomingDays.find((day)=>(state.plan?.days?.[day]||[]).length);
    const startButton=$("startWorkout"),chooseButton=$("chooseScheduledDay"),plannerLink=$("openPlannerFromEmpty"),brief=$("planBrief"),summary=W.planDaySummary(state.plan,state.day);
    $("todayLabel").textContent=`${W.localDate()} · ${state.day} plan`;
    startButton.hidden=!items.length;startButton.disabled=!state.plan||state.blocked;
    chooseButton.hidden=!!items.length||!scheduledDay;plannerLink.hidden=!!items.length||!!scheduledDay;
    if(!items.length){
      brief.hidden=true;brief.innerHTML="";
      const recovery=(state.plan?.restDays||[state.plan?.restDay]).includes(state.day);
      $("planPreview").innerHTML=`<div class="empty-state"><strong>${recovery?"Recovery is part of the plan.":"Nothing is scheduled for this day yet."}</strong>${scheduledDay?`${esc(scheduledDay)} has a workout ready. Choose it below, or edit your week in Plan.`:"Add exercises in Plan to make your first workout available."}</div>`;
      if(scheduledDay){chooseButton.dataset.day=scheduledDay;chooseButton.innerHTML=`Choose ${esc(scheduledDay)} workout <span aria-hidden="true">→</span>`;}
      else delete chooseButton.dataset.day;
      $("startHint").textContent=scheduledDay?`Your next scheduled session is ${scheduledDay}.`:"Build a session in Plan, then return here to train.";return;
    }
    brief.hidden=false;
    brief.innerHTML=`<div><span>Movements</span><strong>${summary.movements}</strong></div><div><span>Working sets</span><strong>${summary.workingSets}</strong></div><div><span>Plan day</span><strong>${esc(summary.day)}</strong></div>`;
    $("planPreview").innerHTML=items.map((item,index)=>`<article class="preview-card"><span class="preview-number">${String(index+1).padStart(2,"0")}</span><strong>${esc(exercise(item.exerciseId).name)}</strong><small>${Number(item.sets)} sets · ${esc(item.reps)}</small></article>`).join("");
    $("startHint").textContent=`${items.length} exercises · ${items.reduce((count,item)=>count+Number(item.sets),0)} planned sets. This session will be dated today.`;
  }
  function formatLabel(entry){return `${entry.measurement==="timed"?"Time":"Reps"} · ${entry.loadType==="bodyweight"?"Bodyweight":entry.loadType==="assisted"?"Assistance":"External load"}${entry.loadType!=="bodyweight"?` · ${entry.unit}`:""}`;}
  function previous(entry){
    const metric=W.metrics(entry)[0],points=W.series(state.history.filter((item)=>item.id!==state.workout?.id),W.formatKey(entry),metric.key);
    const last=points.at(-1);
    return last?`<p class="previous-result">Previous logged session · ${esc(last.date)}: <strong>${number(last.value)} ${esc(metric.unit)}</strong> (${esc(metric.label.toLowerCase())}).</p>`:"";
  }
  function option(value,label,current){return `<option value="${value}"${value===current?" selected":""}>${label}</option>`;}
  function hasActuals(entry){return entry.sets.some((set)=>set.completed||set.reps!==null||set.weight!==null||set.seconds!==null);}
  function renderEntry(entry,index){
    const ex=exercise(entry.exerciseId),timed=entry.measurement==="timed",weighted=entry.loadType!=="bodyweight",locked=hasActuals(entry)||state.workout.status==="completed",disabled=locked?" disabled":"",completedSets=entry.sets.filter((set)=>set.completed).length,next=W.nextIncompleteSet(state.workout);
    const measurement=timed?"seconds":"reps";
    return `<article class="exercise-card" data-entry="${esc(entry.id)}"><div class="exercise-heading"><span class="exercise-index">${String(index+1).padStart(2,"0")}</span><div><h3>${esc(ex.name)}</h3><p>Planned: ${entry.sets.length} × ${esc(entry.prescribedReps)}${ex.equipment?` · ${esc(ex.equipment)}`:""}</p></div><span class="exercise-progress">${completedSets}/${entry.sets.length} sets</span></div><div class="format-controls"><label class="field">Record<select data-format="measurement" aria-label="Measurement for ${esc(ex.name)}"${disabled}>${option("reps","Repetitions",entry.measurement)}${option("timed","Time in seconds",entry.measurement)}</select></label><label class="field">Load type<select data-format="loadType" aria-label="Load type for ${esc(ex.name)}"${disabled}>${option("external","External load",entry.loadType)}${option("bodyweight","Bodyweight",entry.loadType)}${option("assisted","Assistance",entry.loadType)}</select></label><label class="field">Unit<select data-format="unit" aria-label="Load unit for ${esc(ex.name)}"${disabled}${!weighted&&!locked?" disabled":""}>${option("kg","kg",entry.unit)}${option("lb","lb",entry.unit)}</select></label></div><p class="format-note">${locked?"Logging format is locked while actual values are present. Clear uncompleted values to change it.":"Check the logging format before your first set. Enter 0 explicitly if an external or assisted set has no added load."}${entry.loadType==="assisted"?" Assistance is not lifted weight; it does not create weight or volume records.":""}</p><table class="sets-table"><thead><tr><th scope="col">Set</th>${weighted?`<th scope="col">${entry.loadType==="assisted"?"Assist":"Load"} (${entry.unit})</th>`:""}<th scope="col">${timed?"Seconds":"Reps"}</th><th scope="col">Completed</th></tr></thead><tbody>${entry.sets.map((set,setIndex)=>`<tr data-set="${setIndex}" class="${set.completed?"set-complete":next?.entryId===entry.id&&next.setIndex===setIndex?"set-next":""}"><td class="set-number">${setIndex+1}</td>${weighted?`<td><input type="number" inputmode="decimal" min="0" max="1000" step="0.01" data-actual="weight" value="${set.weight??""}" placeholder="—" aria-label="${esc(ex.name)}, set ${setIndex+1}, ${entry.loadType==="assisted"?"assistance":"load"} in ${entry.unit}"${set.completed||state.workout.status==="completed"?" disabled":""}/></td>`:""}<td><input type="number" inputmode="numeric" min="1" max="${timed?3600:1000}" step="1" data-actual="${measurement}" value="${set[measurement]??""}" placeholder="—" aria-label="${esc(ex.name)}, set ${setIndex+1}, actual ${measurement}"${set.completed||state.workout.status==="completed"?" disabled":""}/></td><td><button type="button" class="button secondary set-check" data-complete="${setIndex}" aria-pressed="${set.completed}" aria-label="${set.completed?"Uncheck":"Mark complete"} ${esc(ex.name)}, set ${setIndex+1}"${state.workout.status==="completed"?" disabled":""}>${set.completed?"✓ Done":"Mark done"}</button></td></tr>`).join("")}</tbody></table>${previous(entry)}</article>`;
  }
  function renderSession(){
    const workout=state.workout;if(!workout)return;
    $("sessionTitle").textContent=workout.title;$("sessionDate").textContent=`${workout.date} · ${workout.planDay||"Training"}${workout.status==="completed"?" · awaiting save":""}`;
    $("sessionEntries").innerHTML=workout.entries.map(renderEntry).join("");
    updateSessionMeta();tick();
  }
  function updateSessionMeta(){
    if(!state.workout)return;
    const counts=W.progress(state.workout);
    $("progressCount").textContent=`${counts.completed} / ${counts.total} sets`;
    const next=W.nextIncompleteSet(state.workout),nextEntry=next?state.workout.entries[next.entryIndex]:null;
    $("progressLabel").textContent=counts.percent===100?"Every planned set is logged.":next?`Next: ${exercise(nextEntry.exerciseId).name} · set ${next.setIndex+1} of ${nextEntry.sets.length}.`:"Take it one set at a time.";
    $("sessionProgress").value=counts.percent;$("progressRing").setAttribute("aria-label",`${counts.percent} percent complete`);
    $("ringValue").style.strokeDashoffset=String(100-counts.percent);
    $("finishHint").textContent=counts.total===counts.completed?"All planned sets are logged. Finish when you’re ready.":`${counts.total-counts.completed} sets remain. You can finish early; only checked sets count.`;
    $("finishWorkout").disabled=!counts.completed||state.workout.status==="completed"||!!state.conflict||state.blocked;
    $("saveNow").disabled=!!state.saving||!!state.conflict||state.blocked;
    $("closeSession").disabled=!!state.saving||!!state.conflict||state.blocked||state.workout.status!=="active";
    $("timerToggle").disabled=state.workout.status!=="active"||state.blocked;
    $("timerReset").disabled=state.workout.status!=="active"||state.blocked;
    $("nextSet").disabled=!next||state.workout.status!=="active"||state.blocked;
    $("nextSet").setAttribute("aria-label",next?`Go to ${exercise(nextEntry.exerciseId).name}, set ${next.setIndex+1}`:"All planned sets are logged");
  }
  function focusNextSet(){
    const next=W.nextIncompleteSet(state.workout);if(!next)return;
    const card=$("sessionEntries").querySelector(`[data-entry="${CSS.escape(next.entryId)}"]`),row=card?.querySelector(`[data-set="${next.setIndex}"]`);
    row?.scrollIntoView({behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth",block:"center"});
    (row?.querySelector("input:not(:disabled)")||row?.querySelector("button:not(:disabled)"))?.focus();
  }
  function markDirty({save=true}={}){
    if(!state.workout||state.blocked)return;
    state.dirty=true;state.sequence++;
    if(state.workout.status==="active")state.workout.elapsedSeconds=Math.min(604800,Math.max(0,Math.floor((Date.now()-state.workout.startedAt)/1000)));
    const stored=persistDraft();
    status(stored?"Device draft kept · account save pending":"Device recovery unavailable. Keep this tab open until saved.",stored?"":"error");
    clearTimeout(state.saveTimer);
    if(save&&!state.conflict)state.saveTimer=setTimeout(()=>void flushSave(),900);
  }
  function showConflict(latest,message=""){
    clearTimeout(state.saveTimer);state.conflict={latest};state.dirty=true;persistDraft();
    $("conflictPanel").hidden=false;
    if(message)$("conflictMessage").textContent=message;
    else $("conflictMessage").textContent="This session changed in another tab or device. Choose the latest saved version, or explicitly save your changes as a separate session. Neither version has been overwritten.";
    const mine=W.progress(state.workout),saved=latest?W.progress(latest):null;
    $("conflictComparison").innerHTML=`<div><strong>Latest saved version</strong><span>${latest?`${esc(latest.title)} · ${saved.completed}/${saved.total} sets · revision ${Number(latest.revision)}`:"This session is no longer in saved history."}</span></div><div><strong>Your device draft</strong><span>${esc(state.workout.title)} · ${mine.completed}/${mine.total} sets · ${esc(state.workout.status)}</span></div>`;
    $("useLatest").disabled=!latest;status("Save conflict. Review both versions above.","error");updateSessionMeta();$("conflictTitle").focus();
  }
  async function flushSave(){
    clearTimeout(state.saveTimer);
    if(!state.workout||!state.dirty||state.blocked||state.conflict)return false;
    if(state.saving){await state.saving;return state.dirty&&!state.conflict&&!state.blocked?flushSave():!state.dirty;}
    const snapshot=W.copy(state.workout),sequence=state.sequence;
    status(state.mode==="account"?"Saving to your account…":"Saving on this device…");
    const save=(async()=>{
      try{
        let saved;
        {
          await assertIdentity();
          const body=snapshot.revision?{workout:W.payload(snapshot),expectedRevision:snapshot.revision}:{workout:W.payload(snapshot)};
          const result=await api(snapshot.revision?`/api/workouts/${encodeURIComponent(snapshot.id)}`:"/api/workouts",{method:snapshot.revision?"PUT":"POST",body:JSON.stringify(body)});
          saved=result.workout;
          await assertIdentity();
        }
        if(!saved||!Number.isInteger(saved.revision))throw new Error("The save response was incomplete. Your draft is still available; retry before leaving.");
        if(!W.matches(saved,snapshot)){showConflict(saved,"The saved session differs from this request. Review the latest saved version before choosing what to keep.");return false;}
        state.workout.revision=saved.revision;state.workout.updatedAt=saved.updatedAt;
        state.dirty=state.sequence!==sequence;
        upsertHistory(W.summary(saved));
        if(!state.dirty){
          status(state.mode==="account"?"Saved to your account":"Saved on this device only","saved");if(!$("sessionEntries").querySelector("input[aria-invalid=true]"))errorMessage("");
          if(saved.status==="completed"){removeDraft();showCompleted(saved);}else persistDraft();
        }else{persistDraft();state.saveTimer=setTimeout(()=>void flushSave(),300);}
        return true;
      }catch(error){
        if(error.status===409&&error.code==="ACTIVE_WORKOUT_EXISTS"&&error.data?.workout){
          resumeExistingActive(error.data.workout,sequence);return false;
        }
        if(error.status===409&&(!error.code||error.code==="WORKOUT_CONFLICT")){
          const latest=error.data?.workout||null;showConflict(latest);return false;
        }
        if(error.status===404&&snapshot.revision){showConflict(null,"This session was removed from saved history. Keep your draft by explicitly saving it as a new session.");return false;}
        if(error.status===401||error.code==="IDENTITY_CHANGED")blockSession();
        status(saveError(error),"error");errorMessage(saveError(error));persistDraft();return false;
      }
    })();
    state.saving=save;updateSessionMeta();
    try{return await save;}finally{state.saving=null;updateSessionMeta();}
  }
  function upsertHistory(summary){
    state.history=[summary,...state.history.filter((item)=>item.id!==summary.id)].sort((a,b)=>b.startedAt-a.startedAt);
    renderHistory();
  }
  function resumeExistingActive(workout,snapshotSequence){
    const rejectedDraftKey=state.draftKey,changedWhileSaving=state.sequence!==snapshotSequence;
    if(changedWhileSaving)persistDraft();else removeDraft(rejectedDraftKey);
    selectWorkout(workout);upsertHistory(W.summary(workout));
    $("sessionPanel").scrollIntoView({block:"start"});
    toast(changedWhileSaving?"Your existing workout was resumed. Changes made in this tab are kept as a separate device recovery draft.":"You already had a workout in progress, so STRATA resumed it instead of starting another.");
  }
  function showCompleted(workout){
    $("sessionPanel").hidden=true;$("celebration").hidden=false;$("conflictPanel").hidden=true;
    const counts=W.progress(workout);
    $("celebrationMessage").textContent=`${counts.completed} completed set${counts.completed===1?"":"s"} · ${workout.entries.length} planned movements · ${W.duration(workout.elapsedSeconds)} since start. ${state.mode==="account"?"Saved to your account.":"Saved on this device only."}`;
    toast("Workout complete. Your history is updated.");
    $("celebration").scrollIntoView({block:"center"});
  }
  function returnToPlan(){
    state.workout=null;state.draftKey="";state.pausedSeconds=null;$("celebration").hidden=true;$("sessionPanel").hidden=true;$("startPanel").hidden=false;scanDrafts();renderPlan();($("startWorkout").hidden?$("planDay"):$("startWorkout")).focus();
  }
  function exportDraft(){
    if(!state.workout)return;
    const blob=new Blob([JSON.stringify({format:"strata-workout-draft",version:1,workout:state.workout,unsaved:state.dirty,pausedRestSeconds:state.pausedSeconds},null,2)],{type:"application/json"});
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`strata-workout-${state.workout.date}-${state.workout.id}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function tick(){
    const workout=state.workout;if(!workout||state.blocked)return;
    $("sessionElapsed").textContent=W.duration(workout.status==="completed"?workout.elapsedSeconds:Math.min(604800,Math.max(0,Math.floor((Date.now()-workout.startedAt)/1000))));
    const remaining=workout.restEndsAt?W.remainingSeconds(workout.restEndsAt):state.pausedSeconds??Number($("restDuration").value);
    $("restClock").textContent=W.duration(remaining);
    $("timerToggle").textContent=workout.restEndsAt&&remaining>0?"Pause":state.pausedSeconds?"Resume":"Start rest";
    if(workout.restEndsAt&&remaining===0&&!state.timerAnnounced){state.timerAnnounced=true;toast("Rest timer finished. Continue when you’re ready.");}
  }
  function startRest(seconds=Number($("restDuration").value)){
    if(!state.workout||state.workout.status!=="active"||state.blocked)return;
    state.workout.restEndsAt=Date.now()+seconds*1000;state.pausedSeconds=null;state.timerAnnounced=false;markDirty();tick();
  }
  function chartEntries(){
    const result=new Map();
    for(const workout of state.history.filter((item)=>item.status==="completed"))for(const entry of workout.exerciseSummaries||[]){
      if(entry.completedSets>0)result.set(W.formatKey(entry),entry);
    }
    return [...result.entries()].sort((a,b)=>exercise(a[1].exerciseId).name.localeCompare(exercise(b[1].exerciseId).name));
  }
  function renderChartControls(){
    const current=$("chartExercise").value,entries=chartEntries();
    $("chartEmpty").hidden=!!entries.length;$("chartControls").hidden=!entries.length;
    $("chartExercise").innerHTML=entries.map(([key,entry])=>`<option value="${esc(key)}">${esc(exercise(entry.exerciseId).name)} · ${esc(formatLabel(entry))}</option>`).join("");
    if(entries.some(([key])=>key===current))$("chartExercise").value=current;
    renderMetricOptions();
  }
  function renderMetricOptions(){
    const entry=chartEntries().find(([key])=>key===$("chartExercise").value)?.[1],current=$("chartMetric").value;
    $("chartMetric").innerHTML=entry?W.metrics(entry).map((metric)=>`<option value="${metric.key}">${esc(metric.label)} (${esc(metric.unit)})</option>`).join(""):"";
    if(entry&&W.metrics(entry).some((metric)=>metric.key===current))$("chartMetric").value=current;
    renderChart();
  }
  function renderChart(){
    const entry=chartEntries().find(([key])=>key===$("chartExercise").value)?.[1];
    if(!entry){$("performanceChart").innerHTML="";return;}
    const metric=W.metrics(entry).find((item)=>item.key===$("chartMetric").value);
    const points=W.series(state.history,$("chartExercise").value,metric.key),best=W.bestInWindow(points);
    if(!points.length){$("performanceChart").innerHTML="<p class='chart-no-data'>No completed sets in this logging format yet.</p>";return;}
    const top=Math.max(1,best),left=45,right=355,bottom=159,height=125;
    const coords=points.map((point,index)=>({x:points.length===1?200:left+index/(points.length-1)*(right-left),y:bottom-point.value/top*height}));
    const table=points.map((point)=>`<tr><td>${esc(point.date)}</td><td>${number(point.value)} ${esc(metric.unit)}</td></tr>`).join("");
    $("performanceChart").innerHTML=`<div class="chart-best"><strong>${number(best)} <small>${esc(metric.unit)}</small></strong><span>Best in loaded history</span></div><svg class="chart-svg" viewBox="0 0 375 196" role="img" aria-label="${esc(metric.label)} across ${points.length} completed session${points.length===1?"":"s"}. Best in loaded history: ${number(best)} ${esc(metric.unit)}. Exact values in the table below."><line class="chart-grid" x1="${left}" x2="${right}" y1="34" y2="34"/><line class="chart-grid" x1="${left}" x2="${right}" y1="96.5" y2="96.5"/><line class="chart-baseline" x1="${left}" x2="${right}" y1="${bottom}" y2="${bottom}"/><text class="chart-label" x="0" y="38">${number(top)}</text><text class="chart-label" x="0" y="101">${number(top/2)}</text><text class="chart-label" x="0" y="163">0</text>${points.length>1?`<polyline class="chart-line" points="${coords.map((point)=>`${point.x},${point.y}`).join(" ")}"/>`:""}${coords.map((point,index)=>`<circle class="chart-dot" cx="${point.x}" cy="${point.y}" r="5"><title>${esc(points[index].date)}: ${number(points[index].value)} ${esc(metric.unit)}</title></circle>`).join("")}<text class="chart-label" x="${left}" y="186">${esc(points[0].date)}</text>${points.length>1?`<text class="chart-label" x="${right}" y="186" text-anchor="end">${esc(points.at(-1).date)}</text>`:""}</svg>${points.length===1?"<p class='single-point-note'>Your first data point. Another completed session makes a comparison possible.</p>":"<p class='single-point-note'>Sessions are spaced equally in chronological order.</p>"}<details class="chart-data"><summary>View exact session values</summary><table class="chart-table"><thead><tr><th scope="col">Session date</th><th scope="col">${esc(metric.label)}</th></tr></thead><tbody>${table}</tbody></table></details>`;
    $("chartScope").textContent=`Based on ${points.length} matching completed session${points.length===1?"":"s"} in ${state.history.length} loaded sessions${state.hasMore?"; load more to extend the window":""}. Formats and units are compared separately. ${entry.loadType==="assisted"?"Assistance is excluded from load records; rep comparisons do not account for differing assistance.":entry.loadType==="bodyweight"?"Bodyweight is excluded from external load and volume records.":entry.measurement==="timed"?"Timed sets are measured in seconds and do not generate weight-volume records.":"Volume uses only completed sets with recorded external loads."}`;
  }
  function renderHistory(){
    const completed=state.history.filter((item)=>item.status==="completed"),sets=completed.reduce((total,item)=>total+item.completedSets,0),active=state.history.filter((item)=>item.status==="active").length;
    const recoveryIds=new Set(state.recoveries.filter((record)=>record.dirty).map((record)=>record.workout.id));
    const visibleHistory=state.history.filter((item)=>item.status!=="active"||!recoveryIds.has(item.id));
    $("historyStats").innerHTML=`<div><strong>${completed.length}</strong><span>Completed · loaded history</span></div><div><strong>${sets}</strong><span>Sets in completed sessions</span></div><div><strong>${active}</strong><span>Open · loaded history</span></div>`;
    $("historyList").innerHTML=visibleHistory.length?visibleHistory.map((item)=>`<article class="history-row"><div><span class="status-chip${item.status==="active"?" active":""}">${item.status==="active"?"In progress":"Completed"}</span><h4>${esc(item.title)}</h4><p>${esc(item.date)} · ${item.completedSets}/${item.totalSets} sets · ${W.duration(item.elapsedSeconds)}</p></div><button type="button" class="button secondary compact" data-history="${esc(item.id)}">${item.status==="active"?"Resume":"View"}</button></article>`).join(""):recoveryIds.size?"<div class='empty-state'><strong>Review your device draft above.</strong>The saved session stays separate until you choose which work to keep.</div>":"<div class='empty-state'><strong>Your story starts with one session.</strong>Start from your plan and your completed work will appear here.</div>";
    $("loadMore").hidden=!state.hasMore;$("loadMore").disabled=state.historyBusy;renderChartControls();
  }
  async function loadHistory({more=false}={}){
    if(state.historyBusy||state.blocked)return;
    state.historyBusy=true;$("refreshHistory").disabled=true;$("loadMore").disabled=true;$("historyError").hidden=true;
    try{
      let result;
      result=await accountRead(`/api/workouts?limit=20&offset=${more?state.offset:0}`);
      if(!Array.isArray(result.workouts)||typeof result.hasMore!=="boolean")throw new Error("Workout history returned an incomplete response. Try again.");
      state.offset=(more?state.offset:0)+result.workouts.length;
      const combined=more?[...state.history,...result.workouts]:result.workouts;
      state.history=[...new Map(combined.map((item)=>[item.id,item])).values()].sort((a,b)=>b.startedAt-a.startedAt);
      state.hasMore=result.hasMore;renderHistory();
    }catch(error){
      if(error.status===401)blockSession();
      $("historyError").hidden=false;$("historyError").textContent=saveError(error);
    }finally{state.historyBusy=false;$("refreshHistory").disabled=false;$("loadMore").disabled=false;}
  }
  async function openDetail(id){
    if(state.detailBusy||state.blocked)return;
    state.detailBusy=true;
    try{
      const workout=await fetchWorkout(id);if(!workout)throw new Error("This session is no longer in saved history. Refresh the history list.");
      if(workout.status==="active"){
        if(state.workout?.status==="active"&&state.workout.id!==workout.id){toast("Choose Save & close for your current session before switching. You can resume it later.");return;}
        if(state.dirty){toast("Review and save your current device changes before resuming a saved session.");return;}
        selectWorkout(workout);$("sessionPanel").scrollIntoView({block:"start"});return;
      }
      $("detailTitle").textContent=workout.title;
      const counts=W.progress(workout);
      $("detailBody").innerHTML=`<p>${esc(workout.date)} · ${counts.completed}/${counts.total} completed sets · ${W.duration(workout.elapsedSeconds)} since start</p>${workout.entries.map((entry)=>`<section class="detail-exercise"><h3>${esc(exercise(entry.exerciseId).name)}</h3><p>${esc(formatLabel(entry))} · planned ${esc(entry.prescribedReps)}</p>${entry.sets.map((set,index)=>`<div class="detail-set${set.completed?"":" unfinished"}"><span>Set ${index+1}</span><span>${set[entry.measurement==="timed"?"seconds":"reps"]??"—"} ${entry.measurement==="timed"?"sec":"reps"}${entry.loadType!=="bodyweight"?` · ${set.weight??"—"} ${entry.unit}${entry.loadType==="assisted"?" assistance":""}`:""}</span><span class="${set.completed?"done":""}">${set.completed?"✓ Done":"Unfinished"}</span></div>`).join("")}</section>`).join("")}`;
      $("detailDialog").showModal();
    }catch(error){toast(saveError(error));}
    finally{state.detailBusy=false;}
  }
  async function initialize(){
    if(state.loading)return;
    if(state.blocked){location.reload();return;}
    state.loading=true;$("loadError").hidden=true;$("accessPanel").hidden=true;restorePreferences();
    try{
      const identity=await api("/api/me");
      if(!identity.user?.id)throw new Error("Sign in to Strata+ to open your workout room.");
      if(identity.user.discovery?.active!==true){$("accessPanel").hidden=false;$("modeNotice").textContent="Workout logging and history are included in Strata+.";return;}
      state.mode="account";state.user=identity.user;state.csrfToken=String(identity.csrfToken||"");state.ownerId=owner();
      const catalog=await fetch("/exercises.json",{credentials:"same-origin"});
      if(!catalog.ok)throw new Error("The exercise library could not be loaded.");
      state.catalog=await catalog.json();if(!Array.isArray(state.catalog))throw new Error("The exercise library response was incomplete.");
      const planResult=await accountRead("/api/plan");
      if(String(planResult.user?.id)!==String(state.user.id)){blockSession();return;}
      state.plan=planResult.plan;
      if(!state.plan?.days)throw new Error("Your account plan could not be loaded. Retry to continue.");
      $("modeNotice").innerHTML=`<strong>${esc(state.user.name||"Your account")}’s Strata+ workout room.</strong> Sessions sync to your account. Unsaved recovery drafts may remain in this browser. <a href='/account.html'>Account settings</a>`;
      $("trainingRoom").hidden=false;$("historySection").hidden=false;renderPlan();scanDrafts();await loadHistory();
      if(location.hash==="#historySection"&&!state.blocked){$("historySection").scrollIntoView({block:"start"});$("historyTitle").focus();}
    }catch(error){
      $("loadError").hidden=false;$("loadErrorMessage").textContent=saveError(error);
      $("modeNotice").textContent="The workout room could not load. Your saved sessions and device drafts have been kept.";
    }finally{state.loading=false;}
  }
  $("retryLoad").addEventListener("click",()=>void initialize());
  $("planDay").addEventListener("change",()=>{
    state.day=$("planDay").value;
    const url=new URL(location.href);url.searchParams.set("day",state.day);history.replaceState(null,"",url);
    renderPlan();
  });
  $("chooseScheduledDay").addEventListener("click",()=>{
    const day=$("chooseScheduledDay").dataset.day;
    if(!W.DAYS.includes(day))return;
    state.day=day;
    const url=new URL(location.href);url.searchParams.set("day",state.day);history.replaceState(null,"",url);
    renderPlan();$("startWorkout").focus();
  });
  $("startWorkout").addEventListener("click",()=>{
    if(state.workout?.status==="active"||state.blocked)return;
    if(state.historyBusy){toast("Checking your saved sessions. Try again in a moment.");return;}
    const active=state.history.find((item)=>item.status==="active");
    if(active){
      toast("You already have a workout in progress. Resume it before starting another.");
      const recoveryIndex=state.recoveries.findIndex((record)=>record.dirty&&record.workout.id===active.id);
      if(recoveryIndex>=0){
        $("recoveryPanel").scrollIntoView({block:"start"});
        $("recoveryList").querySelector(`[data-recover="${recoveryIndex}"]`)?.focus();
      }else{
        $("historySection").scrollIntoView({block:"start"});
        [...$("historyList").querySelectorAll("[data-history]")].find((button)=>button.dataset.history===active.id)?.focus();
      }
      return;
    }
    try{selectWorkout(W.createWorkout(state.plan,state.day,state.catalog),{dirty:true});markDirty();$("sessionPanel").scrollIntoView({block:"start"});}
    catch(error){toast(error.message);}
  });
  $("sessionEntries").addEventListener("input",(event)=>{
    const input=event.target.closest("[data-actual]");if(!input||state.blocked)return;
    const entry=state.workout?.entries.find((item)=>item.id===input.closest("[data-entry]").dataset.entry),set=entry?.sets[Number(input.closest("[data-set]").dataset.set)];
    if(!set||set.completed||state.workout.status!=="active")return;
    const value=input.value===""?null:Number(input.value);
    if(!input.validity.valid||value!==null&&!Number.isFinite(value)){input.setAttribute("aria-invalid","true");errorMessage("Use the allowed range and whole reps or seconds; loads allow at most 2 decimal places. This value has not been applied.");return;}
    input.removeAttribute("aria-invalid");errorMessage("");set[input.dataset.actual]=value;markDirty();
    const card=input.closest("[data-entry]");card.querySelectorAll("[data-format]").forEach((select)=>select.disabled=hasActuals(entry)||(select.dataset.format==="unit"&&entry.loadType==="bodyweight"));
  });
  $("sessionEntries").addEventListener("change",(event)=>{
    const select=event.target.closest("[data-format]");if(!select||state.blocked)return;
    const entry=state.workout.entries.find((item)=>item.id===select.closest("[data-entry]").dataset.entry);if(!entry||hasActuals(entry)||state.workout.status!=="active")return;
    entry[select.dataset.format]=select.value;
    if(entry.loadType==="bodyweight")entry.unit="kg";
    markDirty();renderSession();
  });
  $("sessionEntries").addEventListener("click",(event)=>{
    const button=event.target.closest("[data-complete]");if(!button||state.blocked||state.workout?.status!=="active")return;
    const entry=state.workout.entries.find((item)=>item.id===button.closest("[data-entry]").dataset.entry),index=Number(button.dataset.complete),set=entry.sets[index];
    const invalid=button.closest("tr").querySelector("input[aria-invalid=true]");
    if(invalid){invalid.focus();errorMessage("Correct this set’s highlighted actual value before completing it.");return;}
    if(!set.completed){const error=W.actualError(entry,set);if(error){errorMessage(`${exercise(entry.exerciseId).name}, set ${index+1}: ${error}`);button.closest("tr").querySelector("input:not(:disabled)")?.focus();return;}}
    set.completed=!set.completed;errorMessage("");
    if(set.completed&&$("autoRest").checked)startRest();else markDirty();
    renderSession();
    $("sessionEntries").querySelector(`[data-entry="${CSS.escape(entry.id)}"] [data-complete="${index}"]`)?.focus();
  });
  $("timerToggle").addEventListener("click",()=>{
    if(!state.workout||state.workout.status!=="active")return;
    const remaining=W.remainingSeconds(state.workout.restEndsAt);
    if(state.workout.restEndsAt&&remaining>0){state.pausedSeconds=remaining;state.workout.restEndsAt=null;markDirty();tick();}
    else startRest(state.pausedSeconds||Number($("restDuration").value));
  });
  $("timerReset").addEventListener("click",()=>{if(!state.workout||state.workout.status!=="active")return;state.workout.restEndsAt=null;state.pausedSeconds=null;state.timerAnnounced=false;markDirty();tick();});
  $("restDuration").addEventListener("change",()=>{rememberPreferences();tick();});
  $("autoRest").addEventListener("change",rememberPreferences);
  $("nextSet").addEventListener("click",focusNextSet);
  $("saveNow").addEventListener("click",()=>void flushSave());
  $("closeSession").addEventListener("click",async()=>{
    if(!state.workout||state.workout.status!=="active"||state.conflict||state.blocked)return;
    const invalid=$("sessionEntries").querySelector("input[aria-invalid=true]");
    if(invalid){invalid.focus();errorMessage("Correct or clear the highlighted actual value before saving and closing.");return;}
    if(state.dirty)await flushSave();
    if(state.dirty||state.saving||state.conflict||state.blocked)return;
    persistDraft();returnToPlan();toast("Session saved. Resume it from your history whenever you’re ready.");
  });
  $("exportDraft").addEventListener("click",exportDraft);$("exportConflict").addEventListener("click",exportDraft);
  $("finishWorkout").addEventListener("click",()=>{
    if(!state.workout||state.conflict||state.blocked||state.workout.status!=="active")return;
    const invalid=$("sessionEntries").querySelector("input[aria-invalid=true]");if(invalid){invalid.focus();errorMessage("Correct or clear the highlighted actual value before finishing.");return;}
    const counts=W.progress(state.workout);if(!counts.completed)return;
    $("finishDialogMessage").textContent=`You’ve completed ${counts.completed} of ${counts.total} sets. ${counts.total-counts.completed} sets will remain unfinished.`;
    $("finishDialog").returnValue="cancel";$("finishDialog").showModal();
  });
  $("finishDialog").addEventListener("close",()=>{
    if($("finishDialog").returnValue!=="finish"||state.blocked||state.conflict||!state.workout)return;
    state.workout.status="completed";state.workout.completedAt=Date.now();state.workout.elapsedSeconds=Math.min(604800,Math.max(0,Math.floor((state.workout.completedAt-state.workout.startedAt)/1000)));state.workout.restEndsAt=null;state.pausedSeconds=null;
    markDirty({save:false});renderSession();void flushSave();
  });
  $("anotherSession").addEventListener("click",()=>{
    if(state.dirty||state.saving)return;
    returnToPlan();
  });
  $("recoveryList").addEventListener("click",(event)=>{
    const recoverButton=event.target.closest("[data-recover]");if(recoverButton){void recover(Number(recoverButton.dataset.recover));return;}
    const discardButton=event.target.closest("[data-discard]");if(!discardButton)return;
    const record=state.recoveries[Number(discardButton.dataset.discard)];if(!record)return;
    if(!confirm("Remove this device recovery draft? Unsaved changes in this draft will be lost. Saved account or guest history will remain."))return;
    removeDraft(record.key);scanDrafts();
  });
  $("useLatest").addEventListener("click",()=>{
    const latest=state.conflict?.latest;if(!latest)return;
    if(!confirm("Use the latest saved version and discard this tab’s unsaved changes? Download your draft first if you want a separate copy."))return;
    removeDraft();selectWorkout(latest);if(latest.status==="completed"){removeDraft();showCompleted(latest);}upsertHistory(W.summary(latest));
  });
  $("saveCopy").addEventListener("click",()=>{
    if(!state.conflict||state.saving)return;
    const oldKey=state.draftKey,copy=W.copy(state.workout);copy.id=W.id();delete copy.revision;delete copy.updatedAt;copy.title=`${copy.title.replace(/ \(recovered copy\)$/u,"").slice(0,100)} (recovered copy)`;
    selectWorkout(copy,{dirty:true,pausedSeconds:state.pausedSeconds});
    if(persistDraft())removeDraft(oldKey);markDirty({save:false});void flushSave();
  });
  $("historyList").addEventListener("click",(event)=>{const button=event.target.closest("[data-history]");if(button)void openDetail(button.dataset.history);});
  $("refreshHistory").addEventListener("click",()=>void loadHistory());$("loadMore").addEventListener("click",()=>void loadHistory({more:true}));
  $("chartExercise").addEventListener("change",renderMetricOptions);$("chartMetric").addEventListener("change",renderChart);
  $("closeDetail").addEventListener("click",()=>$("detailDialog").close());
  window.addEventListener("beforeunload",(event)=>{persistDraft();if(state.dirty){event.preventDefault();event.returnValue="";}});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")persistDraft();else if(state.mode==="account"&&!state.blocked)void assertIdentity().catch((error)=>{if(error.status!==401&&error.code!=="IDENTITY_CHANGED")status(saveError(error),"error");});tick();});
  window.addEventListener("online",()=>{if(state.dirty&&!state.blocked&&!state.conflict)toast("Connection restored. Choose Save now to retry your pending account changes.");});
  setInterval(tick,1000);
  void initialize();
})();
