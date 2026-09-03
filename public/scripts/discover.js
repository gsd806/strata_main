"use strict";

const Core=globalThis.StrataDiscovery;
if(!Core)throw new Error("STRATA discovery engine did not load.");
const GROUP_LABELS={chest:"Chest",back:"Back",shoulders:"Shoulders",arms:"Arms",legs:"Legs",glutes:"Glutes",calves:"Calves",core:"Core"};
const PREFERENCE_OPTIONS={stable:"Stable setup","long-range":"Long-range friendly","simple-setup":"Simple setup",compound:"Compound lifts",isolation:"Isolation work"};
const LIMITATION_OPTIONS={"no-overhead":"Avoid overhead positions","no-deep-knee":"Avoid deep knee flexion","no-unsupported-hinge":"Avoid unsupported hinges","no-floor":"Avoid floor exercises","no-unilateral":"Avoid unilateral work"};
const EXPLORER_DESKTOP_PAGE_SIZE=24;
const EXPLORER_MOBILE_PAGE_SIZE=12;
const SEARCH_DEBOUNCE_MS=180;
const state={exercises:[],methodology:null,sources:[],limited:new Set(),preferences:null,user:null,aggregate:new Map(),userRatings:new Map(),compare:[],collection:"all",query:"",group:"all",equipment:"all",pattern:"all",level:"all",sort:"personal",recommendations:[],activeExercise:null,explorerLimit:EXPLORER_DESKTOP_PAGE_SIZE};
const el=(id)=>document.getElementById(id);

async function api(path,options={}) {
  const response=await fetch(path,{...options,credentials:"same-origin",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(options.headers||{})}});
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=Object.assign(new Error(data.error||"Request failed."),{status:response.status,code:data.code||"REQUEST_FAILED"});
    if(response.status===401)window.location.replace("/account.html?mode=login&next=pricing");
    else if(response.status===402||data.code==="DISCOVERY_ACCESS_REQUIRED")window.location.replace("/pricing?reason=access-revoked");
    throw error;
  }
  return data;
}

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function exerciseById(id){return state.exercises.find((exercise)=>exercise.id===id);}
function titleCase(value){return String(value).replace(/(^|[- /])\w/g,(match)=>match.toUpperCase());}
const round=Core.round;
function aggregateFor(id){return state.aggregate.get(id)||null;}
function communityLabel(id){const item=aggregateFor(id);return item&&Number(item.rating_count)>0?`${round(item.overall*2,1)}/10 · ${item.rating_count} vote${Number(item.rating_count)===1?"":"s"}`:"No community votes";}
const setupScore=Core.setupScore;
const setupLabel=Core.setupLabel;
const resistanceProfile=Core.resistanceProfile;
const practicality=Core.practicality;
function factorWeights(){return Core.factorWeights(state.methodology);}
function weightedBaseline(exercise){return Core.weightedBaseline(exercise,state.methodology);}
function scoreAdjustment(exercise){return Core.scoreAdjustment(exercise,state.methodology);}
function personalResult(exercise){return Core.personalResult(exercise,state.preferences);}
function alternativesFor(exercise){return Core.alternativesFor(exercise,state.exercises,state.preferences,4);}

function profileReason(result){return result.reasons.length?result.reasons.join(", "):"strong all-around fit";}
function buildRecommendations(){state.recommendations=state.exercises.map((exercise)=>({exercise,result:personalResult(exercise)})).filter((item)=>item.result.eligible).sort((a,b)=>b.result.match-a.result.match||b.exercise.score-a.exercise.score).slice(0,8);}
function personalLabel(result,{long=false}={}){return result.eligible?`${result.match}% personal match`:long?`Profile mismatch — ${profileReason(result)}`:"Profile mismatch";}

function choiceMarkup(name,value,label,checked){return `<label class="choice-pill"><input type="checkbox" name="${name}" value="${escapeHtml(value)}" ${checked?"checked":""}/><span>${escapeHtml(label)}</span></label>`;}
function renderProfile(){
  el("goalSelect").value=state.preferences.goal;el("levelSelect").value=state.preferences.level;el("daysInput").value=state.preferences.days;
  const equipment=[...new Set(state.exercises.map((exercise)=>exercise.equipment))];
  el("equipmentChoices").innerHTML=equipment.map((value)=>choiceMarkup("equipment",value,value,state.preferences.equipment.includes(value))).join("");
  el("preferenceChoices").innerHTML=Object.entries(PREFERENCE_OPTIONS).map(([value,label])=>choiceMarkup("preferences",value,label,state.preferences.preferences.includes(value))).join("");
  el("limitationChoices").innerHTML=Object.entries(LIMITATION_OPTIONS).map(([value,label])=>choiceMarkup("limitations",value,label,state.preferences.limitations.includes(value))).join("");
  el("profileStatus").textContent="Saved to your account";
}

