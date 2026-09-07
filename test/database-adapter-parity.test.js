"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {mkdirSync,mkdtempSync,rmSync}=require("node:fs");
const {join}=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const {createStore}=require("../src/database");

const PROJECT_ROOT=join(__dirname,"..");
const TEST_RUNTIME=join(PROJECT_ROOT,"test-runtime");

function fakeTursoClientFactory() {
  const database=new DatabaseSync(":memory:",{enableForeignKeyConstraints:true});

  async function execute(statement) {
    const sql=typeof statement==="string"?statement:statement.sql;
    const args=typeof statement==="string"?[]:(statement.args||[]);
    const prepared=database.prepare(sql);
    const returnsRows=/^\s*(?:SELECT|WITH|PRAGMA|EXPLAIN)\b/i.test(sql)||/\bRETURNING\b/i.test(sql);
    if (returnsRows) {
      const objectRows=prepared.all(...args);
      const columns=prepared.columns().map((column)=>column.name);
      const rows=objectRows.map((row)=>columns.map((column)=>row[column]));
      const rowsAffected=Number(database.prepare("SELECT changes() AS count").get().count);
      return {columns,rows,rowsAffected};
    }
    const result=prepared.run(...args);
    return {columns:[],rows:[],rowsAffected:Number(result.changes)};
  }

  return {
    execute,
    async batch(statements) {
      database.exec("BEGIN IMMEDIATE");
      try {
        const results=[];
        for (const statement of statements) results.push(await execute(statement));
        database.exec("COMMIT");
        return results;
      } catch(error) {
        try { database.exec("ROLLBACK"); } catch { /* Preserve the statement failure. */ }
        throw error;
      }
    },
    close() { database.close(); }
  };
}

function restoreEnvironment(previous) {
  for (const [key,value] of Object.entries(previous)) {
    if (value===undefined) delete process.env[key];
    else process.env[key]=value;
  }
}

async function stores() {
  mkdirSync(TEST_RUNTIME,{recursive:true});
  const localDirectory=mkdtempSync(join(TEST_RUNTIME,"adapter-parity-"));
  const previous={
    NODE_ENV:process.env.NODE_ENV,
    STRATA_DATA_DIR:process.env.STRATA_DATA_DIR,
    TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,
    TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN
  };
  let local;
  let turso;
  try {
    process.env.NODE_ENV="test";
    process.env.STRATA_DATA_DIR=localDirectory;
    delete process.env.TURSO_DATABASE_URL;
    delete process.env.TURSO_AUTH_TOKEN;
    local=await createStore(PROJECT_ROOT);

    delete process.env.STRATA_DATA_DIR;
    process.env.TURSO_DATABASE_URL="https://adapter-parity.invalid";
    process.env.TURSO_AUTH_TOKEN="parity-test-token";
    turso=await createStore(PROJECT_ROOT,{tursoClientFactory:fakeTursoClientFactory});
  } finally {
    restoreEnvironment(previous);
  }
  return {
    local,
    turso,
    async close() {
      await Promise.all([local?.close(),turso?.close()]);
      rmSync(localDirectory,{recursive:true,force:true});
    }
  };
}

