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
    created_at INTEGER NOT NULL,
    email_verified_at INTEGER
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
  `CREATE TABLE IF NOT EXISTS signup_verifications (
    challenge_id TEXT PRIMARY KEY,
    browser_token_hash TEXT NOT NULL UNIQUE,
    user_id TEXT NOT NULL,
    purpose TEXT NOT NULL DEFAULT 'signup' CHECK(purpose IN ('signup','login')),
    email TEXT NOT NULL COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    password_salt TEXT NOT NULL,
    code_digest TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 1),
    attempts_used INTEGER NOT NULL DEFAULT 0 CHECK(attempts_used >= 0),
    send_count INTEGER NOT NULL DEFAULT 0 CHECK(send_count >= 0),
    last_sent_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    hard_expires_at INTEGER NOT NULL,
    delivery_state TEXT NOT NULL,
    consumed_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    CHECK(expires_at <= hard_expires_at)
  )`,
  "CREATE INDEX IF NOT EXISTS signup_verifications_user_id_idx ON signup_verifications(user_id)",
  "CREATE INDEX IF NOT EXISTS signup_verifications_email ON signup_verifications(email,consumed_at,created_at)",
  "CREATE INDEX IF NOT EXISTS signup_verifications_expiry ON signup_verifications(hard_expires_at,consumed_at)",
  `CREATE TABLE IF NOT EXISTS email_verification_sends (
    send_id TEXT PRIMARY KEY,
    email_hash TEXT NOT NULL,
    challenge_id TEXT NOT NULL,
    generation INTEGER NOT NULL CHECK(generation >= 1),
    sent_at INTEGER NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS email_verification_sends_email_time ON email_verification_sends(email_hash,sent_at)",
  "CREATE INDEX IF NOT EXISTS email_verification_sends_time ON email_verification_sends(sent_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS email_verification_sends_challenge_generation ON email_verification_sends(challenge_id,generation)",
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
  userById:"SELECT id,name,email,created_at,email_verified_at FROM users WHERE id = ?",
  insertUser:"INSERT INTO users(id,name,email,password_hash,password_salt,created_at,email_verified_at) VALUES(?,?,?,?,?,?,?)",
  insertSession:"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) VALUES(?,?,?,?,?)",
  session:"SELECT s.token_hash,s.csrf_token,s.expires_at,u.id,u.name,u.email,u.created_at,u.email_verified_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?",
  deleteSession:"DELETE FROM sessions WHERE token_hash=?",
  deleteExpired:"DELETE FROM sessions WHERE expires_at<=?",
  verificationByTokenHash:"SELECT challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at FROM signup_verifications WHERE browser_token_hash=?",
  verificationByChallenge:"SELECT challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at FROM signup_verifications WHERE challenge_id=?",
  insertVerification:"INSERT INTO signup_verifications(challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,?,?)",
  rotateVerification:"UPDATE signup_verifications SET code_digest=?,generation=generation+1,attempts_used=0,send_count=send_count+1,last_sent_at=?,expires_at=?,delivery_state=?,updated_at=? WHERE challenge_id=? AND generation=? AND consumed_at IS NULL RETURNING challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at",
  markVerificationDelivery:"UPDATE signup_verifications SET delivery_state=?,updated_at=? WHERE challenge_id=? AND generation=? AND consumed_at IS NULL RETURNING challenge_id",
  claimVerificationAttempt:"UPDATE signup_verifications SET attempts_used=attempts_used+1,updated_at=? WHERE challenge_id=? AND generation=? AND consumed_at IS NULL AND expires_at>? AND hard_expires_at>? AND attempts_used<? RETURNING challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at",
  consumeVerification:"UPDATE signup_verifications SET code_digest='',password_hash='',password_salt='',delivery_state='consumed',consumed_at=?,updated_at=? WHERE challenge_id=? AND generation=? AND consumed_at IS NULL RETURNING challenge_id,browser_token_hash,user_id,purpose,email,name,password_hash,password_salt,code_digest,generation,attempts_used,send_count,last_sent_at,expires_at,hard_expires_at,delivery_state,consumed_at,created_at,updated_at",
  completeSignupInsert:"INSERT INTO users(id,name,email,password_hash,password_salt,created_at,email_verified_at) SELECT user_id,name,email,password_hash,password_salt,?,? FROM signup_verifications WHERE challenge_id=? AND generation=? AND purpose='signup' AND consumed_at IS NULL AND expires_at>? AND hard_expires_at>? RETURNING id,name,email,created_at,email_verified_at",
  completeSignupConsume:"UPDATE signup_verifications SET code_digest='',password_hash='',password_salt='',delivery_state='consumed',consumed_at=?,updated_at=? WHERE changes()=1 AND challenge_id=? AND generation=? AND purpose='signup' AND consumed_at IS NULL AND expires_at>? AND hard_expires_at>? RETURNING challenge_id",
  completeSignupSession:"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) SELECT ?,user_id,?,?,? FROM signup_verifications WHERE changes()=1 AND challenge_id=? AND generation=? AND purpose='signup' AND consumed_at=? RETURNING token_hash",
  completeLoginVerifyUser:"UPDATE users SET email_verified_at=? WHERE email_verified_at IS NULL AND id=(SELECT user_id FROM signup_verifications WHERE challenge_id=? AND generation=? AND purpose='login' AND consumed_at IS NULL AND expires_at>? AND hard_expires_at>?) RETURNING id,name,email,created_at,email_verified_at",
  completeLoginConsume:"UPDATE signup_verifications SET code_digest='',password_hash='',password_salt='',delivery_state='consumed',consumed_at=?,updated_at=? WHERE changes()=1 AND challenge_id=? AND generation=? AND purpose='login' AND consumed_at IS NULL AND expires_at>? AND hard_expires_at>? RETURNING challenge_id",
  completeLoginSession:"INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at,created_at) SELECT ?,user_id,?,?,? FROM signup_verifications WHERE changes()=1 AND challenge_id=? AND generation=? AND purpose='login' AND consumed_at=? RETURNING token_hash",
  completeLoginDeleteOldSessions:"DELETE FROM sessions WHERE changes()=1 AND user_id=(SELECT user_id FROM signup_verifications WHERE challenge_id=? AND generation=? AND purpose='login' AND consumed_at=?) AND token_hash<>? RETURNING token_hash",
  countVerificationSends:"SELECT COUNT(*) AS send_count FROM email_verification_sends WHERE email_hash=? AND sent_at>=?",
  recordVerificationSend:"INSERT INTO email_verification_sends(send_id,email_hash,challenge_id,generation,sent_at) VALUES(?,?,?,?,?)",
  claimVerificationSend:"INSERT OR IGNORE INTO email_verification_sends(send_id,email_hash,challenge_id,generation,sent_at) SELECT ?,?,?,?,? WHERE (SELECT COUNT(*) FROM email_verification_sends WHERE email_hash=? AND sent_at>=?)<? RETURNING send_id",
  verificationSendByChallengeGeneration:"SELECT send_id,email_hash,challenge_id,generation,sent_at FROM email_verification_sends WHERE challenge_id=? AND generation=?",
  deleteOldVerifications:"DELETE FROM signup_verifications WHERE hard_expires_at<=? OR (consumed_at IS NOT NULL AND consumed_at<=?)",
  deleteOldVerificationSends:"DELETE FROM email_verification_sends WHERE sent_at<?",
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
  upsertAdjustment:"INSERT INTO paddle_adjustments(adjustment_id,transaction_id,action,type,status,occurred_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(adjustment_id) DO UPDATE SET action=excluded.action,type=excluded.type,status=excluded.status,occurred_at=excluded.occurred_at,updated_at=excluded.updated_at WHERE excluded.occurred_at>=paddle_adjustments.occurred_at RETURNING adjustment_id",
  revokePurchase:"UPDATE paddle_purchases SET access_revoked_at=?,revocation_reason=?,updated_at=MAX(updated_at,?) WHERE transaction_id=? AND access_revoked_at IS NULL",
  hasDiscoveryAccess:"SELECT 1 AS active FROM paddle_purchases WHERE user_id=? AND (? IS NULL OR price_id=?) AND paddle_status='completed' AND completed_at IS NOT NULL AND access_revoked_at IS NULL LIMIT 1",
  discoveryAccessSummary:"SELECT COUNT(*) AS purchase_count,COALESCE(SUM(CASE WHEN paddle_status='completed' AND completed_at IS NOT NULL AND access_revoked_at IS NULL THEN 1 ELSE 0 END),0) AS active_purchase_count,COALESCE(SUM(CASE WHEN paddle_status IN ('draft','ready','paid') AND completed_at IS NULL AND access_revoked_at IS NULL THEN 1 ELSE 0 END),0) AS pending_purchase_count,MAX(CASE WHEN paddle_status='completed' AND access_revoked_at IS NULL THEN completed_at ELSE NULL END) AS latest_active_purchase_at,MAX(completed_at) AS latest_completed_at,MAX(access_revoked_at) AS latest_revoked_at FROM paddle_purchases WHERE user_id=? AND (? IS NULL OR price_id=?)",
  adjustmentById:"SELECT adjustment_id,transaction_id,action,type,status,occurred_at,updated_at FROM paddle_adjustments WHERE adjustment_id=?",
  webhookEvent:"SELECT event_id,notification_id,event_type,occurred_at,processed_at FROM paddle_webhook_events WHERE event_id=?",
  recordWebhookEvent:"INSERT INTO paddle_webhook_events(event_id,notification_id,event_type,occurred_at,processed_at) VALUES(?,?,?,?,?) ON CONFLICT(event_id) DO NOTHING RETURNING event_id"
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

function localColumnNames(db,table) {
  return new Set(db.prepare(`PRAGMA table_info(${table})`).all().map((row) => String(row.name)));
}

function addLocalColumn(db,table,column,declaration) {
  if (localColumnNames(db,table).has(column)) return;
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  } catch(error) {
    // A second process may have completed the same additive migration after
    // our schema probe. Only suppress the error when the column now exists.
    if (!localColumnNames(db,table).has(column)) throw error;
  }
}

function migrateLocalSchema(db) {
  addLocalColumn(db,"users","email_verified_at","INTEGER");
  // Turso/SQLite require a table rebuild to add a CHECK-constrained column to
  // a populated table. Runtime validation below preserves the invariant while
  // keeping this upgrade additive for existing verification rows.
  addLocalColumn(db,"signup_verifications","purpose","TEXT NOT NULL DEFAULT 'signup'");
  db.exec("DROP INDEX IF EXISTS signup_verifications_user_id");
  db.exec("CREATE INDEX IF NOT EXISTS signup_verifications_user_id_idx ON signup_verifications(user_id)");
}

async function tursoColumnNames(client,table) {
  const result=await client.execute(`PRAGMA table_info(${table})`);
  return new Set(plainRows(result.rows,result.columns).map((row) => String(row.name)));
}

async function addTursoColumn(client,table,column,declaration) {
  if ((await tursoColumnNames(client,table)).has(column)) return;
  try {
    await client.execute(`ALTER TABLE ${table} ADD COLUMN ${column} ${declaration}`);
  } catch(error) {
    if (!(await tursoColumnNames(client,table)).has(column)) throw error;
  }
}

async function migrateTursoSchema(client) {
  await addTursoColumn(client,"users","email_verified_at","INTEGER");
  await addTursoColumn(client,"signup_verifications","purpose","TEXT NOT NULL DEFAULT 'signup'");
  await client.execute("DROP INDEX IF EXISTS signup_verifications_user_id");
  await client.execute("CREATE INDEX IF NOT EXISTS signup_verifications_user_id_idx ON signup_verifications(user_id)");
}

function affectedRows(result) {
  return Number(result?.changes ?? result?.rowsAffected ?? 0);
}

const CONSUMED_VERIFICATION_RETENTION_MS = 60 * 60 * 1000;
const VERIFICATION_SEND_RETENTION_MS = 24 * 60 * 60 * 1000;

function verificationInsertArgs(verification) {
  const purpose=verification.purpose??"signup";
  if (purpose!=="signup"&&purpose!=="login") throw new TypeError("Verification purpose must be signup or login.");
  return [
    verification.challengeId,
    verification.browserTokenHash,
    verification.userId,
    purpose,
    verification.email,
    verification.name,
    verification.passwordHash,
    verification.passwordSalt,
    verification.codeDigest,
    Number(verification.generation ?? 1),
    Number(verification.attemptsUsed ?? 0),
    Number(verification.sendCount ?? 0),
    Number(verification.lastSentAt),
    Number(verification.expiresAt),
    Number(verification.hardExpiresAt),
    verification.deliveryState,
    Number(verification.createdAt),
    Number(verification.updatedAt)
  ];
}

function verificationRotationArgs(challengeId,currentGeneration,rotation) {
  return [
    rotation.codeDigest,
    Number(rotation.lastSentAt),
    Number(rotation.expiresAt),
    rotation.deliveryState,
    Number(rotation.updatedAt),
    challengeId,
    Number(currentGeneration)
  ];
}

function verificationSendArgs(send) {
  return [send.id,send.emailHash,send.challengeId,Number(send.generation),Number(send.sentAt)];
}

function verificationSendClaimArgs(send,since,maxSends) {
  return [...verificationSendArgs(send),send.emailHash,Number(since),Number(maxSends)];
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
  migrateLocalSchema(db);

  const statements = Object.fromEntries(Object.entries(SQL).map(([name,sql]) => [name,db.prepare(sql)]));
  return {
    kind:"local",
    async ping() { return probeConnection(() => statements.ping.get()); },
    async userByEmail(email) { return plainRow(statements.userByEmail.get(email)); },
    async userById(id) { return plainRow(statements.userById.get(id)); },
    async insertUser(user) { statements.insertUser.run(user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt,user.emailVerifiedAt??user.email_verified_at??null); },
    async insertSession(session) { statements.insertSession.run(session.tokenHash,session.userId,session.csrfToken,session.expiresAt,session.createdAt); },
    async session(tokenHash,now) { return plainRow(statements.session.get(tokenHash,now)); },
    async deleteSession(tokenHash) { statements.deleteSession.run(tokenHash); },
    async deleteExpired(now) { statements.deleteExpired.run(now); },
    async verificationByTokenHash(tokenHash) { return plainRow(statements.verificationByTokenHash.get(tokenHash)); },
    async insertVerification(verification) {
      statements.insertVerification.run(...verificationInsertArgs(verification));
      return plainRow(statements.verificationByChallenge.get(verification.challengeId));
    },
    async rotateVerification(challengeId,currentGeneration,rotation) {
      return plainRow(statements.rotateVerification.get(...verificationRotationArgs(challengeId,currentGeneration,rotation)));
    },
    async markVerificationDelivery(challengeId,generation,state,updatedAt) {
      return Boolean(plainRow(statements.markVerificationDelivery.get(state,updatedAt,challengeId,generation)));
    },
    async claimVerificationAttempt(challengeId,generation,updatedAt,maxAttempts=5) {
      return plainRow(statements.claimVerificationAttempt.get(updatedAt,challengeId,generation,updatedAt,updatedAt,maxAttempts));
    },
    async consumeVerification(challengeId,generation,consumedAt) {
      return plainRow(statements.consumeVerification.get(consumedAt,consumedAt,challengeId,generation));
    },
    async completeSignup(challengeId,generation,createdAt,session) {
      if (!session||!session.tokenHash||!session.csrfToken) throw new TypeError("A session is required to complete signup.");
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const user=plainRow(statements.completeSignupInsert.get(createdAt,createdAt,challengeId,generation,createdAt,createdAt));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        const consumed=plainRow(statements.completeSignupConsume.get(createdAt,createdAt,challengeId,generation,createdAt,createdAt));
        if (!consumed) throw new Error("Verification could not be consumed atomically.");
        const insertedSession=plainRow(statements.completeSignupSession.get(session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,challengeId,generation,createdAt));
        if (!insertedSession) throw new Error("Verification session could not be created atomically.");
        db.exec("COMMIT");
        transactionOpen=false;
        return user;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async completeLoginVerification(challengeId,generation,verifiedAt,session) {
      if (!session||!session.tokenHash||!session.csrfToken) throw new TypeError("A session is required to complete login verification.");
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const user=plainRow(statements.completeLoginVerifyUser.get(verifiedAt,challengeId,generation,verifiedAt,verifiedAt));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        const consumed=plainRow(statements.completeLoginConsume.get(verifiedAt,verifiedAt,challengeId,generation,verifiedAt,verifiedAt));
        if (!consumed) throw new Error("Login verification could not be consumed atomically.");
        const insertedSession=plainRow(statements.completeLoginSession.get(session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,challengeId,generation,verifiedAt));
        if (!insertedSession) throw new Error("Verified login session could not be created atomically.");
        // Only the freshly verified session should survive. The changes()
        // guard binds this cleanup to the session insert above, so a stale
        // sibling challenge cannot delete the winning session.
        statements.completeLoginDeleteOldSessions.all(challengeId,generation,verifiedAt,session.tokenHash);
        db.exec("COMMIT");
        transactionOpen=false;
        return user;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async countVerificationSends(emailHash,since) {
      return Number(plainRow(statements.countVerificationSends.get(emailHash,since))?.send_count||0);
    },
    async recordVerificationSend(send) {
      statements.recordVerificationSend.run(...verificationSendArgs(send));
    },
    async claimVerificationSend(send,since,maxSends) {
      return Boolean(plainRow(statements.claimVerificationSend.get(...verificationSendClaimArgs(send,since,maxSends))));
    },
    async verificationSendByChallengeGeneration(challengeId,generation) {
      return plainRow(statements.verificationSendByChallengeGeneration.get(challengeId,generation));
    },
    async deleteOldVerificationData(now,sendBefore=now-VERIFICATION_SEND_RETENTION_MS) {
      const consumedBefore=now-CONSUMED_VERIFICATION_RETENTION_MS;
      const verifications=affectedRows(statements.deleteOldVerifications.run(now,consumedBefore));
      const sends=affectedRows(statements.deleteOldVerificationSends.run(sendBefore));
      return {verifications,sends};
    },
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
      return Boolean(plainRow(statements.upsertAdjustment.get(adjustment.adjustmentId,adjustment.transactionId,adjustment.action,adjustment.type||null,adjustment.status,adjustment.occurredAt,adjustment.updatedAt)));
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
      return Boolean(plainRow(statements.recordWebhookEvent.get(event.eventId,event.notificationId||null,event.eventType,event.occurredAt,event.processedAt)));
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
  await migrateTursoSchema(client);

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
    insertUser:(user) => run(SQL.insertUser,[user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt,user.emailVerifiedAt??user.email_verified_at??null]),
    insertSession:(session) => run(SQL.insertSession,[session.tokenHash,session.userId,session.csrfToken,session.expiresAt,session.createdAt]),
    session:(tokenHash,now) => first(SQL.session,[tokenHash,now]),
    deleteSession:(tokenHash) => run(SQL.deleteSession,[tokenHash]),
    deleteExpired:(now) => run(SQL.deleteExpired,[now]),
    verificationByTokenHash:(tokenHash) => first(SQL.verificationByTokenHash,[tokenHash]),
    async insertVerification(verification) {
      await run(SQL.insertVerification,verificationInsertArgs(verification));
      return first(SQL.verificationByChallenge,[verification.challengeId]);
    },
    async rotateVerification(challengeId,currentGeneration,rotation) {
      const result=await run(SQL.rotateVerification,verificationRotationArgs(challengeId,currentGeneration,rotation));
      return plainRow(result.rows?.[0],result.columns);
    },
    async markVerificationDelivery(challengeId,generation,state,updatedAt) {
      const result=await run(SQL.markVerificationDelivery,[state,updatedAt,challengeId,generation]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async claimVerificationAttempt(challengeId,generation,updatedAt,maxAttempts=5) {
      const result=await run(SQL.claimVerificationAttempt,[updatedAt,challengeId,generation,updatedAt,updatedAt,maxAttempts]);
      return plainRow(result.rows[0],result.columns);
    },
    async consumeVerification(challengeId,generation,consumedAt) {
      const result=await run(SQL.consumeVerification,[consumedAt,consumedAt,challengeId,generation]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async completeSignup(challengeId,generation,createdAt,session) {
      if (!session||!session.tokenHash||!session.csrfToken) throw new TypeError("A session is required to complete signup.");
      const verification=await first(SQL.verificationByChallenge,[challengeId]);
      if (!verification||Number(verification.generation)!==Number(generation)||verification.consumed_at!=null) return null;
      const results=await client.batch([
        {sql:SQL.completeSignupInsert,args:[createdAt,createdAt,challengeId,generation,createdAt,createdAt]},
        {sql:SQL.completeSignupConsume,args:[createdAt,createdAt,challengeId,generation,createdAt,createdAt]},
        {sql:SQL.completeSignupSession,args:[session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,challengeId,generation,createdAt]}
      ],"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!user) return null;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Verification could not be consumed atomically.");
      if (!plainRow(results[2]?.rows?.[0],results[2]?.columns)) throw new Error("Verification session could not be created atomically.");
      return user;
    },
    async completeLoginVerification(challengeId,generation,verifiedAt,session) {
      if (!session||!session.tokenHash||!session.csrfToken) throw new TypeError("A session is required to complete login verification.");
      const verification=await first(SQL.verificationByChallenge,[challengeId]);
      if (!verification||verification.purpose!=="login"||Number(verification.generation)!==Number(generation)||verification.consumed_at!=null) return null;
      const results=await client.batch([
        {sql:SQL.completeLoginVerifyUser,args:[verifiedAt,challengeId,generation,verifiedAt,verifiedAt]},
        {sql:SQL.completeLoginConsume,args:[verifiedAt,verifiedAt,challengeId,generation,verifiedAt,verifiedAt]},
        {sql:SQL.completeLoginSession,args:[session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,challengeId,generation,verifiedAt]},
        {sql:SQL.completeLoginDeleteOldSessions,args:[challengeId,generation,verifiedAt,session.tokenHash]}
      ],"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!user) return null;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Login verification could not be consumed atomically.");
      if (!plainRow(results[2]?.rows?.[0],results[2]?.columns)) throw new Error("Verified login session could not be created atomically.");
      return user;
    },
    async countVerificationSends(emailHash,since) {
      return Number((await first(SQL.countVerificationSends,[emailHash,since]))?.send_count||0);
    },
    recordVerificationSend:(send) => run(SQL.recordVerificationSend,verificationSendArgs(send)),
    async claimVerificationSend(send,since,maxSends) {
      const result=await run(SQL.claimVerificationSend,verificationSendClaimArgs(send,since,maxSends));
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    verificationSendByChallengeGeneration:(challengeId,generation) => first(SQL.verificationSendByChallengeGeneration,[challengeId,generation]),
    async deleteOldVerificationData(now,sendBefore=now-VERIFICATION_SEND_RETENTION_MS) {
      const consumedBefore=now-CONSUMED_VERIFICATION_RETENTION_MS;
      const results=await client.batch([
        {sql:SQL.deleteOldVerifications,args:[now,consumedBefore]},
        {sql:SQL.deleteOldVerificationSends,args:[sendBefore]}
      ],"write");
      return {verifications:affectedRows(results[0]),sends:affectedRows(results[1])};
    },
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
      return Boolean(plainRow(result.rows?.[0],result.columns));
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
      return Boolean(plainRow(result.rows?.[0],result.columns));
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
