/* global module */
(function(root,factory){
  "use strict";
  const guidance=factory();
  if(typeof module==="object"&&module.exports)module.exports=guidance;
  else root.StrataWorkoutGuidance=guidance;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
  "use strict";

  function suggestionTarget(suggestion,number){
    const target=suggestion?.target||{},parts=[];
    if(Number.isFinite(target.weight))parts.push(`${number(target.weight)} ${suggestion.unit||"kg"}`);
    if(Number.isFinite(target.reps))parts.push(`${number(target.reps)} reps`);
    if(Number.isFinite(target.seconds))parts.push(`${number(target.seconds)} seconds`);
    return parts.join(" · ")||"Keep the current logged target";
  }

  function actionLabel(value){
    return String(value||"Review next target").replace(/[_-]+/g," ").replace(/\b\w/g,(letter)=>letter.toUpperCase());
  }

  function create({$,state,accountRead,api,assertIdentity,saveError,exercise,esc,number,renderPlan}){
    let loadGeneration=0;
    function reset(){
      loadGeneration++;state.adaptation=null;state.checkInBusy=false;
      for(const id of ["checkInDifficulty","checkInEnergy","checkInComfort","checkInEnjoyment"])$(id).value="";
      $("saveCheckIn").disabled=false;$("anotherSession").disabled=false;$("saveCheckIn").textContent="Save check-in";$("checkInStatus").textContent="";$("checkInStatus").dataset.state="";
      $("progressionPanel").hidden=true;$("progressionList").innerHTML="";$("adaptationProposal").hidden=true;$("adaptationStatus").textContent="";
    }

    function renderAdaptation(adaptation){
      state.adaptation=adaptation?.status==="pending"?adaptation:null;
      $("adaptationProposal").hidden=!state.adaptation;
      if(!state.adaptation)return;
      const change=state.adaptation.change||{};
      $("adaptationTitle").textContent=state.adaptation.title||"Review a smaller next workout.";
      $("adaptationExplanation").textContent=state.adaptation.explanation||"Your check-in supports reviewing one small change.";
      $("adaptationChange").textContent=`${change.day||"Planned day"} · ${exercise(change.exerciseId).name} · ${Number(change.fromSets)||"—"} to ${Number(change.toSets)||"—"} sets`;
      $("acceptAdaptation").disabled=false;$("dismissAdaptation").disabled=false;$("adaptationStatus").textContent="";
    }

    function render(result,{saved=false}={}){
      if(saved)loadGeneration++;const checkIn=result?.checkIn;
      if(checkIn){
        $("checkInDifficulty").value=String(checkIn.difficulty);$("checkInEnergy").value=String(checkIn.energy);$("checkInComfort").value=String(checkIn.comfort);$("checkInEnjoyment").value=String(checkIn.enjoyment);
        $("saveCheckIn").textContent="Update check-in";
        if(saved){$("checkInStatus").textContent="Saved";$("checkInStatus").dataset.state="saved";}
      }
      const suggestions=Array.isArray(result?.progression?.suggestions)?result.progression.suggestions:[];
      $("progressionPanel").hidden=false;
      $("progressionList").innerHTML=suggestions.length?suggestions.map((suggestion)=>`<article class="progression-suggestion"><div><span>${esc(actionLabel(suggestion.action))}</span><h4>${esc(exercise(suggestion.exerciseId).name)}</h4></div><div class="progression-target"><strong>${esc(suggestionTarget(suggestion,number))}</strong>${Array.isArray(suggestion.targetSets)?`<ol class="progression-sets">${suggestion.targetSets.map((target,index)=>`<li>Set ${index+1} · ${esc(suggestionTarget({...suggestion,target},number))}</li>`).join("")}</ol>`:""}</div><p>${esc(suggestion.explanation||"Review this target against your next planned workout.")}</p><small>${esc(suggestion.timing||"Next time you train this exercise")} · review before applying</small></article>`).join(""):"<p class='muted'>No progression change is suggested from this workout. Keep the current targets and continue logging comparable sets.</p>";
      renderAdaptation(result?.adaptation||null);
    }

    async function load(workoutId){
      const generation=++loadGeneration;$("progressionPanel").hidden=false;$("progressionList").innerHTML="<p class='muted'>Checking completed sets for your next workout target…</p>";
      try{
        const result=await accountRead(`/api/workouts/${encodeURIComponent(workoutId)}/check-in`);
        if(generation!==loadGeneration||state.blocked||state.workout?.id!==workoutId||state.workout?.status!=="completed")return;
        if(result.csrfToken)state.csrfToken=String(result.csrfToken);render(result);
      }catch{
        if(generation!==loadGeneration||state.blocked)return;
        if(state.workout?.id===workoutId){$("progressionList").innerHTML="<p class='muted'>Next-weight guidance could not be loaded. Your completed workout is saved; reload to try again.</p>";$("checkInStatus").textContent="Couldn’t load an earlier check-in — you can still save these answers.";$("checkInStatus").dataset.state="error";}
      }
    }

    async function save(){
      if(state.checkInBusy||state.blocked||!state.workout||state.workout.status!=="completed")return;
      const controls=["checkInDifficulty","checkInEnergy","checkInComfort","checkInEnjoyment"].map($),values=controls.map((control)=>Number(control.value));
      const missing=controls[values.findIndex((value)=>!Number.isInteger(value)||value<1||value>5)];
      if(missing){$("checkInStatus").textContent="Choose one response for each check-in question.";$("checkInStatus").dataset.state="error";missing.focus();return;}
      const workoutId=state.workout.id;state.checkInBusy=true;$("saveCheckIn").disabled=true;$("anotherSession").disabled=true;$("saveCheckIn").textContent="Saving…";$("checkInStatus").textContent="Saving…";$("checkInStatus").dataset.state="";
      try{
        await assertIdentity();
        const result=await api(`/api/workouts/${encodeURIComponent(workoutId)}/check-in`,{method:"POST",body:JSON.stringify({checkIn:{difficulty:values[0],energy:values[1],comfort:values[2],enjoyment:values[3]}})});
        await assertIdentity();if(state.workout?.id!==workoutId)return;
        if(result.csrfToken)state.csrfToken=String(result.csrfToken);render(result,{saved:true});
      }catch(error){
        if(state.workout?.id===workoutId){$("checkInStatus").textContent=`Couldn't save — ${saveError(error)} Retry when ready.`;$("checkInStatus").dataset.state="error";$("saveCheckIn").textContent="Retry check-in";}
      }finally{
        state.checkInBusy=false;
        if(state.workout?.id===workoutId){$("saveCheckIn").disabled=false;$("anotherSession").disabled=false;if($("saveCheckIn").textContent==="Saving…")$("saveCheckIn").textContent="Save check-in";}
      }
    }

    async function resolve(decision){
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
      }finally{
        state.checkInBusy=false;$("anotherSession").disabled=false;
        if(state.adaptation){$("acceptAdaptation").disabled=false;$("dismissAdaptation").disabled=false;}
      }
    }

    return{reset,render,renderAdaptation,load,save,resolve};
  }

  return{suggestionTarget,actionLabel,create};
});
