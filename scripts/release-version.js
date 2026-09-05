#!/usr/bin/env node
"use strict";

const fs=require("node:fs");
const path=require("node:path");

const PROJECT_ROOT=path.join(__dirname,"..");
const STRICT_VERSION=/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;

// Release references are intentionally explicit. This tool never walks the tree,
// which keeps private data, dependencies, and Git internals out of its scope.
const DEFAULT_MANIFEST=Object.freeze({
  textFiles:Object.freeze([
    "README.md",
    "public/pages/account.html",
    "public/pages/admin.html",
    "public/pages/contact.html",
    "public/pages/delete-account.html",
    "public/pages/discover.html",
    "public/pages/forgot-password.html",
    "public/pages/index.html",
    "public/pages/install.html",
    "public/pages/offline.html",
    "public/pages/planner.html",
    "public/pages/pricing.html",
    "public/pages/privacy.html",
    "public/pages/refunds.html",
    "public/pages/reset-password.html",
    "public/pages/terms.html",
    "public/pages/verify-email.html",
    "public/scripts/app.js",
    "public/scripts/planner.js",
    "public/service-worker.js",
    "test/public-info.test.js",
    "test/pwa.test.js",
    "test/server.test.js"
  ]),
  readmeFiles:Object.freeze(["README.md"])
});

const STANDARD_MARKERS=Object.freeze([
  {label:"asset version",source:String.raw`\?v=((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))`},
  {label:"build label",source:String.raw`\bBuild\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\b`},
  {label:"build constant",source:String.raw`\bconst\s+BUILD\s*=\s*["']((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))["']`},
  {label:"build assertion",source:String.raw`assert\.equal\(\s*(?:BUILD|version)\s*,\s*["']((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))["']`}
]);

// README keeps historical release notes. Only its current-release anchors are
// audited for drift; every literal occurrence of the current package version is
// still advanced during an update.
const README_MARKERS=Object.freeze([
  {label:"README overview",source:String.raw`^STRATA[^\n]*\bBuild\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\s+is\b`},
  {label:"README release heading",source:String.raw`^\*\*Build\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\s+is\b`},
  {label:"README structure heading",source:String.raw`^Build\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\s+separates\b`},
  {label:"README public-pages heading",source:String.raw`^Build\s+((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))\s+has\b`}
]);

class ReleaseVersionError extends Error {
  constructor(message){super(message);this.name="ReleaseVersionError";}
}

function validateVersion(value,label="Version"){
  if(typeof value!=="string"||!STRICT_VERSION.test(value)){
    throw new ReleaseVersionError(`${label} must use strict x.y.z format with non-negative integers (received ${JSON.stringify(value)}).`);
  }
  return value;
}

function readJson(file){
  let source;
  try{source=fs.readFileSync(file,"utf8");}
  catch(error){throw new ReleaseVersionError(`Cannot read ${file}: ${error.message}`);}
  try{return {source,value:JSON.parse(source)};}
  catch(error){throw new ReleaseVersionError(`Invalid JSON in ${file}: ${error.message}`);}
}

function safeManifestPath(root,relative){
  if(typeof relative!=="string"||relative.length===0||path.isAbsolute(relative)||relative.split(/[\\/]/).includes("..")){
    throw new ReleaseVersionError(`Unsafe release manifest path: ${JSON.stringify(relative)}.`);
  }
  return path.join(root,relative);
}

function lineAt(source,index){return source.slice(0,index).split("\n").length;}

function collectMarkers(relative,source,readmeFiles){
  const patterns=readmeFiles.has(relative)?README_MARKERS:STANDARD_MARKERS;
  const markers=[];
  for(const pattern of patterns){
    const expression=new RegExp(pattern.source,"gm");
    for(const match of source.matchAll(expression)){
      const offset=match[0].indexOf(match[1]);
      markers.push({label:pattern.label,version:match[1],line:lineAt(source,match.index+offset)});
    }
  }
  return markers;
}

function auditRelease(root,current,manifest=DEFAULT_MANIFEST){
  validateVersion(current,"package.json version");
  const errors=[];
  const readmeFiles=new Set(manifest.readmeFiles||[]);
  const packageLockPath=safeManifestPath(root,"package-lock.json");
  const {value:lock}=readJson(packageLockPath);
  const lockVersions=[
    ["package-lock.json top-level version",lock.version],
    ["package-lock.json root package version",lock.packages?.[""]?.version]
  ];
  for(const [label,version] of lockVersions){
    if(version!==current)errors.push(`${label} is ${JSON.stringify(version)}; expected ${current} from package.json.`);
  }

  for(const relative of manifest.textFiles){
    const file=safeManifestPath(root,relative);
    let source;
    try{source=fs.readFileSync(file,"utf8");}
    catch(error){errors.push(`${relative} cannot be read: ${error.message}`);continue;}
    const markers=collectMarkers(relative,source,readmeFiles);
    if(markers.length===0){
      errors.push(`${relative} has no recognized release-version marker; update the explicit manifest or restore its marker.`);
      continue;
    }
    for(const marker of markers){
      if(marker.version!==current){
        errors.push(`${relative}:${marker.line} ${marker.label} is ${marker.version}; expected ${current} from package.json.`);
      }
    }
  }

  if(errors.length){
    throw new ReleaseVersionError(`Release version drift detected:\n- ${errors.join("\n- ")}`);
  }
  return {filesChecked:2+manifest.textFiles.length};
}

