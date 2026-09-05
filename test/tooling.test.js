"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");

const ROOT=path.join(__dirname,"..");
const read=(relative)=>fs.readFileSync(path.join(ROOT,relative),"utf8");

test("one check command owns the complete pre-release verification sequence",()=>{
  const manifest=JSON.parse(read("package.json"));
  assert.deepEqual(manifest.scripts.check.split(" && "),[
    "npm run release:check",
    "npm run lint",
    "npm test",
    "npm run qa:runtime"
  ]);
  assert.equal(manifest.scripts.qa,"npm run check");
  assert.equal(manifest.scripts.lint,"eslint . --max-warnings=0");
  assert.match(manifest.devDependencies.eslint,/^10\./);

  const workflow=read(".github/workflows/ci.yml");
  assert.match(workflow,/run: npm run check/);
  assert.match(workflow,/run: npm run coverage/);
});

test("coverage reports application code without an arbitrary percentage gate",()=>{
  const command=JSON.parse(read("package.json")).scripts.coverage;
  assert.match(command,/--experimental-test-coverage/);
  assert.match(command,/--test-coverage-include='server\.js'/);
  assert.match(command,/--test-coverage-include='src\/\*\*\/\*\.js'/);
  assert.match(command,/--test-coverage-include='public\/scripts\/\*\*\/\*\.js'/);
  assert.doesNotMatch(command,/--test-coverage-(?:branches|functions|lines)=/);
});

test("security and architecture guidance cover the maintained trust boundaries",()=>{
  const readme=read("README.md"),security=read("SECURITY.md"),architecture=read("docs/architecture.md"),deployment=read("docs/deployment.md");
  assert.match(readme,/docs\/architecture\.md/);
  assert.match(readme,/docs\/deployment\.md/);
  assert.match(readme,/SECURITY\.md/);
  assert.match(security,/report a vulnerability privately/i);
  assert.match(security,/do not open a public GitHub issue/i);
  for(const boundary of ["src/auth.js","src/admin.js","src/support.js","SQLite","Turso","Paddle","Resend","PWA architecture"]){
    assert.match(architecture,new RegExp(boundary.replace(/[.*+?^${}()|[\]\\]/g,"\\$&"),"i"),boundary);
  }
  assert.match(deployment,/PADDLE_CHECKOUT_ENABLED=false/);
  assert.match(deployment,/npm run check/);
});
