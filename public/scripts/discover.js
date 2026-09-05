"use strict";

const Core=globalThis.StrataDiscovery;
if(!Core)throw new Error("The Strata+ engine did not load.");
const Monthly=globalThis.StrataMonthlyPlan;
if(!Monthly)throw new Error("The Strata+ monthly-plan engine did not load.");
const GROUP_LABELS={chest:"Chest",back:"Back",shoulders:"Shoulders",arms:"Arms",legs:"Legs",glutes:"Glutes",calves:"Calves",core:"Core"};
const PREFERENCE_OPTIONS={stable:"Stable setup","long-range":"Long-range friendly","simple-setup":"Simple setup",compound:"Compound lifts",isolation:"Isolation work"};
const LIMITATION_OPTIONS={"no-overhead":"Avoid overhead positions","no-deep-knee":"Avoid deep knee flexion","no-unsupported-hinge":"Avoid unsupported hinges","no-floor":"Avoid floor exercises","no-unilateral":"Avoid unilateral work"};
const EXPLORER_DESKTOP_PAGE_SIZE=24;
const EXPLORER_MOBILE_PAGE_SIZE=12;
const SEARCH_DEBOUNCE_MS=180;
const RATINGS_REFRESH_MIN_INTERVAL_MS=15_000;
const COMMUNITY_PAGE_SIZE=12;
const FEATURE_DEFAULT="recommendations";
const FEATURE_CONFIG=Object.freeze({
  recommendations:{panelId:"recommendations",headingId:"recommendationTitle",label:"Best for you"},
  explorer:{panelId:"exerciseExplorer",headingId:"explorerTitle",label:"Explore and rate"},
  battle:{panelId:"battle",headingId:"battleTitle",label:"Exercise battle"},
  profile:{panelId:"profile",headingId:"profileTitle",label:"Tune my ranking"},
  community:{panelId:"communityPlans",headingId:"communityPlansTitle",label:"Community weekly plans"},
  monthly:{panelId:"monthlyPlan",headingId:"monthlyPlanTitle",label:"31-day plan"}
});
const state={exercises:[],methodology:null,sources:[],limited:new Set(),preferences:null,user:null,csrfToken:"",aggregate:new Map(),userRatings:new Map(),ratingsRefreshedAt:0,ratingsRefreshPromise:null,compare:[],collection:"all",query:"",group:"all",equipment:"all",pattern:"all",level:"all",sort:"personal",recommendations:[],activeExercise:null,activeFeature:null,explorerLimit:EXPLORER_DESKTOP_PAGE_SIZE,weeklyPlan:null,weeklyPlanUpdatedAt:0,monthlyPlan:null,monthlySchedule:null,monthlySource:"muscle-schedule",communityPlans:[],communityLoaded:false,communityLoading:false,communityError:"",communityNextOffset:0,communityQuery:"",communityPendingId:null,communityAppliedId:null,communityAppliedUpdatedAt:0};
const el=(id)=>document.getElementById(id);

async function api(path,options={}) {
  const method=String(options.method||"GET").toUpperCase(),changesState=method!=="GET"&&method!=="HEAD";
  let response;
  try{
    response=await fetch(path,{...options,credentials:"same-origin",headers:{Accept:"application/json",...(options.body?{"Content-Type":"application/json"}:{}),...(changesState&&state.csrfToken?{"X-CSRF-Token":state.csrfToken}:{}),...(options.headers||{})}});
  }catch(cause){
    throw Object.assign(new Error("Could not reach STRATA. Check your connection, then try again."),{code:"NETWORK_ERROR",cause});
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok){
    const error=Object.assign(new Error(data.error||"Request failed."),{status:response.status,code:data.code||"REQUEST_FAILED"});
    if(response.status===401){error.redirecting=true;window.location.replace("/account.html?mode=login&next=discover");}
    else if(response.status===402||data.code==="DISCOVERY_ACCESS_REQUIRED"){error.redirecting=true;window.location.replace("/pricing?reason=access-revoked");}
    throw error;
  }
  return data;
}

