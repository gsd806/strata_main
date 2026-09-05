"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const PROJECT_ROOT=path.join(__dirname,"..");
const PUBLIC_ROOT=path.join(PROJECT_ROOT,"public");
const BUILD=require(path.join(PROJECT_ROOT,"package.json")).version;
const read=(name)=>fs.readFileSync(path.join(PUBLIC_ROOT,"pages",name),"utf8");
const text=(name)=>read(name).replace(/<script[\s\S]*?<\/script>/gi," ").replace(/<style[\s\S]*?<\/style>/gi," ").replace(/<[^>]+>/g," ").replace(/&nbsp;/g," ").replace(/\s+/g," ").trim();

test("homepage exposes pricing, contact, and every public policy without JavaScript",()=>{
  const home=read("index.html");
  for(const route of ["/pricing","/contact","/terms","/privacy","/refunds"])assert.match(home,new RegExp(`href="${route}"`),`${route} homepage link`);
  assert.match(home,/mailto:stratafitness\.official@gmail\.com/i);
  assert.match(text("index.html"),/\$5\.99 USD/i);
  assert.match(text("index.html"),/one-time purchase/i);
});

test("homepage publishes the founder story without exposing a residential address",()=>{
  const home=read("index.html"),copy=text("index.html");
  assert.match(home,/id="founder"/);
  assert.match(home,/href="#founder"/);
  assert.match(copy,/Saeed Abdalla Alketbi/);
  assert.match(copy,/founded by Saeed Abdalla Alketbi at 22/i);
  assert.match(copy,/third-year chemical engineering student at United Arab Emirates University \(UAEU\)/i);
  assert.match(copy,/Born and raised in the UAE and based in Al Ain/i);
  assert.match(copy,/Chemical Engineering · UAEU/i);
  assert.match(home,/<div class="founder-mark"[^>]*>[\s\S]*?<span>SK<\/span>/);
  assert.doesNotMatch(home,/<div class="founder-mark"[^>]*>[\s\S]*?<span>SA<\/span>/);
  assert.doesNotMatch(copy,/Zahkir|Malad|street 13|st\.?\s*13/i);
});

test("published Strata+ price and refund promise are exact and consistent",()=>{
  assert.equal(BUILD,"6.9.9");
  const pricingHtml=read("pricing.html"),pricing=text("pricing.html"),refunds=text("refunds.html"),terms=text("terms.html");
  assert.match(pricing,/Strata\+/);
  assert.match(pricing,/\$5\.99 USD/i);
  assert.match(pricing,/one[- ]time/i);
  assert.match(pricing,/no recurring subscription/i);
  assert.match(pricing,/personalized session builder/i);
  assert.match(pricing,/community weekly plans/i);
  assert.match(pricing,/31-day planner/i);
  assert.match(pricingHtml,/href="\/planner\.html">Open free planner/);
  assert.match(pricingHtml,/href="\/refunds"/);
  assert.match(pricingHtml,/id="buyDiscovery"/);
  assert.match(pricingHtml,/src="https:\/\/cdn\.paddle\.com\/paddle\/v2\/paddle\.js"/);
  assert.match(pricingHtml,new RegExp(`src="/pricing\\.js\\?v=${BUILD.replace(/\./g,"\\.")}"`));
  assert.match(pricing,/Paddle is the merchant of record/i);
  assert.match(pricing,/unlocks after STRATA securely confirms the completed transaction/i);
  assert.match(refunds,/14 calendar days after the (?:date of your )?(?:paid )?Strata\+ purchase|14 calendar days after the purchase date/i);
  assert.match(refunds,/original payment method/i);
  assert.match(terms,/\$5\.99 USD/i);
  assert.match(terms,/not a subscription/i);
  assert.match(terms,/Paddle acts as merchant of record/i);
});

