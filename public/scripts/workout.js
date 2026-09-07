(function(){
  "use strict";
  const W=globalThis.StrataWorkout;
  const G=globalThis.StrataDiscovery;
  const $=(id)=>document.getElementById(id);
  const esc=(value)=>String(value??"").replace(/[&<>"']/g,(character)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
  const number=(value)=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:2});
  const signal=name=>globalThis.StrataSignals?.record?.(name);
  const PREFERENCE_KEY="strata_workout_preferences_v1",OFFLINE_CONTEXT_KEY="strata_workout_offline_context_v1",REST_DURATIONS=[30,60,90,120,180,300];
  const state={mode:"",user:null,ownerId:"",contextId:W.id(),csrfToken:"",catalog:[],plan:null,planUpdatedAt:0,day:W.dayFromSearch(location.search),workout:null,dirty:false,sequence:0,saving:null,saveTimer:null,blocked:false,conflict:null,pausedSeconds:null,timerAnnounced:false,draftKey:"",recoveries:[],history:[],offset:0,hasMore:false,historyBusy:false,memoryHistory:[],memoryExhausted:false,memoryBusy:false,memoryReady:false,memoryError:"",detailBusy:false,loading:false,toastTimer:null,checkInBusy:false,adaptation:null,swapEntryId:"",swapCandidateId:"",swapProposal:null,swapBusy:false,swapTrigger:null,offlineAccessUntil:0};
  function toast(message){
    $("workoutToast").textContent=message;$("workoutToast").classList.add("is-visible");
    clearTimeout(state.toastTimer);state.toastTimer=setTimeout(()=>$("workoutToast").classList.remove("is-visible"),5000);
  }
  function status(message,kind=""){ $("saveStatus").textContent=message;$("saveStatus").dataset.state=kind; }
  function errorMessage(message){$("sessionError").textContent=message;$("sessionError").hidden=!message;}
  function exercise(id){return state.catalog.find((item)=>item.id===id)||{name:id,equipment:"",caution:""};}
  function guideMarkup(item){
    const guidance=G?.exerciseGuidance?.(item,state.catalog);if(!guidance)return"";
    return `<details class="exercise-guide"><summary>Setup, cues &amp; equipment swaps</summary><div class="exercise-guide-grid"><section><span>Set up</span><p>${esc(guidance.setup)}</p></section><section><span>Purpose</span><p>${esc(guidance.purpose)}</p></section><section><span>Technique cues</span><ul>${guidance.cues.map((cue)=>`<li>${esc(cue)}</li>`).join("")}</ul></section><section class="guide-warning"><span>Caution / Common mistake</span><p>${esc(guidance.mistake)}</p></section><section><span>General catalog range</span><p>${esc(guidance.prescription)}</p></section><section><span>Same target · other equipment</span><ul>${guidance.alternatives.map(({exercise:alternative})=>`<li><strong>${esc(alternative.name)}</strong> · ${esc(alternative.equipment)}</li>`).join("")}</ul></section></div></details>`;
  }
  function owner(){return `account:${state.user.id}`;}
  function authorizeOffline(discovery){state.offlineAccessUntil=W.offlineAccessUntil(discovery);}
  function writeOfflineContext(draftKey=state.draftKey){
    if(state.mode!=="account"||state.blocked||!state.ownerId||!draftKey||state.offlineAccessUntil<=Date.now())return;
    try{localStorage.setItem(OFFLINE_CONTEXT_KEY,JSON.stringify({version:1,userId:String(state.user.id),ownerId:state.ownerId,contextId:state.contextId,draftKey,authorizedAt:Date.now(),authorizedUntil:state.offlineAccessUntil}));}
    catch{/* The normal account save still works when offline continuation storage is unavailable. */}
  }
  function clearOfflineContext(draftKey=state.draftKey){
    try{const current=JSON.parse(localStorage.getItem(OFFLINE_CONTEXT_KEY)||"null");if(!draftKey||current?.draftKey===draftKey)localStorage.removeItem(OFFLINE_CONTEXT_KEY);}
    catch{/* A malformed or blocked context cannot authorize the offline shell. */}
  }
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
    clearOfflineContext();
    $("trainingRoom").hidden=true;$("historySection").hidden=true;$("recoveryPanel").hidden=true;$("conflictPanel").hidden=true;
    $("modeNotice").textContent="Your account session changed. Your draft belongs to the original account and has been kept on this device where storage is available.";
    $("loadError").hidden=false;$("loadErrorMessage").textContent="Reload the workout room to use the current account. Sign in to the original account to recover its draft. Account sessions never switch into guest mode automatically.";
    $("retryLoad").textContent="Reload workout room";
    if($("detailDialog").open)$("detailDialog").close();
    if($("finishDialog").open)$("finishDialog").close();
    if($("swapDialog").open)$("swapDialog").close();
  }
  function blockAccess(){
    state.blocked=true;clearTimeout(state.saveTimer);persistDraft();
    clearOfflineContext();
    $("trainingRoom").hidden=true;$("historySection").hidden=true;$("recoveryPanel").hidden=true;$("conflictPanel").hidden=true;$("accessPanel").hidden=false;
    $("modeNotice").textContent="Strata+ access ended. Saved sessions and device drafts are kept; your free Plan is unchanged.";
    if($("detailDialog").open)$("detailDialog").close();if($("finishDialog").open)$("finishDialog").close();if($("swapDialog").open)$("swapDialog").close();
  }
  async function assertIdentity(){
    if(state.mode!=="account")return;
    let current;
    try{current=await api("/api/me");}catch(error){if(error.status===401)blockSession();throw error;}
    if(String(current.user?.id)!==String(state.user.id)){
      blockSession();throw Object.assign(new Error("The signed-in account changed."),{code:"IDENTITY_CHANGED"});
    }
    if(current.user.discovery?.active!==true){blockAccess();throw Object.assign(new Error("Strata+ access is required. Your device draft has been kept."),{status:402});}
    state.user={...state.user,discovery:current.user.discovery};authorizeOffline(current.user.discovery);writeOfflineContext();
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
    if(state.workout.status==="completed"&&!state.dirty){removeDraft();return true;}
    if(!state.draftKey)state.draftKey=`${W.draftPrefix(state.ownerId)}${state.contextId}:${state.workout.id}`;
    const record={ownerId:state.ownerId,contextId:state.contextId,workout:state.workout,dirty:state.dirty,pausedSeconds:state.pausedSeconds,savedAt:Date.now()};
    try{localStorage.setItem(state.draftKey,JSON.stringify(record));writeOfflineContext(state.draftKey);return true;}
    catch{return false;}
  }
  function removeDraft(key=state.draftKey){try{if(key)localStorage.removeItem(key);clearOfflineContext(key);}catch{/* Keep the in-memory session when storage is unavailable. */}}
  function scanDrafts(){
    const items=[],staleKeys=[];
    try{
      const prefix=W.draftPrefix(state.ownerId);
      for(let index=0;index<localStorage.length;index++){
        const key=localStorage.key(index);
        if(!key?.startsWith(prefix))continue;
        const record=W.readDraft(localStorage.getItem(key),state.ownerId);
        if(record?.dirty)items.push({...record,key});
        else if(record?.workout?.status==="completed")staleKeys.push(key);
      }
      staleKeys.forEach((key)=>localStorage.removeItem(key));
    }catch{toast("Device draft recovery is unavailable in this browser. Keep this tab open until your session is saved.");}
    state.recoveries=items.sort((a,b)=>b.savedAt-a.savedAt);
    renderRecovery();renderPlan();renderHistory();
  }
  function renderRecovery(){
    $("recoveryPanel").hidden=!state.recoveries.length||!!state.workout||state.blocked;
    $("recoveryList").innerHTML=state.recoveries.map((record,index)=>{
      const counts=W.progress(record.workout);
      return `<div class="recovery-item"><div><strong>${esc(record.workout.title)}</strong><small>${esc(record.workout.date)} · ${counts.completed}/${counts.total} sets · ${record.dirty?"Unsaved device changes":"Previously saved session"}</small></div><div class="actions"><button class="button secondary compact" data-recover="${index}" type="button">Review &amp; recover</button><button class="button quiet compact" data-discard="${index}" type="button">Remove device draft</button></div></div>`;
    }).join("");
  }
  function selectWorkout(workout,{dirty=false,pausedSeconds=null}={}){
    state.workout=W.normalizeWorkout(workout);state.dirty=dirty;state.sequence++;state.conflict=null;
    state.memoryError="";state.memoryReady=memoryReadyFor(state.workout);
    state.pausedSeconds=Number.isFinite(pausedSeconds)&&pausedSeconds>0?Math.min(3600,pausedSeconds):null;
    state.draftKey=`${W.draftPrefix(state.ownerId)}${state.contextId}:${workout.id}`;
    state.timerAnnounced=false;
    $("conflictPanel").hidden=true;$("celebration").hidden=true;$("recoveryPanel").hidden=true;
    $("startPanel").hidden=true;$("sessionPanel").hidden=false;
    errorMessage("");renderSession();persistDraft();
    status(dirty?"Sync pending":"Synced",dirty?"error":"saved");
    $("sessionTitle").focus();
    if(!state.memoryReady)void loadWorkoutMemory(state.workout.id);
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
        else if(latest&&W.matches(latest,record.workout)){state.workout.revision=latest.revision;state.dirty=false;status("Synced","saved");persistDraft();}
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
    const activeWorkout=state.workout?.status==="active"?state.workout:state.history.find((item)=>item.status==="active")||state.recoveries.find((record)=>record.workout.status==="active")?.workout;
    const activeHint=activeWorkout?`${activeWorkout.title} is already in progress. Resume it from Training history below before starting another session.`:"";
    $("todayLabel").textContent=`${W.localDate()} · ${state.day} plan`;
    startButton.hidden=!items.length||!!activeWorkout;startButton.disabled=!state.plan||state.blocked;
    chooseButton.hidden=!!activeWorkout||!!items.length||!scheduledDay;plannerLink.hidden=!!activeWorkout||!!items.length||!!scheduledDay;
    if(!items.length){
      brief.hidden=true;brief.innerHTML="";
      const recovery=(state.plan?.restDays||[state.plan?.restDay]).includes(state.day);
      $("planPreview").innerHTML=`<div class="empty-state"><strong>${recovery?"Recovery is part of the plan.":"Nothing is scheduled for this day yet."}</strong>${scheduledDay?`${esc(scheduledDay)} has a workout ready. Choose it below, or edit your week in Plan.`:"Add exercises to your week in Plan, then return here to train."}</div>`;
      if(scheduledDay){chooseButton.dataset.day=scheduledDay;chooseButton.innerHTML=`Choose ${esc(scheduledDay)} workout <span aria-hidden="true">→</span>`;}
      else delete chooseButton.dataset.day;
      $("startHint").textContent=activeHint||(scheduledDay?`Your next scheduled session is ${scheduledDay}.`:"Build a session in Plan, then return here to train.");return;
    }
    brief.hidden=false;
    brief.innerHTML=`<div><span>Movements</span><strong>${summary.movements}</strong></div><div><span>Working sets</span><strong>${summary.workingSets}</strong></div><div><span>Plan day</span><strong>${esc(summary.day)}</strong></div>`;
    $("planPreview").innerHTML=items.map((item,index)=>{const itemExercise=exercise(item.exerciseId);return `<article class="preview-card"><span class="preview-number">${String(index+1).padStart(2,"0")}</span><strong>${esc(itemExercise.name)}</strong><small>${Number(item.sets)} sets · ${esc(item.reps)}</small>${guideMarkup(itemExercise)}</article>`;}).join("");
    $("startHint").textContent=activeHint||`${items.length} exercises · ${items.reduce((count,item)=>count+Number(item.sets),0)} planned sets. This session will be dated today.`;
  }
  function formatLabel(entry){return `${entry.measurement==="timed"?"Time":"Reps"} · ${entry.loadType==="bodyweight"?"Bodyweight":entry.loadType==="assisted"?"Assistance":"External load"}${entry.loadType!=="bodyweight"?` · ${entry.unit}`:""}`;}
  function option(value,label,current){return `<option value="${value}"${value===current?" selected":""}>${label}</option>`;}
  function hasActuals(entry){return entry.sets.some((set)=>set.completed||set.reps!==null||set.weight!==null||set.seconds!==null);}
  function setValue(entry,set){
    const actual=entry.measurement==="timed"?`${set.seconds==null?"—":number(set.seconds)} sec`:`${set.reps==null?"—":number(set.reps)} reps`;
    const load=entry.loadType==="bodyweight"?"Bodyweight":set.weight==null?"Load not guessed":`${number(set.weight)} ${entry.unit}${entry.loadType==="assisted"?" assistance":""}`;
    const rememberedScale=["rir","rpe"].includes(set.effortType)?set.effortType:"";
    return `${actual} · ${load}${set.effort!=null&&rememberedScale?` · ${number(set.effort)} ${rememberedScale.toUpperCase()}`:""}`;
  }
  function memoryFor(entry){return W.previousComparable(state.memoryHistory,entry,state.workout?.id);}
  function memoryReadyFor(workout){return !workout||state.memoryExhausted||workout.entries.every((entry)=>memoryFor(entry));}
  function mergeMemory(items){state.memoryHistory=[...new Map([...state.memoryHistory,...items].map((item)=>[item.id,item])).values()].sort((a,b)=>b.startedAt-a.startedAt);}
  async function loadWorkoutMemory(workoutId){
    if(state.memoryBusy||state.blocked||state.workout?.id!==workoutId||memoryReadyFor(state.workout))return;
    state.memoryBusy=true;state.memoryError="";state.memoryReady=false;renderSession();
    let offset=0,hasMore=true;
    try{
      while(hasMore&&state.workout?.id===workoutId&&!memoryReadyFor(state.workout)){
        const result=await accountRead(`/api/workouts?limit=100&offset=${offset}&memory=1`);
        if(!Array.isArray(result.workouts)||typeof result.hasMore!=="boolean"||!result.workouts.length&&result.hasMore)throw new Error("Workout Memory received an incomplete history page.");
        mergeMemory(result.workouts);offset+=result.workouts.length;hasMore=result.hasMore;
        if(!hasMore)state.memoryExhausted=true;
      }
      if(state.workout?.id===workoutId)state.memoryReady=memoryReadyFor(state.workout);
    }catch(error){
      if(state.workout?.id===workoutId){state.memoryReady=false;state.memoryError=saveError(error);}
    }finally{
      state.memoryBusy=false;
      if(state.workout?.id===workoutId)renderSession();
      else if(state.workout&&!memoryReadyFor(state.workout))void loadWorkoutMemory(state.workout.id);
    }
  }
  function memoryMarkup(entry){
    if(!state.memoryReady){
      const failed=!!state.memoryError;
      return `<section class="workout-memory" aria-label="Training memory and suggested target"${failed?"":' aria-busy="true"'}><div class="memory-previous empty"><span>${failed?"Couldn’t check older history":"Checking full saved history…"}</span><p>${failed?`${esc(state.memoryError)} Choose Refresh history to retry; no previous result has been assumed.`:"Looking beyond the recent list for the latest exact match."}</p></div><div class="memory-target"><span>Today’s suggested target</span><p>${failed?"Enter today’s values manually while saved history is unavailable.":"Ready after the saved-history check. STRATA will not guess a load."}</p><button class="button primary compact" type="button" disabled>${failed?"History unavailable":"Checking history…"}</button></div></section>`;
    }
    const memory=memoryFor(entry),suggestion=W.suggestedTargets(entry,memory),canApply=!W.hasSetValues(entry)&&state.workout.status==="active";
    const previous=memory?`<div class="memory-previous"><span>Previous comparable · ${esc(memory.date)}</span><ol>${memory.sets.map((set,index)=>`<li><b>Set ${index+1}</b> ${esc(setValue(entry,set))}</li>`).join("")}</ol><button class="button secondary compact" type="button" data-use-last${canApply?"":" disabled"}>Use last values</button></div>`:`<div class="memory-previous empty"><span>No comparable set history yet</span><p>Complete this logging format once and STRATA will remember it here.</p></div>`;
    const targets=suggestion.sets.map((set,index)=>`<li><b>Set ${index+1}</b> ${esc(setValue(entry,set))}</li>`).join("");
    return `<section class="workout-memory" aria-label="Training memory and suggested target">${previous}<div class="memory-target"><span>Today’s suggested target</span><ol>${targets}</ol><p>${esc(suggestion.explanation)}</p><button class="button primary compact" type="button" data-apply-target${canApply?"":" disabled"}>Apply suggested target</button></div></section>`;
  }
  function advancedTools(entry,ex){
    if(entry.loadType!=="external")return"";
    const memory=state.memoryReady?memoryFor(entry):null,suggested=W.suggestedTargets(entry,memory).sets[0]?.weight??"",barbell=/barbell|smith/i.test(ex.equipment||"");
    return `<details class="advanced-tools"><summary>Advanced · warm-ups${barbell?" &amp; plates":""}</summary><div class="advanced-grid"><section><h4>Warm-up ramp</h4><p>Enter a working load for three non-working preparation sets.</p><div class="calculator-row"><label class="field">Working load (${entry.unit})<input type="number" min="0.01" max="1000" step="0.01" value="${suggested}" data-warmup-load /></label><button class="button secondary compact" type="button" data-calc-warmup>Calculate</button></div><div class="calculator-result" data-warmup-result role="status"></div></section>${barbell?`<section><h4>Plate calculator</h4><p>Uses common plate pairs; confirm the plates available at your gym.</p><div class="plate-fields"><label class="field">Target (${entry.unit})<input type="number" min="0" max="1000" step="0.01" value="${suggested}" data-plate-target /></label><label class="field">Bar (${entry.unit})<input type="number" min="0" max="1000" step="0.01" value="${entry.unit==="lb"?45:20}" data-bar-weight /></label></div><button class="button secondary compact" type="button" data-calc-plates>Show plates per side</button><div class="calculator-result" data-plate-result role="status"></div></section>`:""}</div></details>`;
  }
  function supersetLabel(entry){const groups=[...new Set(state.workout.entries.map((item)=>item.supersetGroup).filter(Boolean))],index=groups.indexOf(entry.supersetGroup);return index>=0?`Superset ${String.fromCharCode(65+index)}`:"";}
  function renderEntry(entry,index){
    const ex=exercise(entry.exerciseId),timed=entry.measurement==="timed",weighted=entry.loadType!=="bodyweight",locked=hasActuals(entry)||state.workout.status==="completed",disabled=locked?" disabled":"",completedSets=entry.sets.filter((set)=>set.completed).length,next=W.nextIncompleteSet(state.workout),effort=entry.effortType!=="none",effortLocked=entry.sets.some((set)=>set.effort!=null)||state.workout.status==="completed",grouped=!!entry.supersetGroup,nextEntry=state.workout.entries[index+1];
    const measurement=timed?"seconds":"reps";
    const setRows=entry.sets.map((set,setIndex)=>`<tr data-set="${setIndex}" class="${set.completed?"set-complete":next?.entryId===entry.id&&next.setIndex===setIndex?"set-next":""}"><td class="set-number" data-label="Set">${setIndex+1}</td>${weighted?`<td data-label="${entry.loadType==="assisted"?"Assist":"Load"} (${entry.unit})"><input type="number" inputmode="decimal" min="0" max="1000" step="0.01" data-actual="weight" value="${set.weight??""}" placeholder="—" aria-label="${esc(ex.name)}, set ${setIndex+1}, ${entry.loadType==="assisted"?"assistance":"load"} in ${entry.unit}"${set.completed||state.workout.status==="completed"?" disabled":""}/></td>`:""}<td data-label="${timed?"Seconds":"Reps"}"><input type="number" inputmode="numeric" min="1" max="${timed?3600:1000}" step="1" data-actual="${measurement}" value="${set[measurement]??""}" placeholder="—" aria-label="${esc(ex.name)}, set ${setIndex+1}, actual ${measurement}"${set.completed||state.workout.status==="completed"?" disabled":""}/></td>${effort?`<td data-label="${entry.effortType.toUpperCase()}"><input type="number" inputmode="decimal" min="${entry.effortType==="rpe"?1:0}" max="10" step="0.5" data-actual="effort" value="${set.effort??""}" placeholder="Optional" aria-label="${esc(ex.name)}, set ${setIndex+1}, ${entry.effortType.toUpperCase()}"${set.completed||state.workout.status==="completed"?" disabled":""}/></td>`:""}<td class="set-actions-cell" data-label="Actions"><div class="set-actions"><button type="button" class="button secondary set-check" data-complete="${setIndex}" aria-pressed="${set.completed}" aria-label="${set.completed?"Uncheck":"Mark complete"} ${esc(ex.name)}, set ${setIndex+1}"${state.workout.status==="completed"?" disabled":""}>${set.completed?"✓ Done":"Done"}</button><button type="button" class="button quiet set-copy" data-duplicate-set="${setIndex}" aria-label="Duplicate ${esc(ex.name)}, set ${setIndex+1}"${entry.sets.length>=10||state.workout.status==="completed"?" disabled":""}>Copy</button><button type="button" class="button quiet set-remove" data-remove-set="${setIndex}" aria-label="Remove ${esc(ex.name)}, set ${setIndex+1}"${entry.sets.length<=1||set.completed||state.workout.status==="completed"?" disabled":""}>Remove</button></div></td></tr>`).join("");
    return `<article class="exercise-card${grouped?" is-superset":""}" data-entry="${esc(entry.id)}"><div class="exercise-heading"><span class="exercise-index">${String(index+1).padStart(2,"0")}</span><div>${grouped?`<span class="superset-badge">${supersetLabel(entry)}</span>`:""}<h3>${esc(ex.name)}</h3><p>Planned: ${entry.sets.length} × ${esc(entry.prescribedReps)}${ex.equipment?` · ${esc(ex.equipment)}`:""}${entry.replacedFromExerciseId?` · Replaced ${esc(exercise(entry.replacedFromExerciseId).name)} for this session`:""}</p></div><span class="exercise-progress">${completedSets}/${entry.sets.length} sets</span></div><div class="exercise-actions"><button class="button secondary compact" type="button" data-open-swap${locked?" disabled title=\"Clear logged values before swapping this exercise\"":""}>Swap exercise</button>${nextEntry||grouped?`<button class="button quiet compact" type="button" data-toggle-superset>${grouped?"Unpair superset":"Pair with next"}</button>`:""}</div>${memoryMarkup(entry)}${guideMarkup(ex)}<div class="format-controls"><label class="field">Record<select data-format="measurement" aria-label="Measurement for ${esc(ex.name)}"${disabled}>${option("reps","Repetitions",entry.measurement)}${option("timed","Time in seconds",entry.measurement)}</select></label><label class="field">Load type<select data-format="loadType" aria-label="Load type for ${esc(ex.name)}"${disabled}>${option("external","External load",entry.loadType)}${option("bodyweight","Bodyweight",entry.loadType)}${option("assisted","Assistance",entry.loadType)}</select></label><label class="field">Unit<select data-format="unit" aria-label="Load unit for ${esc(ex.name)}"${disabled}${!weighted&&!locked?" disabled":""}>${option("kg","kg",entry.unit)}${option("lb","lb",entry.unit)}</select></label><label class="field">Effort (optional)<select data-format="effortType" aria-label="Effort scale for ${esc(ex.name)}"${effortLocked?" disabled":""}>${option("none","Off",entry.effortType)}${option("rir","RIR",entry.effortType)}${option("rpe","RPE",entry.effortType)}</select></label></div><p class="format-note">${locked?"Logging format is locked while actual values are present. Clear uncompleted values to change it.":"Check the logging format before your first set. Enter 0 explicitly if an external or assisted set has no added load."}${entry.loadType==="assisted"?" Assistance is not lifted weight; it does not create weight or volume records.":""} Effort is optional and never inferred.</p><div class="sets-scroll"><table class="sets-table"><thead><tr><th scope="col">Set</th>${weighted?`<th scope="col">${entry.loadType==="assisted"?"Assist":"Load"} (${entry.unit})</th>`:""}<th scope="col">${timed?"Seconds":"Reps"}</th>${effort?`<th scope="col">${entry.effortType.toUpperCase()}</th>`:""}<th scope="col">Actions</th></tr></thead><tbody>${setRows}</tbody></table></div><button class="button secondary compact add-set" type="button" data-add-set${entry.sets.length>=10||state.workout.status==="completed"?" disabled":""}>+ Add set</button><label class="exercise-note">Exercise note <span>Optional · private to this session</span><textarea rows="2" maxlength="500" data-entry-note placeholder="Setup, cue, or anything you want to remember"${state.workout.status==="completed"?" disabled":""}>${esc(entry.note)}</textarea></label>${advancedTools(entry,ex)}</article>`;
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
  function entryFor(node){return state.workout?.entries.find((item)=>item.id===node.closest("[data-entry]")?.dataset.entry);}
  function alternativesFor(entry){
    const current=exercise(entry.exerciseId),guided=G?.exerciseGuidance?.(current,state.catalog,8)?.alternatives?.map((item)=>item.exercise)||[];
    const fallback=state.catalog.filter((candidate)=>candidate.id!==current.id&&W.swapComparison(current,candidate).compatible).sort((a,b)=>(b.sub===current.sub)-(a.sub===current.sub)||Number(b.score)-Number(a.score));
    return [...new Map([...guided,...fallback].map((item)=>[item.id,item])).values()].slice(0,8);
  }
  function renderSwapComparison(){
    const entry=state.workout?.entries.find((item)=>item.id===state.swapEntryId),candidate=exercise(state.swapCandidateId);if(!entry||!candidate.id)return;
    const current=exercise(entry.exerciseId),comparison=W.swapComparison(current,candidate);
    $("swapComparison").innerHTML=`<div><span>Current</span><strong>${esc(current.name)}</strong><small>${esc(current.sub||current.group)} · ${esc(current.equipment)} · FitScore ${Number(current.score)} · Stability ${Number(current.metrics?.stability||0)}</small></div><span class="swap-arrow" aria-hidden="true">→</span><div><span>Alternative</span><strong>${esc(candidate.name)}</strong><small>${esc(candidate.sub||candidate.group)} · ${esc(candidate.equipment)} · FitScore ${Number(candidate.score)} · Stability ${Number(candidate.metrics?.stability||0)}</small></div><p>${esc(comparison.explanation)}</p>`;
    $("planSwapReview").hidden=true;state.swapProposal=null;$("swapError").hidden=true;
  }
  function openSwap(button){
    const entry=entryFor(button);if(!entry||hasActuals(entry)||state.workout.status!=="active")return;
    const choices=alternativesFor(entry);if(!choices.length){toast("No comparable catalog alternative is available for this movement.");return;}
    state.swapEntryId=entry.id;state.swapCandidateId=choices[0].id;state.swapProposal=null;state.swapTrigger=button;
    $("swapExercise").innerHTML=choices.map((candidate)=>`<option value="${esc(candidate.id)}">${esc(candidate.name)} · ${esc(candidate.equipment)} · FitScore ${Number(candidate.score)}</option>`).join("");
    $("swapExercise").value=state.swapCandidateId;$("swapTitle").textContent=`Replace ${exercise(entry.exerciseId).name}`;renderSwapComparison();$("swapDialog").showModal();$("swapTitle").focus();
  }
  function closeSwap(){if($("swapDialog").open)$("swapDialog").close();}
  function applyWorkoutSwap(entry,candidate){
    if(!entry||!candidate||hasActuals(entry)||state.workout.status!=="active")throw new Error("Clear logged values before replacing this exercise.");
    const before=entry.exerciseId,unit=entry.unit,format=W.inferFormat(candidate,entry.prescribedReps);
    if(!entry.replacedFromExerciseId)entry.replacedFromExerciseId=before;
    entry.exerciseId=candidate.id;entry.measurement=format.measurement;entry.loadType=format.loadType;entry.unit=format.loadType==="bodyweight"?"kg":unit;
    entry.sets=entry.sets.map(W.blankSet);markDirty();renderSession();
  }
  function reviewPlanSwap(){
    const entry=state.workout?.entries.find((item)=>item.id===state.swapEntryId);if(!entry)return;
    try{
      state.swapProposal=W.planSwapProposal(state.plan,state.workout.planDay,entry,state.swapCandidateId);
      $("planSwapSummary").textContent=`${state.workout.planDay}: ${exercise(state.swapProposal.before).name} → ${exercise(state.swapProposal.after).name}. Your current Plan version is ${state.planUpdatedAt}.`;
      $("planSwapReview").hidden=false;$("planSwapReview").scrollIntoView({block:"nearest"});$("approvePlanSwap").focus();
    }catch(error){$("swapError").textContent=error.message;$("swapError").hidden=false;}
  }
  async function approvePlanSwap(){
    const proposal=state.swapProposal,entryId=state.swapEntryId,candidateId=state.swapCandidateId;if(!proposal||state.swapBusy)return;
    state.swapBusy=true;for(const id of ["swapWorkoutOnly","reviewPlanSwap","approvePlanSwap","cancelPlanSwap"])$(id).disabled=true;$("swapError").hidden=true;
    try{
      await assertIdentity();
      const result=await api("/api/plan",{method:"PUT",body:JSON.stringify({plan:proposal.plan,expectedPlanUpdatedAt:state.planUpdatedAt,expectedUserId:String(state.user.id)})});
      await assertIdentity();
      const entry=state.workout?.entries.find((item)=>item.id===entryId),candidate=exercise(candidateId);if(!entry||!candidate.id)throw new Error("This active workout changed before the Plan update could be shown. Reload to review both saved versions.");
      state.plan=result.plan;state.planUpdatedAt=Number(result.planUpdatedAt)||state.planUpdatedAt;applyWorkoutSwap(entry,candidate);closeSwap();toast("Approved: Plan and this workout now use the replacement exercise.");
    }catch(error){$("swapError").textContent=error.status===409?"Your Plan changed elsewhere. Nothing in this workout was replaced; close this dialog and review the latest Plan.":`Couldn't save the Plan change — ${saveError(error)}`;$("swapError").hidden=false;}
    finally{state.swapBusy=false;for(const id of ["swapWorkoutOnly","reviewPlanSwap","approvePlanSwap","cancelPlanSwap"])$(id).disabled=false;}
  }
  function applyRemembered(entry,kind){
    try{
      const memory=memoryFor(entry),values=kind==="last"?memory?.sets:W.suggestedTargets(entry,memory).sets;
      if(!values?.length)throw new Error("No comparable set values are available yet.");W.applyTargets(entry,values);markDirty();renderSession();toast(kind==="last"?"Previous values applied. Review them before each set.":"Suggested target applied. Review it before training.");
    }catch(error){errorMessage(error.message);}
  }
  function toggleSuperset(entry){
    const index=state.workout.entries.indexOf(entry);if(index<0)return;
    if(entry.supersetGroup){const group=entry.supersetGroup;state.workout.entries.forEach((item)=>{if(item.supersetGroup===group)item.supersetGroup="";});}
    else{
      const next=state.workout.entries[index+1];if(!next){toast("Choose an exercise above another movement to make a pair.");return;}
      if(next.supersetGroup){const old=next.supersetGroup;state.workout.entries.forEach((item)=>{if(item.supersetGroup===old)item.supersetGroup="";});}
      const group=`superset-${W.id().replace(/^workout-/,"").slice(0,80)}`;entry.supersetGroup=group;next.supersetGroup=group;
    }
    markDirty();renderSession();
  }
  function markDirty({save=true}={}){
    if(!state.workout||state.blocked)return;
    state.dirty=true;state.sequence++;
    if(state.workout.status==="active")state.workout.elapsedSeconds=Math.min(604800,Math.max(0,Math.floor((Date.now()-state.workout.startedAt)/1000)));
    const stored=persistDraft();
    status(stored?"Sync pending":"Couldn't save — Retry",stored?"":"error");
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
    $("useLatest").disabled=!latest;status("Conflict — Review","error");updateSessionMeta();$("conflictTitle").focus();
  }
  async function flushSave(){
    clearTimeout(state.saveTimer);
    if(!state.workout||!state.dirty||state.blocked||state.conflict)return false;
    if(state.saving){await state.saving;return state.dirty&&!state.conflict&&!state.blocked?flushSave():!state.dirty;}
    const snapshot=W.copy(state.workout),sequence=state.sequence;
    status("Saving…");
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
          status("Synced","saved");if(!$("sessionEntries").querySelector("input[aria-invalid=true]"))errorMessage("");
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
        const detail=saveError(error);status("Couldn't save — Retry","error");errorMessage(detail);persistDraft();return false;
      }
    })();
    state.saving=save;updateSessionMeta();
    try{return await save;}finally{state.saving=null;updateSessionMeta();}
  }
  function upsertHistory(summary){
    state.history=[summary,...state.history.filter((item)=>item.id!==summary.id)].sort((a,b)=>b.startedAt-a.startedAt);
    mergeMemory([summary]);
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
    resetCheckIn();void loadCheckIn(workout.id);
    toast("Workout complete. Your history is updated.");
    $("celebration").scrollIntoView({block:"center"});
  }
  function resetCheckIn(){
    state.adaptation=null;state.checkInBusy=false;
    for(const id of ["checkInDifficulty","checkInEnergy","checkInComfort","checkInEnjoyment"])$(id).value="";
    $("saveCheckIn").disabled=false;$("anotherSession").disabled=false;$("saveCheckIn").textContent="Save check-in";$("checkInStatus").textContent="";$("checkInStatus").dataset.state="";
    $("progressionPanel").hidden=true;$("progressionList").innerHTML="";$("adaptationProposal").hidden=true;$("adaptationStatus").textContent="";
  }
  function suggestionTarget(suggestion){
    const target=suggestion?.target||{},parts=[];
    if(Number.isFinite(target.weight))parts.push(`${number(target.weight)} ${suggestion.unit||"kg"}`);
    if(Number.isFinite(target.reps))parts.push(`${number(target.reps)} reps`);
    if(Number.isFinite(target.seconds))parts.push(`${number(target.seconds)} seconds`);
    return parts.join(" · ")||"Keep the current logged target";
  }
  function actionLabel(value){return String(value||"Review next target").replace(/[_-]+/g," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());}
  function renderTrainingGuidance(result,{saved=false}={}){
    const checkIn=result?.checkIn;
    if(checkIn){
      $("checkInDifficulty").value=String(checkIn.difficulty);$("checkInEnergy").value=String(checkIn.energy);$("checkInComfort").value=String(checkIn.comfort);$("checkInEnjoyment").value=String(checkIn.enjoyment);
      $("saveCheckIn").textContent="Update check-in";
      if(saved){$("checkInStatus").textContent="Saved";$("checkInStatus").dataset.state="saved";}
    }
    const suggestions=Array.isArray(result?.progression?.suggestions)?result.progression.suggestions:[];
    $("progressionPanel").hidden=!checkIn;
    $("progressionList").innerHTML=suggestions.length?suggestions.map((suggestion)=>`<article class="progression-suggestion"><div><span>${esc(actionLabel(suggestion.action))}</span><h4>${esc(exercise(suggestion.exerciseId).name)}</h4></div><strong>${esc(suggestionTarget(suggestion))}</strong><p>${esc(suggestion.explanation||"Review this target against your next planned session.")}</p><small>${suggestion.requiresApproval===true?"Suggestion only · no workout or plan changed":"Review before changing your Plan"}</small></article>`).join(""):"<p class='muted'>No progression change is suggested from this session. Keep the current targets and continue logging comparable sets.</p>";
    renderAdaptation(result?.adaptation||null);
  }
  function renderAdaptation(adaptation){
    state.adaptation=adaptation?.status==="pending"?adaptation:null;
    $("adaptationProposal").hidden=!state.adaptation;
    if(!state.adaptation)return;
    const change=state.adaptation.change||{};
    $("adaptationTitle").textContent=state.adaptation.title||"Review a smaller next session.";
    $("adaptationExplanation").textContent=state.adaptation.explanation||"Your check-in supports reviewing one small change.";
    $("adaptationChange").textContent=`${change.day||"Planned day"} · ${exercise(change.exerciseId).name} · ${Number(change.fromSets)||"—"} to ${Number(change.toSets)||"—"} sets`;
    $("acceptAdaptation").disabled=false;$("dismissAdaptation").disabled=false;$("adaptationStatus").textContent="";
  }
  async function loadCheckIn(workoutId){
    try{
      const result=await accountRead(`/api/workouts/${encodeURIComponent(workoutId)}/check-in`);
      if(state.workout?.id!==workoutId||state.workout?.status!=="completed")return;
      if(result.csrfToken)state.csrfToken=String(result.csrfToken);renderTrainingGuidance(result);
    }catch(error){
      if(error.status===404)return;
      if(state.workout?.id===workoutId){$("checkInStatus").textContent="Couldn’t load an earlier check-in — you can still save these answers.";$("checkInStatus").dataset.state="error";}
    }
  }
  async function saveCheckIn(){
    if(state.checkInBusy||state.blocked||!state.workout||state.workout.status!=="completed")return;
    const controls=["checkInDifficulty","checkInEnergy","checkInComfort","checkInEnjoyment"].map($),values=controls.map((control)=>Number(control.value));
    const missing=controls[values.findIndex((value)=>!Number.isInteger(value)||value<1||value>5)];
    if(missing){$("checkInStatus").textContent="Choose one response for each check-in question.";$("checkInStatus").dataset.state="error";missing.focus();return;}
    const workoutId=state.workout.id;state.checkInBusy=true;$("saveCheckIn").disabled=true;$("anotherSession").disabled=true;$("saveCheckIn").textContent="Saving…";$("checkInStatus").textContent="Saving…";$("checkInStatus").dataset.state="";
    try{
      await assertIdentity();
      const result=await api(`/api/workouts/${encodeURIComponent(workoutId)}/check-in`,{method:"POST",body:JSON.stringify({checkIn:{difficulty:values[0],energy:values[1],comfort:values[2],enjoyment:values[3]}})});
      await assertIdentity();if(state.workout?.id!==workoutId)return;
      if(result.csrfToken)state.csrfToken=String(result.csrfToken);renderTrainingGuidance(result,{saved:true});
    }catch(error){
      if(state.workout?.id===workoutId){$("checkInStatus").textContent=`Couldn't save — ${saveError(error)} Retry when ready.`;$("checkInStatus").dataset.state="error";$("saveCheckIn").textContent="Retry check-in";}
    }finally{state.checkInBusy=false;if(state.workout?.id===workoutId){$("saveCheckIn").disabled=false;$("anotherSession").disabled=false;if($("saveCheckIn").textContent==="Saving…")$("saveCheckIn").textContent="Save check-in";}}
  }
  async function resolveAdaptation(decision){
    const adaptation=state.adaptation;if(!adaptation||state.checkInBusy||state.blocked)return;
    state.checkInBusy=true;$("acceptAdaptation").disabled=true;$("dismissAdaptation").disabled=true;$("anotherSession").disabled=true;$("adaptationStatus").textContent=decision==="accept"?"Saving the approved Plan change…":"Keeping your current Plan…";
    try{
      await assertIdentity();
      const body=decision==="accept"?{decision,expectedPlanUpdatedAt:adaptation.expectedPlanUpdatedAt}:{decision};
      const result=await api(`/api/training/adaptations/${encodeURIComponent(adaptation.id)}`,{method:"POST",body:JSON.stringify(body)});await assertIdentity();
      if(result.plan?.days)state.plan=result.plan;
      if(Number.isSafeInteger(result.planUpdatedAt))state.planUpdatedAt=result.planUpdatedAt;
      state.adaptation=null;$("adaptationProposal").hidden=true;$("adaptationStatus").textContent="";
      $("checkInStatus").textContent=decision==="accept"?"Saved · Your approved one-set reduction is now in Plan.":"Saved · Your current Plan was kept.";$("checkInStatus").dataset.state="saved";renderPlan();
    }catch(error){
      $("adaptationStatus").textContent=error.status===409?"Your Plan or this suggestion changed elsewhere. Reload before deciding; nothing was overwritten.":`Couldn't save this decision — ${saveError(error)}`;
    }finally{state.checkInBusy=false;$("anotherSession").disabled=false;if(state.adaptation){$("acceptAdaptation").disabled=false;$("dismissAdaptation").disabled=false;}}
  }
  function returnToPlan(){
    state.workout=null;state.draftKey="";state.pausedSeconds=null;resetCheckIn();$("celebration").hidden=true;$("sessionPanel").hidden=true;$("startPanel").hidden=false;scanDrafts();($("startWorkout").hidden?$("planDay"):$("startWorkout")).focus();
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
      result=await accountRead(`/api/workouts?limit=20&offset=${more?state.offset:0}&memory=1`);
      if(!Array.isArray(result.workouts)||typeof result.hasMore!=="boolean")throw new Error("Workout history returned an incomplete response. Try again.");
      state.offset=(more?state.offset:0)+result.workouts.length;
      const combined=more?[...state.history,...result.workouts]:result.workouts;
      state.history=[...new Map(combined.map((item)=>[item.id,item])).values()].sort((a,b)=>b.startedAt-a.startedAt);
      if(more)mergeMemory(result.workouts);else{state.memoryHistory=result.workouts;state.memoryExhausted=!result.hasMore;state.memoryError="";}
      state.hasMore=result.hasMore;renderPlan();renderHistory();
      if(state.workout){state.memoryReady=memoryReadyFor(state.workout);renderSession();if(!state.memoryReady)void loadWorkoutMemory(state.workout.id);}
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
      $("detailBody").innerHTML=`<p>${esc(workout.date)} · ${counts.completed}/${counts.total} completed sets · ${W.duration(workout.elapsedSeconds)} since start</p>${W.normalizeWorkout(workout).entries.map((entry)=>`<section class="detail-exercise"><h3>${esc(exercise(entry.exerciseId).name)}</h3><p>${esc(formatLabel(entry))} · planned ${esc(entry.prescribedReps)}${entry.supersetGroup?" · Superset pair":""}${entry.replacedFromExerciseId?` · Replaced ${esc(exercise(entry.replacedFromExerciseId).name)}`:""}</p>${entry.note?`<blockquote>${esc(entry.note)}</blockquote>`:""}${entry.sets.map((set,index)=>`<div class="detail-set${set.completed?"":" unfinished"}"><span>Set ${index+1}</span><span>${set[entry.measurement==="timed"?"seconds":"reps"]??"—"} ${entry.measurement==="timed"?"sec":"reps"}${entry.loadType!=="bodyweight"?` · ${set.weight??"—"} ${entry.unit}${entry.loadType==="assisted"?" assistance":""}`:""}${set.effort!=null&&entry.effortType!=="none"?` · ${set.effort} ${entry.effortType.toUpperCase()}`:""}</span><span class="${set.completed?"done":""}">${set.completed?"✓ Done":"Unfinished"}</span></div>`).join("")}</section>`).join("")}`;
      $("detailDialog").showModal();
    }catch(error){toast(saveError(error));}
    finally{state.detailBusy=false;}
  }
  async function openRequestedWorkout(){
    const prefix="#resume=";
    if(!location.hash.startsWith(prefix))return false;
    let requested="";try{requested=decodeURIComponent(location.hash.slice(prefix.length));}catch{return false;}
    const recoveryIndex=state.recoveries.findIndex((record)=>record.dirty&&record.workout.id===requested);
    const clearRequest=()=>{const url=new URL(location.href);url.hash="";history.replaceState(null,"",url);};
    if(recoveryIndex>=0){await recover(recoveryIndex);clearRequest();return true;}
    const active=state.history.find((item)=>item.id===requested&&item.status==="active");
    if(!active)return false;
    await openDetail(active.id);clearRequest();return true;
  }
  async function initialize(){
    if(state.loading)return;
    if(state.blocked){location.reload();return;}
    state.loading=true;$("loadError").hidden=true;$("accessPanel").hidden=true;restorePreferences();
    try{
      const identity=await api("/api/me");
      if(!identity.user?.id)throw new Error("Sign in to Strata+ to open your workout room.");
      if(identity.user.discovery?.active!==true){$("accessPanel").hidden=false;$("modeNotice").textContent="Guided workouts, set logging, and history are Strata+ features. Your free Plan is unchanged.";return;}
      state.mode="account";state.user=identity.user;state.csrfToken=String(identity.csrfToken||"");state.ownerId=owner();authorizeOffline(identity.user.discovery);
      const catalog=await fetch("/exercises.json",{credentials:"same-origin"});
      if(!catalog.ok)throw new Error("The exercise library could not be loaded.");
      state.catalog=await catalog.json();if(!Array.isArray(state.catalog))throw new Error("The exercise library response was incomplete.");
      const planResult=await accountRead("/api/plan");
      if(String(planResult.user?.id)!==String(state.user.id)){blockSession();return;}
      state.plan=planResult.plan;state.planUpdatedAt=Number(planResult.planUpdatedAt)||0;
      if(!state.plan?.days)throw new Error("Your account plan could not be loaded. Retry to continue.");
      $("modeNotice").innerHTML=`<strong>Strata+ · ${esc(state.user.name||"Your account")}.</strong> Saved sessions sync across devices; an opened active workout can continue from this browser while offline. <a href='/account.html'>Account</a>`;
      $("trainingRoom").hidden=false;$("historySection").hidden=false;scanDrafts();await loadHistory();
      const resumed=!state.blocked&&await openRequestedWorkout();
      if(!resumed&&location.hash==="#historySection"&&!state.blocked){$("historySection").scrollIntoView({block:"start"});$("historyTitle").focus();}
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
    try{selectWorkout(W.createWorkout(state.plan,state.day,state.catalog),{dirty:true});markDirty();signal("workout_started");$("sessionPanel").scrollIntoView({block:"start"});}
    catch(error){toast(error.message);}
  });
  $("sessionEntries").addEventListener("input",(event)=>{
    const note=event.target.closest("[data-entry-note]");
    if(note&&!state.blocked){const entry=entryFor(note);if(entry&&state.workout.status==="active"){entry.note=note.value;markDirty();}return;}
    const input=event.target.closest("[data-actual]");if(!input||state.blocked)return;
    const entry=state.workout?.entries.find((item)=>item.id===input.closest("[data-entry]").dataset.entry),set=entry?.sets[Number(input.closest("[data-set]").dataset.set)];
    if(!set||set.completed||state.workout.status!=="active")return;
    const value=input.value===""?null:Number(input.value);
    if(!input.validity.valid||value!==null&&!Number.isFinite(value)){input.setAttribute("aria-invalid","true");errorMessage(input.dataset.actual==="effort"?"Use a whole or half-step value within the selected RIR or RPE range. This value has not been applied.":"Use the allowed range and whole reps or seconds; loads allow at most 2 decimal places. This value has not been applied.");return;}
    if(input.dataset.actual==="effort"){const effort=W.effortError(entry,{effort:value});if(effort){input.setAttribute("aria-invalid","true");errorMessage(effort);return;}}
    input.removeAttribute("aria-invalid");errorMessage("");set[input.dataset.actual]=value;markDirty();
    const card=input.closest("[data-entry]");card.querySelectorAll("[data-format]").forEach((select)=>select.disabled=hasActuals(entry)||(select.dataset.format==="unit"&&entry.loadType==="bodyweight"));
  });
  $("sessionEntries").addEventListener("change",(event)=>{
    const select=event.target.closest("[data-format]");if(!select||state.blocked)return;
    const entry=entryFor(select);if(!entry||state.workout.status!=="active")return;
    if(select.dataset.format==="effortType"){
      if(entry.sets.some((set)=>set.effort!=null))return;
      entry.effortType=select.value;markDirty();renderSession();return;
    }
    if(hasActuals(entry))return;
    entry[select.dataset.format]=select.value;
    if(entry.loadType==="bodyweight")entry.unit="kg";
    markDirty();renderSession();
  });
  $("sessionEntries").addEventListener("click",(event)=>{
    const action=event.target.closest("button");if(!action||state.blocked||state.workout?.status!=="active")return;
    const entry=entryFor(action);if(!entry)return;
    if(action.hasAttribute("data-open-swap")){openSwap(action);return;}
    if(action.hasAttribute("data-toggle-superset")){toggleSuperset(entry);return;}
    if(action.hasAttribute("data-use-last")){applyRemembered(entry,"last");return;}
    if(action.hasAttribute("data-apply-target")){applyRemembered(entry,"target");return;}
    if(action.hasAttribute("data-add-set")){try{const index=W.addSet(entry);markDirty();renderSession();$("sessionEntries").querySelector(`[data-entry="${CSS.escape(entry.id)}"] [data-set="${index}"] input:not(:disabled)`)?.focus();}catch(error){errorMessage(error.message);}return;}
    if(action.hasAttribute("data-duplicate-set")){try{const index=W.duplicateSet(entry,Number(action.dataset.duplicateSet));markDirty();renderSession();$("sessionEntries").querySelector(`[data-entry="${CSS.escape(entry.id)}"] [data-set="${index}"] input:not(:disabled)`)?.focus();}catch(error){errorMessage(error.message);}return;}
    if(action.hasAttribute("data-remove-set")){try{W.removeSet(entry,Number(action.dataset.removeSet));markDirty();renderSession();$("sessionEntries").querySelector(`[data-entry="${CSS.escape(entry.id)}"] [data-add-set]`)?.focus();}catch(error){errorMessage(error.message);}return;}
    if(action.hasAttribute("data-calc-warmup")){
      const card=action.closest("[data-entry]"),sets=W.warmupSets(card.querySelector("[data-warmup-load]").value),result=card.querySelector("[data-warmup-result]");
      result.textContent=sets.length?sets.map((set)=>`${set.percent}% · ${number(set.load)} ${entry.unit} × ${set.reps}`).join("  →  "):"Enter a working load above 0 and no more than 1,000.";return;
    }
    if(action.hasAttribute("data-calc-plates")){
      const card=action.closest("[data-entry]"),breakdown=W.plateBreakdown(card.querySelector("[data-plate-target]").value,card.querySelector("[data-bar-weight]").value),result=card.querySelector("[data-plate-result]");
      result.textContent=breakdown.remainder===null?"Enter a target at least as heavy as the bar.":`${breakdown.pairs.length?breakdown.pairs.map((item)=>`${item.count} × ${number(item.plate)} ${entry.unit}`).join(" + "):"No plates"} per side${breakdown.achievable?".":` · ${number(breakdown.remainder)} ${entry.unit} per side cannot be made with common plates.`}`;return;
    }
    const button=action.closest("[data-complete]");if(!button)return;
    const index=Number(button.dataset.complete),set=entry.sets[index];
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
    markDirty({save:false});renderSession();signal("workout_completed");void flushSave();
  });
  $("checkInForm").addEventListener("submit",event=>{event.preventDefault();void saveCheckIn();});
  $("acceptAdaptation").addEventListener("click",()=>void resolveAdaptation("accept"));
  $("dismissAdaptation").addEventListener("click",()=>void resolveAdaptation("dismiss"));
  $("anotherSession").addEventListener("click",()=>{
    if(state.dirty||state.saving||state.checkInBusy)return;
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
  $("swapExercise").addEventListener("change",()=>{state.swapCandidateId=$("swapExercise").value;renderSwapComparison();});
  $("swapWorkoutOnly").addEventListener("click",()=>{const entry=state.workout?.entries.find((item)=>item.id===state.swapEntryId),candidate=exercise(state.swapCandidateId);try{applyWorkoutSwap(entry,candidate);closeSwap();toast("Replacement applied to this workout only. Your Plan is unchanged.");}catch(error){$("swapError").textContent=error.message;$("swapError").hidden=false;}});
  $("reviewPlanSwap").addEventListener("click",reviewPlanSwap);$("approvePlanSwap").addEventListener("click",()=>void approvePlanSwap());
  $("cancelPlanSwap").addEventListener("click",()=>{$("planSwapReview").hidden=true;state.swapProposal=null;$("reviewPlanSwap").focus();});
  $("closeSwap").addEventListener("click",closeSwap);
  $("swapDialog").addEventListener("close",()=>{const trigger=state.swapTrigger,replacement=state.swapEntryId?$("sessionEntries").querySelector(`[data-entry="${CSS.escape(state.swapEntryId)}"] [data-open-swap]`):null,target=trigger?.isConnected?trigger:replacement;state.swapEntryId="";state.swapCandidateId="";state.swapProposal=null;state.swapTrigger=null;setTimeout(()=>{if(target?.isConnected)target.focus();},0);});
  window.addEventListener("beforeunload",(event)=>{persistDraft();if(state.dirty||state.checkInBusy||state.swapBusy){event.preventDefault();event.returnValue="";}});
  document.addEventListener("visibilitychange",()=>{if(document.visibilityState==="hidden")persistDraft();else if(state.mode==="account"&&!state.blocked)void assertIdentity().catch((error)=>{if(error.status!==401&&error.code!=="IDENTITY_CHANGED")status(saveError(error),"error");});tick();});
  window.addEventListener("online",()=>{if(state.dirty&&!state.blocked&&!state.conflict)toast("Connection restored. Choose Save now to retry your pending account changes.");});
  setInterval(tick,1000);
  void initialize();
})();
