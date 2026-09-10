"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const read=(...parts)=>readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");
const discoverModules=["app-navigation.js","discover-state.js","discover-api.js","discover-navigation.js","discover-progress.js","discover-render.js","discover-catalog.js","discover-detail.js","discover-community.js","discover-session.js","discover-sharing.js","discover-events.js","discover.js"];
const discoverScript=()=>discoverModules.map(name=>read("scripts",name)).join("\n");

test("every primary navigation uses five destinations while exercise and planning tools remain contextual",()=>{
  const html=read("pages","discover.html"),config=require("../public/scripts/discover-state").FEATURE_CONFIG;
  const panels=[...html.matchAll(/<section\b([^>]*\bdata-feature-panel="([^"]+)"[^>]*)>/g)];
  assert.deepEqual(panels.map(match=>match[2]).sort(),Object.keys(config).sort());
  for(const [feature,{panelId,headingId}] of Object.entries(config)){
    const panel=panels.find(match=>match[2]===feature);
    assert.ok(panel[1].includes(`id="${panelId}"`));assert.ok(panel[1].includes(`aria-labelledby="${headingId}"`));
    assert.match(html,new RegExp(`<h1[^>]*id="${headingId}"[^>]*tabindex="-1"`));
  }
  const globalNavs=[...html.matchAll(/<nav[^>]*aria-label="Primary navigation"[^>]*>([\s\S]*?)<\/nav>/g)];
  assert.equal(globalNavs.length,2);
  for(const [,nav] of globalNavs)assert.deepEqual([...nav.matchAll(/<a[^>]*href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map(match=>[match[1],match[2]]),[["/","Exercises"],["/planner.html","Plan"],["/workout.html","Train"],["/discover.html#progressWorkspace","Progress"],["/account.html","Account"]]);
  const exerciseTools=html.match(/<div id="exerciseToolNavigation">([\s\S]*?)<\/nav>/)?.[1]||"";
  assert.deepEqual([...exerciseTools.matchAll(/data-feature-target="([^"]+)"/g)].map(match=>match[1]),["recommendations","library","battle","profile","saved"]);
  assert.match(exerciseTools,/href="\/#rankings"/);assert.match(html,/id="planToolBreadcrumb"[^>]*aria-label="Breadcrumb"[^>]*hidden/);
  assert.match(html,/id="planToolBreadcrumb"[\s\S]*?href="\/planner\.html">Plan<\/a>/);
  assert.doesNotMatch(html,/class="studio-account"|data-feature-panel="(?:today|plan|explore)"/);
  assert.match(html,/<noscript>/);
});

test("Strata+ loads bounded state, API, navigation, feature controllers, rendering, events, and shell files in dependency order",()=>{
  const html=read("pages","discover.html"),names=discoverModules;
  let previous=-1;
  for(const name of names){const index=html.indexOf(`src="${name}?v=`);assert.ok(index>previous,`${name} must load after its dependencies`);previous=index;}
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
  assert.match(script,/latest plan is loaded; review the selected day, then add the workout again/i);
  assert.match(script,/Time is an estimate; actual duration changes with setup, rest, and training pace/);
  assert.match(html,/id="sessionResultsTitle">Your workout will appear here\./);
  assert.match(script,/sessionBuilderForm"\)\?\.addEventListener\("submit",[^\n]+generateSession\(\{announce:true\}\)/);
  assert.doesNotMatch(script,/sessionGroup"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/sessionLength"\)\?\.addEventListener\("change",[^\n]+generateSession/);
  assert.doesNotMatch(script,/function initialize\(\)[^\n]+generate/);
  assert.match(script,/preferredDay\(state\.sessionDayInitialized\?select\.value:""\)/,"The initial builder day must come from the saved week or today, not the first static Monday option");
  assert.ok((script.match(/id="sessionResultsTitle"/g)||[]).length>=2,"success and error rendering must retain the results label target");
});

test("Progress provides loading, retry, empty history and next-action states without another Today page",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["progressLoadState","progressLoadTitle","progressLoadMessage","progressRetry","progressFirstWorkout","progressFirstAction","progressHistoryContent"])assert.match(html,new RegExp(`\\bid="${id}"`));
  assert.match(script,/historyLoading\?"Loading your workout history…":"Workout history couldn’t load"/);
  assert.match(script,/element\("progressFirstWorkout"\)\.hidden=true;element\("progressHistoryContent"\)\.hidden=true/);
  assert.match(script,/action\.href=active\?`\/workout\.html#resume=\$\{encodeURIComponent\(active\.id\)\}`:planned\?"\/workout\.html":"\/planner\.html"/);
  assert.match(script,/"progressRetry"\)\.addEventListener\("click",\(\)=>void loadMemberDashboard/);
  assert.doesNotMatch(html,/id="todayWorkspace"|id="planWorkspace"|id="plusStartWorkout"|id="weeklyPulse"/);
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

  assert.match(script,/const FEATURE_DEFAULT="recommendations"/);
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

test("old workspace links resolve to the canonical Plan, Train and Exercises views",()=>{
  const app=require("../public/scripts/app-navigation"),config=require("../public/scripts/discover-state").FEATURE_CONFIG;
  for(const hash of ["today","todayWorkspace"])assert.equal(app.legacyDestination(hash),"/workout.html");
  for(const hash of ["plan","planWorkspace"])assert.equal(app.legacyDestination(hash),"/planner.html");
  for(const hash of ["explore","exploreWorkspace"])assert.equal(app.featureAlias(hash),"library");
  for(const feature of ["session","block","monthly","community"])assert.equal(app.ownerFor(feature),"plan");
  assert.equal(config.block.panelId,"trainingBlockWorkspace");assert.equal(config.saved.panelId,"savedExercises");
  assert.equal(app.ownerFor("progress"),"progress");
});

test("Progress reports bounded log-derived measures without pretending to assess recovery",()=>{
  const html=read("pages","discover.html"),script=discoverScript();
  for(const id of ["progressWorkspace","progressAdherence","progressVolume","progressConsistency","progressSessions","repeatImprovementList","personalBestList"]){
    assert.match(html,new RegExp(`\\bid="${id}"`),id);
  }
  assert.match(html,/same exercise, measurement, load type, and unit; a heavier load may have different repetitions/);
  assert.match(html,/load volume is external load × repetitions from completed sets/);
  assert.match(script,/\/api\/workouts\?limit=100&offset=0/);
  assert.match(script,/summaryKey\(summary,metric\)/);
  assert.match(html,/Weeks with at least one completed workout, last four weeks/);
  assert.match(script,/summary\.loadType!=="external"/,"assistance and bodyweight must not be added to external load volume");
  const assistedMetricLine=script.split("\n").find((line)=>line.includes('summary.loadType==="assisted"'))||"";
  assert.match(assistedMetricLine,/summary\.minAssistance/,"assisted records must use the stored minimum assistance");
  assert.doesNotMatch(assistedMetricLine,/summary\.maxWeight/,"null external-load records must not become zero-assistance records");
  assert.match(script,/100 most recent workouts/);
  assert.match(script,/New logged highs/);
  assert.match(script,/Best logged values/);
  assert.match(html,/id="progressFirstWorkout"[^>]*hidden/);
  assert.match(html,/Your progress starts with a completed workout/);
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
  assert.match(html,/Calculated from the start date/);
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

  assert.match(script,/function clearPrivateWorkspace\(\)\{[\s\S]*?workspaceGeneration\+=1;workspaceReady=false;[\s\S]*?state\.user=null;state\.csrfToken="";[\s\S]*?main\.hidden=true;main\.inert=true/);
  assert.match(script,/requestGeneration!==getGeneration\(\)[\s\S]*?STALE_WORKSPACE_RESPONSE/);
  assert.match(script,/String\(data\.user\?\.id\|\|""\)!==String\(identity\.user\?\.id\|\|""\)/);
  assert.match(script,/identity\.user\?\.discovery\?\.active!==true/);
  assert.match(script,/async function revalidateMemberWorkspaceWhenVisible\(\)\{[\s\S]*?clearPrivateWorkspace\(\);[\s\S]*?await init\(\)/);
  assert.match(script,/window\.addEventListener\?\.\("focus"/);
  assert.match(script,/document\.addEventListener\("visibilitychange"/);
});

test("literal headings and a single compact score guide explain the current view",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),css=read("styles","discover.css");
  for(const [id,label] of [["recommendationTitle","Recommended exercises"],["explorerTitle","Browse exercises"],["battleTitle","Compare exercises"],["profileTitle","Recommendation preferences"],["savedExercisesTitle","Saved exercises"],["sessionBuilderTitle","Workout builder"],["trainingBlockTitle","Training block"],["monthlyPlanTitle","Monthly schedule"],["communityPlansTitle","Browse shared plans"],["progressWorkspaceTitle","Your training progress"]])assert.match(html,new RegExp(`id="${id}"[^>]*>${label}<`));
  assert.equal((html.match(/What do these scores mean\?/g)||[]).length,1);
  for(const label of ["FitScore","Match for you","Community rating"])assert.match(html,new RegExp(`<dt>${label}</dt>`));
  assert.doesNotMatch(script,/recommendationTitle"\)\.innerHTML/,"A display name must not be interpolated into the recommendation heading");
  assert.doesNotMatch(html,/feature-block-session|ONE CLEAR NEXT STEP|BUILD SOMETHING|BEST EXERCISES <em>/);
  assert.match(css,/\.plus-studio \.profile-section,\.plus-studio \.recommendation-section\s*\{[^}]*color:var\(--ink\);[^}]*background:var\(--paper\)/);
  assert.match(css,/@media\(max-width:800px\)[\s\S]*?\.plus-studio \.studio-header\s*\{[^}]*grid-template-columns:auto minmax\(0,1fr\);[^}]*grid-template-rows:auto auto/);
});

test("Strata+ initial loading offers a normalized, retryable error without replacing auth redirects",()=>{
  const html=read("pages","discover.html"),script=discoverScript(),css=read("styles","discover.css");
  for(const id of ["discoveryLoadError","discoveryLoadErrorTitle","discoveryLoadErrorMessage","discoveryRetry"])assert.match(html,new RegExp(`\\bid="${id}"`));
  assert.match(html,/id="discoveryRetry"[^>]*>Try again/);
  assert.match(script,/code:"NETWORK_ERROR"/);
  assert.match(script,/error\.redirecting=true;const next=appNavigation\.discoverReturnPath\(\)/);
  assert.match(script,/onAccessDenied:\(\)=>showFeatureAccess\(\)/);
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
  assert.match(html,/id="communityApplyTitle">Replace your weekly plan\?</);
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
  assert.match(script,/personal\.eligible\?`\$\{personal\.match\}% match for you`:"Excluded"/);
  assert.match(script,/aria-label="Inspect \$\{escapeHtml\(exercise\.name\)\}, \$\{escapeHtml\(group\)\}, \$\{escapeHtml\(exercise\.equipment\)\}, \$\{escapeHtml\(fit\)\}"/);
  assert.doesNotMatch(script,/containerId&&!el\("detailDialog"\)\?\.open/);
  assert.match(css,/\.movement-board-open b\.is-excluded\s*\{/);
  assert.doesNotMatch(script,/\/api\/(?:shortlist|saved|favorites)/,"The device-private board must not invent a new server contract");
  assert.match(core,/function normalizeShortlist\(value,exercises,limit=4\)/);
  assert.match(css,/\.movement-board-list\s*\{[^}]*grid-template-columns:repeat\(4,minmax\(0,1fr\)\)/);
  assert.match(css,/@media \(max-width: 680px\)[\s\S]*?\.movement-board-list\s*\{\s*grid-template-columns:1fr/);
});