function scoreButton(exercise){return `<button class="score-button" data-open-detail="${exercise.id}" type="button" aria-label="Open transparent FitScore for ${escapeHtml(exercise.name)}"><strong>${exercise.score}</strong><span>FitScore</span></button>`;}
function compareButton(exercise){const active=state.compare.includes(exercise.id);return `<button class="${active?"active":""}" data-toggle-compare="${exercise.id}" type="button" aria-pressed="${active}" aria-label="${active?"Remove":"Add"} ${escapeHtml(exercise.name)} ${active?"from":"to"} comparison">${active?"Selected ✓":"Compare +"}</button>`;}

function renderRecommendations(){
  buildRecommendations();
  const goal={hypertrophy:"Hypertrophy selection",strength:"Strength skill",balanced:"Balanced","time-efficient":"Time-efficient setup"}[state.preferences.goal]||titleCase(state.preferences.goal);
  el("recommendationSummary").textContent=`Rules-based ${goal.toLowerCase()} ranking · ${state.preferences.equipment.length} equipment types · ${state.preferences.days} days`;
  el("recommendationGrid").innerHTML=state.recommendations.length?state.recommendations.map(({exercise,result},index)=>`<article class="recommend-card" data-rank="${String(index+1).padStart(2,"0")}"><div class="card-topline"><span class="match-pill">${result.match}% personal match</span>${scoreButton(exercise)}</div><h3>${escapeHtml(exercise.name)}</h3><span class="target">${escapeHtml(GROUP_LABELS[exercise.group])} / ${escapeHtml(exercise.sub)}</span><p>${escapeHtml(profileReason(result))}. ${escapeHtml(exercise.why)}</p><div class="mini-meta"><span>${escapeHtml(exercise.equipment)}</span><span>${escapeHtml(exercise.level)}</span></div><div class="mini-actions"><button data-open-detail="${exercise.id}" type="button" aria-label="Why ${escapeHtml(exercise.name)} ranks here">Why it ranks</button>${compareButton(exercise)}<a href="/planner.html?add=${encodeURIComponent(exercise.id)}" aria-label="Add ${escapeHtml(exercise.name)} to weekly plan">Plan +</a></div></article>`).join(""):`<div class="loading-card">No exercise matches all saved equipment and constraints. Update your profile above.</div>`;
}

