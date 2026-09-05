"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdirSync,mkdtempSync,rmSync } = require("node:fs");
const { join } = require("node:path");
const { createStore } = require("../src/database");

const PROJECT_ROOT=join(__dirname,"..");

const PRICE_ID="pri_01m1kyc2zd313d7a3ssmg02424";
const PRODUCT_ID="pro_01m1ky8j916ybyacs836dxbz8x";

async function fixture() {
  const runtimeRoot=join(PROJECT_ROOT,"test-runtime");
  mkdirSync(runtimeRoot,{recursive:true});
  const root=mkdtempSync(join(runtimeRoot,"payment-db-"));
  const previous={
    nodeEnv:process.env.NODE_ENV,
    tursoUrl:process.env.TURSO_DATABASE_URL,
    dataDir:process.env.STRATA_DATA_DIR
  };
  process.env.NODE_ENV="test";
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.STRATA_DATA_DIR;
  const store=await createStore(root);
  await store.insertUser({
    id:"user-1",
    name:"Payment Tester",
    email:"payments@example.test",
    passwordHash:"not-a-real-password-hash",
    passwordSalt:"not-a-real-salt",
    createdAt:100
  });
  return {
    store,
    async close() {
      await store.close();
      rmSync(root,{recursive:true,force:true});
      if(previous.nodeEnv===undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV=previous.nodeEnv;
      if(previous.tursoUrl===undefined) delete process.env.TURSO_DATABASE_URL; else process.env.TURSO_DATABASE_URL=previous.tursoUrl;
      if(previous.dataDir===undefined) delete process.env.STRATA_DATA_DIR; else process.env.STRATA_DATA_DIR=previous.dataDir;
    }
  };
}

function pending(transactionId,createdAt,status="ready") {
  return {
    transactionId,
    userId:"user-1",
    priceId:PRICE_ID,
    productId:PRODUCT_ID,
    paddleStatus:status,
    createdAt,
    updatedAt:createdAt
  };
}

test("one-time Strata+ trials grant temporary access without becoming purchases",async()=>{
  const {store,close}=await fixture();
  try{
    assert.equal(await store.discoveryTrial("user-1"),null);
    assert.equal(await store.hasDiscoveryAccess("user-1",null,999),false);
    const trial=await store.startDiscoveryTrial("user-1",1_000,11_000);
    assert.deepEqual(trial,{user_id:"user-1",started_at:1_000,expires_at:11_000});
    assert.equal(await store.hasPaidDiscoveryAccess("user-1"),false);
    assert.equal(await store.hasDiscoveryAccess("user-1",null,10_999),true);
    assert.equal(await store.hasDiscoveryAccess("user-1",null,11_000),false);
    assert.equal(await store.startDiscoveryTrial("user-1",20_000,30_000),null,"a used trial cannot restart");
    assert.deepEqual(await store.discoveryTrial("user-1"),trial);
  }finally{await close();}
});

test("purchase ledger grants access from any completed, unrevoked purchase",async() => {
  const {store,close}=await fixture();
  try {
    assert.deepEqual(await store.discoveryAccessSummary("user-1"),{
      active:false,
      purchaseCount:0,
      activePurchaseCount:0,
      pendingPurchaseCount:0,
      latestActivePurchaseAt:null,
      latestCompletedAt:null,
      latestRevokedAt:null
    });

    const first=await store.insertPendingPurchase(pending("txn_first",1_000));
    assert.equal(first.paddle_status,"ready");
    assert.equal((await store.pendingPurchaseForUser("user-1",PRICE_ID)).transaction_id,"txn_first");
    assert.equal(await store.hasDiscoveryAccess("user-1"),false);

    const completed=await store.completePurchase("txn_first",{customerId:"ctm_first",completedAt:2_000,updatedAt:2_000});
    assert.equal(completed.paddle_status,"completed");
    assert.equal(completed.customer_id,"ctm_first");
    assert.equal(completed.completed_at,2_000);
    assert.equal(await store.pendingPurchaseForUser("user-1",PRICE_ID),null);
    assert.equal(await store.hasDiscoveryAccess("user-1"),true);
    assert.equal(await store.hasDiscoveryAccess("user-1",PRICE_ID),true);
    assert.equal(await store.hasDiscoveryAccess("user-1","pri_another_product"),false);
    assert.equal((await store.discoveryAccessSummary("user-1","pri_another_product")).purchaseCount,0);

    await store.revokePurchase("txn_first","approved_full_refund",3_000,3_000);
    assert.equal(await store.hasDiscoveryAccess("user-1"),false);

    await store.insertPendingPurchase(pending("txn_second",4_000));
    await store.completePurchase("txn_second",{customerId:"ctm_second",completedAt:5_000,updatedAt:5_000});
    assert.equal(await store.hasDiscoveryAccess("user-1"),true,"a refunded older purchase must not revoke a later active purchase");
    assert.deepEqual(await store.discoveryAccessSummary("user-1"),{
      active:true,
      purchaseCount:2,
      activePurchaseCount:1,
      pendingPurchaseCount:0,
      latestActivePurchaseAt:5_000,
      latestCompletedAt:5_000,
      latestRevokedAt:3_000
    });
  } finally {
    await close();
  }
});

test("purchase status updates are ordered and completed is terminal",async() => {
  const {store,close}=await fixture();
  try {
    await store.insertPendingPurchase(pending("txn_ordered",1_000,"draft"));
    assert.equal((await store.updatePurchaseStatus("txn_ordered","ready",2_000)).paddle_status,"ready");
    const stale=await store.updatePurchaseStatus("txn_ordered","payment_failed",1_500);
    assert.equal(stale.paddle_status,"ready");
    assert.equal(stale.updated_at,2_000);

    await store.completePurchase("txn_ordered",{customerId:"ctm_ordered",completedAt:3_000,updatedAt:3_000});
    const lateCancel=await store.updatePurchaseStatus("txn_ordered","canceled",4_000);
    assert.equal(lateCancel.paddle_status,"completed");
    assert.equal(lateCancel.updated_at,3_000);
    assert.equal(await store.hasDiscoveryAccess("user-1"),true);
  } finally {
    await close();
  }
});

test("adjustment upserts keep the newest event and revocation is monotonic",async() => {
  const {store,close}=await fixture();
  try {
    await store.insertPendingPurchase(pending("txn_refund",1_000));
    await store.completePurchase("txn_refund",{customerId:"ctm_refund",completedAt:2_000,updatedAt:2_000});

    const pendingApplied=await store.upsertAdjustment({
      adjustmentId:"adj_refund",
      transactionId:"txn_refund",
      action:"refund",
      type:"full",
      status:"pending_approval",
      occurredAt:4_000,
      updatedAt:4_000
    });
    assert.equal(pendingApplied,true);
    assert.equal((await store.adjustmentById("adj_refund")).status,"pending_approval");

    const staleApplied=await store.upsertAdjustment({
      adjustmentId:"adj_refund",
      transactionId:"txn_refund",
      action:"refund",
      type:"full",
      status:"approved",
      occurredAt:3_000,
      updatedAt:5_000
    });
    assert.equal(staleApplied,false,"an older delivery must not overwrite newer adjustment state");
    const stale=await store.adjustmentById("adj_refund");
    assert.equal(stale.status,"pending_approval");
    assert.equal(stale.occurred_at,4_000);

    const approvedApplied=await store.upsertAdjustment({
      adjustmentId:"adj_refund",
      transactionId:"txn_refund",
      action:"refund",
      type:"full",
      status:"approved",
      occurredAt:6_000,
      updatedAt:6_000
    });
    assert.equal(approvedApplied,true);
    assert.equal((await store.adjustmentById("adj_refund")).status,"approved");

    const revoked=await store.revokePurchase("txn_refund","approved_full_refund",6_000,6_000);
    assert.equal(revoked.access_revoked_at,6_000);
    assert.equal(revoked.revocation_reason,"approved_full_refund");
    await store.revokePurchase("txn_refund","duplicate_or_later_reason",7_000,7_000);
    await store.completePurchase("txn_refund",{customerId:"ctm_refund",completedAt:8_000,updatedAt:8_000});

    const preserved=await store.purchaseByTransaction("txn_refund");
    assert.equal(preserved.access_revoked_at,6_000,"replayed completion must not restore revoked access");
    assert.equal(preserved.revocation_reason,"approved_full_refund");
    assert.equal(preserved.completed_at,2_000,"replayed completion must preserve the first completion time");
    assert.equal(await store.hasDiscoveryAccess("user-1"),false);
  } finally {
    await close();
  }
});

test("webhook event IDs are recorded once",async() => {
  const {store,close}=await fixture();
  try {
    const event={eventId:"evt_once",notificationId:"ntf_once",eventType:"transaction.completed",occurredAt:2_000,processedAt:2_100};
    assert.equal(await store.recordWebhookEvent(event),true);
    assert.equal(await store.recordWebhookEvent({...event,eventType:"adjustment.updated",processedAt:9_999}),false);
    assert.deepEqual(await store.webhookEvent("evt_once"),{
      event_id:"evt_once",
      notification_id:"ntf_once",
      event_type:"transaction.completed",
      occurred_at:2_000,
      processed_at:2_100
    });
    assert.equal(await store.webhookEvent("evt_missing"),null);
  } finally {
    await close();
  }
});

test("adjustments require a known local purchase",async() => {
  const {store,close}=await fixture();
  try {
    await assert.rejects(
      store.upsertAdjustment({adjustmentId:"adj_unknown",transactionId:"txn_unknown",action:"refund",type:"full",status:"approved",occurredAt:1_000,updatedAt:1_000}),
      /foreign key/i
    );
  } finally {
    await close();
  }
});
