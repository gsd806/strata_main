"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const PROJECT_ROOT=join(__dirname,"..");
const readPublic=(path)=>readFileSync(join(PROJECT_ROOT,"public",path),"utf8");

test("admin client keeps server data out of HTML injection sinks",()=>{
  const source=readPublic("scripts/admin.js");
  assert.match(source,/function create\([\s\S]*?node\.textContent=String\(text\)/);
  assert.match(source,/ticketMessage"\)\.textContent=/);
  assert.match(source,/adminIdentity"\)\.textContent=/);
  assert.doesNotMatch(source,/\.innerHTML\s*=|\.outerHTML\s*=|insertAdjacentHTML\s*\(|document\.write\s*\(|\beval\s*\(|new Function\s*\(/);
  assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB/,
    "private admin responses and elevation state must remain in memory only");
});

test("admin mutations use same-origin credentials and the current session CSRF token",()=>{
  const source=readPublic("scripts/admin.js");
  assert.match(source,/credentials:"same-origin"/);
  assert.match(source,/headers\["X-CSRF-Token"\]=state\.csrfToken/);
  assert.match(source,/if\(!\["GET","HEAD"\]\.includes\(method\)&&state\.csrfToken\)/);
  assert.match(source,/api\("\/api\/admin\/elevate",\{method:"POST"/);
  assert.match(source,/api\(`\/api\/admin\/users\/\$\{encodeURIComponent\(userId\(user\)\)\}\/actions`,\{method:"POST"/);
  assert.match(source,/api\(`\/api\/admin\/support\/\$\{encodeURIComponent\(supportId\(ticket\)\)\}`,\{method:"POST"/);
  assert.doesNotMatch(source,/fetch\(\s*[`'"]https?:\/\//i,"admin data must never be sent to a cross-origin endpoint");
});

test("admin elevation and destructive controls require explicit user input",()=>{
  const html=readPublic("pages/admin.html");
  const source=readPublic("scripts/admin.js");
  assert.match(html,/id="elevationPassword"[^>]*type="password"[^>]*autocomplete="current-password"/i);
  assert.match(html,/id="actionReason"[^>]*minlength="4"[^>]*maxlength="200"[^>]*required/i);
  assert.match(html,/id="actionConfirmation"[^>]*required/i);
  for(const action of ["send-password-reset","send-delete-link","cancel-deletion","revoke-sessions","suspend","restore"]){
    assert.match(html,new RegExp(`data-user-action="${action}"`));
    assert.match(source,new RegExp(`(?:"${action}"|${action}):\\{`));
  }
  assert.match(source,/const payload=JSON\.stringify\(\{password:input\.value\}\);\s*input\.value="";/,
    "the current password field must be cleared before awaiting the network response");
  assert.match(source,/if\(reason\.length<4\)/);
  assert.match(source,/if\(confirmation!==expected\)/);
});

test("admin page declares a private, accessible management surface",()=>{
  const html=readPublic("pages/admin.html");
  assert.match(html,/<meta name="robots" content="noindex, nofollow, noarchive" \/>/i);
  assert.match(html,/<meta name="referrer" content="no-referrer" \/>/i);
  assert.match(html,/<a class="skip-link" href="#adminMain">/i);
  assert.match(html,/role="tablist"/i);
  assert.match(html,/role="status"[^>]*aria-live="polite"/i);
  assert.match(html,/<dialog[^>]+id="userDialog"/i);
  assert.match(html,/<dialog[^>]+id="confirmDialog"/i);
  assert.match(html,/<dialog[^>]+id="supportDialog"/i);
  assert.doesNotMatch(html,/href="\/manifest\.webmanifest"|src="\/pwa\.js/i);
});

test("expired elevation purges rendered private data without waiting for another API call",()=>{
  const source=readPublic("scripts/admin.js");
  assert.match(source,/state\.elevatedUntil<=Date\.now\(\)\)showElevation/);
  assert.match(source,/document\.addEventListener\("visibilitychange"/);
  assert.match(source,/function showElevation[\s\S]*?clearAdminData\(\)/);
});

test("account actions stay locked until authoritative detail loads",()=>{
  const html=readPublic("pages/admin.html");
  const source=readPublic("scripts/admin.js");
  assert.match(html,/class="action-zone"[^>]*aria-describedby="userDetailStatus"/i);
  assert.match(source,/renderUserDetails\(user,\{actionsReady:false\}\)/);
  assert.match(source,/if\(!actionsReady\)\{disabled=true;title="Full account details are still loading\.";\}/);
  assert.match(source,/renderUserDetails\(result\.user,\{actionsReady:true\}\)/);
  assert.match(source,/Account actions remain locked\. \$\{friendlyError\(error\)\}/);
});

test("admin state changes move focus to stable visible targets",()=>{
  const html=readPublic("pages/admin.html");
  const source=readPublic("scripts/admin.js");
  assert.match(html,/id="accessTitle" tabindex="-1"/i);
  assert.match(source,/if\(focus\)requestAnimationFrame\(\(\)=>el\("accessTitle"\)\.focus/);
  assert.match(source,/el\("supportDialog"\)\.showModal\(\);syncDialogLock\(\);\s*requestAnimationFrame\(\(\)=>el\("supportDialogTitle"\)\.focus/);
  assert.match(source,/openDashboard\(result\.elevatedUntil,\{focus:true\}\)/);
  assert.match(source,/if\(message&&!persist&&!error&&!focus\)globalMessageTimer=/,
    "a success message that receives focus must not disappear underneath it");
});

test("authenticated admin layout keeps dense desktop rows and readable controls",()=>{
  const css=readPublic("styles/admin.css");
  assert.match(css,/body\.admin-ready \.record-card>button \{ min-height:72px;/);
  assert.match(css,/body\.admin-ready \.record-primary \{ display:grid; grid-template-columns:/);
  assert.match(css,/\.pagination button \{ min-height:44px;/);
  assert.match(css,/\.field label \{[^}]*font:500 10px\/1\.5 var\(--mono\)/);
});