function replaceLiteral(source,current,target){
  const pieces=source.split(current);
  return {content:pieces.join(target),occurrences:pieces.length-1};
}

function renderJsonVersion(source,file,current,target,isLock){
  let parsed;
  try{parsed=JSON.parse(source);}
  catch(error){throw new ReleaseVersionError(`Invalid JSON in ${file}: ${error.message}`);}
  parsed.version=target;
  let occurrences=1;
  if(isLock){
    if(!parsed.packages||!parsed.packages[""])throw new ReleaseVersionError(`${file} is missing packages[""].`);
    parsed.packages[""].version=target;
    occurrences=2;
  }
  return {content:`${JSON.stringify(parsed,null,2)}\n`,occurrences};
}

function planRelease(root,current,target,manifest=DEFAULT_MANIFEST){
  const plans=[];
  for(const [relative,isLock] of [["package.json",false],["package-lock.json",true]]){
    const file=safeManifestPath(root,relative);
    const source=fs.readFileSync(file,"utf8");
    const rendered=renderJsonVersion(source,relative,current,target,isLock);
    plans.push({relative,file,...rendered});
  }
  for(const relative of manifest.textFiles){
    const file=safeManifestPath(root,relative);
    const source=fs.readFileSync(file,"utf8");
    const rendered=replaceLiteral(source,current,target);
    if(rendered.occurrences===0){
      throw new ReleaseVersionError(`${relative} contains no ${current} reference to update.`);
    }
    plans.push({relative,file,...rendered});
  }
  return plans;
}

function runRelease({root=PROJECT_ROOT,target=null,check=false,dryRun=false,manifest=DEFAULT_MANIFEST,logger=console}={}){
  const packagePath=safeManifestPath(root,"package.json");
  const {value:pkg}=readJson(packagePath);
  const current=validateVersion(pkg.version,"package.json version");
  const audit=auditRelease(root,current,manifest);

  if(check){
    if(target!==null||dryRun)throw new ReleaseVersionError("--check cannot be combined with a target version or --dry-run.");
    logger.log(`Release versions are aligned at ${current} across ${audit.filesChecked} allowlisted files.`);
    return {current,filesChecked:audit.filesChecked,changed:false};
  }

  validateVersion(target,"Target version");
  if(target===current)throw new ReleaseVersionError(`Target version ${target} already matches package.json; use --check to audit the release.`);
  const plans=planRelease(root,current,target,manifest);
  const occurrenceCount=plans.reduce((sum,plan)=>sum+plan.occurrences,0);

  if(dryRun){
    logger.log(`Dry run: ${current} -> ${target}`);
    for(const plan of plans)logger.log(`- ${plan.relative}: ${plan.occurrences} replacement${plan.occurrences===1?"":"s"}`);
    logger.log(`No files written. ${plans.length} allowlisted files and ${occurrenceCount} references would change.`);
    return {current,target,changed:false,dryRun:true,plans};
  }

  for(const plan of plans)fs.writeFileSync(plan.file,plan.content,"utf8");
  logger.log(`Updated ${plans.length} allowlisted files and ${occurrenceCount} references from ${current} to ${target}.`);
  return {current,target,changed:true,plans};
}

function usage(){
  return [
    "Usage:",
    "  node scripts/release-version.js --check",
    "  node scripts/release-version.js --dry-run <x.y.z>",
    "  node scripts/release-version.js <x.y.z>",
    "",
    "package.json is the current-version source of truth. Only the files in the",
    "script's explicit manifest can be read or written."
  ].join("\n");
}

function parseArguments(argv){
  let check=false;
  let dryRun=false;
  let help=false;
  const positional=[];
  for(const argument of argv){
    if(argument==="--check")check=true;
    else if(argument==="--dry-run")dryRun=true;
    else if(argument==="--help"||argument==="-h")help=true;
    else if(argument.startsWith("-"))throw new ReleaseVersionError(`Unknown option ${argument}.\n\n${usage()}`);
    else positional.push(argument);
  }
  if(help)return {help:true};
  if(positional.length>1)throw new ReleaseVersionError(`Expected at most one target version.\n\n${usage()}`);
  const target=positional[0]||null;
  if(check&&(dryRun||target))throw new ReleaseVersionError(`--check must be used by itself.\n\n${usage()}`);
  if(!check&&!target)throw new ReleaseVersionError(`A target version is required unless --check is used.\n\n${usage()}`);
  return {check,dryRun,target,help:false};
}

if(require.main===module){
  try{
    const options=parseArguments(process.argv.slice(2));
    if(options.help)process.stdout.write(`${usage()}\n`);
    else runRelease(options);
  }catch(error){
    process.stderr.write(`${error.message}\n`);
    process.exitCode=1;
  }
}

module.exports={
  DEFAULT_MANIFEST,
  ReleaseVersionError,
  STRICT_VERSION,
  auditRelease,
  parseArguments,
  runRelease,
  validateVersion
};
