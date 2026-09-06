"use strict";
(()=>{
  const core=window.StrataOnboarding,discovery=window.StrataDiscovery,$=id=>document.getElementById(id);
  let exercises=[],user=null,csrf="",revision=0,preferenceRevision=0,original=null,preview=null,ready=false,busy=false,profileKey="",previousDownload=null,savedPreferenceTags=[];
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function status(message){$("setupStatus").textContent=message;}
  async function request(path,options={}){
    let response;
    try{response=await fetch(path,{credentials:"same-origin",...options,headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json","X-CSRF-Token":csrf,"X-Strata-User":String(user?.id||"")} :{}),...options.headers}});}catch{throw new Error("Connection interrupted. Your preview is still here; reconnect and retry.");}
    const data=await response.json().catch(()=>({}));
    if(response.status===401){ready=false;$("setupFields").disabled=true;$("saveWeek").disabled=true;}
    if(!response.ok)throw Object.assign(new Error(data.error||"STRATA could not load your account. Retry in a moment."),{status:response.status,code:data.code});
    return data;
  }
  function hasItems(plan){return core.DAYS.some(day=>plan?.days?.[day]?.length);}
  function values(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input=>input.value);}
  function profile(){return {version:1,goal:$("goal").value,level:$("level").value,minutes:Number($("minutes").value),equipment:values("equipment"),availability:values("days"),preferences:[...savedPreferenceTags],limitations:values("limitations")};}
  function renderSnapshot(){
    const snapshot=core.trainingSnapshot(profile());
    $("setupDaysMetric").textContent=snapshot.trainingDays?`${snapshot.trainingDays} day${snapshot.trainingDays===1?"":"s"}`:"—";
    $("setupRecoveryMetric").textContent=snapshot.trainingDays?`${snapshot.recoveryDays} day${snapshot.recoveryDays===1?"":"s"}`:"—";
    $("setupMinutesMetric").textContent=snapshot.minutes?`${snapshot.minutes} min`:"—";
    $("setupReadiness").textContent=snapshot.message;
  }
  function rememberProfile(){try{localStorage.setItem(profileKey,JSON.stringify({version:1,minutes:Number($("minutes").value)}));}catch{status("Browser storage is unavailable. Keep this page open until your week is saved.");}}
  function restoreSessionLength(){
    let saved;try{saved=JSON.parse(localStorage.getItem(profileKey)||"null");}catch{return;}
    if(!saved||saved.version!==1)return;
    if([...$("minutes").options].some(option=>option.value===String(saved.minutes)))$("minutes").value=String(saved.minutes);
  }
  function renderSavedProfile(preferences,plan){
    const saved=core.profileFromSaved(preferences,plan);savedPreferenceTags=[...saved.preferences];
    if([...$("goal").options].some(option=>option.value===String(saved.goal)))$("goal").value=String(saved.goal);
    if([...$("level").options].some(option=>option.value===String(saved.level)))$("level").value=String(saved.level);
    $("equipmentChoices").innerHTML=[...new Set(exercises.map(e=>e.equipment))].sort().map(value=>`<label><input type="checkbox" name="equipment" value="${escape(value)}" ${saved.equipment.includes(value)?"checked":""} /> ${escape(value)}</label>`).join("");
    $("dayChoices").innerHTML=core.DAYS.map(day=>`<label><input type="checkbox" name="days" value="${day}" ${saved.availability.includes(day)?"checked":""} /> ${day.slice(0,3)}</label>`).join("");
    document.querySelectorAll('input[name="limitations"]').forEach(input=>{input.checked=saved.limitations.includes(input.value);});
    return saved;
  }
  function allowEditing(preferences){
    profileKey=`strata_setup_v1:user:${user.id}`;const saved=renderSavedProfile(preferences,original);restoreSessionLength();ready=true;$("setupFields").disabled=false;
    const replacing=hasItems(original);
    $("setupKicker").textContent=replacing?"01 / REBUILD YOUR WEEK":"01 / YOUR STARTING POINT";
    $("generateWeekLabel").textContent=replacing?"Preview a replacement week":"Preview my first week";
    $("accountMode").textContent=(replacing
      ?`Strata+ · ${user.name||"Your account"}. You already have a saved week. Previewing is safe; saving a new week replaces it only after you confirm.`
      :`Strata+ · ${user.name||"Your account"}. Your profile and first saved week will sync across devices.`)+(saved.recoveryAdjusted?" Your saved setup used all seven training days, so this setup leaves Sunday open for recovery; review the selected days before previewing.":"");
    $("retrySetup").hidden=true;renderSnapshot();status("");
  }
  function setPlannerAction({conflict=false,hidden=false}={}){
    const link=$("openPlanner");
    link.textContent=conflict?"Open planner in a new tab →":"Edit my week →";
    link.target=conflict?"_blank":"";
    link.rel=conflict?"noopener":"";
    link.hidden=hidden;
  }
  function requirePlus(account){
    if(!account?.user?.id)throw new Error("Sign in to Strata+ to set up your week.");
    if(account.user.discovery?.active!==true){ready=false;$("setupFields").disabled=true;$("saveWeek").disabled=true;throw new Error("Weekly setup is included in Strata+. Open Strata+ to restore access; your plan has not changed.");}
  }
  async function verifyAccess(){
    const me=await request("/api/me",{cache:"no-store"});requirePlus(me);
    if(String(me.user.id)!==String(user?.id)){ready=false;throw new Error("The signed-in account changed. Reload setup before continuing.");}
    csrf=me.csrfToken;
  }
  async function init(){
    ready=false;$("setupFields").disabled=true;$("retrySetup").hidden=true;$("previewSummary").hidden=true;status("Loading your starting point…");
    try{
      if(!exercises.length){
        const response=await fetch("/exercises.json?v=7.2.0");if(!response.ok)throw new Error("The exercise library is unavailable. Reconnect and retry.");exercises=await response.json();
      }
      const account=await request("/api/setup",{cache:"no-store"});requirePlus(account);
      if(!account.csrfToken)throw new Error("Your account could not be verified. Retry before editing.");
      user=account.user;csrf=account.csrfToken;revision=Number(account.planUpdatedAt);preferenceRevision=Number(account.preferencesUpdatedAt)||0;original=account.plan;allowEditing(account.preferences);
    }catch(error){status(error.message);$("accountMode").textContent="Account connection unavailable. Your existing account plan has not changed.";$("retrySetup").hidden=false;}
  }
  function renderPreview(){
    $("previewTitle").textContent="Your next chapter.";
    const snapshot=core.trainingSnapshot(profile(),preview);
    $("previewSummary").innerHTML=`<div><strong>${snapshot.trainingDays}</strong><span>training day${snapshot.trainingDays===1?"":"s"}</span></div><div><strong>${snapshot.movementCount}</strong><span>movements</span></div><div><strong>${snapshot.workingSets}</strong><span>working sets</span></div>`;
    $("previewSummary").hidden=false;
    $("weekPreview").innerHTML=core.DAYS.map(day=>{const session=preview.sessions.find(item=>item.day===day);return `<section class="preview-day"><h3>${day} ${session?`<small> / ${escape(session.focusLabel)}</small>`:""}</h3>${session?`<small>${escape(session.summary)}</small><details><summary>Review ${session.items.length} movements</summary><ul>${session.items.map(item=>`<li>${escape(item.exercise.name)} · ${item.sets} × ${escape(item.reps)}<br /><small>${escape(item.roleLabel)} · ${escape(item.exercise.equipment)}</small></li>`).join("")}</ul></details>`:"<small>Recovery / no planned session</small>"}</section>`;}).join("");
    $("replaceNotice").textContent=hasItems(original)?"You already have a saved week. Saving this preview replaces it; download a copy of your current week first.":"Your first week is ready. Save it, then adjust any movement, sets, or reps in the planner.";
    const oldLink=document.getElementById("previousWeek");if(oldLink)oldLink.remove();
    if(hasItems(original)){
      if(previousDownload)URL.revokeObjectURL(previousDownload);
      previousDownload=URL.createObjectURL(new Blob([JSON.stringify({format:"strata-weekly-plan",version:1,exportedAt:new Date().toISOString(),plan:original},null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.id="previousWeek";link.href=previousDownload;link.download="strata-previous-week.json";link.textContent="Download my current week";$("replaceNotice").after(link);
    }
    $("replaceLabel").hidden=!hasItems(original);$("replaceWeek").checked=false;$("saveControls").hidden=false;setPlannerAction({hidden:true});$("saveWeek").disabled=false;$("previewTitle").focus();
  }
  $("setupForm").addEventListener("submit",async event=>{
    event.preventDefault();if(!ready||busy)return;
    busy=true;$("setupFields").disabled=true;$("generateWeekLabel").textContent="Building your preview…";
    try{await verifyAccess();preview=core.buildWeek(profile(),exercises,discovery,()=>globalThis.crypto?.randomUUID?.()||`setup-${Date.now()}-${Math.random().toString(16).slice(2)}`);rememberProfile();renderPreview();status("Preview ready. Exercises match the equipment and movement filters you selected. Review their notes in the planner; you can replace any selection.");}
    catch(error){preview=null;$("previewSummary").hidden=true;$("saveControls").hidden=true;status(error.message);}
    finally{busy=false;$("setupFields").disabled=!ready;$("generateWeekLabel").textContent=hasItems(original)?"Preview a replacement week":"Preview my first week";}
  });
  $("setupForm").addEventListener("change",()=>{if(!ready)return;preview=null;$("previewSummary").hidden=true;$("saveControls").hidden=true;setPlannerAction({hidden:true});rememberProfile();renderSnapshot();status("Choices updated. Preview again to see your revised week.");});
  $("saveWeek").addEventListener("click",async()=>{
    if(!preview||busy||!ready)return;
    if(hasItems(original)&&!$("replaceWeek").checked){status("Review the preview and confirm replacing your current week first.");$("replaceWeek").focus();return;}
    busy=true;$("saveWeek").disabled=true;$("saveWeek").textContent="Saving your week…";$("setupFields").disabled=true;setPlannerAction({hidden:true});status("Saving your week…");
    try{
      await verifyAccess();
      const saved=await request("/api/setup",{method:"PUT",body:JSON.stringify({plan:preview.plan,preferences:preview.preferences,expectedPlanUpdatedAt:revision,expectedPreferencesUpdatedAt:preferenceRevision,expectedUserId:user.id})});
      revision=saved.planUpdatedAt;preferenceRevision=saved.preferencesUpdatedAt;original=saved.plan||preview.plan;savedPreferenceTags=[...(saved.preferences?.preferences||preview.preferences.preferences)];
      $("saveControls").hidden=true;setPlannerAction();status("Saved to your account. Open your planner to make it yours.");$("openPlanner").focus();
    }catch(error){
      if(error.status===409){setPlannerAction({conflict:true});status("Your saved week changed in another tab or device. Your preview is safe here. Open the planner in a new tab to compare both before replacing anything.");$("openPlanner").focus();}
      else status(error.message);
    }
    finally{busy=false;$("saveWeek").textContent="Save this week and profile";$("saveWeek").disabled=!ready;$("setupFields").disabled=!ready;}
  });
  $("retrySetup").addEventListener("click",init);
  void init();
})();
