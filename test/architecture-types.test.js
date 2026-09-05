"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {readFileSync}=require("node:fs");
const {join}=require("node:path");

const ROOT=join(__dirname,"..");

test("strict checkJs covers provider, transport, storage, and service composition boundaries",()=>{
  const config=JSON.parse(readFileSync(join(ROOT,"tsconfig.boundaries.json"),"utf8"));
  assert.equal(config.compilerOptions.allowJs,true);
  assert.equal(config.compilerOptions.checkJs,true);
  assert.equal(config.compilerOptions.strict,true);
  assert.equal(config.compilerOptions.noEmit,true);
  assert.equal(config.compilerOptions.exactOptionalPropertyTypes,true);
  assert.equal(config.compilerOptions.noUncheckedIndexedAccess,true);
  for(const file of [
    "src/domain-types.d.ts","src/http.js","src/payments.js","src/store-contract.js",
    "src/service-composition.js"
  ])assert.ok(config.include.includes(file),`${file} must remain in the strict boundary program`);
});

test("production service composition covers all three typed factories and their cross-service cycle",()=>{
  const fixture=readFileSync(join(ROOT,"src","service-composition.js"),"utf8");
  const server=readFileSync(join(ROOT,"src","server.js"),"utf8");
  for(const factory of ["createAuthService","createAdminService","createSupportService"]){
    assert.match(fixture,new RegExp(`${factory}\\(\\{`));
    assert.match(server,new RegExp(`\\b${factory}\\b`));
  }
  assert.match(fixture,/claimAdminForLogin:async\(user\)=>admin\?admin\.maybeClaimAdminForLogin\(user\):user/);
  assert.match(fixture,/http:\{json:http\.json,bodyJson:http\.bodyJson\}/);
  assert.match(server,/composeServices\(\{/);
});

test("service factories publish declared dependency and return contracts",()=>{
  for(const [file,dependencyType,serviceType] of [
    ["auth.js","AuthServiceDependencies","AuthService"],
    ["admin.js","AdminServiceDependencies","AdminService"],
    ["support.js","SupportServiceDependencies","SupportService"]
  ]){
    const source=readFileSync(join(ROOT,"src",file),"utf8");
    assert.match(source,new RegExp(`@param \\{import\\("\\./domain-types"\\)\\.${dependencyType}\\} dependencies`));
    assert.match(source,new RegExp(`@returns \\{import\\("\\./domain-types"\\)\\.${serviceType}\\}`));
  }
});
