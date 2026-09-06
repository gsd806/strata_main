"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const read=(...parts)=>readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");

test("Strata+ feature blocks progressively enhance seven visible workspaces",()=>{
  const html=read("pages","discover.html");
  const script=read("scripts","discover.js");
  const panels=[...html.matchAll(/<section\b([^>]*\bdata-feature-panel="([^"]+)"[^>]*)>/g)];
  const blocks=[...html.matchAll(/<a\b[^>]*\bclass="[^"]*feature-block[^"]*"[^>]*\bdata-feature-target="([^"]+)"[^>]*>/g)];

  assert.deepEqual(panels.map((match)=>match[2]).sort(),["battle","community","explorer","monthly","profile","recommendations","session"]);
  assert.equal(blocks.length,7);
  for(const label of ["Recommendations","Library","Compare","Preferences","Community","31-day plan","Session"])assert.match(html,new RegExp(`<span>${label}</span>`));
  assert.doesNotMatch(html,/<span>0[1-7] \/ (?:Recommendations|Library|Compare|Preferences|Community|31-day plan|Session)<\/span>/,"Decorative numbers must not contradict the panels' DOM and reading order");
  for(const [tag] of panels)assert.doesNotMatch(tag,/\bhidden\b/,"feature panels must remain visible when JavaScript is unavailable");
  for(const [tag] of blocks){
    assert.match(tag,/\baria-controls="[^"]+"/);
    assert.match(tag,/\baria-expanded="false"/);
  }
  assert.match(html,/class="studio-account" href="\/account\.html">Account<\/a>/);
  assert.match(html,/aria-label="Primary navigation"><a href="\/">Rankings<\/a><a class="active" href="\/discover\.html" aria-current="page">Strata\+<\/a><a href="\/planner\.html">Plan<\/a><a href="\/workout\.html">Train<\/a>/);
  assert.match(script,/account\.html\?mode=login&next=discover/);
});

test("session builder waits for an explicit build and adds the result with plan concurrency protection",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js");
  for(const id of ["sessionBuilder","sessionBuilderForm","sessionGroup","sessionLength","sessionGenerate","sessionDay","sessionResults","sessionResultsTitle","sessionStatus","sessionAddAll","sessionOpenPlan"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  for(const focus of ["full","upper","lower","push","pull","core"])assert.match(html,new RegExp(`<option value="${focus}"`),focus);
  for(const minutes of [20,35,50])assert.match(html,new RegExp(`<option value="${minutes}"`),String(minutes));
  assert.match(html,/id="sessionResults"[^>]*aria-labelledby="sessionResultsTitle"/);
  assert.match(script,/Core\.buildSession\(\{exercises:state\.exercises,preferences:state\.preferences/);
  assert.match(script,/Core\.mergeSessionIntoPlan\(state\.weeklyPlan,day,state\.session\)/);
  assert.match(script,/expectedPlanUpdatedAt:state\.weeklyPlanUpdatedAt/);
  assert.match(script,/error\.status===409\|\|error\.code==="PLAN_CHANGED"/);
  assert.match(script,/latest plan is loaded; review the selected day, then add the session again/i);
  assert.match(script,/Time is an estimate; actual duration changes with setup, rest, and training pace/);
  assert.match(html,/id="sessionResultsTitle">YOUR SESSION WILL APPEAR HERE\./);
  assert.match(script,/sessionBuilderForm"\)\?\.addEventListener\("submit",[^\n]+generateSession\(\{announce:true\}\)/);
  assert.doesNotMatch(script,/sessionGroup"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/sessionLength"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/function initializeSessionBuilder\(\)[^\n]+generateSession/);
  assert.match(script,/preferredSessionDay\(state\.sessionDayInitialized\?select\.value:""\)/,"The initial builder day must come from the saved week or today, not the first static Monday option");
  assert.ok((script.match(/id="sessionResultsTitle"/g)||[]).length>=2,"success and error rendering must retain the results label target");
});

test("weekly pulse uses saved-plan counts without implying workout completion or readiness",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js");
  for(const id of ["weeklyPulse","weeklyPulseEyebrow","weeklyPulseTitle","weeklyPulseDetail","weeklyPulseBar","weeklyPulseAction"])assert.match(html,new RegExp(`\\bid="${id}"`),id);
  assert.match(script,/Core\.weeklyPulse\(state\.weeklyPlan,\{profileDays:state\.preferences\.days\}\)/);
  assert.match(script,/weeklyPulseBar"\)\.setAttribute\("style",`width:\$\{pulse\.progressPercent\}%`/);
  assert.match(html,/id="plusStartWorkout"[^>]*>Start working out <span aria-hidden="true">↗<\/span>/);
  assert.match(script,/start\.href=`\/workout\.html\?day=\$\{encodeURIComponent\(pulse\.day\)\}`;start\.innerHTML='Start working out <span aria-hidden="true">↗<\/span>'/);
  assert.match(script,/start\.href="\/onboarding\.html";start\.innerHTML='Build my first week <span aria-hidden="true">→<\/span>'/);
  assert.doesNotMatch(html,/id="plusRoutineAction"/);
  assert.match(script,/weeklyPulseAction"\)\.href="\/planner\.html"/);
  assert.match(script,/weeklyPulseAction"\)\.innerHTML='Edit weekly plan <span aria-hidden="true">→<\/span>'/);
  assert.doesNotMatch(script,/weeklyPulse[^\n]*(?:recovered|readiness|completed)/i);
});

test("community plans preview a full week and require confirmation before replacing My Plan",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js");
  for(const id of ["communityPlans","communityPlanSearch","communityPlanGrid","communityPlanStatus","communityLoadMore","communityApplyDialog","communityApplyCancel","communityApplyConfirm","communityApplyWarning","communityOpenPlan"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.doesNotMatch(html,/data-feature-target="methodology"/);
  assert.doesNotMatch(html,/>FitScore method</i);
  assert.match(html,/Your current week will be replaced/i);
  assert.match(html,/aria-describedby="communityApplyDescription communityApplyWarning"/);
  assert.match(script,/\/api\/community-plans\?limit=/);
  assert.match(script,/\/api\/community-plans\/\$\{encodeURIComponent\(record\.id\)\}\/apply/);
  assert.match(script,/Monthly\.DAYS\.map\(\(day\)=>sharedPlanDayMarkup/);
  assert.match(script,/Use this week/);
  assert.match(script,/Open my plan <span aria-hidden="true">→<\/span>/);
  assert.match(script,/sourceUpdatedAt:Number\(record\.updatedAt\)/);
  assert.match(script,/targetUpdatedAt:state\.weeklyPlanUpdatedAt/);
  assert.match(script,/openDialog\(dialog,el\("communityApplyCancel"\)\)/);
  assert.doesNotMatch(script,/items\.slice\(0,8\)/,"the preview must show every exercise that can be applied");
  assert.match(script,/state\.weeklyPlan=Monthly\.normalizeWeeklyPlan\(result\.plan/);
  assert.match(script,/communityApplyDialog/);
});

test("monthly workspace exposes private import, multi-muscle schedule, PDF, and sharing controls",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js"),worker=read("service-worker.js");
  for(const id of ["monthlyPlanForm","monthlySourceAccount","monthlySourceGuest","monthlyFileInput","monthlySchedule","generateMonthlyPlan","monthlyResults","monthlyPdfButton","monthlyShareButton"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.match(html,/accept="\.json,application\/json"/);
  assert.match(html,/exactly 31 dated days/i);
  assert.match(script,/Monthly\.generateMonthPlan/);
  assert.match(script,/\/api\/monthly-plan/);
  assert.match(script,/navigator\.share/);
  assert.match(script,/print-monthly-plan/);
  assert.match(worker,/monthly-plan-core\.js\?v=/);
});

test("Strata+ feature navigation owns visibility, URL state, focus, and reduced motion",()=>{
  const script=read("scripts","discover.js"),css=read("styles","discover.css");

  assert.match(script,/const FEATURE_DEFAULT="recommendations"/);
  assert.match(script,/candidatePanel\.hidden=candidate!==name/);
  assert.match(script,/historyMode:"push"/);
  assert.match(script,/function initializeFeatureNavigation\(\)\{\s*const requested=featureFromLocation\(\);\s*activateFeature\(requested\|\|FEATURE_DEFAULT,\{scroll:Boolean\(requested\),historyMode:"none"\}\);\s*\}/);
  assert.match(script,/"popstate",restoreFeatureFromHistory/);
  assert.match(script,/"hashchange",restoreFeatureFromHistory/);
  assert.match(script,/if\(rawHash&&!requested\)return/);
  assert.match(script,/focus:\s*true,scroll:\s*true,smooth:\s*true/);
  assert.match(script,/activateFeature\("battle"[^\n]+openComparison\(\)/);
  assert.match(script,/initializeFeatureNavigation\(\);\s*init\(\);/);
  assert.doesNotMatch(script,/finally\{initializeFeatureNavigation\(\);\}/);
  assert.match(css,/\.feature-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\*,\*::before,\*::after\s*\{\s*animation:none\s*!important;\s*transition:none\s*!important/);
  assert.match(css,/\.session-result-card:hover[^}]*\{\s*transform:none/);
});

test("Strata+ copy and visual polish remain resilient across content and breakpoints",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js"),css=read("styles","discover.css");

  assert.match(html,/id="featureHubTitle">CHOOSE YOUR <em>NEXT STEP\.<\/em>/);
  assert.match(html,/id="recommendationTitle"[^>]*>BEST EXERCISES <em>FOR YOU\.<\/em>/);
  assert.doesNotMatch(script,/recommendationTitle"\)\.innerHTML/,"A display name must not be interpolated into the recommendation heading");
  assert.match(html,/>Exercise library<\/strong>/);
  assert.match(html,/>Build a session<\/strong>/);
  assert.doesNotMatch(html,/feature-block-session/);
  assert.doesNotMatch(css,/feature-block-session/);
  assert.match(css,/\.plus-studio \.profile-section,\.plus-studio \.recommendation-section\s*\{[^}]*color:var\(--ink\);[^}]*background:var\(--paper\)/);
  assert.match(css,/\.plus-studio \.profile-card,[^\n]*\.plus-studio \.recommend-card,[^\n]*\.plus-studio \.session-builder/);
  assert.doesNotMatch(css,/\.recommendation-card|\.session-brief|\.choice span/);
  assert.match(css,/@media\(max-width:800px\)[\s\S]*?\.plus-studio \.studio-header\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\);[^}]*grid-template-rows:auto auto/);
  assert.match(css,/\.section-heading h2,\.studio-hero h1,\.weekly-pulse h2\{[^}]*overflow-wrap:normal;word-break:normal/);
});

test("Strata+ initial loading offers a normalized, retryable error without replacing auth redirects",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js"),css=read("styles","discover.css");
  for(const id of ["discoveryLoadError","discoveryLoadErrorTitle","discoveryLoadErrorMessage","discoveryRetry"])assert.match(html,new RegExp(`\\bid="${id}"`));
  assert.match(html,/id="discoveryRetry"[^>]*>Try again/);
  assert.match(script,/code:"NETWORK_ERROR"/);
  assert.match(script,/error\.redirecting=true;window\.location\.replace\("\/account\.html\?mode=login&next=discover"\)/);
  assert.match(script,/if\(!error\?\.redirecting\)showInitialLoadError\(error\)/);
  assert.match(script,/"discoveryRetry"\)\.addEventListener\("click",\(\)=>\{void init\(\);\}\)/);
  assert.match(css,/\.discovery-load-error\[hidden\]\s*\{\s*display:none/);
  assert.match(script,/class="loading-card load-error-card"/,"Failed requests should not keep showing the loading animation");
  assert.match(css,/\.load-error-card::before\s*\{[^}]*content:"!"/,"Failed workspaces should show an unmistakable error state");
});

test("open rating drafts survive aggregate-driven detail re-renders",()=>{
  const script=read("scripts","discover.js");
  assert.match(script,/function openRatingDraft\(id\)/);
  assert.match(script,/const ratingDraft=openRatingDraft\(id\);state\.activeExercise=id/);
  assert.match(script,/ratingFormMarkup\(exercise,ratingDraft\)/);
});

test("Strata+ polish keeps filters legible and comparison details accessible",()=>{
  const html=read("pages","discover.html"),script=read("scripts","discover.js"),css=read("styles","discover.css");

  assert.equal((html.match(/class="filter-label"/g)||[]).length,6);
  assert.match(html,/id="clearFilters"[^>]*>Clear all</);
  assert.match(html,/id="communityApplyTitle">REPLACE MY WEEKLY PLAN\?</);
  assert.match(script,/data-scroll-alternatives/);
  assert.doesNotMatch(script,/href="#alternativeSection"/);
  assert.match(script,/<thead><tr><th scope="col">Measure<\/th>/);
  assert.match(script,/Best in this comparison/);
  assert.match(script,/match-pill \$\{personal\.eligible\?"":"is-excluded"\}/);
  assert.match(css,/\.match-pill\.is-excluded/);
  assert.match(css,/\.small-button \{ min-height: 44px/);
  assert.match(css,/body:has\(\.compare-tray:not\(\[hidden\]\)\) \{ padding-bottom: 112px/);
  assert.match(css,/@media \(max-width: 520px\)\s*\{\s*\.feature-grid \{ grid-template-columns: 1fr/);
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*?\.studio-header \{[^}]*backdrop-filter:none/,
    "Mobile navigation must escape the sticky header's backdrop-filter containing block");
});