async function parityScenario(store) {
  const user={
    id:"parity-user",
    name:"Parity User",
    email:"parity@example.test",
    passwordHash:"private-parity-hash",
    passwordSalt:"private-parity-salt",
    createdAt:1_000,
    emailVerifiedAt:1_000
  };
  const insertUserResult=await store.insertUser(user);
  const insertedSession=await store.insertSession({
    tokenHash:"parity-session",
    userId:user.id,
    csrfToken:"private-parity-csrf",
    expiresAt:10_000,
    createdAt:1_100,
    authVersion:1
  });
  await store.insertSession({
    tokenHash:"expired-session",
    userId:user.id,
    csrfToken:"private-expired-csrf",
    expiresAt:1_150,
    createdAt:1_100,
    authVersion:1
  });
  const deleteExpiredResult=await store.deleteExpired(1_200);
  const activeSession=await store.session("parity-session",1_200);
  const sessionAtExpiry=await store.session("parity-session",10_000);
  const expiredSession=await store.session("expired-session",1_200);
  await store.insertSession({tokenHash:"other-session-a",userId:user.id,csrfToken:"private-other-a",expiresAt:10_000,createdAt:1_101,authVersion:1});
  await store.insertSession({tokenHash:"other-session-b",userId:user.id,csrfToken:"private-other-b",expiresAt:10_000,createdAt:1_102,authVersion:1});
  const accountSessions=await store.accountSessions(user.id,"parity-session",1_200);
  const currentSessionProtected=await store.revokeAccountSession(user.id,"parity-session","parity-session",1_200);
  const foreignSessionProtected=await store.revokeAccountSession("not-the-owner","other-session-a","parity-session",1_200);
  const revokedAccountSession=await store.revokeAccountSession(user.id,"other-session-a","parity-session",1_200);
  const revokedOtherAccountSessions=await store.revokeOtherAccountSessions(user.id,"parity-session",1_200);
  const currentAccountSession=await store.session("parity-session",1_200);

  const planJson=JSON.stringify({version:1,restDay:"Sunday",days:{}});
  const firstPlan=await store.upsertPlan(user.id,planJson,1_300,0);
  const stalePlan=await store.upsertPlan(user.id,JSON.stringify({stale:true}),1_301,0);
  const monthlyResult=await store.upsertMonthlyPlan(user.id,JSON.stringify({month:1}),1_400);
  const preferencesResult=await store.upsertPreferences(user.id,JSON.stringify({goal:"strength"}),1_500);
  const setupPlanJson=JSON.stringify({version:1,restDay:"Saturday",days:{Monday:[{exerciseId:"setup"}]}});
  const setupPreferencesJson=JSON.stringify({goal:"balanced",days:1});
  const setupResult=await store.saveTrainingSetup(user.id,setupPlanJson,setupPreferencesJson,1_200,1_300,1_500);
  const staleSetup=await store.saveTrainingSetup(user.id,JSON.stringify({staleSetup:true}),JSON.stringify({goal:"stale"}),1_201,1_300,1_500);
  const setupPlan=await store.plan(user.id),setupPreferences=await store.preferences(user.id);
  const ratingResult=await store.upsertRating(user.id,"parity-lift",{
    comfort:5,pump:4,enjoyment:3,stability:4,setup:2,overall:4
  },1_600,1_600);

  const verificationSendResult=await store.recordVerificationSend({
    id:"parity-send",
    emailHash:"parity-email-hash",
    challengeId:"parity-challenge",
    generation:1,
    sentAt:1_700
  });
  const verificationSendCount=await store.countVerificationSends("parity-email-hash",1_600);

  const pending=await store.insertPendingPurchase({
    transactionId:"txn_parity",
    userId:user.id,
    priceId:"pri_parity",
    productId:"pro_parity",
    paddleStatus:"ready",
    createdAt:1_800,
    updatedAt:1_800
  });
  const completed=await store.completePurchase("txn_parity",{
    customerId:"ctm_original",
    completedAt:1_900,
    updatedAt:1_900
  });
  const replayed=await store.completePurchase("txn_parity",{
    customerId:"ctm_replayed",
    completedAt:2_000,
    updatedAt:2_000
  });
  const accountExport=await store.accountExport(user.id);

  const revoked=await store.revokeUserSessions(user.id);
  const staleSessionAccepted=await store.insertSession({
    tokenHash:"stale-session",
    userId:user.id,
    csrfToken:"private-stale-csrf",
    expiresAt:20_000,
    createdAt:2_100,
    authVersion:1
  });
  const deleteSessionResult=await store.deleteSession("parity-session");

  await store.insertUser({
    id:"reset-user",name:"Reset User",email:"reset@example.test",
    passwordHash:"old-reset-hash",passwordSalt:"old-reset-salt",createdAt:2_200,emailVerifiedAt:2_200
  });
  await store.insertSession({
    tokenHash:"reset-session",userId:"reset-user",csrfToken:"private-reset-csrf",
    expiresAt:20_000,createdAt:2_300,authVersion:1
  });
  await store.upsertAccountAction({
    requestId:"reset-request",userId:"reset-user",purpose:"password_reset",tokenHash:"reset-token-hash",
    expiresAt:5_000,deliveryState:"sent",createdAt:2_400,updatedAt:2_400
  });
  const resetCompleted=await store.completePasswordReset("reset-token-hash","new-reset-hash","new-reset-salt",4_000);
  const resetSessionAfter=await store.session("reset-session",4_001);
  const resetActionAfter=await store.accountActionByTokenHash("reset-token-hash");
  const resetReplay=await store.completePasswordReset("reset-token-hash","replayed-hash","replayed-salt",4_001);
  const resetCredentials=await store.accountCredentialsById("reset-user");

  await store.insertUser({
    id:"expiry-user",name:"Expiry User",email:"expiry@example.test",
    passwordHash:"original-expiry-hash",passwordSalt:"original-expiry-salt",createdAt:2_500,emailVerifiedAt:2_500
  });
  await store.insertSession({
    tokenHash:"expiry-session",userId:"expiry-user",csrfToken:"private-expiry-csrf",
    expiresAt:20_000,createdAt:2_600,authVersion:1
  });
  await store.upsertAccountAction({
    requestId:"expiry-request",userId:"expiry-user",purpose:"password_reset",tokenHash:"expiry-token-hash",
    expiresAt:6_000,deliveryState:"sent",createdAt:2_700,updatedAt:2_700
  });
  const resetAtExactExpiry=await store.completePasswordReset("expiry-token-hash","forbidden-hash","forbidden-salt",6_000);
  const expiryCredentials=await store.accountCredentialsById("expiry-user");
  const expirySessionAfter=await store.session("expiry-session",6_000);

  const oldSignal=await store.incrementProductSignal("2026-06-09","preview_generated");
  const firstSignal=await store.incrementProductSignal("2026-09-06","preview_generated");
  const repeatedSignal=await store.incrementProductSignal("2026-09-06","preview_generated");
  const workoutSignal=await store.incrementProductSignal("2026-09-07","workout_started");
  const signalCounts=await store.productSignalCounts("2026-06-10","2026-09-07");
  const deletedSignals=await store.deleteOldProductSignals("2026-06-10");
  const retainedSignalCounts=await store.productSignalCounts("2026-01-01","2026-09-07");

  return {
    insertUserResult,
    insertedSession,
    deleteExpiredResult,
    activeSession,
    sessionAtExpiry,
    expiredSession,
    accountSessions,
    currentSessionProtected,
    foreignSessionProtected,
    revokedAccountSession,
    revokedOtherAccountSessions,
    currentAccountSession,
    firstPlan,
    stalePlan,
    monthlyResult,
    monthlyPlan:await store.monthlyPlan(user.id),
    preferencesResult,
    setupResult,
    staleSetup,
    setupPlan,
    setupPreferences,
    ratingResult,
    ratings:await store.ratingsForUser(user.id),
    verificationSendResult,
    verificationSendCount,
    pending,
    completed,
    replayed,
    accountExport,
    paidAccess:await store.hasPaidDiscoveryAccess(user.id),
    revoked,
    staleSessionAccepted,
    deleteSessionResult,
    deletedSession:await store.session("parity-session",2_200),
    resetCompleted,
    resetSessionAfter,
    resetActionAfter,
    resetReplay,
    resetCredentials,
    resetAtExactExpiry,
    expiryCredentials,
    expirySessionAfter,
    oldSignal,
    firstSignal,
    repeatedSignal,
    workoutSignal,
    signalCounts,
    deletedSignals,
    retainedSignalCounts
  };
}

