"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const PROJECT_ROOT=path.join(__dirname,"..");
const read=(name)=>fs.readFileSync(path.join(PROJECT_ROOT,name),"utf8");

test("homepage styles keep live comparison UI and omit retired modal families",()=>{
  const css=read("public/styles/styles.css");
  for(const selector of [".compare-dock",".compare-dialog",".dialog-header","#compareContent",".compare-table-wrap",".compare-table"]){
    assert.ok(css.includes(selector),`${selector} must remain styled`);
  }
  assert.doesNotMatch(css,/\.(?:plan-(?:dialog|content|layout|sidebar|sidebar-label|editor|title-fields|field|list-head|item|video|empty|summary)|workout-tabs?|remove-item|auth-[a-z-]+|account-(?:card|avatar|stats|actions))\b/);
});

test("homepage navigation and exercise controls expose 44px touch targets",()=>{
  const css=read("public/styles/styles.css");
  assert.match(css,/\.brand\s*\{[^}]*min-width:\s*44px;[^}]*min-height:\s*44px;/);
  assert.match(css,/\.action-icon\s*\{[^}]*width:\s*44px;[^}]*height:\s*44px;/);
  assert.doesNotMatch(css,/\.exercise-row \.action-icon\s*\{[^}]*\b(?:width|height):\s*(?:3\d|4[0-3])px/);
});

test("the focusable horizontal comparison region has a visible focus treatment",()=>{
  const css=read("public/styles/styles.css");
  const app=read("public/scripts/app.js");
  assert.match(app,/class="compare-table-wrap" role="region"[^>]*tabindex="0"/);
  assert.match(css,/\.compare-table-wrap:focus-visible\s*\{[^}]*outline:\s*3px solid var\(--orange-text\);[^}]*box-shadow:/);
});

test("compact mobile navigation keeps account actions and every muscle group easy to reach",()=>{
  const home=read("public/pages/index.html");
  const account=read("public/pages/account.html");
  const homeCss=read("public/styles/styles.css");
  const accountCss=read("public/styles/account.css");
  assert.match(home,/class="group-tabs-hint"[^>]*>Swipe to explore all 8 muscle groups/);
  assert.match(homeCss,/\.group-tabs\s*\{[^}]*display:\s*flex;[^}]*overflow-x:\s*auto;[^}]*scroll-snap-type:\s*x proximity;/);
  assert.match(account,/class="account-choice-nav"[^>]*>[\s\S]*href="#signupPanel"[\s\S]*href="#loginPanel"/);
  assert.match(accountCss,/\.account-choice-nav\{display:grid;grid-template-columns:1fr 1fr;/);
});

test("the support honeypot stays outside the accessibility tree",()=>{
  const contact=read("public/pages/contact.html");
  assert.match(contact,/<div class="support-honeypot" aria-hidden="true">[\s\S]*?<input[^>]*tabindex="-1"/);
});

test("Discover defines the compact hero gap only once",()=>{
  const css=read("public/styles/discover.css");
  assert.equal(css.match(/\.hero-layout\s*\{\s*gap:\s*34px;\s*\}/g)?.length,1);
});

test("every native dialog has an accessible name and restores its trigger",()=>{
  for(const page of ["public/pages/index.html","public/pages/admin.html","public/pages/discover.html"]){
    const html=read(page),dialogs=[...html.matchAll(/<dialog\b([^>]*)>/g)];
    assert.ok(dialogs.length,`${page} should contain a dialog`);
    for(const [,attributes] of dialogs)assert.match(attributes,/\baria-(?:label|labelledby)="[^"]+"/,`${page} dialog needs an accessible name`);
  }
  assert.match(read("public/scripts/app.js"),/dialogReturnFocus/);
  assert.match(read("public/scripts/discover.js"),/dialogReturnFocus/);
});

test("plan-saving surfaces use consistent announced states and actionable errors",()=>{
  const plannerHtml=read("public/pages/planner.html"),planner=read("public/scripts/planner.js"),discover=read("public/scripts/discover.js");
  assert.match(plannerHtml,/id="saveStatus"[^>]*role="status"[^>]*aria-live="polite"/);
  for(const state of ["Saving…","Saved","Couldn't save — Retry"])assert.ok(planner.includes(state),`planner must expose ${state}`);
  for(const state of ["Saving…","Saved","Couldn't save — Retry"])assert.ok(discover.includes(state),`Strata+ must expose ${state}`);
  assert.match(discover,/data-rating-status role="status" aria-live="polite"/);
  assert.match(planner,/PLAN_CHANGED/);
  assert.match(discover,/latest plan is loaded; review the selected day/i);
});