function populateFilters(){
  const groups=[...new Set(state.exercises.map((exercise)=>exercise.group))];
  const equipment=[...new Set(state.exercises.map((exercise)=>exercise.equipment))];
  const patterns=[...new Set(state.exercises.map((exercise)=>exercise.pattern))];
  el("groupFilter").innerHTML=`<option value="all">All muscles</option>${groups.map((value)=>`<option value="${value}">${escapeHtml(GROUP_LABELS[value]||titleCase(value))}</option>`).join("")}`;
  el("equipmentFilter").innerHTML=`<option value="all">All equipment</option>${equipment.map((value)=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
  el("patternFilter").innerHTML=`<option value="all">All patterns</option>${patterns.map((value)=>`<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
}

function discoveryResults(){
  return Core.filterExercises(state.exercises,{collection:state.collection,query:state.query,group:state.group,equipment:state.equipment,pattern:state.pattern,level:state.level,sort:state.sort},state.preferences,aggregateFor);
}

function explorerPageSize(){return window.matchMedia?.("(max-width: 680px)")?.matches?EXPLORER_MOBILE_PAGE_SIZE:EXPLORER_DESKTOP_PAGE_SIZE;}
function resetExplorerWindow(){state.explorerLimit=explorerPageSize();}

function renderExplorer(){
  const items=discoveryResults(),visibleItems=items.slice(0,state.explorerLimit),remaining=Math.max(0,items.length-visibleItems.length),nextCount=Math.min(explorerPageSize(),remaining);
  el("resultCount").textContent=items.length;el("resultNoun").textContent=items.length===1?"exercise":"exercises";el("exerciseGrid").hidden=!items.length;el("emptyState").hidden=Boolean(items.length);
  el("exerciseGrid").innerHTML=visibleItems.map((exercise,index)=>{const personal=personalResult(exercise);return `<article class="exercise-card" data-result-index="${index}"><div class="card-topline"><span class="match-pill">${escapeHtml(personalLabel(personal))}</span>${scoreButton(exercise)}</div><h3>${escapeHtml(exercise.name)}</h3><span class="target">${escapeHtml(GROUP_LABELS[exercise.group]||titleCase(exercise.group))} / ${escapeHtml(exercise.sub)}</span><p>${escapeHtml(exercise.why)}</p><div class="mini-meta"><span>${escapeHtml(exercise.equipment)}</span><span>${escapeHtml(exercise.pattern)}</span><span>${escapeHtml(exercise.level)}</span></div><div class="community-line"><span>Community score</span><strong>${escapeHtml(communityLabel(exercise.id))}</strong></div><div class="mini-actions"><button data-open-detail="${exercise.id}" type="button" aria-label="Inspect ${escapeHtml(exercise.name)}">Inspect</button>${compareButton(exercise)}<a href="/planner.html?add=${encodeURIComponent(exercise.id)}" aria-label="Add ${escapeHtml(exercise.name)} to weekly plan">Plan +</a></div></article>`;}).join("")+(!remaining?"":`<div class="explorer-load-more"><p>Showing ${visibleItems.length} of ${items.length} matching exercises</p><button data-load-more-exercises type="button" aria-controls="exerciseGrid">Load ${nextCount} more <span aria-hidden="true">↓</span></button></div>`);
}

function renderMethodology(){
  el("methodSummary").textContent=`${state.methodology.summary} ${state.methodology.formula}`;
  el("methodFactors").innerHTML=state.methodology.factors.map((factor,index)=>`<div class="factor-row"><span>${String(index+1).padStart(2,"0")}</span><div><strong>${escapeHtml(factor.label)}</strong><small>${escapeHtml(factor.description)} ${escapeHtml(factor.boundary)}</small></div><b>${factor.weight}%</b></div>`).join("");
}

function renderCompareTray(){
  const exercises=state.compare.map(exerciseById).filter(Boolean);
  el("compareTray").hidden=!exercises.length;el("compareCount").textContent=`${exercises.length}/4`;el("openCompare").disabled=exercises.length<2;
  el("compareNames").textContent=exercises.length?exercises.map((exercise)=>exercise.name).join(" vs. "):"Choose 2–4 exercises";
  renderBattleBuilder();
}

function battleOptions(selected){
  const groups=Object.keys(GROUP_LABELS);
  return `<option value="">Choose an exercise…</option>${groups.map((group)=>`<optgroup label="${escapeHtml(GROUP_LABELS[group])}">${state.exercises.filter((exercise)=>exercise.group===group).sort((a,b)=>b.score-a.score).map((exercise)=>`<option value="${exercise.id}" ${exercise.id===selected?"selected":""}>${escapeHtml(exercise.name)} — ${exercise.score}</option>`).join("")}</optgroup>`).join("")}`;
}

function renderBattleBuilder(){
  if(!state.exercises.length)return;
  el("battleSelects").innerHTML=[0,1,2,3].map((index)=>`<label class="battle-slot">Exercise ${index+1}${index<2?" (required)":" (optional)"}<select data-battle-slot="${index}" ${index<2?"required":""}>${battleOptions(state.compare[index]||"")}</select></label>`).join("");
  const count=state.compare.length;
  el("battleStatus").textContent=count<2?`${count}/4 selected · choose at least two`:`${count}/4 selected · ready to compare`;
}

function readBattleBuilder(){
  state.compare=[...new Set([...document.querySelectorAll("[data-battle-slot]")].map((select)=>select.value).filter((id)=>exerciseById(id)))].slice(0,4);
  const count=state.compare.length;
  el("battleStatus").textContent=count<2?`${count}/4 selected · choose at least two`:`${count}/4 selected · ready to compare`;
  el("compareTray").hidden=!count;el("compareCount").textContent=`${count}/4`;el("openCompare").disabled=count<2;
  el("compareNames").textContent=count?state.compare.map((id)=>exerciseById(id).name).join(" vs. "):"Choose 2–4 exercises";
}

function toggleCompare(id){
  if(state.compare.includes(id))state.compare=state.compare.filter((item)=>item!==id);
  else if(state.compare.length<4)state.compare.push(id);
  else{showToast("Comparison is limited to four exercises.");return;}
  el("battleResults").hidden=true;renderCompareTray();renderRecommendations();renderExplorer();
}

function sourceSelection(exercise){
  const ids=["rom-2023","rom-meta-2021","prescription-2023","progression-acsm","machines-2022","execution-ace","anatomy-openstax"];
  if(exercise.pattern.includes("Squat")||exercise.pattern.includes("Press"))ids.push("load-2021");
  return [...new Set(ids)].map((id)=>state.sources.find((source)=>source.id===id)).filter(Boolean);
}

function metricMarkup(exercise){
  const weights=factorWeights();
  return state.methodology.factors.map((factor)=>`<div class="metric-row"><span>${escapeHtml(factor.label)}</span><div class="metric-bar"><i style="width:${exercise.metrics[factor.key]}%"></i></div><strong>${exercise.metrics[factor.key]}</strong><small>${round(exercise.metrics[factor.key]*weights[factor.key]/100,1)} pts</small></div>`).join("");
}

function ratingOptions(selected){return [1,2,3,4,5].map((value)=>`<option value="${value}" ${Number(selected)===value?"selected":""}>${value} — ${{1:"Low",2:"Below average",3:"Average",4:"Strong",5:"Excellent"}[value]}</option>`).join("");}
function ratingFormMarkup(exercise){
  const current=state.userRatings.get(exercise.id)||{comfort:3,pump:3,enjoyment:3,stability:3,setup:3,overall:3};
  return `<form class="rating-form" data-rating-form="${exercise.id}"><div class="rating-grid">${[["comfort","Comfort"],["pump","Pump / target feel"],["enjoyment","Enjoyment"],["stability","Perceived stability"],["setup","Setup ease"],["overall","Overall"]].map(([key,label])=>`<label>${label}<select name="${key}">${ratingOptions(current[key])}</select></label>`).join("")}</div><button class="button button-dark" type="submit">${state.userRatings.has(exercise.id)?"Update my rating":"Save my rating"} <span>→</span></button></form>`;
}

function gainsAndLosses(reference,candidate){
  const result=Core.gainsAndLosses(reference,candidate,state.methodology);
  return `Gain: ${result.gain} · Trade-off: ${result.loss}`;
}

function openDetail(id){
  const exercise=exerciseById(id);if(!exercise)return;state.activeExercise=id;
  const dialog=el("detailDialog");
  const baseline=weightedBaseline(exercise),adjustment=scoreAdjustment(exercise),personal=personalResult(exercise),aggregate=aggregateFor(id),sources=sourceSelection(exercise),alternatives=alternativesFor(exercise),confidence=state.limited.has(id)?"Limited":"Moderate";
  const profileHeading=personal.eligible?"Why it fits you":"Why it does not match your profile";
  const profileSummary=personal.eligible?`<strong>${personal.match}% rules-based match.</strong> ${escapeHtml(profileReason(personal))}.`:`<strong>Excluded by your saved rules.</strong> ${escapeHtml(profileReason(personal))}.`;
  el("detailContent").innerHTML=`
    <div class="detail-hero"><div class="dialog-head" style="position:static;padding:0 0 24px;background:transparent;border-color:rgba(255,255,255,.18)"><p class="kicker">Exercise intelligence / ${escapeHtml(GROUP_LABELS[exercise.group]||titleCase(exercise.group))}</p><button class="icon-button" data-close-dialog="detailDialog" type="button" aria-label="Close exercise details">×</button></div><div class="detail-hero-grid"><div><h2 class="detail-title" id="detailTitle">${escapeHtml(exercise.name)}</h2><p>${escapeHtml(exercise.why)}</p><span class="match-pill">${escapeHtml(personalLabel(personal))}</span></div><div class="detail-score"><strong>${exercise.score}</strong><span>Official FitScore</span></div></div><div class="detail-quick-actions"><button data-toggle-compare="${exercise.id}" type="button" aria-pressed="${state.compare.includes(id)}">${state.compare.includes(id)?"Remove from battle":"Add to battle"}</button><a href="#alternativeSection">Find alternative ↓</a><a href="/planner.html?add=${encodeURIComponent(id)}">Add to week →</a><a href="${exercise.youtube}" target="_blank" rel="noreferrer">YouTube search ↗</a><button data-share-exercise="${exercise.id}" type="button">Share card ↗</button></div></div>
    <div class="detail-body"><div class="detail-grid"><div>
      <section class="detail-section"><h3>${profileHeading}</h3><p>${profileSummary} This selection is an editorial rules engine, not an AI prediction or medical recommendation.</p><p><strong>Target:</strong> ${escapeHtml(exercise.sub)} · <strong>Pattern:</strong> ${escapeHtml(exercise.pattern)} · <strong>Equipment:</strong> ${escapeHtml(exercise.equipment)} · <strong>Level:</strong> ${escapeHtml(exercise.level)}</p></section>
      <section class="detail-section"><h3>FitScore audit</h3><div class="metric-list">${metricMarkup(exercise)}</div><div class="adjustment-row"><strong>Weighted baseline: ${round(baseline,1)}</strong> · Published score: ${exercise.score} · Editorial adjustment: ${adjustment>0?"+":""}${adjustment}.<br/>${escapeHtml(state.methodology.adjustment)}</div><p>${escapeHtml(state.methodology.evidenceNote)}</p></section>
      <section class="detail-section"><h3>Evidence and boundaries</h3><span class="confidence">${confidence} exercise-specific confidence</span><p><strong>Evidence:</strong> the links below support broad training principles. <strong>STRATA interpretation:</strong> applying those principles to this exact exercise and score is editorial judgment.</p>${sources.map((source)=>`<article class="source-card"><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a><span>${escapeHtml(source.type)} · ${escapeHtml(source.publisher)} · ${source.year}</span><p><strong>Supports:</strong> ${escapeHtml(source.supports)}</p><p class="source-boundary"><strong>Does not support:</strong> ${escapeHtml(source.doesNotSupport)}</p></article>`).join("")}</section>
    </div><aside>
      <section class="detail-section"><h3>Practical decision</h3><p><strong>Stability:</strong> ${exercise.metrics.stability}/100 · <strong>Effective range:</strong> ${exercise.metrics.range}/100</p><p><strong>Resistance profile:</strong> ${escapeHtml(resistanceProfile(exercise))}</p><p><strong>Progression:</strong> ${exercise.metrics.progression}/100 · <strong>Setup:</strong> ${escapeHtml(setupLabel(exercise))}</p><p><strong>Editorial practicality:</strong> ${practicality(exercise)}/100</p><h4>Programming starting point</h4><p>${escapeHtml(exercise.sets)} sets · ${escapeHtml(exercise.reps)} reps · ${escapeHtml(exercise.rest)} rest</p><h4>Technique cues</h4><ul>${exercise.cues.map((cue)=>`<li>${escapeHtml(cue)}</li>`).join("")}</ul><h4>Consideration</h4><p>${escapeHtml(exercise.caution)}</p></section>
      <section class="detail-section" id="alternativeSection"><h3>Find an alternative</h3><div class="alternative-list">${alternatives.length?alternatives.map(({exercise:candidate,match})=>`<div class="alternative-item"><div><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(gainsAndLosses(exercise,candidate))}</small></div><span>${match}%</span><div class="alternative-actions"><button data-open-detail="${candidate.id}" type="button" aria-label="Open ${escapeHtml(candidate.name)} details">Open</button><a href="/planner.html?add=${encodeURIComponent(candidate.id)}" aria-label="Add ${escapeHtml(candidate.name)} to weekly plan">Plan +</a></div></div>`).join(""):"<p>No eligible same-target alternative under your saved profile.</p>"}</div><p>Match percentages are transparent editorial similarity scores based on target, pattern, resistance profile, equipment, skill, and factor profile.</p></section>
      <section class="detail-section"><h3>Community score</h3><div class="rating-summary"><strong>${aggregate?`${round(aggregate.overall*2,1)}/10`:"—"}</strong><span>${aggregate?`${aggregate.rating_count} account vote${Number(aggregate.rating_count)===1?"":"s"}`:"No ratings yet"}</span></div>${aggregate?`<div class="community-breakdown">${[["comfort","Comfort"],["pump","Pump"],["enjoyment","Enjoyment"],["stability","Stability"],["setup","Setup"],["overall","Overall"]].map(([key,label])=>`<span>${label}<b>${round(aggregate[key],1)}/5</b></span>`).join("")}</div>`:""}<p>Your vote is tied to your account and replaces your prior vote. It never changes the official FitScore.</p>${ratingFormMarkup(exercise)}</section>
    </aside></div></div>`;
  if(!dialog.open)dialog.showModal();document.body.classList.add("dialog-open");
}

function comparisonWinner(exercises){
  const result=Core.comparisonRecommendation(exercises,state.preferences);
  return {winner:result.winner,text:result.reason||result.error};
}

function bestIds(exercises,value){
  const scores=exercises.map((exercise)=>({id:exercise.id,value:Number.parseFloat(value(exercise))})).filter((item)=>Number.isFinite(item.value));
  if(!scores.length)return new Set();
  const top=Math.max(...scores.map((item)=>item.value));return new Set(scores.filter((item)=>item.value===top).map((item)=>item.id));
}
function tableRow(label,exercises,value,{winner=false}={}){const leaders=winner?bestIds(exercises,value):new Set();return `<tr><th scope="row">${escapeHtml(label)}</th>${exercises.map((exercise)=>`<td class="${leaders.has(exercise.id)?"winner":""}">${value(exercise)}</td>`).join("")}</tr>`;}
function openComparison(){
  const exercises=state.compare.map(exerciseById).filter(Boolean);
  if(exercises.length<2){el("battleStatus").textContent="Choose at least two different exercises first.";el("battleResults").hidden=true;showToast("Choose at least two exercises.");return;}
  const verdict=comparisonWinner(exercises);
  const rows=[
    tableRow("Exercise",exercises,(exercise)=>`<strong>${escapeHtml(exercise.name)}</strong><br>${escapeHtml(exercise.sub)}`),
    tableRow("Official FitScore",exercises,(exercise)=>`${exercise.score}/100`,{winner:true}),
    tableRow("Personal match",exercises,(exercise)=>personalResult(exercise).eligible?`${personalResult(exercise).match}%`:"Excluded by profile",{winner:true}),
    tableRow("Community score",exercises,(exercise)=>escapeHtml(communityLabel(exercise.id))),
    tableRow("Primary target",exercises,(exercise)=>escapeHtml(exercise.sub)),
    tableRow("Stability",exercises,(exercise)=>`${exercise.metrics.stability}/100`,{winner:true}),
    tableRow("Effective range",exercises,(exercise)=>`${exercise.metrics.range}/100`,{winner:true}),
    tableRow("Target stimulus",exercises,(exercise)=>`${exercise.metrics.stimulus}/100`,{winner:true}),
    tableRow("Progression",exercises,(exercise)=>`${exercise.metrics.progression}/100`,{winner:true}),
    tableRow("Resistance profile",exercises,(exercise)=>escapeHtml(resistanceProfile(exercise))),
    tableRow("Setup",exercises,(exercise)=>escapeHtml(setupLabel(exercise))),
    tableRow("Equipment",exercises,(exercise)=>escapeHtml(exercise.equipment)),
    tableRow("Practicality",exercises,(exercise)=>`${practicality(exercise)}/100`,{winner:true}),
    tableRow("Starting point",exercises,(exercise)=>`${escapeHtml(exercise.sets)} × ${escapeHtml(exercise.reps)}<br>${escapeHtml(exercise.rest)} rest`),
    tableRow("STRATA interpretation",exercises,(exercise)=>escapeHtml(exercise.why)),
    tableRow("Add to week",exercises,(exercise)=>`<a class="small-button" href="/planner.html?add=${encodeURIComponent(exercise.id)}">Plan +</a>`)
  ];
  el("battleResults").innerHTML=`<div class="battle-results-head"><h3>Side-by-side result</h3><div class="battle-results-actions"><button class="small-button" data-share-battle type="button">Share card ↗</button><a class="small-button" href="/planner.html">Open planner ↗</a></div></div><div class="battle-verdict"><strong>${verdict.winner?`${escapeHtml(verdict.winner.name)} leads`:"No universal winner"}</strong><p>${escapeHtml(verdict.text)}</p></div><div class="comparison-scroll" role="region" aria-label="Exercise comparison table" tabindex="0"><table class="comparison-table"><caption class="sr-only">Exercise comparison across FitScore, targets, mechanics, progression, setup, equipment, and practicality</caption><tbody>${rows.join("")}</tbody></table></div><p class="field-note">Highlighted cells lead this selected set on that factor. Rankings are editorial and do not predict individual results.</p>`;
  el("battleResults").hidden=false;el("battleStatus").textContent=`Compared ${exercises.length} exercises.`;
}

function syncDialogState(){document.body.classList.toggle("dialog-open",Boolean(document.querySelector("dialog[open]")));}
function closeDialog(id){const dialog=el(id);if(dialog?.open)dialog.close();syncDialogState();}
let toastTimer;function showToast(message){const toast=el("toast");toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),2200);}

function cardLines(kind,id){
  if(kind==="exercise"){
    const exercise=exerciseById(id),personal=personalResult(exercise);return {eyebrow:`${GROUP_LABELS[exercise.group]||titleCase(exercise.group)} / ${exercise.sub}`,title:exercise.name,score:`${exercise.score}`,scoreLabel:"OFFICIAL FITSCORE",lines:[personalLabel(personal,{long:true}),`${exercise.equipment} · ${exercise.pattern}`,exercise.why],footer:"Evidence-aware exercise discovery"};
  }
  if(kind==="comparison"){
    const exercises=state.compare.map(exerciseById).filter(Boolean),verdict=comparisonWinner(exercises);return {eyebrow:"EXERCISE BATTLE",title:exercises.map((exercise)=>exercise.name).join(" vs. "),score:verdict.winner?String(verdict.winner.score):"—",scoreLabel:verdict.winner?"LEADING FITSCORE":"NO UNIVERSAL WINNER",lines:exercises.map((exercise)=>`${exercise.score} FitScore · ${personalLabel(personalResult(exercise))} — ${exercise.name}`),footer:"Compare the trade-offs, not just the score"};
  }
  const top=state.recommendations.slice(0,5);return {eyebrow:"PERSONALIZED SHORTLIST",title:`${titleCase(state.preferences.goal)} selection`,score:String(top[0]?.result.match||"—"),scoreLabel:"TOP PERSONAL MATCH",lines:top.map(({exercise,result},index)=>`${index+1}. ${exercise.name} — ${result.match}% match`),footer:`${state.preferences.days} days · ${state.preferences.level} · community ratings separate`};
}

function wrapCanvasText(ctx,text,x,y,maxWidth,lineHeight,maxLines=3){const words=String(text).split(/\s+/);let line="",lines=0;for(const word of words){const test=`${line}${line?" ":""}${word}`;if(ctx.measureText(test).width>maxWidth&&line){ctx.fillText(line,x,y);line=word;y+=lineHeight;lines+=1;if(lines>=maxLines-1)break;}else line=test;}if(line&&lines<maxLines){let final=line;if(ctx.measureText(final).width>maxWidth){while(final.length&&ctx.measureText(`${final}…`).width>maxWidth)final=final.slice(0,-1);final+="…";}ctx.fillText(final,x,y);}return y+lineHeight;}

async function shareCard(kind,id=null){
  try{
    const data=cardLines(kind,id),canvas=document.createElement("canvas");canvas.width=1080;canvas.height=1350;const ctx=canvas.getContext("2d");
    if(!ctx)throw new Error("Canvas is unavailable.");
    ctx.fillStyle="#10110f";ctx.fillRect(0,0,1080,1350);ctx.strokeStyle="rgba(217,255,67,.18)";ctx.lineWidth=2;ctx.beginPath();ctx.arc(960,110,360,0,Math.PI*2);ctx.stroke();ctx.beginPath();ctx.arc(960,110,470,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle="#d9ff43";ctx.font="600 42px Oswald, sans-serif";ctx.fillText("▰ STRATA",70,95);ctx.font="500 20px 'DM Mono', monospace";ctx.fillText(data.eyebrow.toUpperCase(),70,180);
    ctx.fillStyle="#faf9f5";ctx.font="600 78px Oswald, sans-serif";let y=wrapCanvasText(ctx,data.title.toUpperCase(),70,285,900,86,3);
    y=Math.max(y+35,515);ctx.fillStyle="#d9ff43";ctx.font="600 190px Oswald, sans-serif";ctx.fillText(data.score,70,y+150);ctx.fillStyle="#faf9f5";ctx.font="500 21px 'DM Mono', monospace";ctx.fillText(data.scoreLabel,310,y+130);
    let lineY=y+245;ctx.strokeStyle="rgba(255,255,255,.22)";for(const line of data.lines.slice(0,5)){ctx.beginPath();ctx.moveTo(70,lineY-34);ctx.lineTo(1010,lineY-34);ctx.stroke();ctx.fillStyle="#faf9f5";ctx.font="500 30px Manrope, sans-serif";lineY=wrapCanvasText(ctx,line,70,lineY,920,40,2)+25;}
    ctx.strokeStyle="rgba(255,255,255,.22)";ctx.beginPath();ctx.moveTo(70,1240);ctx.lineTo(1010,1240);ctx.stroke();ctx.fillStyle="rgba(255,255,255,.55)";ctx.font="500 18px 'DM Mono', monospace";ctx.fillText(data.footer.toUpperCase(),70,1290);ctx.fillStyle="#ff5a36";ctx.fillText("STRATAFITNESS.ONLINE",755,1290);
    const blob=await new Promise((resolve)=>canvas.toBlob(resolve,"image/png"));if(!blob)throw new Error("Image export is unavailable.");
    const filename=`strata-${kind}-${Date.now()}.png`;
    if(typeof File==="function"&&navigator.share){const file=new File([blob],filename,{type:"image/png"});if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],title:`STRATA ${kind} card`,text:"Exercise intelligence from STRATA"});return;}catch(error){if(error.name==="AbortError")return;}}}
    const url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=filename;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);showToast("Share card downloaded.");
  }catch(error){showToast(`Share failed: ${error.message}`);}
}

function setCollectionState(value){document.querySelectorAll("[data-collection]").forEach((button)=>{const active=button.dataset.collection===value;button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});}
let explorerSearchTimer=null;
function resetFilters(){clearTimeout(explorerSearchTimer);state.collection="all";state.query="";state.group="all";state.equipment="all";state.pattern="all";state.level="all";state.sort="personal";el("searchInput").value="";el("groupFilter").value="all";el("equipmentFilter").value="all";el("patternFilter").value="all";el("levelFilter").value="all";el("sortSelect").value="personal";setCollectionState("all");resetExplorerWindow();renderExplorer();}

const profileForm=el("profileForm");
function markProfileDirty(){if(profileForm.dataset.saving!=="true")el("profileStatus").textContent="Unsaved changes";}
profileForm.addEventListener("input",markProfileDirty);
profileForm.addEventListener("change",markProfileDirty);
profileForm.addEventListener("submit",async(event)=>{
  event.preventDefault();if(profileForm.dataset.saving==="true")return;
  const formElement=event.currentTarget,form=new FormData(formElement),preferences={goal:form.get("goal"),level:form.get("level"),days:Number(form.get("days")),equipment:form.getAll("equipment"),preferences:form.getAll("preferences"),limitations:form.getAll("limitations")};
  const controls=[...formElement.elements];profileForm.dataset.saving="true";controls.forEach((control)=>{control.disabled=true;});
  el("profileStatus").textContent="Saving…";
  try{const result=await api("/api/preferences",{method:"PUT",body:JSON.stringify({preferences})});state.preferences=result.preferences;renderProfile();renderRecommendations();resetExplorerWindow();renderExplorer();showToast("Personalized ranking refreshed.");}
  catch(error){el("profileStatus").textContent=error.message;showToast(error.message);}
  finally{profileForm.dataset.saving="false";controls.forEach((control)=>{control.disabled=false;});}
});

document.addEventListener("submit",async(event)=>{
  const form=event.target.closest("[data-rating-form]");if(!form)return;event.preventDefault();const id=form.dataset.ratingForm,data=Object.fromEntries(new FormData(form));const rating=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,Number(value)]));const button=form.querySelector("button"),originalHtml=button.innerHTML;button.disabled=true;button.textContent="Saving…";
  try{const result=await api(`/api/ratings/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify({rating})});state.userRatings.set(id,result.rating);state.aggregate.set(id,result.aggregate);openDetail(id);renderExplorer();renderRecommendations();showToast("Your account rating was saved.");}
  catch(error){button.innerHTML=originalHtml;showToast(error.message);}finally{button.disabled=false;}
});