test("SQLite and Turso adapters expose matching values, mutation results, and security state transitions",{concurrency:false},async()=>{
  const fixture=await stores();
  try {
    assert.equal(fixture.local.kind,"local");
    assert.equal(fixture.turso.kind,"turso");
    const localResult=await parityScenario(fixture.local);
    const tursoResult=await parityScenario(fixture.turso);
    assert.deepEqual(tursoResult,localResult);
    for (const key of [
      "insertUserResult","deleteExpiredResult","monthlyResult","preferencesResult",
      "ratingResult","verificationSendResult","deleteSessionResult"
    ]) assert.equal(localResult[key],undefined,`${key} must have one documented void result across adapters`);
    assert.equal(localResult.replayed,null,"a provider completion cannot replace the durable customer identity");
    assert.equal(localResult.completed.customer_id,"ctm_original");
    assert.equal(localResult.completed.completed_at,1_900);
    assert.equal(localResult.activeSession.expires_at,10_000);
    assert.equal(localResult.sessionAtExpiry,null,"sessions must expire at the exact stored boundary");
    assert.deepEqual(localResult.accountSessions.map(({token_hash,created_at,expires_at})=>({token_hash,created_at,expires_at})),[
      {token_hash:"parity-session",created_at:1_100,expires_at:10_000},
      {token_hash:"other-session-b",created_at:1_102,expires_at:10_000},
      {token_hash:"other-session-a",created_at:1_101,expires_at:10_000}
    ]);
    assert.equal(localResult.currentSessionProtected,false,"self-service cannot revoke the current session");
    assert.equal(localResult.foreignSessionProtected,false,"self-service cannot revoke another user's session");
    assert.equal(localResult.revokedAccountSession,true);
    assert.equal(localResult.revokedOtherAccountSessions,1);
    assert.ok(localResult.currentAccountSession,"bulk revocation must preserve the current session");
    const serializedExport=JSON.stringify(localResult.accountExport);
    assert.doesNotMatch(serializedExport,/private-|password_hash|password_salt|token_hash|csrf_token|customer_id|admin_note|ip_hash/i);
    assert.equal(localResult.accountExport.profile.id,"parity-user");
    assert.equal(localResult.accountExport.ratings[0].exercise_id,"parity-lift");
    assert.equal(localResult.accountExport.purchases[0].transaction_id,"txn_parity");
    assert.equal(localResult.revoked.revoked,1);
    assert.equal(localResult.staleSessionAccepted,false);
    assert.equal(localResult.resetCompleted.auth_version,2);
    assert.equal(localResult.resetSessionAfter,null,"password reset must revoke every prior session");
    assert.equal(localResult.resetActionAfter,null,"a consumed reset token must not remain reusable");
    assert.equal(localResult.resetReplay,null,"password reset must be one-time");
    assert.equal(localResult.resetCredentials.password_hash,"new-reset-hash");
    assert.equal(localResult.resetAtExactExpiry,null,"reset tokens must expire at the exact stored boundary");
    assert.equal(localResult.expiryCredentials.password_hash,"original-expiry-hash");
    assert.ok(localResult.expirySessionAfter,"an expired reset attempt must not revoke an otherwise valid session");
    assert.equal(localResult.setupResult.updated_at,1_501,"the joint revision must advance past both stored timestamps after clock rollback");
    assert.equal(localResult.setupResult.preferences_updated_at,1_501);
    assert.equal(localResult.staleSetup,null,"stale setup revisions must not partially update either record");
    assert.equal(localResult.setupPlan.plan_json,JSON.stringify({version:1,restDay:"Saturday",days:{Monday:[{exerciseId:"setup"}]}}));
    assert.equal(localResult.setupPreferences.preferences_json,JSON.stringify({goal:"balanced",days:1}));
    assert.deepEqual(localResult.signalCounts,[
      {event_day:"2026-09-06",event_name:"preview_generated",event_count:2},
      {event_day:"2026-09-07",event_name:"workout_started",event_count:1}
    ]);
    assert.equal(localResult.deletedSignals,1);
    assert.deepEqual(localResult.retainedSignalCounts,localResult.signalCounts);
  } finally {
    await fixture.close();
  }
});
