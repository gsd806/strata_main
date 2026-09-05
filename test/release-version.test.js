"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const os=require("node:os");
const path=require("node:path");

const {
  ReleaseVersionError,
  auditRelease,
  parseArguments,
  runRelease,
  validateVersion
}=require("../scripts/release-version");

const FIXTURE_MANIFEST={
  textFiles:["README.md","public/page.html"],
  readmeFiles:["README.md"]
};

function write(root,relative,content){
  const file=path.join(root,relative);
  fs.mkdirSync(path.dirname(file),{recursive:true});
  fs.writeFileSync(file,content,"utf8");
}

function makeFixture(version="1.2.3"){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"strata-release-version-"));
  write(root,"package.json",`${JSON.stringify({name:"fixture",version},null,2)}\n`);
  write(root,"package-lock.json",`${JSON.stringify({name:"fixture",version,lockfileVersion:3,packages:{"":{name:"fixture",version}}},null,2)}\n`);
  write(root,"README.md",[
    `STRATA fixture. Build ${version} is the current release.`,
    `**Build ${version} is a deterministic test release.**`,
    `Build ${version} separates browser files from private code.`,
    `Build ${version} has public pages.`,
    "Build 1.0.0 remains historical."
  ].join("\n"));
  write(root,"public/page.html",`<link href="/app.css?v=${version}"><p>Build ${version}</p>\n`);
  for(const relative of ["node_modules/dependency/version.txt",".git/internal-version","data/private-version.txt"]){
    write(root,relative,`private ${version}\n`);
  }
  return root;
}

test("release versions require strict x.y.z values",()=>{
  for(const valid of ["0.0.0","1.2.3","10.20.300"])assert.equal(validateVersion(valid),valid);
  for(const invalid of [null,"","1.2","v1.2.3","01.2.3","1.02.3","1.2.3-beta","1.2.3.4"]){
    assert.throws(()=>validateVersion(invalid),ReleaseVersionError);
  }
  assert.deepEqual(parseArguments(["--check"]),{check:true,dryRun:false,target:null,help:false});
  assert.deepEqual(parseArguments(["--dry-run","2.0.0"]),{check:false,dryRun:true,target:"2.0.0",help:false});
  assert.throws(()=>parseArguments(["--check","2.0.0"]),/--check must be used by itself/);
});

test("release checks identify exact drift before any write",t=>{
  const root=makeFixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  write(root,"public/page.html",'<link href="/app.css?v=1.2.2"><p>Build 1.2.3</p>\n');
  assert.throws(
    ()=>runRelease({root,target:"1.2.4",dryRun:true,manifest:FIXTURE_MANIFEST,logger:{log(){}}}),
    error=>{
      assert.match(error.message,/Release version drift detected/);
      assert.match(error.message,/public\/page\.html:1 asset version is 1\.2\.2; expected 1\.2\.3 from package\.json/);
      return true;
    }
  );
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version,"1.2.3");
});

test("dry runs report the allowlisted plan without touching any file",t=>{
  const root=makeFixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const before=new Map([
    "package.json","package-lock.json","README.md","public/page.html",
    "node_modules/dependency/version.txt",".git/internal-version","data/private-version.txt"
  ].map(relative=>[relative,fs.readFileSync(path.join(root,relative),"utf8")]));
  const output=[];
  const result=runRelease({root,target:"1.2.4",dryRun:true,manifest:FIXTURE_MANIFEST,logger:{log(line){output.push(line);}}});
  assert.equal(result.changed,false);
  assert.equal(result.dryRun,true);
  assert.match(output.join("\n"),/No files written/);
  for(const [relative,content] of before){
    assert.equal(fs.readFileSync(path.join(root,relative),"utf8"),content,`${relative} must remain unchanged`);
  }
});

test("updates advance only explicit release files and preserve excluded trees",t=>{
  const root=makeFixture();
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  const excluded=["node_modules/dependency/version.txt",".git/internal-version","data/private-version.txt"];
  const result=runRelease({root,target:"1.2.4",manifest:FIXTURE_MANIFEST,logger:{log(){}}});
  assert.equal(result.changed,true);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,"package.json"),"utf8")).version,"1.2.4");
  const lock=JSON.parse(fs.readFileSync(path.join(root,"package-lock.json"),"utf8"));
  assert.equal(lock.version,"1.2.4");
  assert.equal(lock.packages[""].version,"1.2.4");
  assert.match(fs.readFileSync(path.join(root,"public/page.html"),"utf8"),/v=1\.2\.4[\s\S]*Build 1\.2\.4/);
  const readme=fs.readFileSync(path.join(root,"README.md"),"utf8");
  assert.match(readme,/Build 1\.2\.4 is the current release/);
  assert.match(readme,/Build 1\.0\.0 remains historical/);
  for(const relative of excluded)assert.equal(fs.readFileSync(path.join(root,relative),"utf8"),"private 1.2.3\n");
  assert.doesNotThrow(()=>auditRelease(root,"1.2.4",FIXTURE_MANIFEST));
});