document.addEventListener("click",(event)=>{
  const detail=event.target.closest("[data-open-detail]"),compare=event.target.closest("[data-toggle-compare]"),close=event.target.closest("[data-close-dialog]"),collection=event.target.closest("[data-collection]"),reset=event.target.closest("[data-reset-filters]"),loadMore=event.target.closest("[data-load-more-exercises]"),share=event.target.closest("[data-share-exercise]"),shareBattle=event.target.closest("[data-share-battle]");
  if(detail){if(el("detailDialog").open)closeDialog("detailDialog");openDetail(detail.dataset.openDetail);}
  else if(compare){toggleCompare(compare.dataset.toggleCompare);if(el("detailDialog").open)openDetail(compare.dataset.toggleCompare);}
  else if(close)closeDialog(close.dataset.closeDialog);
  else if(collection){state.collection=collection.dataset.collection;if(state.collection==="community"){state.sort="community";el("sortSelect").value="community";}setCollectionState(state.collection);resetExplorerWindow();renderExplorer();}
  else if(reset)resetFilters();
  else if(loadMore){const firstNewIndex=state.explorerLimit;state.explorerLimit+=explorerPageSize();renderExplorer();requestAnimationFrame(()=>el("exerciseGrid").querySelector(`[data-result-index="${firstNewIndex}"] [data-open-detail]`)?.focus());}
  else if(share)void shareCard("exercise",share.dataset.shareExercise);
  else if(shareBattle)void shareCard("comparison");
});

