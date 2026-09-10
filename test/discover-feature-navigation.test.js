"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const read=(...parts)=>readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const discoverModules=["discover-state.js","discover-api.js","discover-navigation.js","discover-progress.js","particle-chart-core.js","discover-chart.js","discover-render.js","discover-catalog.js","discover-detail.js","discover-community.js","discover-session.js","discover-sharing.js","discover-events.js","discover.js"];
const discoverScript=()=>discoverModules.map(name=>read("scripts",name)).join("\n");

test("Strata+ progressively enhances four primary destinations and focused supporting tools",()=>{
  const html=read("pages","discover.html");
  const script=discoverScript();
  const panels=[...html.matchAll(/<section\b([^>]*\bdata-feature-panel="([^"]+)"[^>]*)>/g)];
  const blocks=[...html.matchAll(/<a\b[^>]*\bclass="[^"]*feature-block[^"]*"[^>]*\bdata-feature-target="([^"]+)"[^>]*>/g)];

  assert.deepEqual(panels.map((match)=>match[2]).sort(),["battle","community","explore","library","monthly","plan","profile","progress","recommendations","session","today"]);
  assert.equal(blocks.length,5);
  for(const label of ["Recommendations","Library","Compare","Preferences","Community"])assert.match(html,new RegExp(`<span>${label}</span>`));
  for(const destination of ["today","plan","progress","explore"])assert.match(html,new RegExp(`class="destination-link"[^>]*data-feature-target="${destination}"[^>]*aria-controls="[^"]+"[^>]*aria-expanded="false"`));
  for(const [tag] of panels)assert.doesNotMatch(tag,/\bhidden\b/,"feature panels must remain visible when JavaScript is unavailable");
  for(const [tag] of blocks){
    assert.match(tag,/\baria-controls="[^"]+"/);
    assert.match(tag,/\baria-expanded="false"/);
  }
  assert.match(html,/class="studio-account" href="\/account\.html">Account<\/a>/);
  assert.match(html,/aria-label="Primary navigation"><a href="\/">Rankings<\/a><a class="active" href="\/discover\.html" aria-current="page">Strata\+<\/a><a href="\/planner\.html">Plan<\/a><a href="\/workout\.html">Train<\/a>/);
  assert.match(script,/account\.html\?mode=login&next=discover/);
  const primaryExplore=html.match(/<nav class="feature-grid explore-tool-grid explore-primary-tools"[\s\S]*?<\/nav>/)?.[0]||"";
  assert.equal((primaryExplore.match(/class="feature-block"/g)||[]).length,2,"Explore should present only recommendations and the library as immediate tools");
  assert.match(html,/<details class="explore-advanced-tools"><summary>/);
  assert.match(html,/<details class="context-tools"><summary>/);
  assert.doesNotMatch(html,/<details class="(?:explore-advanced-tools|context-tools)" open/,"advanced tools should start collapsed");
});

test("Strata+ loads bounded state, API, navigation, feature controllers, rendering, events, and shell files in dependency order",()=>{
  const html=read("pages","discover.html"),names=discoverModules;
  let previous=-1;
  for(const name of names){const index=html.indexOf(`src="${name}?v=`);assert.ok(index>previous,`${name} must load after its dependencies`);previous=index;}
  const progressIndex=html.indexOf('src="discover-progress.js?v='),vendorIndex=html.indexOf('src="/particle-charts-1.0.0.min.js?v='),coreIndex=html.indexOf('src="particle-chart-core.js?v='),chartIndex=html.indexOf('src="discover-chart.js?v=');
  assert.ok(progressIndex<vendorIndex&&vendorIndex<coreIndex&&coreIndex<chartIndex,"the pinned runtime and shared STRATA chart core must load between pure progress logic and its adapter");
  assert.match(html,/src="\/particle-charts-1\.0\.0\.min\.js\?v=[^"]+" integrity="sha384-[^"]+" crossorigin="anonymous"/);
  assert.doesNotMatch(html,/(?:unpkg|jsdelivr|cdnjs)[^"']*particle/i,"the chart runtime must stay on the STRATA origin");
  for(const name of names.slice(0,-1))assert.ok(read("scripts",name).split("\n").length<=120,`${name} should remain a small boundary module`);
  assert.ok(read("scripts","discover.js").split("\n").length<=700,"the incremental shell should stay below the second-pass module budget");
});

test("session builder waits for an explicit build and adds the result with plan concurrency protection",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["sessionBuilder","sessionBuilderForm","sessionGroup","sessionLength","sessionGenerate","sessionDay","sessionResults","sessionResultsTitle","sessionStatus","sessionAddAll","sessionOpenPlan"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  for(const focus of ["full","upper","lower","push","pull","core"])assert.match(html,new RegExp(`<option value="${focus}"`),focus);
  for(const minutes of [20,35,50])assert.match(html,new RegExp(`<option value="${minutes}"`),String(minutes));
  assert.match(html,/id="sessionResults"[^>]*aria-labelledby="sessionResultsTitle"/);
  assert.match(script,/core\.buildSession\(\{exercises:state\.exercises,preferences:state\.preferences/);
  assert.match(script,/core\.mergeSessionIntoPlan\(state\.weeklyPlan,day,state\.session\)/);
  assert.match(script,/expectedPlanUpdatedAt:state\.weeklyPlanUpdatedAt/);
  assert.match(script,/error\.status===409\|\|error\.code==="PLAN_CHANGED"/);
  assert.match(script,/latest plan is loaded; review the selected day, then add the session again/i);
  assert.match(script,/Time is an estimate; actual duration changes with setup, rest, and training pace/);
  assert.match(html,/id="sessionResultsTitle">YOUR SESSION WILL APPEAR HERE\./);
  assert.match(script,/sessionBuilderForm"\)\?\.addEventListener\("submit",[^\n]+generateSession\(\{announce:true\}\)/);
  assert.doesNotMatch(script,/sessionGroup"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/sessionLength"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/function initialize\(\)[^\n]+generate/);
  assert.match(script,/preferredDay\(state\.sessionDayInitialized\?select\.value:""\)/,"The initial builder day must come from the saved week or today, not the first static Monday option");
  assert.ok((script.match(/id="sessionResultsTitle"/g)||[]).length>=2,"success and error rendering must retain the results label target");
});

test("Today distinguishes completed planned days from plan coverage and preserves the next action",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["weeklyPulse","weeklyPulseEyebrow","weeklyPulseTitle","weeklyPulseDetail","weeklyPulseBar","weeklyPulseAction"])assert.match(html,new RegExp(`\\bid="${id}"`),id);
  assert.match(script,/Core\.weeklyPulse\(state\.weeklyPlan,\{profileDays:state\.preferences\.days\}\)/);
  assert.match(html,/planned days completed this week/);
  assert.match(script,/History unavailable/);
  assert.match(html,/id="plusStartWorkout"[^>]*>Start working out <span aria-hidden="true">↗<\/span>/);
  assert.match(script,/start\.href=`\/workout\.html\?day=\$\{encodeURIComponent\(next\.day\)\}`;start\.innerHTML='Start working out <span aria-hidden="true">↗<\/span>'/);
  assert.match(script,/start\.href=`\/workout\.html#resume=\$\{encodeURIComponent\(active\.id\)\}`;start\.innerHTML='Resume workout <span aria-hidden="true">↗<\/span>'/);
  assert.match(script,/start\.href="\/onboarding\.html";start\.innerHTML='Build my first week <span aria-hidden="true">→<\/span>'/);
  assert.doesNotMatch(html,/id="plusRoutineAction"/);
  assert.match(script,/weeklyPulseAction"\)\.href="#planWorkspace"/);
  assert.match(script,/weeklyPulseAction"\)\.innerHTML='Review plan <span aria-hidden="true">→<\/span>'/);
  assert.doesNotMatch(script,/weeklyPulse[^\n]*(?:recovered|readiness)/i);
});

test("community plans preview a full week and require confirmation before replacing My Plan",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["communityPlans","communityPlanSearch","communityPlanGrid","communityPlanStatus","communityLoadMore","communityApplyDialog","communityApplyCancel","communityApplyConfirm","communityApplyWarning","communityOpenPlan"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.doesNotMatch(html,/data-feature-target="methodology"/);
  assert.doesNotMatch(html,/>FitScore method</i);
  assert.match(html,/Your current week will be replaced/i);
  assert.match(html,/aria-describedby="communityApplyDescription communityApplyWarning"/);
  assert.match(script,/\/api\/community-plans\?limit=/);
  assert.match(script,/\/api\/community-plans\/\$\{encodeURIComponent\(record\.id\)\}\/apply/);
  assert.match(script,/monthly\.DAYS\.map\(\(day\)=>sharedPlanDayMarkup/);
  assert.match(script,/Use this week/);
  assert.match(script,/Open my plan <span aria-hidden="true">→<\/span>/);
  assert.match(script,/sourceUpdatedAt:Number\(record\.updatedAt\)/);
  assert.match(script,/targetUpdatedAt:state\.weeklyPlanUpdatedAt/);
  assert.match(script,/openDialog\(dialog,element\("communityApplyCancel"\)\)/);
  assert.doesNotMatch(script,/items\.slice\(0,8\)/,"the preview must show every exercise that can be applied");
  assert.match(script,/state\.weeklyPlan=monthly\.normalizeWeeklyPlan\(result\.plan/);
  assert.match(script,/communityApplyDialog/);
});

test("monthly workspace exposes private import, multi-muscle schedule, PDF, and sharing controls",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),worker=read("service-worker.js"),css=read("styles","discover.css");
  for(const id of ["monthlyPlanForm","monthlySourceAccount","monthlySourceGuest","monthlyFileInput","monthlySchedule","generateMonthlyPlan","monthlyResults","monthlyPdfButton","monthlyShareButton"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.match(html,/accept="\.json,application\/json"/);
  assert.match(html,/exactly 31 dated days/i);
  assert.match(script,/Monthly\.generateMonthPlan/);
  assert.match(script,/\/api\/monthly-plan/);
  assert.match(script,/navigator\.share/);
  assert.match(script,/print-monthly-plan/);
  assert.match(css,/body\.print-monthly-plan > \.skip-link,[\s\S]*?display: none !important;/,"The exported plan must not print the keyboard skip link");
  assert.match(worker,/monthly-plan-core\.js\?v=/);
});

test("Strata+ feature navigation owns visibility, URL state, focus, and reduced motion",()=>{
  const script=discoverScript(),css=read("styles","discover.css");

  assert.match(script,/const FEATURE_DEFAULT="today"/);
  assert.match(script,/candidatePanel\.hidden=candidate!==name/);
  assert.match(script,/historyMode:"push"/);
  assert.match(script,/function initialize\(\)\{\s*const requested=featureFromLocation\(\);\s*activate\(requested\|\|defaultFeature,\{scroll:Boolean\(requested\),historyMode:"none"\}\);\s*\}/);
  assert.match(script,/"popstate",restore/);
  assert.match(script,/"hashchange",restore/);
  assert.match(script,/if\(rawHash&&!requested\)return/);
  assert.match(script,/focus:\s*true,scroll:\s*true,smooth:\s*true/);
  assert.match(script,/event\.preventDefault\(\);actions\.hideToast\(\);actions\.activateFeature/,"destination navigation should clear a transient saved toast");
  assert.match(script,/activateFeature\("battle"[^\n]+openComparison\(\)/);
  assert.match(script,/initializeFeatureNavigation\(\);\s*init\(\);/);
  assert.doesNotMatch(script,/finally\{initializeFeatureNavigation\(\);\}/);
  assert.match(css,/\.feature-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\*,\*::before,\*::after\s*\{\s*animation:none\s*!important;\s*transition:none\s*!important/);
  assert.match(css,/\.session-result-card:hover[^}]*\{\s*transform:none/);
});

test("Today presents one primary action with an honest, comparable training brief",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["todayWorkspace","todayTitle","plusStartWorkout","todayDurationLabel","todayDuration","todayEquipmentLabel","todayEquipment","todayPreviousLabel","todayPreviousValue","todayPreviousDetail"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  const today=html.match(/<section class="studio-hero feature-panel"[\s\S]*?<\/section>\s*<section class="plan-workspace/)?.[0]||"";
  assert.equal((today.match(/id="plusStartWorkout"/g)||[]).length,1);
  assert.match(script,/function previousComparable\(items\)/);
  assert.match(script,/same format and unit/);
  assert.match(script,/estimatedSessionMinutes\(items\)/);
  assert.match(script,/The time is an estimate based on movements and working sets/);
  assert.match(script,/todayDurationLabel"\)\.textContent="Elapsed"/);
  assert.match(script,/equipment\.length>2\?`\$\{equipment\.slice\(0,2\)\.join\(" \+ "\)\} \+\$\{equipment\.length-2\} more`/);
});

test("Progress reports bounded log-derived measures without pretending to assess recovery",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["progressWorkspace","progressAdherence","progressVolume","progressConsistency","progressSessions","repeatImprovementList","personalBestList","trainingMemoryTrend","trainingMemoryTrendTitle","trainingMemoryTrendDescription","trainingMemoryTrendControls","trainingMemoryMovement","trainingMemoryMetric","trainingMemoryChartFrame","trainingMemoryChart","trainingMemoryTrendStatus","trainingMemoryTrendScope","trainingMemoryTrendEmpty","trainingMemoryTrendEmptyTitle","trainingMemoryTrendEmptyDetail","trainingMemoryExact","trainingMemoryExactValues"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.match(html,/id="trainingMemoryTrend"[^>]*aria-labelledby="trainingMemoryTrendTitle"[^>]*aria-describedby="trainingMemoryTrendDescription"/);
  assert.match(html,/<label for="trainingMemoryMovement"><span>Movement &amp; format<\/span><select id="trainingMemoryMovement"/);
  assert.match(html,/<label for="trainingMemoryMetric"><span>Measure<\/span><select id="trainingMemoryMetric"/);
  assert.match(html,/id="trainingMemoryTrendStatus" role="status" aria-live="polite" aria-atomic="true"/);
  assert.match(html,/<details class="training-memory-exact" id="trainingMemoryExact"[^>]*>[\s\S]*?<summary>View exact session values/);
  assert.match(html,/They describe training history—not recovery, injury risk, or guaranteed results/);
  assert.match(html,/load volume is load × repetitions from completed sets/);
  assert.match(script,/\/api\/workouts\?limit=100&offset=0/);
  assert.match(script,/summaryKey\(summary,metric\)/);
  assert.match(script,/ChartCore\.createProgressChart\(\{element:el,state,exerciseName,readableDate,escapeHtml\}\)/);
  assert.match(script,/trainingMemoryMovement"\)\.addEventListener\("change"[\s\S]*?state\.progressChartMetric="";actions\.renderProgressChart\(\)/);
  assert.match(script,/trainingMemoryMetric"\)\.addEventListener\("change"[\s\S]*?actions\.renderProgressChart\(\)/);
  assert.match(html,/Weeks with at least one completed session, last four weeks/);
  assert.match(script,/summary\.loadType!=="external"/,"assistance and bodyweight must not be added to external load volume");
  const assistedMetricLine=script.split("\n").find((line)=>line.includes('summary.loadType==="assisted"'))||"";
  assert.match(assistedMetricLine,/summary\.minAssistance/,"assisted records must use the stored minimum assistance");
  assert.doesNotMatch(assistedMetricLine,/summary\.maxWeight/,"null external-load records must not become zero-assistance records");
  assert.match(script,/Nothing comparable in the 100 most recent sessions/);
  assert.match(script,/RECENT REPEAT IMPROVEMENTS/);
  assert.match(script,/RECENT PERFORMANCE HIGHS/);
  assert.match(html,/id="progressFirstWorkout"[^>]*hidden/);
  assert.match(html,/COMPLETE YOUR FIRST WORKOUT TO UNLOCK PROGRESS/);
  assert.match(html,/id="progressHistoryContent"/);
  assert.match(script,/progressFirstWorkout/);
});

test("training blocks and adaptations require explicit, concurrency-aware approval",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["trainingBlockForm","trainingBlockWeeks","trainingBlockStartDate","trainingBlockCurrentWeek","trainingBlockState","trainingBlockLighterWeek","trainingBlockSave","trainingBlockReview","trainingBlockWorkoutCount","trainingBlockSetCount","trainingBlockMuscles","trainingBlockEvidence","trainingBlockNextDecision","trainingBlockCarry","trainingBlockLighter","trainingBlockFinish","trainingBlockActionDialog","trainingBlockActionConfirm","progressionCard","progressionAccept","progressionDismiss","progressionStatus"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  for(const weeks of [4,5,6,7,8])assert.match(html,new RegExp(`<option value="${weeks}"`));
  assert.match(html,/saved weekly Plan is never changed automatically/);
  assert.match(script,/Accepting changes \$\{name\} from \$\{from\} to \$\{to\} sets on \$\{day\} in your saved weekly Plan/);
  assert.match(script,/It remains there until you edit Plan again/);
  assert.doesNotMatch(`${html}\n${script}`,/next-session|next comparable session/i);
  assert.match(html,/The current week is calculated from that date/);
  assert.match(html,/This is a reminder only\. It never changes sets in your weekly Plan/);
  assert.match(html,/Skipped and replaced counts appear only when a saved workout explicitly records them/);
  assert.match(html,/Nothing is saved until you confirm/);
  assert.match(script,/api\("\/api\/training"\)/);
  assert.match(script,/body:JSON\.stringify\(\{block:blockInput,expectedRevision:state\.trainingBlockRevision,expectedUserId\}\)/);
  assert.match(script,/decision:"accept",expectedPlanUpdatedAt:suggestion\.expectedPlanUpdatedAt/);
  assert.match(script,/decision:"dismiss"/);
  assert.match(script,/await confirmDashboardIdentity\(expectedUserId,expectedCsrf\)/);
  assert.match(script,/adaptationChangeLabel\(raw\.change\)/);
  assert.doesNotMatch(script,/change:String\(raw\.change/);
  assert.match(script,/TRAINING_BLOCK_CHANGED/);
  assert.match(script,/el\("trainingBlockStartDate"\)\.value=localIsoDate\(\)/);
  assert.match(script,/block\.status==="completed"\?`Saved\. Completed/);
  assert.match(script,/BlockCore\.deriveWeek\(\{weeks,startDate\}\)/);
  assert.match(script,/currentWeek=status==="completed"\?weeks:timeline\.week/);
  assert.match(script,/BlockCore\.actionProposal\(state\.trainingBlock,action\)/);
  assert.match(script,/Your weekly Plan is unchanged/);
  assert.match(script,/Workout history is unavailable, so Strata\+ is not making progress, skip, or replacement claims/);
  assert.equal((script.match(/select\.innerHTML=core\.WEEKDAYS/g)||[]).length,1,"session-day options must be rendered once");
  assert.equal((script.match(/if\(previewError\)element\("sessionStatus"\)/g)||[]).length,1,"session preview conflicts must be announced once");
});

test("Strata+ clears private state before focus and visibility account revalidation",()=>{
  const script=discoverScript();

  assert.match(script,/function clearPrivateWorkspace\(\)\{\s*progressChartController\?\.clear\(\{wipe:true\}\);\s*workspaceGeneration\+=1/,
    "private chart canvas, controls, and accessible table must be wiped before the account generation changes");
  assert.match(script,/function clearPrivateWorkspace\(\)\{[\s\S]*?workspaceGeneration\+=1;workspaceReady=false;[\s\S]*?state\.user=null;state\.csrfToken="";[\s\S]*?main\.hidden=true;main\.inert=true/);
  assert.match(script,/requestGeneration!==getGeneration\(\)[\s\S]*?STALE_WORKSPACE_RESPONSE/);
  assert.match(script,/String\(data\.user\?\.id\|\|""\)!==String\(identity\.user\?\.id\|\|""\)/);
  assert.match(script,/identity\.user\?\.discovery\?\.active!==true/);
  assert.match(script,/async function revalidateMemberWorkspaceWhenVisible\(\)\{[\s\S]*?clearPrivateWorkspace\(\);[\s\S]*?await init\(\)/);
  assert.match(script,/window\.addEventListener\?\.\("focus"/);
  assert.match(script,/document\.addEventListener\("visibilitychange"/);
});

test("Strata+ copy and visual polish remain resilient across content and breakpoints",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),css=read("styles","discover.css");

  assert.match(html,/id="todayTitle"[^>]*>ONE SESSION\.<br \/><em>ONE CLEAR NEXT STEP\.<\/em>/);
  assert.match(html,/id="recommendationTitle"[^>]*>BEST EXERCISES <em>FOR YOU\.<\/em>/);
  assert.doesNotMatch(script,/recommendationTitle"\)\.innerHTML/,"A display name must not be interpolated into the recommendation heading");
  assert.match(html,/>Explore every movement<\/strong>/);
  assert.match(html,/>Your next action<\/small>/);
  assert.doesNotMatch(html,/feature-block-session/);
  assert.doesNotMatch(css,/feature-block-session/);
  assert.match(css,/\.plus-studio \.profile-section,\.plus-studio \.recommendation-section\s*\{[^}]*color:var\(--ink\);[^}]*background:var\(--paper\)/);
  assert.match(css,/\.plus-studio \.profile-card,[^\n]*\.plus-studio \.recommend-card,[^\n]*\.plus-studio \.session-builder/);
  assert.doesNotMatch(css,/\.recommendation-card|\.session-brief|\.choice span/);
  assert.match(css,/@media\(max-width:800px\)[\s\S]*?\.plus-studio \.studio-header\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\);[^}]*grid-template-rows:auto auto/);
  assert.match(css,/\.section-heading h2,\.studio-hero h1,\.weekly-pulse h2\{[^}]*overflow-wrap:normal;word-break:normal/);
});

test("Strata+ initial loading offers a normalized, retryable error without replacing auth redirects",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),css=read("styles","discover.css");
  for(const id of ["discoveryLoadError","discoveryLoadErrorTitle","discoveryLoadErrorMessage","discoveryRetry"])assert.match(html,new RegExp(`\\bid="${id}"`));
  assert.match(html,/id="discoveryRetry"[^>]*>Try again/);
  assert.match(script,/code:"NETWORK_ERROR"/);
  assert.match(script,/error\.redirecting=true;redirect\("\/account\.html\?mode=login&next=discover"\)/);
  assert.match(script,/redirect:\(path\)=>window\.location\.replace\(path\)/);
  assert.match(script,/if\(!error\?\.redirecting&&!error\?\.stale\)showInitialLoadError\(error\)/);
  assert.match(script,/"discoveryRetry"\)\.addEventListener\("click",\(\)=>\{void actions\.init\(\);\}\)/);
  assert.match(css,/\.discovery-load-error\[hidden\]\s*\{\s*display:none/);
  assert.match(script,/class="loading-card load-error-card"/,"Failed requests should not keep showing the loading animation");
  assert.match(css,/\.load-error-card::before\s*\{[^}]*content:"!"/,"Failed workspaces should show an unmistakable error state");
});

test("open rating drafts survive aggregate-driven detail re-renders",()=>{
  const script=discoverScript();
  assert.match(script,/function openRatingDraft\(id\)/);
  assert.match(script,/const ratingDraft=openRatingDraft\(id\);state\.activeExercise=id/);
  assert.match(script,/ratingFormMarkup\(exercise,ratingDraft\)/);
});

test("Strata+ polish keeps filters legible and comparison details accessible",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),css=read("styles","discover.css");

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

test("Strata+ offers a private, bounded decision board without changing server contracts",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),core=read("scripts","discovery-core.js"),css=read("styles","discover.css");
  for(const id of ["movementBoardTitle","movementBoardCapacity","movementBoardList","movementBoardStatus","clearMovementBoard","compareMovementBoard","savedCollectionLabel"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.match(html,/Private on this device/);
  assert.match(html,/data-collection="saved"/);
  assert.match(script,/movementBoard:4/);
  assert.match(script,/MOVEMENT_BOARD_LIMIT=StateCore\.LIMITS\.movementBoard/);
  assert.match(script,/localStorage\?\.getItem\(movementBoardStorageKey\(\)\)/);
  assert.match(script,/localStorage\?\.setItem\(movementBoardStorageKey\(\),JSON\.stringify\(state\.shortlist\)\)/);
  assert.match(script,/core\.normalizeShortlist\(state\.shortlist,state\.exercises,movementBoardLimit\)/);
  assert.match(script,/data-toggle-shortlist/);
  assert.match(script,/personal\.eligible\?`\$\{personal\.match\}% match`:"Excluded"/);
  assert.match(script,/aria-label="Inspect \$\{escapeHtml\(exercise\.name\)\}, \$\{escapeHtml\(group\)\}, \$\{escapeHtml\(exercise\.equipment\)\}, \$\{escapeHtml\(fit\)\}"/);
  assert.doesNotMatch(script,/containerId&&!el\("detailDialog"\)\?\.open/);
  assert.match(css,/\.movement-board-open b\.is-excluded\s*\{/);
  assert.doesNotMatch(script,/\/api\/(?:shortlist|saved|favorites)/,"The device-private board must not invent a new server contract");
  assert.match(core,/function normalizeShortlist\(value,exercises,limit=4\)/);
  assert.match(css,/\.movement-board-list\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*?\.movement-board-list\s*\{\s*grid-template-columns:1fr/);
});
