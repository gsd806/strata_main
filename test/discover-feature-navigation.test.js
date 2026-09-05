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

  assert.deepEqual(panels.map((match)=>match[2]).sort(),["battle","explorer","methodology","monthly","profile","recommendations"]);
  assert.equal(blocks.length,6);
  for(const [tag] of panels)assert.doesNotMatch(tag,/\bhidden\b/,"feature panels must remain visible when JavaScript is unavailable");
  for(const [tag] of blocks){
    assert.match(tag,/\baria-controls="[^"]+"/);
    assert.match(tag,/\baria-expanded="false"/);
  }
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
  assert.match(script,/focus:\s*true,scroll:\s*true,smooth:\s*true/);
  assert.match(script,/activateFeature\("battle"[^\n]+openComparison\(\)/);
  assert.match(script,/finally\{initializeFeatureNavigation\(\);\}/);
  assert.match(css,/\.feature-panel\[hidden\]\s*\{\s*display:\s*none\s*!important/);
  assert.match(css,/@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css,/\.toast, \.feature-block \{ transition: none; \}/);
});
