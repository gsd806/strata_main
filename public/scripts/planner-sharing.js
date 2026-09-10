/* global module */
(function(root,factory){
  const api=factory();
  if(typeof module==="object"&&module.exports)module.exports=api;
  root.StrataPlannerSharing=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function createController({state,el,api,escapeHtml,planMovementCount,restDays,hasRestConflict,verifyIdentity,lockChangedAccount,flushSave,showToast,focusSoon,browserWindow}){
    function setShareStatus(message="",type=""){
      const status=el("sharePlanStatus");
      status.textContent=message;status.classList.toggle("error",type==="error");status.classList.toggle("success",type==="success");
    }
    function shareDate(value){
      const date=new Date(value);
      if(!Number.isFinite(date.getTime()))return "Recently updated";
      try{return `Updated ${new Intl.DateTimeFormat(undefined,{dateStyle:"medium"}).format(date)}`;}
      catch{return `Updated ${date.toISOString().slice(0,10)}`;}
    }
    function currentSharedPlan(){return state.sharedPlans.find((plan)=>plan&&plan.published!==false)||null;}
    function syncShareForm(plan=currentSharedPlan()){
      const publishButton=el("publishWeeklyPlan");
      publishButton.innerHTML=plan?'Update shared week <span aria-hidden="true">↗</span>':'Publish shared week <span aria-hidden="true">↗</span>';
      if(!plan)return;
      if(!el("sharePlanTitle").value.trim())el("sharePlanTitle").value=String(plan.title||"").slice(0,80);
      if(!el("sharePlanDescription").value.trim())el("sharePlanDescription").value=String(plan.description||"").slice(0,240);
      el("shareDescriptionCount").textContent=`${el("sharePlanDescription").value.length} / 240`;
    }
    function renderOwnSharedPlans({focusId=""}={}){
      const container=el("ownSharedPlans"),plans=state.sharedPlans.filter((plan)=>plan&&plan.published!==false);
      if(!plans.length){
        state.pendingUnpublish="";container.innerHTML='<p class="share-list-empty">You have not shared a week yet. Publish the plan on this page when it is ready.</p>';syncShareForm(null);return;
      }
      container.innerHTML=plans.map((plan)=>{
        const id=escapeHtml(plan.id),title=escapeHtml(plan.title||"Shared week"),description=escapeHtml(plan.description||"No description added."),movementCount=planMovementCount(plan.plan),confirming=state.pendingUnpublish===String(plan.id);
        return `<article class="own-share-card"><div><h4>${title}</h4><p>${description}</p></div><div class="own-share-meta"><span>${movementCount} exercise${movementCount===1?"":"s"}</span><span>${escapeHtml(shareDate(plan.updatedAt||plan.createdAt))}</span><span>By ${escapeHtml(plan.authorName||state.user?.name||"You")}</span></div><button class="unpublish-plan" data-unpublish-plan="${id}" type="button" ${state.shareBusy?"disabled":""}>${confirming?"Confirm unpublish":"Unpublish"}</button></article>`;
      }).join("");
      syncShareForm(plans[0]);
      if(focusId)focusSoon(`[data-unpublish-plan="${String(focusId).replace(/[^a-zA-Z0-9_-]/g,"")}"]`);
    }
    function renderShareAccess(){
      el("sharePlanGuest").hidden=!state.guest;el("sharePlanAccount").hidden=state.guest;
      if(!state.guest){
        if(state.sharedPlansLoaded)renderOwnSharedPlans();
        else el("ownSharedPlans").innerHTML='<p class="share-list-empty">Loading your shared plan…</p>';
      }
    }
    async function loadSharedPlans({announce=false}={}){
      if(state.guest||state.shareBusy)return false;
      const requestId=++state.sharedPlansRequest,container=el("ownSharedPlans");
      container.setAttribute("aria-busy","true");
      if(!state.sharedPlansLoaded)container.innerHTML='<p class="share-list-empty">Loading your shared plan…</p>';
      try{
        await verifyIdentity();const result=await api("/api/community-plans/mine");await verifyIdentity();
        if(requestId!==state.sharedPlansRequest)return false;
        if(result.userId&&String(result.userId)!==String(state.user.id)){lockChangedAccount();throw new Error("The signed-in account changed. Reload to review its shared plans.");}
        state.sharedPlans=Array.isArray(result.plans)?result.plans:result.plan?[result.plan]:[];state.sharedPlansLoaded=true;state.pendingUnpublish="";renderOwnSharedPlans();
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
      panel.hidden=false;el("shareWeeklyPlan").setAttribute("aria-expanded","true");renderShareAccess();focusSoon("#shareWeeklyTitle");
      panel.scrollIntoView?.({behavior:browserWindow.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth",block:"start"});
      if(!state.guest&&!state.sharedPlansLoaded)void loadSharedPlans();
    }
    function closeSharePanel(){el("shareWeeklyPanel").hidden=true;el("shareWeeklyPlan").setAttribute("aria-expanded","false");el("shareWeeklyPlan").focus?.();}
    function shareValidation(){
      const title=el("sharePlanTitle").value.trim(),description=el("sharePlanDescription").value.trim();
      if(state.guest)return{error:"Sign in to publish your week."};
      if(!state.csrfToken)return{error:"Your secure session is not ready. Refresh the page and try again."};
      if(title.length<3)return{error:"Give your plan a title using at least 3 characters.",focus:"sharePlanTitle"};
      if(title.length>80)return{error:"Keep the plan title to 80 characters or fewer.",focus:"sharePlanTitle"};
      if(description.length>240)return{error:"Keep the description to 240 characters or fewer.",focus:"sharePlanDescription"};
      if(planMovementCount()===0)return{error:"Add at least one workout to your week before publishing."};
      if(hasRestConflict())return{error:`Move all exercises off ${restDays().join(", ")} before publishing.`};
      if(!el("sharePlanConfirm").checked)return{error:"Confirm the community privacy notice before publishing.",focus:"sharePlanConfirm"};
      return{title,description};
    }
    function clearShareValidation(){for(const control of [el("sharePlanTitle"),el("sharePlanDescription"),el("sharePlanConfirm")])control.removeAttribute?.("aria-invalid");}
    async function publishWeeklyPlan(){
      if(state.shareBusy)return;
      clearShareValidation();const input=shareValidation();
      if(input.error){setShareStatus(input.error,"error");if(input.focus){el(input.focus).setAttribute?.("aria-invalid","true");el(input.focus).focus?.();}return;}
      state.shareBusy=true;el("publishWeeklyPlan").disabled=true;el("refreshSharedPlans").disabled=true;state.sharedPlansRequest+=1;setShareStatus("Saving your private plan before publishing…");
      try{
        if(!await flushSave({silent:true}))throw state.lastSaveError||new Error("Your private plan could not be saved. Fix that first, then publish again.");
        setShareStatus("Publishing your week to Strata+…");
        const result=await api("/api/community-plans",{method:"POST",body:JSON.stringify({title:input.title,description:input.description,expectedPlanUpdatedAt:state.planUpdatedAt})}),shared=result.plan||result.communityPlan;
        if(shared)state.sharedPlans=[shared];else await loadSharedPlans();
        state.sharedPlansLoaded=true;state.pendingUnpublish="";el("sharePlanConfirm").checked=false;clearShareValidation();setShareStatus("Your week is now available in the Strata+ community library.","success");showToast("Your week was published to Strata+.");
      }catch(error){
        if(error.status===401)setShareStatus("Your session ended. Sign in again before publishing.","error");
        else if(error.code==="COMMUNITY_PLAN_CHANGED"||error.code==="PLAN_CHANGED")setShareStatus("Your saved Plan changed on another device or tab. Refresh this page and review it before publishing.","error");
        else setShareStatus(error.message||"Your week could not be published.","error");
        showToast(error.message||"Your week could not be published.");
      }finally{state.shareBusy=false;el("publishWeeklyPlan").disabled=false;el("refreshSharedPlans").disabled=false;el("ownSharedPlans").setAttribute("aria-busy","false");renderOwnSharedPlans();}
    }
    async function unpublishSharedPlan(id){
      const plan=state.sharedPlans.find((item)=>String(item?.id)===String(id));
      if(!plan||state.shareBusy)return;
      if(state.pendingUnpublish!==String(id)){state.pendingUnpublish=String(id);renderOwnSharedPlans({focusId:id});setShareStatus("Press Confirm unpublish to remove this week from Strata+. Your private Plan will stay unchanged.");return;}
      state.shareBusy=true;state.sharedPlansRequest+=1;el("publishWeeklyPlan").disabled=true;el("refreshSharedPlans").disabled=true;renderOwnSharedPlans();setShareStatus("Removing your week from Strata+…");
      let removed=false;
      try{await api(`/api/community-plans/${encodeURIComponent(id)}`,{method:"DELETE"});state.sharedPlans=state.sharedPlans.filter((item)=>String(item?.id)!==String(id));state.pendingUnpublish="";setShareStatus("Your week was removed from Strata+. Your private Plan is unchanged.","success");showToast("Shared week unpublished.");removed=true;}
      catch(error){state.pendingUnpublish="";setShareStatus(error.message||"Your shared week could not be removed.","error");showToast(error.message||"Could not unpublish the week.");}
      finally{state.shareBusy=false;el("publishWeeklyPlan").disabled=false;el("refreshSharedPlans").disabled=false;el("ownSharedPlans").setAttribute("aria-busy","false");renderOwnSharedPlans();if(removed)el("refreshSharedPlans").focus?.();}
    }

    return{setShareStatus,shareDate,currentSharedPlan,syncShareForm,renderOwnSharedPlans,renderShareAccess,loadSharedPlans,openSharePanel,closeSharePanel,shareValidation,clearShareValidation,publishWeeklyPlan,unpublishSharedPlan};
  }

  return{createController};
});