function escapeHtml(value){return String(value??"").replace(/[&<>'"]/g,(char)=>({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[char]));}
function exerciseById(id){return state.exercises.find((exercise)=>exercise.id===id);}
function titleCase(value){return String(value).replace(/(^|[- /])\w/g,(match)=>match.toUpperCase());}
function featureName(value){
  const raw=String(value||"").replace(/^#/,"");
  if(Object.hasOwn(FEATURE_CONFIG,raw))return raw;
  return Object.keys(FEATURE_CONFIG).find((name)=>FEATURE_CONFIG[name].panelId===raw)||null;
}
function featureFromLocation(){
  const raw=String(globalThis.location?.hash||"").replace(/^#/,"");
  try{return featureName(decodeURIComponent(raw));}catch{return featureName(raw);}
}
function featurePanel(name){const config=FEATURE_CONFIG[name];return config?el(config.panelId):null;}
function featureHash(name){return `#${FEATURE_CONFIG[name].panelId}`;}
function updateFeatureHistory(name,mode){
  if(mode!=="push"&&mode!=="replace")return;
  const hash=featureHash(name);
  if(String(globalThis.location?.hash||"")===hash)return;
  const method=mode==="push"?"pushState":"replaceState";
  globalThis.history?.[method]?.({feature:name},"",hash);
}
function activateFeature(value,{focus=false,scroll=false,smooth=false,announce=false,historyMode="none"}={}){
  const name=featureName(value)||FEATURE_DEFAULT,config=FEATURE_CONFIG[name],panel=featurePanel(name);
  if(!panel)return false;
  state.activeFeature=name;
  for(const candidate of Object.keys(FEATURE_CONFIG)){
    const candidatePanel=featurePanel(candidate);
    if(candidatePanel)candidatePanel.hidden=candidate!==name;
  }
  for(const link of document.querySelectorAll("[data-feature-target]")){
    const active=featureName(link.dataset.featureTarget)===name;
    link.classList.toggle("active",active);
    link.setAttribute?.("aria-controls",FEATURE_CONFIG[featureName(link.dataset.featureTarget)]?.panelId||"");
    link.setAttribute?.("aria-expanded",String(active));
    if(link.classList.contains("feature-block")){
      if(active)link.setAttribute?.("aria-current","location");
      else link.removeAttribute?.("aria-current");
    }
  }
  document.body.dataset.activeFeature=name;
  updateFeatureHistory(name,historyMode);
  if(announce&&el("featureStatus"))el("featureStatus").textContent=`${config.label} workspace opened.`;
  if(state.user&&["recommendations","explorer","battle"].includes(name))void refreshCommunityRatings().catch(()=>{});
  if(state.user&&name==="community"&&!state.communityLoaded&&!state.communityLoading)void loadCommunityPlans({reset:true});
  if(scroll||focus){
    const move=()=>{
      const reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
      if(scroll)panel.scrollIntoView?.({behavior:smooth&&!reduceMotion?"smooth":"auto",block:"start"});
      if(focus)el(config.headingId)?.focus?.({preventScroll:true});
    };
    if(typeof globalThis.requestAnimationFrame==="function")globalThis.requestAnimationFrame(move);else setTimeout(move,0);
  }
  return true;
}
function initializeFeatureNavigation(){
  const rawHash=String(globalThis.location?.hash||"").replace(/^#/,"");
  const requested=featureFromLocation(),atHub=rawHash==="featureHub";
  activateFeature(requested||FEATURE_DEFAULT,{scroll:Boolean(requested),historyMode:requested||atHub?"none":"replace"});
}
let featureHistoryQueued=false;
function restoreFeatureFromHistory(){
  if(featureHistoryQueued)return;
  featureHistoryQueued=true;
  Promise.resolve().then(()=>{
    featureHistoryQueued=false;
    const rawHash=String(globalThis.location?.hash||"").replace(/^#/,"");
    if(rawHash==="featureHub")return;
    const requested=featureFromLocation();
    if(rawHash&&!requested)return;
    activateFeature(requested||FEATURE_DEFAULT,{scroll:Boolean(requested)});
  });
}
window.addEventListener?.("popstate",restoreFeatureFromHistory);
window.addEventListener?.("hashchange",restoreFeatureFromHistory);
const round=Core.round;
function aggregateFor(id){return state.aggregate.get(id)||null;}
function communitySummary(id){
  const item=aggregateFor(id),count=Math.max(0,Number.parseInt(item?.rating_count,10)||0),overall=Number(item?.overall);
  if(!count||!Number.isFinite(overall))return {count:0,hasRatings:false,score:"",label:"Not rated yet",attribution:"No Strata+ ratings yet"};
  const score=(Math.min(5,Math.max(1,overall))*2).toFixed(1);
  return {count,hasRatings:true,score,label:`${score}/10 · ${count} rating${count===1?"":"s"}`,attribution:`Rated by ${count} Strata+ user${count===1?"":"s"}`};
}
function communityLabel(id){return communitySummary(id).label;}
function ratingAverage(value){const number=Number(value);return Number.isFinite(number)?number.toFixed(1):"—";}
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
  el("recommendationGrid").innerHTML=state.recommendations.length?state.recommendations.map(({exercise,result},index)=>`<article class="recommend-card" data-rank="${String(index+1).padStart(2,"0")}"><div class="card-topline"><span class="match-pill">${result.match}% personal match</span>${scoreButton(exercise)}</div><h3>${escapeHtml(exercise.name)}</h3><span class="target">${escapeHtml(GROUP_LABELS[exercise.group])} / ${escapeHtml(exercise.sub)}</span><p>${escapeHtml(profileReason(result))}. ${escapeHtml(exercise.why)}</p><div class="mini-meta"><span>${escapeHtml(exercise.equipment)}</span><span>${escapeHtml(exercise.level)}</span></div><div class="community-line"><span>Community rating</span><strong>${escapeHtml(communityLabel(exercise.id))}</strong></div><div class="mini-actions"><button data-open-detail="${exercise.id}" type="button" aria-label="Why ${escapeHtml(exercise.name)} ranks here">Why it ranks</button>${compareButton(exercise)}<a href="/planner.html?add=${encodeURIComponent(exercise.id)}" aria-label="Add ${escapeHtml(exercise.name)} to weekly plan">Plan +</a></div></article>`).join(""):`<div class="loading-card recommendation-empty"><p>No exercise matches all saved equipment and constraints.</p><a class="small-button" href="#profile" data-feature-target="profile">Tune my ranking →</a></div>`;
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
  el("exerciseGrid").innerHTML=visibleItems.map((exercise,index)=>{const personal=personalResult(exercise);return `<article class="exercise-card" data-result-index="${index}"><div class="card-topline"><span class="match-pill ${personal.eligible?"":"is-excluded"}">${escapeHtml(personalLabel(personal))}</span>${scoreButton(exercise)}</div><h3>${escapeHtml(exercise.name)}</h3><span class="target">${escapeHtml(GROUP_LABELS[exercise.group]||titleCase(exercise.group))} / ${escapeHtml(exercise.sub)}</span><p>${escapeHtml(exercise.why)}</p><div class="mini-meta"><span>${escapeHtml(exercise.equipment)}</span><span>${escapeHtml(exercise.pattern)}</span><span>${escapeHtml(exercise.level)}</span></div><div class="community-line"><span>Community rating</span><strong>${escapeHtml(communityLabel(exercise.id))}</strong></div><div class="mini-actions"><button data-open-detail="${exercise.id}" type="button" aria-label="Inspect ${escapeHtml(exercise.name)}">Inspect</button>${compareButton(exercise)}<a href="/planner.html?add=${encodeURIComponent(exercise.id)}" aria-label="Add ${escapeHtml(exercise.name)} to weekly plan">Plan +</a></div></article>`;}).join("")+(!remaining?"":`<div class="explorer-load-more"><p>Showing ${visibleItems.length} of ${items.length} matching exercises</p><button data-load-more-exercises type="button" aria-controls="exerciseGrid">Load ${nextCount} more <span aria-hidden="true">↓</span></button></div>`);
}

function renderCommunityViews(){
  if(!state.exercises.length||!state.preferences)return;
  renderRecommendations();renderExplorer();
  if(state.activeExercise&&el("detailDialog")?.open)openDetail(state.activeExercise);
  if(state.compare.length>=2&&!el("battleResults")?.hidden)openComparison();
}

async function refreshCommunityRatings({force=false}={}){
  if(!state.user||!state.exercises.length)return false;
  if(state.ratingsRefreshPromise)return state.ratingsRefreshPromise;
  if(!force&&Date.now()-state.ratingsRefreshedAt<RATINGS_REFRESH_MIN_INTERVAL_MS)return false;
  const refresh=api("/api/ratings/aggregates").then((data)=>{
    const aggregates=Array.isArray(data.aggregates)?data.aggregates:Array.isArray(data.ratings?.aggregates)?data.ratings.aggregates:[];
    state.aggregate=new Map(aggregates.map((item)=>[item.exercise_id,item]));
    state.ratingsRefreshedAt=Date.now();renderCommunityViews();return true;
  });
  state.ratingsRefreshPromise=refresh;
  try{return await refresh;}finally{if(state.ratingsRefreshPromise===refresh)state.ratingsRefreshPromise=null;}
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
function ratingFormMarkup(exercise,draft=null){
  const current=draft||state.userRatings.get(exercise.id)||{comfort:3,pump:3,enjoyment:3,stability:3,setup:3,overall:3};
  return `<form class="rating-form" data-rating-form="${exercise.id}"><div class="rating-grid">${[["comfort","Comfort"],["pump","Pump / target feel"],["enjoyment","Enjoyment"],["stability","Perceived stability"],["setup","Setup ease"],["overall","Overall"]].map(([key,label])=>`<label>${label}<select name="${key}">${ratingOptions(current[key])}</select></label>`).join("")}</div><button class="button button-dark" type="submit">${state.userRatings.has(exercise.id)?"Update my rating":"Save my rating"} <span>→</span></button></form>`;
}

function openRatingDraft(id){
  if(state.activeExercise!==id||!el("detailDialog")?.open)return null;
  const form=el("detailContent")?.querySelector?.("[data-rating-form]");
  if(!form||form.dataset?.ratingForm!==id)return null;
  const draft={};
  for(const key of ["comfort","pump","enjoyment","stability","setup","overall"]){
    const field=form.elements?.namedItem?.(key)||form.querySelector?.(`[name="${key}"]`),value=Number(field?.value);
    if(!Number.isInteger(value)||value<1||value>5)return null;
    draft[key]=value;
  }
  return draft;
}

function gainsAndLosses(reference,candidate){
  const result=Core.gainsAndLosses(reference,candidate,state.methodology);
  return `Gain: ${result.gain} · Trade-off: ${result.loss}`;
}

function openDetail(id){
  const exercise=exerciseById(id);if(!exercise)return;const ratingDraft=openRatingDraft(id);state.activeExercise=id;
  const dialog=el("detailDialog");
  const baseline=weightedBaseline(exercise),adjustment=scoreAdjustment(exercise),personal=personalResult(exercise),aggregate=aggregateFor(id),sources=sourceSelection(exercise),alternatives=alternativesFor(exercise),confidence=state.limited.has(id)?"Limited":"Moderate";
  const community=communitySummary(id),ownRating=state.userRatings.get(id)||null;
  const profileHeading=personal.eligible?"Why it fits you":"Why it does not match your profile";
  const profileSummary=personal.eligible?`<strong>${personal.match}% rules-based match.</strong> ${escapeHtml(profileReason(personal))}.`:`<strong>Excluded by your saved rules.</strong> ${escapeHtml(profileReason(personal))}.`;
  el("detailContent").innerHTML=`
    <div class="detail-hero"><div class="dialog-head" style="position:static;padding:0 0 24px;background:transparent;border-color:rgba(255,255,255,.18)"><p class="kicker">Exercise intelligence / ${escapeHtml(GROUP_LABELS[exercise.group]||titleCase(exercise.group))}</p><button class="icon-button" data-close-dialog="detailDialog" type="button" aria-label="Close exercise details">×</button></div><div class="detail-hero-grid"><div><h2 class="detail-title" id="detailTitle">${escapeHtml(exercise.name)}</h2><p>${escapeHtml(exercise.why)}</p><span class="match-pill ${personal.eligible?"":"is-excluded"}">${escapeHtml(personalLabel(personal))}</span></div><div class="detail-score"><strong>${exercise.score}</strong><span>Official FitScore</span></div></div><div class="detail-quick-actions"><button data-toggle-compare="${exercise.id}" type="button" aria-pressed="${state.compare.includes(id)}">${state.compare.includes(id)?"Remove from battle":"Add to battle"}</button><button data-scroll-alternatives type="button" aria-controls="alternativeSection">Find alternative ↓</button><a href="/planner.html?add=${encodeURIComponent(id)}">Add to week →</a><a href="${exercise.youtube}" target="_blank" rel="noreferrer">YouTube search ↗</a><button data-share-exercise="${exercise.id}" type="button">Share card ↗</button></div></div>
    <div class="detail-body"><div class="detail-grid"><div>
      <section class="detail-section"><h3>${profileHeading}</h3><p>${profileSummary} This selection is an editorial rules engine, not an AI prediction or medical recommendation.</p><p><strong>Target:</strong> ${escapeHtml(exercise.sub)} · <strong>Pattern:</strong> ${escapeHtml(exercise.pattern)} · <strong>Equipment:</strong> ${escapeHtml(exercise.equipment)} · <strong>Level:</strong> ${escapeHtml(exercise.level)}</p></section>
      <section class="detail-section"><h3>FitScore audit</h3><div class="metric-list">${metricMarkup(exercise)}</div><div class="adjustment-row"><strong>Weighted baseline: ${round(baseline,1)}</strong> · Published score: ${exercise.score} · Editorial adjustment: ${adjustment>0?"+":""}${adjustment}.<br/>${escapeHtml(state.methodology.adjustment)}</div><p>${escapeHtml(state.methodology.evidenceNote)}</p></section>
      <section class="detail-section"><h3>Evidence and boundaries</h3><span class="confidence">${confidence} exercise-specific confidence</span><p><strong>Evidence:</strong> the links below support broad training principles. <strong>STRATA interpretation:</strong> applying those principles to this exact exercise and score is editorial judgment.</p>${sources.map((source)=>`<article class="source-card"><a href="${source.url}" target="_blank" rel="noreferrer">${escapeHtml(source.title)} ↗</a><span>${escapeHtml(source.type)} · ${escapeHtml(source.publisher)} · ${source.year}</span><p><strong>Supports:</strong> ${escapeHtml(source.supports)}</p><p class="source-boundary"><strong>Does not support:</strong> ${escapeHtml(source.doesNotSupport)}</p></article>`).join("")}</section>
    </div><aside>
      <section class="detail-section"><h3>Practical decision</h3><p><strong>Stability:</strong> ${exercise.metrics.stability}/100 · <strong>Effective range:</strong> ${exercise.metrics.range}/100</p><p><strong>Resistance profile:</strong> ${escapeHtml(resistanceProfile(exercise))}</p><p><strong>Progression:</strong> ${exercise.metrics.progression}/100 · <strong>Setup:</strong> ${escapeHtml(setupLabel(exercise))}</p><p><strong>Editorial practicality:</strong> ${practicality(exercise)}/100</p><h4>Programming starting point</h4><p>${escapeHtml(exercise.sets)} sets · ${escapeHtml(exercise.reps)} reps · ${escapeHtml(exercise.rest)} rest</p><h4>Technique cues</h4><ul>${exercise.cues.map((cue)=>`<li>${escapeHtml(cue)}</li>`).join("")}</ul><h4>Consideration</h4><p>${escapeHtml(exercise.caution)}</p></section>
      <section class="detail-section" id="alternativeSection"><h3 id="alternativeTitle" tabindex="-1">Find an alternative</h3><div class="alternative-list">${alternatives.length?alternatives.map(({exercise:candidate,match})=>`<div class="alternative-item"><div><strong>${escapeHtml(candidate.name)}</strong><small>${escapeHtml(gainsAndLosses(exercise,candidate))}</small></div><span>${match}%</span><div class="alternative-actions"><button data-open-detail="${candidate.id}" type="button" aria-label="Open ${escapeHtml(candidate.name)} details">Open</button><a href="/planner.html?add=${encodeURIComponent(candidate.id)}" aria-label="Add ${escapeHtml(candidate.name)} to weekly plan">Plan +</a></div></div>`).join(""):"<p>No eligible same-target alternative under your saved profile.</p>"}</div><p>Match percentages are transparent editorial similarity scores based on target, pattern, resistance profile, equipment, skill, and factor profile.</p></section>
      <section class="detail-section"><h3>Community score</h3><div class="rating-summary"><strong>${escapeHtml(community.hasRatings?`${community.score}/10`:community.label)}</strong><span>${escapeHtml(community.attribution)}</span></div>${community.hasRatings?`<div class="community-breakdown">${[["comfort","Comfort"],["pump","Pump"],["enjoyment","Enjoyment"],["stability","Stability"],["setup","Setup"],["overall","Overall"]].map(([key,label])=>`<span>${label}<b>${ratingAverage(aggregate[key])}/5</b></span>`).join("")}</div>`:""}${ownRating?`<p><strong>Your rating:</strong> ${Number(ownRating.overall)}/5 overall</p>`:"<p>Be the first Strata+ user to rate this exercise.</p>"}<p>Your rating is tied to your account and replaces your prior rating. It never changes the official FitScore.</p>${ratingFormMarkup(exercise,ratingDraft)}</section>
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
function tableRow(label,exercises,value,{winner=false}={}){const leaders=winner?bestIds(exercises,value):new Set();return `<tr><th scope="row">${escapeHtml(label)}</th>${exercises.map((exercise)=>{const leads=leaders.has(exercise.id);return `<td class="${leads?"winner":""}">${leads?'<span class="sr-only">Best in this comparison. </span>':""}${value(exercise)}</td>`;}).join("")}</tr>`;}
function openComparison(){
  const exercises=state.compare.map(exerciseById).filter(Boolean);
  if(exercises.length<2){el("battleStatus").textContent="Choose at least two different exercises first.";el("battleResults").hidden=true;showToast("Choose at least two exercises.");return;}
  const verdict=comparisonWinner(exercises);
  const rows=[
    tableRow("Official FitScore",exercises,(exercise)=>`${exercise.score}/100`,{winner:true}),
    tableRow("Personal match",exercises,(exercise)=>personalResult(exercise).eligible?`${personalResult(exercise).match}%`:"Excluded by profile",{winner:true}),
    tableRow("Community rating",exercises,(exercise)=>escapeHtml(communityLabel(exercise.id))),
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
  const columnHeaders=exercises.map((exercise)=>`<th scope="col"><strong>${escapeHtml(exercise.name)}</strong><span>${escapeHtml(exercise.sub)}</span></th>`).join("");
  el("battleResults").innerHTML=`<div class="battle-results-head"><h3>Side-by-side result</h3><div class="battle-results-actions"><button class="small-button" data-share-battle type="button">Share card ↗</button><a class="small-button" href="/planner.html">Open planner ↗</a></div></div><div class="battle-verdict"><strong>${verdict.winner?`${escapeHtml(verdict.winner.name)} leads`:"No universal winner"}</strong><p>${escapeHtml(verdict.text)}</p></div><div class="comparison-scroll" role="region" aria-label="Exercise comparison table. Scroll horizontally to see every exercise." tabindex="0"><table class="comparison-table"><caption class="sr-only">Exercise comparison across FitScore, targets, mechanics, progression, setup, equipment, and practicality</caption><thead><tr><th scope="col">Measure</th>${columnHeaders}</tr></thead><tbody>${rows.join("")}</tbody></table></div><p class="field-note">Highlighted cells lead this selected set on that factor. Rankings are editorial and do not predict individual results.</p>`;
  el("battleResults").hidden=false;el("battleStatus").textContent=`Compared ${exercises.length} exercises.`;
}

function syncDialogState(){document.body.classList.toggle("dialog-open",Boolean(document.querySelector("dialog[open]")));}
function closeDialog(id){const dialog=el(id);if(dialog?.open)dialog.close();syncDialogState();}
let toastTimer;function showToast(message){const toast=el("toast");toast.textContent=message;toast.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>toast.classList.remove("show"),2200);}

function normalizeCommunityPlan(record){
  if(!record||typeof record!=="object")return null;
  const id=String(record.id||"").trim();if(!id)return null;
  try{
    return{id,title:String(record.title||"Community week").trim().slice(0,80)||"Community week",description:String(record.description||"").trim().slice(0,240),authorName:String(record.authorName||"STRATA member").trim().slice(0,80)||"STRATA member",createdAt:record.createdAt,updatedAt:record.updatedAt,plan:Monthly.normalizeWeeklyPlan(record.plan,state.exercises)};
  }catch{return null;}
}
function communityPlanStats(record){
  const days=Monthly.DAYS.map((day)=>record.plan.days[day]||[]),exercises=days.reduce((total,items)=>total+items.length,0),trainingDays=days.filter((items)=>items.length).length;
  return{exercises,trainingDays};
}
function communityExerciseName(item){return exerciseById(item.exerciseId)?.name||titleCase(item.exerciseId);}
function communityPlanSearchText(record){
  const names=Monthly.DAYS.flatMap((day)=>record.plan.days[day]||[]).map(communityExerciseName);
  return[record.title,record.description,record.authorName,...names].join(" ").toLocaleLowerCase();
}
function communityDateLabel(value){
  if(value===null||value===undefined||value==="")return "Shared plan";
  const numeric=Number(value),date=new Date(Number.isFinite(numeric)&&numeric>0?numeric:value);
  return Number.isNaN(date.getTime())?"Shared plan":`Shared ${new Intl.DateTimeFormat(undefined,{month:"short",year:"numeric"}).format(date)}`;
}
function sharedPlanDayMarkup(day,plan){
  const items=plan.days[day]||[],isRest=day===plan.restDay;
  const list=items.map((item)=>`<li><strong>${escapeHtml(communityExerciseName(item))}</strong><small>${Number(item.sets)} sets × ${escapeHtml(item.reps)}</small></li>`).join("");
  return `<section class="shared-plan-day ${isRest?"is-rest":""}" aria-label="${escapeHtml(day)}: ${isRest?"recovery day":`${items.length} exercise${items.length===1?"":"s"}`}"><h4>${escapeHtml(day.slice(0,3))}<span>${isRest?"Recovery":`${items.length} exercise${items.length===1?"":"s"}`}</span></h4>${isRest?"<p>REST / RECOVERY</p>":items.length?`<ul>${list}</ul>`:"<p>Open training day</p>"}</section>`;
}
function communityPlanCard(record,index){
  const stats=communityPlanStats(record),applied=state.communityAppliedId===record.id&&state.communityAppliedUpdatedAt===Number(record.updatedAt);
  return `<article class="community-plan-card" data-community-plan="${escapeHtml(record.id)}"><div class="community-plan-card-head"><span class="community-plan-index">${String(index+1).padStart(2,"0")}</span><span class="community-plan-author">By ${escapeHtml(record.authorName)}</span></div><h3>${escapeHtml(record.title)}</h3><p class="community-plan-description">${escapeHtml(record.description||"A complete seven-day workout plan shared with the STRATA community.")}</p><div class="community-plan-meta"><span>${stats.trainingDays} training day${stats.trainingDays===1?"":"s"}</span><span>${stats.exercises} exercise${stats.exercises===1?"":"s"}</span><span>${escapeHtml(communityDateLabel(record.updatedAt||record.createdAt))}</span></div><details class="shared-plan-preview"><summary aria-label="Preview all 7 days of ${escapeHtml(record.title)} by ${escapeHtml(record.authorName)}">Preview all 7 days</summary><div class="shared-plan-week">${Monthly.DAYS.map((day)=>sharedPlanDayMarkup(day,record.plan)).join("")}</div></details><div class="community-plan-card-actions"><button class="button button-dark" data-apply-community="${escapeHtml(record.id)}" data-applied="${applied}" type="button" aria-label="${applied?"This exact version is already in My Plan":`Replace My Plan with ${escapeHtml(record.title)} by ${escapeHtml(record.authorName)}`}" ${applied?"disabled":""}>${applied?"Already in My Plan ✓":"Replace My Plan"} <span>${applied?"✓":"→"}</span></button><a class="small-button" href="/planner.html">View mine</a></div></article>`;
}
function renderCommunityPlans(){
  const grid=el("communityPlanGrid"),status=el("communityPlanStatus"),query=state.communityQuery.trim().toLocaleLowerCase();
  grid.setAttribute?.("aria-busy",String(state.communityLoading));
  if(state.communityLoading&&!state.communityPlans.length){grid.innerHTML='<div class="community-plan-state"><span class="community-state-mark" aria-hidden="true">↻</span><strong>Loading shared plans</strong><p>Getting the latest plans from the community.</p></div>';status.textContent="Loading shared plans…";el("communityLoadMore").hidden=true;return;}
  const plans=query?state.communityPlans.filter((record)=>communityPlanSearchText(record).includes(query)):state.communityPlans;
  if(!plans.length){
    const failed=Boolean(state.communityError),filtered=Boolean(query&&state.communityPlans.length);
    grid.innerHTML=`<div class="community-plan-state"><span class="community-state-mark" aria-hidden="true">${failed?"!":filtered?"⌕":"+"}</span><strong>${failed?"Plans could not load":filtered?"No matching plans":"No plans shared yet"}</strong><p>${failed?escapeHtml(state.communityError):filtered?"Try another plan name, creator, or exercise.":"When a member shares a week from their planner, it will appear here."}</p>${failed?'<button class="small-button" data-community-retry type="button">Try again</button>':""}</div>`;
    status.textContent=failed?"Shared plans are temporarily unavailable.":filtered?"No loaded plans match your search.":"No community plans have been published yet.";
  }else{
    grid.innerHTML=plans.map((record,index)=>communityPlanCard(record,index)).join("");
    status.textContent=state.communityError?`${plans.length} loaded plan${plans.length===1?"":"s"} shown · more plans could not load.`:`${plans.length} plan${plans.length===1?"":"s"} shown${query?` from ${state.communityPlans.length} loaded`:""}.`;
  }
  el("communityLoadMore").hidden=state.communityLoading||state.communityNextOffset===null;
}
function communityViewState(){
  const cards=[...el("communityPlanGrid").querySelectorAll("[data-community-plan]")];
  return{openIds:new Set(cards.filter((card)=>card.querySelector("details")?.open).map((card)=>card.dataset.communityPlan)),focusLoadMore:document.activeElement===el("communityLoadMore")};
}
function restoreCommunityView(view){
  for(const card of el("communityPlanGrid").querySelectorAll("[data-community-plan]"))if(view.openIds.has(card.dataset.communityPlan)){const details=card.querySelector("details");if(details)details.open=true;}
  if(view.focusLoadMore&&!el("communityLoadMore").hidden)el("communityLoadMore").focus?.();
}
async function loadCommunityPlans({reset=false}={}){
  if(state.communityLoading)return;
  const view=communityViewState();
  if(reset){state.communityPlans=[];state.communityNextOffset=0;state.communityError="";state.communityLoaded=false;}
  if(state.communityNextOffset===null&&!reset)return;
  const offset=reset?0:state.communityNextOffset;
  state.communityLoading=true;
  if(!state.communityPlans.length)renderCommunityPlans();
  else{el("communityPlanGrid").setAttribute?.("aria-busy","true");el("communityLoadMore").disabled=true;el("communityPlanStatus").textContent="Loading more shared plans…";}
  try{
    const data=await api(`/api/community-plans?limit=${COMMUNITY_PAGE_SIZE}&offset=${offset}`),incoming=(Array.isArray(data.plans)?data.plans:[]).map(normalizeCommunityPlan).filter(Boolean),plansById=new Map(state.communityPlans.map((plan)=>[plan.id,plan]));
    incoming.forEach((plan)=>plansById.set(plan.id,plan));state.communityPlans=[...plansById.values()];
    const rawNext=Number(data.pagination?.nextOffset);state.communityNextOffset=Number.isSafeInteger(rawNext)&&rawNext>offset?rawNext:null;state.communityError="";
  }catch(error){state.communityError=error.message||"Please check your connection and try again.";}
  finally{state.communityLoading=false;state.communityLoaded=true;el("communityLoadMore").disabled=false;renderCommunityPlans();restoreCommunityView(view);}
}
function openCommunityApplyDialog(id){
  const record=state.communityPlans.find((plan)=>plan.id===String(id));if(!record)return;
  const dialog=el("communityApplyDialog"),incoming=communityPlanStats(record),currentCount=weeklyPlanCount(state.weeklyPlan);
  state.communityPendingId=record.id;el("communityApplyError").hidden=true;el("communityApplyError").textContent="";
  el("communityApplyDescription").textContent=`Replace your current weekly plan with “${record.title}” by ${record.authorName}?`;
  el("communityApplySummary").innerHTML=`<div><span>New week</span><strong>${escapeHtml(record.title)}</strong></div><div><span>Creator</span><strong>${escapeHtml(record.authorName)}</strong></div><div><span>New exercises</span><strong>${incoming.exercises}</strong></div><div><span>Your current week</span><strong>${currentCount} exercise${currentCount===1?"":"s"}</strong></div>`;
  dialog.showModal?.();document.body.classList.add("dialog-open");el("communityApplyCancel").focus?.();
}
async function applyCommunityPlan(){
  const record=state.communityPlans.find((plan)=>plan.id===state.communityPendingId);if(!record)return;
  const dialog=el("communityApplyDialog"),confirm=el("communityApplyConfirm"),controls=[...dialog.querySelectorAll("button")];
  dialog.dataset.busy="true";dialog.setAttribute?.("aria-busy","true");controls.forEach((control)=>{control.disabled=true;});confirm.textContent="Replacing your plan…";el("communityApplyError").hidden=true;
  const controller=typeof globalThis.AbortController==="function"?new AbortController():null;
  const timeout=controller?setTimeout(()=>controller.abort(),15_000):null;
  try{
    const result=await api(`/api/community-plans/${encodeURIComponent(record.id)}/apply`,{method:"POST",body:JSON.stringify({sourceUpdatedAt:Number(record.updatedAt),targetUpdatedAt:state.weeklyPlanUpdatedAt}),...(controller?{signal:controller.signal}:{})});
    state.weeklyPlan=Monthly.normalizeWeeklyPlan(result.plan,state.exercises);state.weeklyPlanUpdatedAt=Number(result.planUpdatedAt)||state.weeklyPlanUpdatedAt;state.communityAppliedId=record.id;state.communityAppliedUpdatedAt=Number(record.updatedAt);updateMonthlySourceButtons();closeDialog("communityApplyDialog");state.communityPendingId=null;renderCommunityPlans();
    const planLink=el("communityOpenPlan");planLink.hidden=false;el("communityPlanStatus").textContent=`“${record.title}” is now your weekly plan.`;planLink.focus?.();showToast("Weekly plan replaced with the community week.");
  }catch(error){
    if(error.code==="COMMUNITY_PLAN_CHANGED"){
      const refreshed=await Promise.allSettled([api("/api/plan"),loadCommunityPlans({reset:true})]);
      if(refreshed[0].status==="fulfilled"){
        state.weeklyPlan=Monthly.normalizeWeeklyPlan(refreshed[0].value.plan,state.exercises);state.weeklyPlanUpdatedAt=Number(refreshed[0].value.planUpdatedAt)||0;
      }
      closeDialog("communityApplyDialog");state.communityPendingId=null;el("communityPlanStatus").textContent="A shared plan or your current week changed. Review the latest versions before trying again.";showToast("Plans changed — review them before replacing yours.");
    }else{const node=el("communityApplyError");node.textContent=error.name==="AbortError"?"The request took too long. Your plan was not confirmed as changed; close this window and check My Plan before trying again.":error.message;node.hidden=false;}
  }
  finally{if(timeout!==null)clearTimeout(timeout);dialog.dataset.busy="false";dialog.setAttribute?.("aria-busy","false");controls.forEach((control)=>{control.disabled=false;});confirm.innerHTML='Replace with this plan <span>→</span>';}
}

function blankMonthlySchedule(){
  const training={Monday:["chest","triceps"],Wednesday:["back","biceps"],Friday:["legs","glutes"],Saturday:["shoulders","core"]};
  return Object.fromEntries(Monthly.DAYS.map((day)=>[day,{rest:!training[day],targets:training[day]||[],sourceItems:[]}]))
}
function copyMonthlyValue(value){return JSON.parse(JSON.stringify(value));}
function weeklyPlanCount(plan){return Monthly.DAYS.reduce((total,day)=>total+(Array.isArray(plan?.days?.[day])?plan.days[day].length:0),0);}
function localIsoDate(){const date=new Date(),part=(value)=>String(value).padStart(2,"0");return `${date.getFullYear()}-${part(date.getMonth()+1)}-${part(date.getDate())}`;}
function friendlyMonthlyDate(value){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(String(value||"")))return "";
  const date=new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime())?"":new Intl.DateTimeFormat(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"}).format(date);
}
function updateMonthlyDateRange(){
  const start=el("monthlyStartDate")?.value;
  try{const end=Monthly.addUtcDays(start,30);el("monthlyEndDate").value=end;el("monthlyDateHelp").textContent=`31 consecutive days: ${friendlyMonthlyDate(start)} – ${friendlyMonthlyDate(end)}.`;}
  catch{el("monthlyEndDate").value="";el("monthlyDateHelp").textContent="Choose a valid starting date.";}
}
function setMonthlyValidation(message=""){const node=el("monthlyValidation");node.textContent=message;node.hidden=!message;}
function monthlyTargetMarkup(day,target,selected,disabled){
  const id=`monthly-${day.toLowerCase()}-${target.key}`;
  return `<label class="monthly-target-chip" for="${id}"><input id="${id}" type="checkbox" value="${escapeHtml(target.key)}" data-monthly-target ${selected?"checked":""} ${disabled?"disabled":""}/><span>${escapeHtml(target.label)}</span></label>`;
}
function renderMonthlySchedule(schedule=state.monthlySchedule){
  state.monthlySchedule=copyMonthlyValue(schedule||blankMonthlySchedule());
  el("monthlySchedule").innerHTML=Monthly.DAYS.map((day,index)=>{
    const config=state.monthlySchedule[day]||{rest:true,targets:[],sourceItems:[]},rest=Boolean(config.rest),sourceCount=Array.isArray(config.sourceItems)?config.sourceItems.length:0;
    return `<fieldset class="monthly-weekday-card ${rest?"is-rest":""}" data-monthly-day="${day}"><legend class="sr-only">${day} schedule</legend><div class="monthly-weekday-head"><h3>${String(index+1).padStart(2,"0")} / ${day}</h3><label class="monthly-rest-toggle"><input type="checkbox" data-monthly-rest ${rest?"checked":""}/><span>${rest?"Rest day":"Training day"}</span></label></div><div class="monthly-target-grid" aria-label="Muscle groups for ${day}">${Monthly.TARGETS.map((target)=>monthlyTargetMarkup(day,target,config.targets.includes(target.key),rest)).join("")}</div><p class="monthly-day-note">${sourceCount?`${sourceCount} exercise${sourceCount===1?"":"s"} copied from your week. Editing this day lets Strata+ choose new exercises.`:rest?"Recovery day · no exercises will be scheduled.":"Choose up to four muscle groups."}</p></fieldset>`;
  }).join("");
}
function readMonthlySchedule(){
  const schedule={};
  for(const day of Monthly.DAYS){
    const card=document.querySelector(`[data-monthly-day="${day}"]`),rest=Boolean(card?.querySelector("[data-monthly-rest]")?.checked);
    const targets=rest?[]:[...card.querySelectorAll("[data-monthly-target]:checked")].map((input)=>input.value);
    if(!rest&&!targets.length)throw new Error(`${day} needs at least one muscle group or must be marked as rest.`);
    if(targets.length>4)throw new Error(`${day} can use at most four muscle groups.`);
    schedule[day]={rest,targets,sourceItems:rest?[]:copyMonthlyValue(state.monthlySchedule?.[day]?.sourceItems||[])};
  }
  if(!Monthly.DAYS.some((day)=>!schedule[day].rest))throw new Error("Choose at least one training day.");
  return Monthly.normalizeSchedule(schedule,state.exercises);
}
function setMonthlySource(plan,label,source="weekly"){
  try{
    const normalized=Monthly.normalizeWeeklyPlan(plan,state.exercises),count=weeklyPlanCount(normalized);
    if(!count)throw new Error("That weekly plan is empty. Add exercises first or build the split manually.");
    state.monthlySource=source;state.monthlySchedule=Monthly.scheduleFromWeeklyPlan(normalized,state.exercises);renderMonthlySchedule();
    document.querySelectorAll(".monthly-source-actions button").forEach((button)=>{const active=(label.includes("account")&&button.id==="monthlySourceAccount")||(label.includes("device")&&button.id==="monthlySourceGuest")||(label.includes("file")&&button.id==="monthlyFileButton");button.classList.toggle("active",active);button.setAttribute("aria-pressed",String(active));});
    setMonthlyValidation();el("monthlyPlanStatus").textContent=`${label} copied as a private snapshot · ${count} exercises.`;
    showToast(`${label} loaded.`);
  }catch(error){setMonthlyValidation(error.message);showToast(error.message);}
}
function deviceGuestPlan(){
  try{const raw=localStorage.getItem("strata_guest_plan_v1");return raw?Monthly.normalizeWeeklyPlan(JSON.parse(raw),state.exercises):null;}
  catch{return null;}
}
function updateMonthlySourceButtons(){
  const accountCount=weeklyPlanCount(state.weeklyPlan),guest=deviceGuestPlan(),guestCount=weeklyPlanCount(guest);
  const accountButton=el("monthlySourceAccount"),guestButton=el("monthlySourceGuest");
  if(accountButton){accountButton.disabled=!accountCount;accountButton.textContent=accountCount?`Use saved weekly plan (${accountCount})`:"Saved weekly plan is empty";accountButton.title=accountCount?`Copy ${accountCount} saved exercises`:"Add exercises in the free weekly planner first";}
  if(guestButton){guestButton.hidden=!guestCount;guestButton.disabled=!guestCount;guestButton.textContent=`Use this device’s plan (${guestCount})`;guestButton.title=guestCount?`Copy ${guestCount} exercises saved on this device`:"";}
}
function monthlyExerciseMarkup(item){
  const exercise=exerciseById(item.exerciseId);
  if(!exercise)return"";
  const target=Monthly.inferTarget(exercise),label=Monthly.TARGET_LABELS[target]||GROUP_LABELS[exercise.group]||titleCase(exercise.group);
  return `<li><strong>${escapeHtml(exercise.name)}<small>${escapeHtml(label)} · ${escapeHtml(exercise.equipment)}</small></strong><span>${escapeHtml(item.sets)} sets × ${escapeHtml(item.reps)}<small>${escapeHtml(exercise.rest)} rest</small></span></li>`;
}
function renderMonthlyPlan(plan,{announce=false}={}){
  state.monthlyPlan=plan||null;
  if(!plan){el("monthlyResults").hidden=true;return;}
  const workoutDays=plan.days.filter((day)=>!day.rest).length,restDays=plan.days.length-workoutDays,totalExercises=plan.days.reduce((sum,day)=>sum+day.exercises.length,0);
  el("monthlyResultsTitle").textContent=plan.title;
  el("monthlySummary").innerHTML=`<div><span>Plan</span><strong>31 days</strong></div><div><span>Training</span><strong>${workoutDays}</strong></div><div><span>Rest</span><strong>${restDays}</strong></div><div><span>Exercises</span><strong>${totalExercises}</strong></div>`;
  el("monthlyDays").innerHTML=plan.days.map((day)=>`<article class="monthly-day-card ${day.rest?"is-rest":""}" data-rest="${day.rest}"><header class="monthly-day-head"><span class="monthly-day-number">Day ${String(day.dayNumber).padStart(2,"0")}</span><time datetime="${escapeHtml(day.date)}">${escapeHtml(friendlyMonthlyDate(day.date))}</time></header><h4>${escapeHtml(day.weekday)}</h4>${day.rest?'<p class="monthly-rest-copy"><strong>REST / RECOVERY</strong><br />Keep the day clear or use gentle movement.</p>':`<p class="monthly-day-targets">${day.targets.map((target)=>escapeHtml(Monthly.TARGET_LABELS[target]||titleCase(target))).join(" + ")}</p><ol class="monthly-exercise-list">${day.exercises.map(monthlyExerciseMarkup).join("")}</ol>`}</article>`).join("");
  el("monthlyResults").hidden=false;
  if(announce){el("monthlyPlanStatus").textContent=`31-day plan ready and saved to your account. ${workoutDays} training days and ${restDays} rest days.`;el("monthlyResults").scrollIntoView?.({behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth",block:"start"});}
}
function populateMonthlyBuilder(plan=null){
  el("monthlyTitle").value=plan?.title||"My 31-day Strata plan";
  el("monthlyStartDate").value=plan?.startDate||localIsoDate();
  el("monthlyExercisesPerTarget").value=String(plan?.exercisesPerTarget||2);
  state.monthlySource=plan?.source||"muscle-schedule";
  renderMonthlySchedule(plan?.schedule||blankMonthlySchedule());updateMonthlyDateRange();updateMonthlySourceButtons();renderMonthlyPlan(plan);
  el("monthlyPlanStatus").textContent=plan?"Your saved 31-day plan is ready on this account.":"Choose your split, start date, and rest days.";
}
function downloadTextFile(text,filename,type="text/plain"){
  const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),link=document.createElement("a");
  link.href=url;link.download=filename;link.hidden=true;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function shareMonthlyPlan(){
  if(!state.monthlyPlan)return;
  const text=Monthly.shareText(state.monthlyPlan,state.exercises),title=state.monthlyPlan.title||"My STRATA 31-day plan";
  try{
    if(typeof File==="function"&&navigator.share){
      const file=new File([text],"strata-31-day-plan.txt",{type:"text/plain"});
      if(navigator.canShare?.({files:[file]})){await navigator.share({title,text:"My private STRATA workout plan",files:[file]});showToast("Plan shared.");return;}
      await navigator.share({title,text});showToast("Plan shared.");return;
    }
    if(navigator.clipboard?.writeText){await navigator.clipboard.writeText(text);showToast("Plan copied to your clipboard.");return;}
    downloadTextFile(text,"strata-31-day-plan.txt");showToast("Share file downloaded.");
  }catch(error){if(error?.name!=="AbortError"){downloadTextFile(text,"strata-31-day-plan.txt");showToast("Sharing was unavailable, so a plan file was downloaded.");}}
}
function printMonthlyPlan(){
  if(!state.monthlyPlan)return;
  document.body.classList.add("print-monthly-plan");
  const finish=()=>document.body.classList.remove("print-monthly-plan");
  window.addEventListener?.("afterprint",finish,{once:true});window.print?.();setTimeout(finish,750);
}

function cardLines(kind,id){
  if(kind==="exercise"){
    const exercise=exerciseById(id),personal=personalResult(exercise);return {eyebrow:`${GROUP_LABELS[exercise.group]||titleCase(exercise.group)} / ${exercise.sub}`,title:exercise.name,score:`${exercise.score}`,scoreLabel:"OFFICIAL FITSCORE",lines:[personalLabel(personal,{long:true}),`${exercise.equipment} · ${exercise.pattern}`,exercise.why],footer:"Evidence-aware Strata+ comparison"};
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

const monthlyPlanForm=el("monthlyPlanForm");
monthlyPlanForm.addEventListener("submit",async(event)=>{
  event.preventDefault();if(monthlyPlanForm.dataset.saving==="true")return;
  const button=el("generateMonthlyPlan");setMonthlyValidation();
  try{
    const schedule=readMonthlySchedule(),generated={...Monthly.generateMonthPlan({title:el("monthlyTitle").value,startDate:el("monthlyStartDate").value,exercisesPerTarget:Number(el("monthlyExercisesPerTarget").value),schedule,exercises:state.exercises,preferences:state.preferences}),source:state.monthlySource};
    monthlyPlanForm.dataset.saving="true";monthlyPlanForm.setAttribute("aria-busy","true");button.disabled=true;el("monthlyPlanStatus").textContent="Choosing exercises and saving your month…";
    const result=await api("/api/monthly-plan",{method:"PUT",body:JSON.stringify({monthlyPlan:generated})});
    state.monthlySchedule=copyMonthlyValue(result.monthlyPlan.schedule);renderMonthlyPlan(result.monthlyPlan,{announce:true});showToast("31-day plan saved to your account.");
  }catch(error){setMonthlyValidation(error.message);el("monthlyPlanStatus").textContent="Your plan was not replaced. Fix the highlighted issue and try again.";showToast(error.message);}
  finally{monthlyPlanForm.dataset.saving="false";monthlyPlanForm.setAttribute("aria-busy","false");button.disabled=false;}
});
el("monthlySchedule").addEventListener("change",(event)=>{
  const card=event.target.closest("[data-monthly-day]");if(!card)return;
  const day=card.dataset.monthlyDay,rest=card.querySelector("[data-monthly-rest]"),targets=[...card.querySelectorAll("[data-monthly-target]")];
  if(event.target.matches("[data-monthly-rest]")){
    targets.forEach((input)=>{input.disabled=rest.checked;if(rest.checked)input.checked=false;});
  }else if(event.target.matches("[data-monthly-target]")){
    const checked=targets.filter((input)=>input.checked);
    if(checked.length>4){event.target.checked=false;setMonthlyValidation(`${day} can use at most four muscle groups.`);return;}
    if(checked.length){rest.checked=false;targets.forEach((input)=>{input.disabled=false;});}
  }
  card.classList.toggle("is-rest",rest.checked);rest.nextElementSibling.textContent=rest.checked?"Rest day":"Training day";
  state.monthlySource="muscle-schedule";state.monthlySchedule[day].sourceItems=[];
  state.monthlySchedule[day].rest=rest.checked;state.monthlySchedule[day].targets=rest.checked?[]:targets.filter((input)=>input.checked).map((input)=>input.value);
  const note=card.querySelector(".monthly-day-note");if(note)note.textContent=rest.checked?"Recovery day · no exercises will be scheduled.":"Custom split · Strata+ will choose suitable exercises.";
  document.querySelectorAll(".monthly-source-actions button").forEach((button)=>{button.classList.remove("active");button.setAttribute("aria-pressed","false");});
  setMonthlyValidation();el("monthlyPlanStatus").textContent="Split changed · create the plan to save it.";
});
el("monthlyStartDate").addEventListener("input",updateMonthlyDateRange);
el("monthlySourceAccount").addEventListener("click",()=>setMonthlySource(state.weeklyPlan,"Saved account plan"));
el("monthlySourceGuest").addEventListener("click",()=>setMonthlySource(deviceGuestPlan(),"This device’s plan"));
el("monthlyFileButton").addEventListener("click",()=>el("monthlyFileInput").click());
el("monthlyFileInput").addEventListener("change",async(event)=>{
  const file=event.target.files?.[0];if(!file)return;
  try{
    if(file.size>256*1024)throw new Error("Plan files must be 256 KB or smaller.");
    const plan=Monthly.parseWeeklyPlanFile(await file.text(),state.exercises);setMonthlySource(plan,"Uploaded plan file");
  }catch(error){setMonthlyValidation(error.message);showToast(error.message);}
  finally{event.target.value="";}
});
el("monthlyPdfButton").addEventListener("click",printMonthlyPlan);
el("monthlyShareButton").addEventListener("click",()=>void shareMonthlyPlan());
el("monthlyEditButton").addEventListener("click",()=>{monthlyPlanForm.scrollIntoView?.({behavior:window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches?"auto":"smooth",block:"start"});el("monthlyTitle").focus?.({preventScroll:true});});
el("communityPlanSearch").addEventListener("input",(event)=>{state.communityQuery=event.target.value;renderCommunityPlans();});
el("communityRefresh").addEventListener("click",()=>void loadCommunityPlans({reset:true}));
el("communityLoadMore").addEventListener("click",()=>void loadCommunityPlans());
el("communityPlanGrid").addEventListener("click",(event)=>{
  const apply=event.target.closest("[data-apply-community]"),retry=event.target.closest("[data-community-retry]");
  if(apply)openCommunityApplyDialog(apply.dataset.applyCommunity);else if(retry)void loadCommunityPlans({reset:true});
});
el("communityApplyConfirm").addEventListener("click",()=>void applyCommunityPlan());
el("communityApplyDialog").addEventListener("close",()=>{if(el("communityApplyDialog").dataset.busy!=="true")state.communityPendingId=null;});

document.addEventListener("submit",async(event)=>{
  const form=event.target.closest("[data-rating-form]");if(!form)return;event.preventDefault();const id=form.dataset.ratingForm,data=Object.fromEntries(new FormData(form));const rating=Object.fromEntries(Object.entries(data).map(([key,value])=>[key,Number(value)]));const button=form.querySelector("button"),originalHtml=button.innerHTML;button.disabled=true;button.textContent="Saving…";
  try{const result=await api(`/api/ratings/${encodeURIComponent(id)}`,{method:"PUT",body:JSON.stringify({rating})});state.userRatings.set(id,result.rating);if(result.aggregate)state.aggregate.set(id,result.aggregate);else state.aggregate.delete(id);state.ratingsRefreshedAt=Date.now();renderCommunityViews();showToast("Your account rating was saved.");}
  catch(error){button.innerHTML=originalHtml;showToast(error.message);}finally{button.disabled=false;}
});

document.addEventListener("click",(event)=>{
  const feature=event.target.closest("[data-feature-target]"),detail=event.target.closest("[data-open-detail]"),compare=event.target.closest("[data-toggle-compare]"),scrollAlternatives=event.target.closest("[data-scroll-alternatives]"),close=event.target.closest("[data-close-dialog]"),collection=event.target.closest("[data-collection]"),reset=event.target.closest("[data-reset-filters]"),loadMore=event.target.closest("[data-load-more-exercises]"),share=event.target.closest("[data-share-exercise]"),shareBattle=event.target.closest("[data-share-battle]");
  if(feature&&featureName(feature.dataset.featureTarget)){event.preventDefault();activateFeature(feature.dataset.featureTarget,{focus:true,scroll:true,smooth:true,announce:true,historyMode:"push"});}
  else if(detail){if(el("detailDialog").open)closeDialog("detailDialog");openDetail(detail.dataset.openDetail);}
  else if(compare){toggleCompare(compare.dataset.toggleCompare);if(el("detailDialog").open)openDetail(compare.dataset.toggleCompare);}
  else if(scrollAlternatives){const section=el("alternativeSection"),heading=el("alternativeTitle"),reduceMotion=window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;section?.scrollIntoView?.({behavior:reduceMotion?"auto":"smooth",block:"start"});heading?.focus?.({preventScroll:true});}
  else if(close)closeDialog(close.dataset.closeDialog);
  else if(collection){state.collection=collection.dataset.collection;if(state.collection==="community"){state.sort="community";el("sortSelect").value="community";}setCollectionState(state.collection);resetExplorerWindow();renderExplorer();}
  else if(reset)resetFilters();
  else if(loadMore){const firstNewIndex=state.explorerLimit;state.explorerLimit+=explorerPageSize();renderExplorer();requestAnimationFrame(()=>el("exerciseGrid").querySelector(`[data-result-index="${firstNewIndex}"] [data-open-detail]`)?.focus());}
  else if(share)void shareCard("exercise",share.dataset.shareExercise);
  else if(shareBattle)void shareCard("comparison");
});

document.querySelectorAll("dialog").forEach((dialog)=>{
  dialog.addEventListener("click",(event)=>{if(event.target===dialog&&dialog.dataset.busy!=="true")closeDialog(dialog.id);});
  dialog.addEventListener("cancel",(event)=>{event.preventDefault();if(dialog.dataset.busy!=="true")closeDialog(dialog.id);});
  dialog.addEventListener("close",syncDialogState);
});
function refreshCommunityRatingsWhenVisible(){
  if(document.visibilityState&&document.visibilityState!=="visible")return;
  void refreshCommunityRatings().catch(()=>{});
}
window.addEventListener?.("focus",refreshCommunityRatingsWhenVisible);
document.addEventListener("visibilitychange",refreshCommunityRatingsWhenVisible);
el("searchInput").addEventListener("input",(event)=>{const query=event.target.value;clearTimeout(explorerSearchTimer);explorerSearchTimer=setTimeout(()=>{state.query=query;resetExplorerWindow();renderExplorer();},SEARCH_DEBOUNCE_MS);});
el("groupFilter").addEventListener("change",(event)=>{state.group=event.target.value;resetExplorerWindow();renderExplorer();});
el("equipmentFilter").addEventListener("change",(event)=>{state.equipment=event.target.value;resetExplorerWindow();renderExplorer();});
el("patternFilter").addEventListener("change",(event)=>{state.pattern=event.target.value;resetExplorerWindow();renderExplorer();});
el("levelFilter").addEventListener("change",(event)=>{state.level=event.target.value;resetExplorerWindow();renderExplorer();});
el("sortSelect").addEventListener("change",(event)=>{state.sort=event.target.value;resetExplorerWindow();renderExplorer();});
el("clearFilters").addEventListener("click",resetFilters);
el("clearCompare").addEventListener("click",()=>{state.compare=[];el("battleResults").hidden=true;renderCompareTray();renderRecommendations();renderExplorer();});
el("openCompare").addEventListener("click",()=>{activateFeature("battle",{focus:true,scroll:true,smooth:true,announce:true,historyMode:"push"});openComparison();});
el("battleSelects").addEventListener("change",()=>{readBattleBuilder();el("battleResults").hidden=true;renderRecommendations();renderExplorer();});
el("battleForm").addEventListener("submit",(event)=>{event.preventDefault();readBattleBuilder();renderCompareTray();renderRecommendations();renderExplorer();openComparison();});
el("battleReset").addEventListener("click",()=>{state.compare=[];el("battleResults").hidden=true;renderCompareTray();renderRecommendations();renderExplorer();});
el("shareRanking").addEventListener("click",()=>void shareCard("ranking"));
el("logoutButton").addEventListener("click",async()=>{try{await api("/api/logout",{method:"POST"});}finally{window.location.replace("/");}});
el("discoveryRetry").addEventListener("click",()=>{void init();});

let discoveryLoading=false;
function initialLoadMessage(error){
  if(error?.code==="NETWORK_ERROR")return error.message;
  if(Number(error?.status)>=500)return "Strata+ is temporarily unavailable. Please try again in a moment.";
  return "Strata+ could not load. Please try again.";
}
function showInitialLoadProgress(){
  el("discoveryLoadError").hidden=true;el("discoveryRetry").disabled=true;
  el("profileStatus").textContent="Loading profile…";el("battleStatus").textContent="Loading exercises…";el("monthlyPlanStatus").textContent="Loading planner…";el("communityPlanStatus").textContent="Loading shared plans…";
  el("recommendationGrid").innerHTML='<div class="loading-card">Building your ranking…</div>';
  el("exerciseGrid").hidden=false;el("exerciseGrid").innerHTML='<div class="loading-card">Loading exercise intelligence…</div>';el("emptyState").hidden=true;
}
function showInitialLoadError(error){
  const message=initialLoadMessage(error);
  el("profileStatus").textContent="Unable to load";el("battleStatus").textContent=message;el("monthlyPlanStatus").textContent=message;el("communityPlanStatus").textContent=message;
  el("recommendationGrid").innerHTML=`<div class="loading-card load-error-card">${escapeHtml(message)}</div>`;el("exerciseGrid").innerHTML=`<div class="loading-card load-error-card">${escapeHtml(message)}</div>`;
  el("discoveryLoadErrorMessage").textContent=message;el("discoveryLoadError").hidden=false;showToast(message);
}
async function init(){
  if(discoveryLoading)return;
  discoveryLoading=true;showInitialLoadProgress();
  try{
    const data=await api("/api/discovery");state.exercises=data.exercises;state.methodology=data.methodology;state.sources=data.sources;state.limited=new Set(data.limitedConfidenceExercises);state.preferences=data.preferences;state.user=data.user;state.weeklyPlan=data.weeklyPlan||null;state.weeklyPlanUpdatedAt=Number(data.weeklyPlanUpdatedAt)||0;state.monthlyPlan=data.monthlyPlan||null;
    state.csrfToken=String(data.csrfToken||"");state.aggregate=new Map((data.ratings.aggregates||[]).map((item)=>[item.exercise_id,item]));state.userRatings=new Map((data.ratings.user||[]).map((item)=>[item.exercise_id,item]));state.ratingsRefreshedAt=Date.now();
    el("userName").textContent=data.user.name;el("catalogTotal").textContent=state.exercises.length;el("recommendationTitle").innerHTML=`BEST EXERCISES <em>FOR ${escapeHtml(data.user.name.split(/\s+/)[0].toUpperCase())}.</em>`;
    renderProfile();populateFilters();renderRecommendations();resetExplorerWindow();renderExplorer();renderCompareTray();populateMonthlyBuilder(state.monthlyPlan);
    activateFeature(state.activeFeature||FEATURE_DEFAULT);
  }catch(error){if(!error?.redirecting)showInitialLoadError(error);}
  finally{discoveryLoading=false;el("discoveryRetry").disabled=false;}
}

initializeFeatureNavigation();
init();