document.querySelectorAll("dialog").forEach((dialog)=>{
  dialog.addEventListener("click",(event)=>{if(event.target===dialog)closeDialog(dialog.id);});
  dialog.addEventListener("cancel",(event)=>{event.preventDefault();closeDialog(dialog.id);});
  dialog.addEventListener("close",syncDialogState);
});
el("searchInput").addEventListener("input",(event)=>{const query=event.target.value;clearTimeout(explorerSearchTimer);explorerSearchTimer=setTimeout(()=>{state.query=query;resetExplorerWindow();renderExplorer();},SEARCH_DEBOUNCE_MS);});
el("groupFilter").addEventListener("change",(event)=>{state.group=event.target.value;resetExplorerWindow();renderExplorer();});
el("equipmentFilter").addEventListener("change",(event)=>{state.equipment=event.target.value;resetExplorerWindow();renderExplorer();});
el("patternFilter").addEventListener("change",(event)=>{state.pattern=event.target.value;resetExplorerWindow();renderExplorer();});
el("levelFilter").addEventListener("change",(event)=>{state.level=event.target.value;resetExplorerWindow();renderExplorer();});
el("sortSelect").addEventListener("change",(event)=>{state.sort=event.target.value;resetExplorerWindow();renderExplorer();});
el("clearFilters").addEventListener("click",resetFilters);
el("clearCompare").addEventListener("click",()=>{state.compare=[];el("battleResults").hidden=true;renderCompareTray();renderRecommendations();renderExplorer();});
el("openCompare").addEventListener("click",()=>{openComparison();const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;el("battle").scrollIntoView({behavior:reduceMotion?"auto":"smooth",block:"start"});});
el("battleSelects").addEventListener("change",()=>{readBattleBuilder();el("battleResults").hidden=true;renderRecommendations();renderExplorer();});
el("battleForm").addEventListener("submit",(event)=>{event.preventDefault();readBattleBuilder();renderCompareTray();renderRecommendations();renderExplorer();openComparison();});
el("battleReset").addEventListener("click",()=>{state.compare=[];el("battleResults").hidden=true;renderCompareTray();renderRecommendations();renderExplorer();});
el("shareRanking").addEventListener("click",()=>void shareCard("ranking"));
el("logoutButton").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}finally{window.location.replace("/");}});

async function init(){
  try{
    const data=await api("/api/discovery");state.exercises=data.exercises;state.methodology=data.methodology;state.sources=data.sources;state.limited=new Set(data.limitedConfidenceExercises);state.preferences=data.preferences;state.user=data.user;
    state.aggregate=new Map((data.ratings.aggregates||[]).map((item)=>[item.exercise_id,item]));state.userRatings=new Map((data.ratings.user||[]).map((item)=>[item.exercise_id,item]));
    el("userName").textContent=data.user.name;el("catalogTotal").textContent=state.exercises.length;el("recommendationTitle").innerHTML=`BEST EXERCISES <em>FOR ${escapeHtml(data.user.name.split(/\s+/)[0].toUpperCase())}.</em>`;
    renderProfile();populateFilters();renderMethodology();renderRecommendations();resetExplorerWindow();renderExplorer();renderCompareTray();
  }catch(error){el("profileStatus").textContent="Unable to load";el("battleStatus").textContent=error.message;el("recommendationGrid").innerHTML=`<div class="loading-card">${escapeHtml(error.message)}</div>`;el("exerciseGrid").innerHTML=`<div class="loading-card">${escapeHtml(error.message)}</div>`;showToast(error.message);}
}

init();
