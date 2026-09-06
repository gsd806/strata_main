"use strict";

const {spawnSync}=require("node:child_process");

// These floors are deliberately based on the Build 6.9.9.007 Node 24
// server/core baseline (91.33% lines, 78.91% branches, 85.47% functions).
// Keep a small
// buffer for useful refactors, while still making a material regression fail.
const COVERAGE_THRESHOLDS=Object.freeze({
  lines:90,
  branches:78,
  functions:85
});

const args=[
  "--test",
  "--test-concurrency=1",
  "--experimental-test-coverage",
  `--test-coverage-lines=${COVERAGE_THRESHOLDS.lines}`,
  `--test-coverage-branches=${COVERAGE_THRESHOLDS.branches}`,
  `--test-coverage-functions=${COVERAGE_THRESHOLDS.functions}`,
  "--test-coverage-include=server.js",
  "--test-coverage-include=src/**/*.js",
  "--test-coverage-include=public/scripts/discovery-core.js",
  "--test-coverage-include=public/scripts/monthly-plan-core.js",
  "--test-coverage-include=public/scripts/workout-core.js",
  "--test-coverage-include=public/scripts/onboarding-core.js"
];

function runCoverage() {
  const result=spawnSync(process.execPath,args,{stdio:"inherit"});
  if (result.error) throw result.error;
  return result.status??1;
}

if (require.main===module) process.exitCode=runCoverage();

module.exports={COVERAGE_THRESHOLDS,args,runCoverage};
