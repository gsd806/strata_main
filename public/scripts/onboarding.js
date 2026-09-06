"use strict";
(()=>{
  const core=window.StrataOnboarding,discovery=window.StrataDiscovery,$=id=>document.getElementById(id);
  const GUEST_KEY="strata_guest_plan_v1";
  let exercises=[],user=null,csrf="",revision=0,original=null,guestRaw=null,preview=null,ready=false,busy=false,profileKey="",previousDownload=null;
  const escape=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  function status(message){$("setupStatus").textContent=message;}
  async function request(path,options={}){
    let response;
    try{response=await fetch(path,{credentials:"same-origin",...options,headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json","X-CSRF-Token":csrf,"X-Strata-User":String(user?.id||"")} :{}),...options.headers}});}catch{throw new Error("Connection interrupted. Your preview is still here; reconnect and retry.");}
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw Object.assign(new Error(data.error||"STRATA could not load your account. Retry in a moment."),{status:response.status,code:data.code});
    return data;
  }
  function emptyWeek(){return {version:1,restDay:"Sunday",days:Object.fromEntries(core.DAYS.map(day=>[day,[]]))};}
  function hasItems(plan){return core.DAYS.some(day=>plan?.days?.[day]?.length);}
  function values(name){return [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(input=>input.value);}
  function profile(){return {version:1,goal:$("goal").value,level:$("level").value,minutes:Number($("minutes").value),equipment:values("equipment"),availability:values("days"),limitations:values("limitations")};}
  function rememberProfile(){try{localStorage.setItem(profileKey,JSON.stringify(profile()));}catch{status("Browser storage is unavailable. Keep this page open until your week is saved.");}}
  function restoreProfile(){
    let saved;try{saved=JSON.parse(localStorage.getItem(profileKey)||"null");}catch{return;}
    if(!saved||saved.version!==1)return;
    for(const id of ["goal","level","minutes"]){if([...$(id).options].some(option=>option.value===String(saved[id])))$(id).value=String(saved[id]);}
    for(const [name,key] of [["equipment","equipment"],["days","availability"],["limitations","limitations"]]){
      if(Array.isArray(saved[key]))document.querySelectorAll(`input[name="${name}"]`).forEach(input=>{input.checked=saved[key].includes(input.value);});
    }
  }
  function allowEditing(){
    profileKey=`strata_setup_v1:${user?`user:${user.id}`:"guest"}`;restoreProfile();ready=true;$("setupFields").disabled=false;
    $("accountMode").textContent=user?`Account plan · ${user.name||user.email||"Signed in"}. Your saved week syncs across devices.`:"Guest plan · This week stays in this browser. Signing in opens a separate account plan.";
    $("retrySetup").hidden=true;$("offlineSetup").hidden=true;status("");
  }
  function enterGuest(){
    try{guestRaw=localStorage.getItem(GUEST_KEY);original=guestRaw?JSON.parse(guestRaw):emptyWeek();}
    catch{status("Your guest plan could not be read. Open the planner to recover it before replacing this week.");return;}
    if(!original?.days||!core.DAYS.every(day=>Array.isArray(original.days[day]))){status("Your existing guest plan needs review. Open the planner before setting up another week.");return;}
    user=null;csrf="";revision=0;allowEditing();
  }
  async function init(){
    ready=false;$("setupFields").disabled=true;$("retrySetup").hidden=true;$("offlineSetup").hidden=true;status("Loading your starting point…");
    try{
      if(!exercises.length){
        const response=await fetch("/exercises.json?v=7.1.0");if(!response.ok)throw new Error("The exercise library is unavailable. Reconnect and retry.");exercises=await response.json();
        $("equipmentChoices").innerHTML=[...new Set(exercises.map(e=>e.equipment))].sort().map(value=>`<label><input type="checkbox" name="equipment" value="${escape(value)}" checked /> ${escape(value)}</label>`).join("");
        $("dayChoices").innerHTML=core.DAYS.map(day=>`<label><input type="checkbox" name="days" value="${day}" ${["Monday","Wednesday","Friday"].includes(day)?"checked":""} /> ${day.slice(0,3)}</label>`).join("");
      }
      let account;
      try{account=await request("/api/plan");}catch(error){if(error.status===401){enterGuest();return;}throw error;}
      if(!account.user?.id||!account.csrfToken)throw new Error("Your account could not be verified. Retry before editing.");
      user=account.user;csrf=account.csrfToken;revision=Number(account.planUpdatedAt);original=account.plan;allowEditing();
    }catch(error){status(error.message);$("accountMode").textContent="Account connection unavailable. Your existing account plan has not changed.";$("retrySetup").hidden=false;$("offlineSetup").hidden=!exercises.length;}
  }
  function renderPreview(){
    $("previewTitle").textContent="Your next chapter.";
    $("weekPreview").innerHTML=core.DAYS.map(day=>{const session=preview.sessions.find(item=>item.day===day);return `<section class="preview-day"><h3>${day} ${session?`<small> / ${escape(session.focusLabel)}</small>`:""}</h3>${session?`<small>${escape(session.summary)}</small><details><summary>Review ${session.items.length} movements</summary><ul>${session.items.map(item=>`<li>${escape(item.exercise.name)} · ${item.sets} × ${escape(item.reps)}<br /><small>${escape(item.roleLabel)} · ${escape(item.exercise.equipment)}</small></li>`).join("")}</ul></details>`:"<small>Recovery / no planned session</small>"}</section>`;}).join("");
    $("replaceNotice").textContent=hasItems(original)?"You already have a saved week. Saving this preview replaces it; download a copy of your current week first.":"Your first week is ready. Save it, then adjust any movement, sets, or reps in the planner.";
    const oldLink=document.getElementById("previousWeek");if(oldLink)oldLink.remove();
    if(hasItems(original)){
      if(previousDownload)URL.revokeObjectURL(previousDownload);
      previousDownload=URL.createObjectURL(new Blob([JSON.stringify({format:"strata-weekly-plan",version:1,exportedAt:new Date().toISOString(),plan:original},null,2)],{type:"application/json"}));
      const link=document.createElement("a");link.id="previousWeek";link.href=previousDownload;link.download="strata-previous-week.json";link.textContent="Download my current week";$("replaceNotice").after(link);
    }
    $("replaceLabel").hidden=!hasItems(original);$("replaceWeek").checked=false;$("saveControls").hidden=false;$("openPlanner").hidden=true;$("saveWeek").disabled=false;$("previewTitle").focus();
  }
  $("setupForm").addEventListener("submit",event=>{
    event.preventDefault();if(!ready||busy)return;
    try{preview=core.buildWeek(profile(),exercises,discovery,()=>globalThis.crypto?.randomUUID?.()||`setup-${Date.now()}-${Math.random().toString(16).slice(2)}`);rememberProfile();renderPreview();status("Preview ready. Exercises match the equipment and movement filters you selected. Review their notes in the planner; you can replace any selection.");}
    catch(error){preview=null;$("saveControls").hidden=true;status(error.message);}
  });
  $("setupForm").addEventListener("change",()=>{if(!ready)return;preview=null;$("saveControls").hidden=true;$("openPlanner").hidden=true;rememberProfile();status("Choices updated. Preview again to see your revised week.");});
  $("saveWeek").addEventListener("click",async()=>{
    if(!preview||busy||!ready)return;
    if(hasItems(original)&&!$("replaceWeek").checked){status("Review the preview and confirm replacing your current week first.");$("replaceWeek").focus();return;}
    busy=true;$("saveWeek").disabled=true;$("setupFields").disabled=true;status("Saving your week…");
    try{
      if(user){
        const me=await request("/api/me");if(String(me.user?.id)!==String(user.id))throw new Error("The signed-in account changed. Reload setup to open that account before saving.");csrf=me.csrfToken;
        const saved=await request("/api/plan",{method:"PUT",body:JSON.stringify({plan:preview.plan,expectedPlanUpdatedAt:revision,expectedUserId:user.id})});revision=saved.planUpdatedAt;original=saved.plan||preview.plan;
      }else{
        let me;try{me=await request("/api/me");}catch(error){if(error.status!==401&&navigator.onLine)throw error;}
        if(me?.user?.id)throw new Error("You signed in on another tab. Reload setup to open your account plan; your guest plan is separate.");
        const saveGuest=()=>{
          if(localStorage.getItem(GUEST_KEY)!==guestRaw)throw new Error("Your guest week changed in another tab. Open the planner to compare it before saving this preview.");
          const nextGuestRaw=JSON.stringify(preview.plan);localStorage.setItem(GUEST_KEY,nextGuestRaw);guestRaw=nextGuestRaw;original=preview.plan;
        };
        if(navigator.locks?.request)await navigator.locks.request("strata-guest-week-save",saveGuest);else saveGuest();
      }
      $("saveControls").hidden=true;$("openPlanner").hidden=false;status(user?"Saved to your account. Open your planner to make it yours.":"Saved in this browser. Open your planner to make it yours.");$("openPlanner").focus();
    }catch(error){status(error.status===409?"Your saved week changed in another tab or device. Your preview is safe here. Open the planner to compare both before replacing anything.":error.message);}
    finally{busy=false;$("saveWeek").disabled=false;$("setupFields").disabled=false;}
  });
  $("retrySetup").addEventListener("click",init);$("offlineSetup").addEventListener("click",enterGuest);
  void init();
})();