test("customer-facing product branding is Strata+ while compatibility identifiers stay stable",()=>{
  const pages=["index.html","pricing.html","account.html","discover.html","planner.html","contact.html","terms.html","privacy.html","refunds.html","delete-account.html","admin.html"];
  const visibleCopy=pages.map(text).join(" ");
  const manifest=fs.readFileSync(path.join(PUBLIC_ROOT,"manifest.webmanifest"),"utf8");
  assert.match(visibleCopy,/Strata\+/);
  assert.doesNotMatch(visibleCopy,/\bDiscovery\b/);
  assert.match(manifest,/"name": "Strata\+ Studio"/);
  assert.match(read("pricing.html"),/id="buyDiscovery"/);
  assert.match(read("discover.html"),/href="\/discover\.html"/);
});

test("contact and policy pages publish the official support address and cross-links",()=>{
  const email="stratafitness.official@gmail.com";
  const contact=read("contact.html");
  assert.match(contact,new RegExp(`mailto:${email.replace(".","\\.")}`,"i"));
  assert.match(text("contact.html"),new RegExp(email.replace(".","\\."),"i"));
  for(const page of ["pricing.html","contact.html","terms.html","privacy.html","refunds.html"]){
    assert.match(read(page),/class="info-nav"[^>]*>[\s\S]*href="\/planner\.html">Planner<\/a>/,`${page} free planner navigation`);
  }
  for(const page of ["terms.html","privacy.html","refunds.html"]) {
    const html=read(page);
    assert.match(text(page),new RegExp(email.replace(".","\\."),"i"),`${page} support email`);
    for(const route of ["/terms","/privacy","/refunds"])assert.match(html,new RegExp(`href="${route}"`),`${page} ${route} link`);
  }
  assert.match(text("privacy.html"),/does not receive or store full payment-card or bank-account details/i);
});

test("support and deletion pages explain their important fallback and retention behavior",()=>{
  const contact=read("contact.html"),deletion=text("delete-account.html");
  assert.match(contact,/<noscript>[\s\S]*support form needs JavaScript[\s\S]*mailto:/i);
  assert.match(text("contact.html"),/signed-in requests use the name and email registered to the account/i);
  assert.match(deletion,/monthly plan/i);
  assert.match(deletion,/published (?:community-)?plan listing/i);
  assert.match(deletion,/support (?:requests|records)[\s\S]*administrator security logs[\s\S]*may be retained/i);
});

test("community-plan policies explain publication, privacy, replacement, and removal",()=>{
  const privacy=text("privacy.html"),terms=text("terms.html");
  assert.match(privacy,/validated structured weekly plan/i);
  assert.match(privacy,/display name/i);
  assert.match(privacy,/email address and internal user identifier are not included in the listing/i);
  assert.match(privacy,/rather than uploading a binary file or attachment/i);
  assert.match(terms,/Only Strata\+ members can browse and apply community plans/i);
  assert.match(terms,/replaces your current saved week/i);
  assert.match(terms,/publisher can unpublish their listing/i);
});

test("public copy describes active secure checkout without overpromising access",()=>{
  const publicCopy=["pricing.html","terms.html","privacy.html","refunds.html"].map(text).join(" ");
  assert.doesNotMatch(publicCopy,/lifetime access|permanent access/i);
  assert.doesNotMatch(publicCopy,/prelaunch|until checkout is activated|when paid checkout launches|when purchasing is available/i);
  assert.match(text("privacy.html"),/Paddle handles checkout and payment information/i);
  assert.match(text("refunds.html"),/Strata\+ access for the refunded account ends when the refund is processed/i);
  const pricingClient=fs.readFileSync(path.join(PUBLIC_ROOT,"scripts","pricing.js"),"utf8");
  assert.doesNotMatch(pricingClient,/permanently unlocked/i);
  assert.match(pricingClient,/unlocked on this account with no recurring subscription/i);
  assert.match(pricingClient,/Skip trial — buy now/);
  assert.match(pricingClient,/error\.code==="CHECKOUT_PREPARING"/);
  assert.doesNotMatch(pricingClient,/error\.status===409/,"a concurrent-checkout response must stay retryable instead of impersonating a completed payment");
});
