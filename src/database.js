"use strict";

const { mkdirSync } = require("node:fs");
const { join } = require("node:path");

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    csrf_token TEXT NOT NULL,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS sessions_user_id ON sessions(user_id)",
  "CREATE INDEX IF NOT EXISTS sessions_expires_at ON sessions(expires_at)",
  `CREATE TABLE IF NOT EXISTS plans (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    plan_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS preferences (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    preferences_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS ratings (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    exercise_id TEXT NOT NULL,
    comfort INTEGER NOT NULL CHECK(comfort BETWEEN 1 AND 5),
    pump INTEGER NOT NULL CHECK(pump BETWEEN 1 AND 5),
    enjoyment INTEGER NOT NULL CHECK(enjoyment BETWEEN 1 AND 5),
    stability INTEGER NOT NULL CHECK(stability BETWEEN 1 AND 5),
    setup INTEGER NOT NULL CHECK(setup BETWEEN 1 AND 5),
    overall INTEGER NOT NULL CHECK(overall BETWEEN 1 AND 5),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY(user_id,exercise_id)
  )`,
  "CREATE INDEX IF NOT EXISTS ratings_exercise_id ON ratings(exercise_id)",
  `CREATE TABLE IF NOT EXISTS paddle_purchases (
    transaction_id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    price_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    customer_id TEXT,
    paddle_status TEXT NOT NULL,
    completed_at INTEGER,
    access_revoked_at INTEGER,
    revocation_reason TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS paddle_purchases_user_id ON paddle_purchases(user_id)",
  "CREATE INDEX IF NOT EXISTS paddle_purchases_customer_id ON paddle_purchases(customer_id)",
  `CREATE TABLE IF NOT EXISTS paddle_adjustments (
    adjustment_id TEXT PRIMARY KEY,
    transaction_id TEXT NOT NULL REFERENCES paddle_purchases(transaction_id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    type TEXT,
    status TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS paddle_adjustments_transaction_id ON paddle_adjustments(transaction_id)",
  `CREATE TABLE IF NOT EXISTS paddle_webhook_events (
    event_id TEXT PRIMARY KEY,
    notification_id TEXT,
    event_type TEXT NOT NULL,
    occurred_at INTEGER NOT NULL,
    processed_at INTEGER NOT NULL
  )`
];

const SQL = {
  ping:"SELECT 1 AS ok",
  userByEmail:"SELECT * FROM users WHERE email = ?",
  userById:"SELECT id,name,email,created_at FROM users WHERE id = ?",
  insertUser:"INSERT INTO users(id,name,email,password_hash,password_salt,created_at) VALUES(?,?,?,?,?,?)",
  insertSession:"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)",
  session:"SELECT s.token_hash,s.csrf_token,s.expires_at,u.id,u.name,u.email,u.created_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
  deleteSession:"DELETE FROM sessions WHERE token_hash=?",
  deleteExpired:"DELETE FROM sessions WHERE expires_at<=?",
  plan:"SELECT plan_json,updated_at FROM plans WHERE user_id=?",
  upsertPlan:"INSERT INTO plans(user_id,plan_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET plan_json=excluded.plan_json,updated_at=excluded.updated_at",
  preferences:"SELECT preferences_json,updated_at FROM preferences WHERE user_id=?",
  upsertPreferences:"INSERT INTO preferences(user_id,preferences_json,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET preferences_json=excluded.preferences_json,updated_at=excluded.updated_at",
  ratingsForUser:"SELECT exercise_id,comfort,pump,enjoyment,stability,setup,overall,updated_at FROM ratings WHERE user_id=?",
  ratingAggregates:"SELECT exercise_id,COUNT(*) AS rating_count,AVG(comfort) AS comfort,AVG(pump) AS pump,AVG(enjoyment) AS enjoyment,AVG(stability) AS stability,AVG(setup) AS setup,AVG(overall) AS overall FROM ratings GROUP BY exercise_id",
  ratingAggregate:"SELECT exercise_id,COUNT(*) AS rating_count,AVG(comfort) AS comfort,AVG(pump) AS pump,AVG(enjoyment) AS enjoyment,AVG(stability) AS stability,AVG(setup) AS setup,AVG(overall) AS overall FROM ratings WHERE exercise_id=? GROUP BY exercise_id",
  upsertRating:"INSERT INTO ratings(user_id,exercise_id,comfort,pump,enjoyment,stability,setup,overall,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(user_id,exercise_id) DO UPDATE SET comfort=excluded.comfort,pump=excluded.pump,enjoyment=excluded.enjoyment,stability=excluded.stability,setup=excluded.setup,overall=excluded.overall,updated_at=excluded.updated_at",
  insertPendingPurchase:"INSERT INTO paddle_purchases(transaction_id,user_id,price_id,product_id,customer_id,paddle_status,completed_at,access_revoked_at,revocation_reason,created_at,updated_at) VALUES(?,?,?,?,NULL,?,NULL,NULL,NULL,?,?)",
  purchaseByTransaction:"SELECT transaction_id,user_id,price_id,product_id,customer_id,paddle_status,completed_at,access_revoked_at,revocation_reason,created_at,updated_at FROM paddle_purchases WHERE transaction_id=?",
  pendingPurchaseForUser:"SELECT transaction_id,user_id,price_id,product_id,customer_id,paddle_status,completed_at,access_revoked_at,revocation_reason,created_at,updated_at FROM paddle_purchases WHERE user_id=? AND price_id=? AND paddle_status IN ('draft','ready','paid') AND completed_at IS NULL AND access_revoked_at IS NULL ORDER BY created_at DESC LIMIT 1",
  completePurchase:"UPDATE paddle_purchases SET customer_id=COALESCE(?,customer_id),paddle_status='completed',completed_at=COALESCE(completed_at,?),updated_at=MAX(updated_at,?) WHERE transaction_id=?",
  updatePurchaseStatus:"UPDATE paddle_purchases SET paddle_status=?,updated_at=? WHERE transaction_id=? AND paddle_status<>'completed' AND updated_at<=?",
  upsertAdjustment:"INSERT INTO paddle_adjustments(adjustment_id,transaction_id,action,type,status,occurred_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(adjustment_id) DO UPDATE SET action=excluded.action,type=excluded.type,status=excluded.status,occurred_at=excluded.occurred_at,updated_at=excluded.updated_at WHERE excluded.occurred_at>=paddle_adjustments.occurred_at",
  revokePurchase:"UPDATE paddle_purchases SET access_revoked_at=?,revocation_reason=?,updated_at=MAX(updated_at,?) WHERE transaction_id=? AND access_revoked_at IS NULL",
  hasDiscoveryAccess:"SELECT 1 AS active FROM paddle_purchases WHERE user_id=? AND (? IS NULL OR price_id=?) AND paddle_status='completed' AND completed_at IS NOT NULL AND access_revoked_at IS NULL LIMIT 1",
  discoveryAccessSummary:"SELECT COUNT(*) AS purchase_count,COALESCE(SUM(CASE WHEN paddle_status='completed' AND completed_at IS NOT NULL AND access_revoked_at IS NULL THEN 1 ELSE 0 END),0) AS active_purchase_count,COALESCE(SUM(CASE WHEN paddle_status IN ('draft','ready','paid') AND completed_at IS NULL AND access_revoked_at IS NULL THEN 1 ELSE 0 END),0) AS pending_purchase_count,MAX(CASE WHEN paddle_status='completed' AND access_revoked_at IS NULL THEN completed_at ELSE NULL END) AS latest_active_purchase_at,MAX(completed_at) AS latest_completed_at,MAX(access_revoked_at) AS latest_revoked_at FROM paddle_purchases WHERE user_id=? AND (? IS NULL OR price_id=?)",
  adjustmentById:"SELECT adjustment_id,transaction_id,action,type,status,occurred_at,updated_at FROM paddle_adjustments WHERE adjustment_id=?",
  webhookEvent:"SELECT event_id,notification_id,event_type,occurred_at,processed_at FROM paddle_webhook_events WHERE event_id=?",
  recordWebhookEvent:"INSERT INTO paddle_webhook_events(event_id,notification_id,event_type,occurred_at,processed_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING"
};

function plainValue(value) {
  return typeof value === "bigint" ? Number(value) : value;
}

function plainRow(row,columns) {
  if (row == null) return null;
  const namedColumns=Array.isArray(columns)
    ? columns.map((name,index) => ({name,index})).filter(({name}) => typeof name === "string" && name.length > 0)
    : [];
  if (namedColumns.length) {
    const source=Object(row),seen=new Set(),entries=[];
    for (const {name,index} of namedColumns) {
      if (seen.has(name)) continue;
      seen.add(name);
      const value=index in source?source[index]:source[name];
      entries.push([name,plainValue(value)]);
    }
    return Object.fromEntries(entries);
  }
  return Object.fromEntries(Object.entries(row).map(([key,value]) => [key,plainValue(value)]));
}

function plainRows(rows,columns) { return rows.map((row) => plainRow(row,columns)); }

function affectedRows(result) {
  return Number(result?.changes ?? result?.rowsAffected ?? 0);
}

function accessSummary(row) {
  const purchaseCount=Number(row?.purchase_count || 0);
  const activePurchaseCount=Number(row?.active_purchase_count || 0);
  const pendingPurchaseCount=Number(row?.pending_purchase_count || 0);
  return {
    active:activePurchaseCount>0,
    purchaseCount,
    activePurchaseCount,
    pendingPurchaseCount,
    latestActivePurchaseAt:row?.latest_active_purchase_at ?? null,
    latestCompletedAt:row?.latest_completed_at ?? null,
    latestRevokedAt:row?.latest_revoked_at ?? null
  };
}

async function probeConnection(query) {
  await query();
  return true;
}

function localStore(root) {
  const { DatabaseSync } = require("node:sqlite");
  const dataDir = process.env.STRATA_DATA_DIR || join(root,"data");
  mkdirSync(dataDir,{recursive:true});
  const db = new DatabaseSync(join(dataDir,"strata.sqlite"),{timeout:5000,enableForeignKeyConstraints:true});
  db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  for (const statement of SCHEMA) db.exec(statement);

  const statements = Object.fromEntries(Object.entries(SQL).map(([name,sql]) => [name,db.prepare(sql)]));
  return {
    kind:"local",
    async ping() { return probeConnection(() => statements.ping.get()); },
    async userByEmail(email) { return plainRow(statements.userByEmail.get(email)); },
    async userById(id) { return plainRow(statements.userById.get(id)); },
    async insertUser(user) { statements.insertUser.run(user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt); },
    async insertSession(session) { statements.insertSession.run(session.tokenHash,session.userId,session.csrfToken,session.expiresAt,session.createdAt); },
    async session(tokenHash,now) { return plainRow(statements.session.get(tokenHash,now)); },
    async deleteSession(tokenHash) { statements.deleteSession.run(tokenHash); },
    async deleteExpired(now) { statements.deleteExpired.run(now); },
    async plan(userId) { return plainRow(statements.plan.get(userId)); },
    async upsertPlan(userId,planJson,updatedAt) { statements.upsertPlan.run(userId,planJson,updatedAt); },
    async preferences(userId) { return plainRow(statements.preferences.get(userId)); },
    async upsertPreferences(userId,preferencesJson,updatedAt) { statements.upsertPreferences.run(userId,preferencesJson,updatedAt); },
    async ratingsForUser(userId) { return plainRows(statements.ratingsForUser.all(userId)); },
    async ratingAggregates() { return plainRows(statements.ratingAggregates.all()); },
    async ratingAggregate(exerciseId) { return plainRow(statements.ratingAggregate.get(exerciseId)); },
    async upsertRating(userId,exerciseId,rating,createdAt,updatedAt) { statements.upsertRating.run(userId,exerciseId,rating.comfort,rating.pump,rating.enjoyment,rating.stability,rating.setup,rating.overall,createdAt,updatedAt); },
    async insertPendingPurchase(purchase) {
      statements.insertPendingPurchase.run(purchase.transactionId,purchase.userId,purchase.priceId,purchase.productId,purchase.paddleStatus||"ready",purchase.createdAt,purchase.updatedAt);
      return plainRow(statements.purchaseByTransaction.get(purchase.transactionId));
    },
    async purchaseByTransaction(transactionId) { return plainRow(statements.purchaseByTransaction.get(transactionId)); },
    async pendingPurchaseForUser(userId,priceId) { return plainRow(statements.pendingPurchaseForUser.get(userId,priceId)); },
    async completePurchase(transactionId,completion) {
      statements.completePurchase.run(completion.customerId||null,completion.completedAt,completion.updatedAt,transactionId);
      return plainRow(statements.purchaseByTransaction.get(transactionId));
    },
    async updatePurchaseStatus(transactionId,status,occurredAt) {
      statements.updatePurchaseStatus.run(status,occurredAt,transactionId,occurredAt);
      return plainRow(statements.purchaseByTransaction.get(transactionId));
    },
    async upsertAdjustment(adjustment) {
      const result=statements.upsertAdjustment.run(adjustment.adjustmentId,adjustment.transactionId,adjustment.action,adjustment.type||null,adjustment.status,adjustment.occurredAt,adjustment.updatedAt);
      return affectedRows(result)>0;
    },
    async adjustmentById(adjustmentId) { return plainRow(statements.adjustmentById.get(adjustmentId)); },
    async revokePurchase(transactionId,reason,revokedAt,updatedAt) {
      statements.revokePurchase.run(revokedAt,reason,updatedAt,transactionId);
      return plainRow(statements.purchaseByTransaction.get(transactionId));
    },
    async hasDiscoveryAccess(userId,priceId=null) { return Boolean(statements.hasDiscoveryAccess.get(userId,priceId,priceId)); },
    async discoveryAccessSummary(userId,priceId=null) { return accessSummary(plainRow(statements.discoveryAccessSummary.get(userId,priceId,priceId))); },
    async webhookEvent(eventId) { return plainRow(statements.webhookEvent.get(eventId)); },
    async recordWebhookEvent(event) {
      return affectedRows(statements.recordWebhookEvent.run(event.eventId,event.notificationId||null,event.eventType,event.occurredAt,event.processedAt))>0;
    },
    async close() { db.close(); }
  };
}

async function tursoStore(url,authToken) {
  if (!authToken) throw new Error("TURSO_AUTH_TOKEN is required when TURSO_DATABASE_URL is set.");

  let createClient;
  try {
    ({ createClient } = await import("@tursodatabase/serverless/compat"));
  } catch (error) {
    throw new Error("Turso support is not installed. Run npm install before starting STRATA.",{cause:error});
  }

  const client = createClient({url,authToken});
  await client.execute("PRAGMA foreign_keys = ON");
  const foreignKeys=await client.execute("PRAGMA foreign_keys");
  const foreignKeyRow=plainRow(foreignKeys.rows[0],foreignKeys.columns);
  if (Number(foreignKeyRow?.foreign_keys??foreignKeyRow?.[0])!==1) {
    client.close();
    throw new Error("Turso foreign key enforcement could not be enabled.");
  }
  for (const statement of SCHEMA) await client.execute(statement);

  async function first(sql,args=[]) {
    const result = await client.execute({sql,args});
    return plainRow(result.rows[0],result.columns);
  }
  async function run(sql,args=[]) {
    return await client.execute({sql,args});
  }
  async function all(sql,args=[]) {
    const result = await client.execute({sql,args});
    return plainRows(result.rows,result.columns);
  }

  return {
    kind:"turso",
    // A successful query is the health signal. Some Turso-compatible row
    // implementations expose selected values only by numeric index, so the
    // probe must not depend on a particular row-object shape.
    ping:() => probeConnection(() => client.execute(SQL.ping)),
    userByEmail:(email) => first(SQL.userByEmail,[email]),
    userById:(id) => first(SQL.userById,[id]),
    insertUser:(user) => run(SQL.insertUser,[user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt]),
    insertSession:(session) => run(SQL.insertSession,[session.tokenHash,session.userId,session.csrfToken,session.expiresAt,session.createdAt]),
    session:(tokenHash,now) => first(SQL.session,[tokenHash,now]),
    deleteSession:(tokenHash) => run(SQL.deleteSession,[tokenHash]),
    deleteExpired:(now) => run(SQL.deleteExpired,[now]),
    plan:(userId) => first(SQL.plan,[userId]),
    upsertPlan:(userId,planJson,updatedAt) => run(SQL.upsertPlan,[userId,planJson,updatedAt]),
    preferences:(userId) => first(SQL.preferences,[userId]),
    upsertPreferences:(userId,preferencesJson,updatedAt) => run(SQL.upsertPreferences,[userId,preferencesJson,updatedAt]),
    ratingsForUser:(userId) => all(SQL.ratingsForUser,[userId]),
    ratingAggregates:() => all(SQL.ratingAggregates),
    ratingAggregate:(exerciseId) => first(SQL.ratingAggregate,[exerciseId]),
    upsertRating:(userId,exerciseId,rating,createdAt,updatedAt) => run(SQL.upsertRating,[userId,exerciseId,rating.comfort,rating.pump,rating.enjoyment,rating.stability,rating.setup,rating.overall,createdAt,updatedAt]),
    async insertPendingPurchase(purchase) {
      await run(SQL.insertPendingPurchase,[purchase.transactionId,purchase.userId,purchase.priceId,purchase.productId,purchase.paddleStatus||"ready",purchase.createdAt,purchase.updatedAt]);
      return first(SQL.purchaseByTransaction,[purchase.transactionId]);
    },
    purchaseByTransaction:(transactionId) => first(SQL.purchaseByTransaction,[transactionId]),
    pendingPurchaseForUser:(userId,priceId) => first(SQL.pendingPurchaseForUser,[userId,priceId]),
    async completePurchase(transactionId,completion) {
      await run(SQL.completePurchase,[completion.customerId||null,completion.completedAt,completion.updatedAt,transactionId]);
      return first(SQL.purchaseByTransaction,[transactionId]);
    },
    async updatePurchaseStatus(transactionId,status,occurredAt) {
      await run(SQL.updatePurchaseStatus,[status,occurredAt,transactionId,occurredAt]);
      return first(SQL.purchaseByTransaction,[transactionId]);
    },
    async upsertAdjustment(adjustment) {
      const result=await run(SQL.upsertAdjustment,[adjustment.adjustmentId,adjustment.transactionId,adjustment.action,adjustment.type||null,adjustment.status,adjustment.occurredAt,adjustment.updatedAt]);
      return affectedRows(result)>0;
    },
    adjustmentById:(adjustmentId) => first(SQL.adjustmentById,[adjustmentId]),
    async revokePurchase(transactionId,reason,revokedAt,updatedAt) {
      await run(SQL.revokePurchase,[revokedAt,reason,updatedAt,transactionId]);
      return first(SQL.purchaseByTransaction,[transactionId]);
    },
    async hasDiscoveryAccess(userId,priceId=null) { return Boolean(await first(SQL.hasDiscoveryAccess,[userId,priceId,priceId])); },
    async discoveryAccessSummary(userId,priceId=null) { return accessSummary(await first(SQL.discoveryAccessSummary,[userId,priceId,priceId])); },
    webhookEvent:(eventId) => first(SQL.webhookEvent,[eventId]),
    async recordWebhookEvent(event) {
      const result=await run(SQL.recordWebhookEvent,[event.eventId,event.notificationId||null,event.eventType,event.occurredAt,event.processedAt]);
      return affectedRows(result)>0;
    },
    async close() { client.close(); }
  };
}

async function createStore(root) {
  const tursoUrl = String(process.env.TURSO_DATABASE_URL || "").trim();
  if (tursoUrl) return tursoStore(tursoUrl,String(process.env.TURSO_AUTH_TOKEN || "").trim());
  if (process.env.NODE_ENV === "production") {
    throw new Error("Production requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN so accounts are not lost.");
  }
  return localStore(root);
}

function isUniqueViolation(error) {
  return /unique constraint|already exists/i.test(String(error?.message || ""));
}

module.exports = { createStore,isUniqueViolation,plainRow,probeConnection };
