"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const read=(...parts)=>readFileSync(join(PROJECT_ROOT,"public",...parts),"utf8");

test("Strata+ feature blocks progressively enhance six visible workspaces",()=>{
  const html=read("pages","discover.html");
  const panels=[...html.matchAll(/<section\b([^>]*\bdata-feature-panel="([^"]+)"[^>]*)>/g)];
  const blocks=[...html.matchAll(/<a\b[^>]*\bclass="[^"]*feature-block[^"]*"[^>]*\bdata-feature-target="([^"]+)"[^>]*>/g)];

  assert.deepEqual(panels.map((match)=>match[2]).sort(),["battle","community","explorer","monthly","profile","recommendations"]);
  assert.equal(blocks.length,6);
  for(const [tag] of panels)assert.doesNotMatch(tag,/\bhidden\b/,"feature panels must remain visible when JavaScript is unavailable");
  for(const [tag] of blocks){
    assert.match(tag,/\baria-controls="[^"]+"/);
    assert.match(tag,/\baria-expanded="false"/);
  }
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
  assert.match(script,/Replace My Plan/);
  assert.match(script,/sourceUpdatedAt:Number\(record\.updatedAt\)/);
  assert.match(script,/targetUpdatedAt:state\.weeklyPlanUpdatedAt/);
  assert.match(script,/communityApplyCancel"\)\.focus/);
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
  assert.match(script,/"popstate",restoreFeatureFromHistory/);
  assert.match(script,/"hashchange",restoreFeatureFromHistory/);
  assert.match(script,/if\(rawHash&&!requested\)return/);
  assert.match(script,/focus:\s*true,scroll:\s*true,smooth:\s*true/);
  assert.match(script,/activateFeature\("battle"[^\n]+openComparison\(\)/);
  assert.match(script,/initializeFeatureNavigation\(\);\s*init\(\);/);
  assert.doesNotMatch(script,/finally\{initializeFeatureNavigation\(\);\}/);
  assert.match(css,/\.feature-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\.toast, \.feature-block \{ transition: none; \}/);
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
});
