"use strict";

const { mkdirSync } = require("node:fs");
const { join } = require("node:path");
const { SCHEMA,SQL } = require("./schema");
const { defineStore } = require("./store-contract");

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
  addLocalColumn(db,"users","auth_version","INTEGER NOT NULL DEFAULT 1");
  addLocalColumn(db,"users","suspended_at","INTEGER");
  addLocalColumn(db,"sessions","auth_version","INTEGER NOT NULL DEFAULT 1");
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
  await addTursoColumn(client,"users","auth_version","INTEGER NOT NULL DEFAULT 1");
  await addTursoColumn(client,"users","suspended_at","INTEGER");
  await addTursoColumn(client,"sessions","auth_version","INTEGER NOT NULL DEFAULT 1");
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

function accountActionArgs(action) {
  if (action.purpose!=="password_reset"&&action.purpose!=="account_delete") {
    throw new TypeError("Account action purpose must be password_reset or account_delete.");
  }
  return [
    action.requestId,
    action.userId,
    action.purpose,
    action.tokenHash,
    Number(action.expiresAt),
    action.deliveryState,
    Number(action.createdAt),
    Number(action.updatedAt)
  ];
}

function stagedAccountActionArgs(action) {
  if (action.purpose!=="password_reset"&&action.purpose!=="account_delete") {
    throw new TypeError("Account action purpose must be password_reset or account_delete.");
  }
  return [
    action.requestId,
    action.userId,
    action.purpose,
    action.tokenHash,
    Number(action.expiresAt),
    Number(action.createdAt)
  ];
}

function accountActionSendArgs(send,since,maxSends) {
  if (send.purpose!=="password_reset"&&send.purpose!=="account_delete") {
    throw new TypeError("Account action send purpose must be password_reset or account_delete.");
  }
  return [
    send.id,
    send.emailHash,
    send.purpose,
    Number(send.sentAt),
    send.emailHash,
    send.purpose,
    Number(since),
    Number(maxSends)
  ];
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

function likePattern(value) {
  return `%${String(value||"").toLowerCase().replace(/[\\%_]/g,(character)=>`\\${character}`)}%`;
}

function adminSearchArgs(query) {
  const clean=String(query||"").trim().toLowerCase();
  const pattern=likePattern(clean);
  return [clean,pattern,pattern,pattern,pattern];
}

function adminAuditArgs(event) {
  return [event.id,event.actorUserId,event.targetUserId||null,event.action,event.reason,event.result||"success",Number(event.createdAt)];
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
  return defineStore("local",{
    async ping() { return probeConnection(() => statements.ping.get()); },
    async userByEmail(email) { return plainRow(statements.userByEmail.get(email)); },
    async userById(id) { return plainRow(statements.userById.get(id)); },
    async accountCredentialsById(id) { return plainRow(statements.accountCredentialsById.get(id)); },
    async insertUser(user) { statements.insertUser.run(user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt,user.emailVerifiedAt??user.email_verified_at??null); },
    async insertSession(session) {
      return Boolean(plainRow(statements.insertSession.get(session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,session.userId,Number(session.authVersion??1))));
    },
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
    async accountActionByTokenHash(tokenHash) { return plainRow(statements.accountActionByTokenHash.get(tokenHash)); },
    async accountActionForUser(userId,purpose) { return plainRow(statements.accountActionForUser.get(userId,purpose)); },
    async upsertAccountAction(action) { return plainRow(statements.upsertAccountAction.get(...accountActionArgs(action))); },
    async markAccountActionDelivery(requestId,tokenHash,state,updatedAt) {
      return Boolean(plainRow(statements.markAccountActionDelivery.get(state,updatedAt,requestId,tokenHash)));
    },
    async stageAccountAction(action) {
      return plainRow(statements.stageAccountAction.get(...stagedAccountActionArgs(action)));
    },
    async activateAccountAction(requestId,tokenHash,activatedAt) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const action=plainRow(statements.activateAccountAction.get(activatedAt,requestId,tokenHash,activatedAt));
        if (!action) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        if (!plainRow(statements.discardStagedAccountAction.get(requestId,tokenHash))) {
          throw new Error("Staged account action could not be consumed atomically.");
        }
        db.exec("COMMIT");
        transactionOpen=false;
        return action;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async discardStagedAccountAction(requestId,tokenHash) {
      return Boolean(plainRow(statements.discardStagedAccountAction.get(requestId,tokenHash)));
    },
    async claimAccountActionSend(send,since,maxSends) {
      return Boolean(plainRow(statements.claimAccountActionSend.get(...accountActionSendArgs(send,since,maxSends))));
    },
    async countAccountActionSends(emailHash,purpose,since) {
      return Number(plainRow(statements.countAccountActionSends.get(emailHash,purpose,since))?.send_count||0);
    },
    async activeAccountDeletion(userId,now) { return plainRow(statements.activeAccountDeletion.get(userId,now)); },
    async cancelAccountDeletion(userId) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const active=plainRow(statements.cancelAccountDeletion.get(userId));
        const staged=plainRows(statements.cancelStagedAccountDeletions.all(userId));
        db.exec("COMMIT");
        transactionOpen=false;
        return Boolean(active||staged.length);
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async cancelAccountDeletionWithAudit(userId,audit) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const active=plainRow(statements.cancelAccountDeletion.get(userId));
        if (!active) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return false;
        }
        if (!plainRow(statements.insertAdminAuditIfChanged.get(...adminAuditArgs(audit)))) throw new Error("Deletion-cancellation audit could not be recorded atomically.");
        statements.cancelStagedAccountDeletionsIfAudit.all(userId,audit.id);
        db.exec("COMMIT");
        transactionOpen=false;
        return true;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async completePasswordReset(tokenHash,passwordHash,passwordSalt,completedAt) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const action=plainRow(statements.accountActionByTokenHash.get(tokenHash));
        if (!action||action.purpose!=="password_reset"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=completedAt) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        const user=plainRow(statements.completePasswordResetUser.get(passwordHash,passwordSalt,completedAt,tokenHash,completedAt));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        const consumed=plainRow(statements.completePasswordResetConsume.get(completedAt,completedAt,tokenHash,completedAt));
        if (!consumed) throw new Error("Password reset could not be consumed atomically.");
        statements.completePasswordResetDeleteSessions.all(tokenHash,completedAt);
        statements.completePasswordResetDeleteStagedActions.all(tokenHash,completedAt);
        statements.completePasswordResetDeleteActions.all(tokenHash,completedAt);
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
    async pendingPurchasesForUser(userId) {
      return Number(plainRow(statements.pendingPurchasesForUser.get(userId))?.pending_count||0);
    },
    async unsettledPurchasesForUser(userId) { return plainRows(statements.unsettledPurchasesForUser.all(userId)); },
    async activeCheckoutCreationForUser(userId,now) { return plainRow(statements.activeCheckoutCreationForUser.get(userId,now)); },
    async deleteAccount(tokenHash,deletedAt,emailHash) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const action=plainRow(statements.accountActionByTokenHash.get(tokenHash));
        if (!action||action.purpose!=="account_delete"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=deletedAt) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return {status:"invalid"};
        }
        if (Number(plainRow(statements.pendingPurchasesForUser.get(action.user_id))?.pending_count||0)>0) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return {status:"purchase_pending"};
        }
        if (plainRow(statements.activeCheckoutCreationForUser.get(action.user_id,deletedAt))) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return {status:"checkout_pending"};
        }
        const user=plainRow(statements.deleteUserWithAction.get(tokenHash,deletedAt,deletedAt));
        if (!user) throw new Error("Account deletion did not remove the requested user.");
        // Keep deletion complete even if a future database connection loses
        // its per-session foreign-key PRAGMA state.
        statements.deleteCommunityPlanForDeletedUser.get(user.id,user.id);
        statements.deleteCheckoutClaimsForDeletedUser.all(user.id,user.id);
        statements.deleteVerificationSendsForDeletedUser.run(user.id,user.email,user.id);
        statements.deleteVerificationsForDeletedUser.run(user.id,user.email,user.id);
        statements.deleteActionSendsForDeletedUser.run(emailHash,user.id);
        db.exec("COMMIT");
        transactionOpen=false;
        return {status:"deleted",user};
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async deleteOldAccountActionData(now,sendBefore=now-VERIFICATION_SEND_RETENTION_MS) {
      const consumedBefore=now-CONSUMED_VERIFICATION_RETENTION_MS;
      const actions=affectedRows(statements.deleteOldAccountActions.run(now,consumedBefore));
      const staged=affectedRows(statements.deleteOldStagedAccountActions.run(now));
      const sends=affectedRows(statements.deleteOldAccountActionSends.run(sendBefore));
      return {actions:actions+staged,sends};
    },
    async plan(userId) { return plainRow(statements.plan.get(userId)); },
    async upsertPlan(userId,planJson,updatedAt,expectedUpdatedAt) {
      return plainRow(statements.upsertPlan.get(planJson,updatedAt,userId,expectedUpdatedAt,expectedUpdatedAt,expectedUpdatedAt,expectedUpdatedAt));
    },
    async communityWeeklyPlans(limit,offset) { return plainRows(statements.communityWeeklyPlans.all(limit,offset)); },
    async communityWeeklyPlan(id) { return plainRow(statements.communityWeeklyPlan.get(id)); },
    async communityWeeklyPlansForUser(userId) { return plainRows(statements.communityWeeklyPlansForUser.all(userId)); },
    async communityWeeklyPlanForOwner(id,userId) { return plainRow(statements.communityWeeklyPlanForOwner.get(id,userId)); },
    async upsertCommunityWeeklyPlan(plan) {
      return plainRow(statements.upsertCommunityWeeklyPlan.get(
        plan.id,plan.title,plan.description,plan.planJson,plan.isPublished?1:0,
        plan.createdAt,plan.updatedAt,plan.userId
      ));
    },
    async upsertCommunityWeeklyPlanFromPlan(plan) {
      return plainRow(statements.upsertCommunityWeeklyPlanFromPlan.get(
        plan.id,plan.title,plan.description,plan.isPublished?1:0,
        plan.createdAt,plan.updatedAt,plan.userId,plan.expectedPlanUpdatedAt,plan.storedPlanJson
      ));
    },
    async setCommunityWeeklyPlanPublished(id,userId,isPublished,updatedAt) {
      return plainRow(statements.setCommunityWeeklyPlanPublished.get(isPublished?1:0,updatedAt,id,userId));
    },
    async deleteCommunityWeeklyPlan(id,userId) { return Boolean(plainRow(statements.deleteCommunityWeeklyPlan.get(id,userId))); },
    async applyCommunityWeeklyPlan({id,userId,sourceUpdatedAt,targetUpdatedAt,planJson,storedPlanJson,updatedAt}) {
      return plainRow(statements.applyCommunityWeeklyPlan.get(
        planJson,updatedAt,userId,id,sourceUpdatedAt,storedPlanJson,targetUpdatedAt
      ));
    },
    async monthlyPlan(userId) { return plainRow(statements.monthlyPlan.get(userId)); },
    async upsertMonthlyPlan(userId,planJson,updatedAt) { statements.upsertMonthlyPlan.run(userId,planJson,updatedAt); },
    async preferences(userId) { return plainRow(statements.preferences.get(userId)); },
    async upsertPreferences(userId,preferencesJson,updatedAt) { statements.upsertPreferences.run(userId,preferencesJson,updatedAt); },
    async ratingsForUser(userId) { return plainRows(statements.ratingsForUser.all(userId)); },
    async ratingAggregates() { return plainRows(statements.ratingAggregates.all()); },
    async ratingAggregate(exerciseId) { return plainRow(statements.ratingAggregate.get(exerciseId)); },
    async upsertRating(userId,exerciseId,rating,createdAt,updatedAt) { statements.upsertRating.run(userId,exerciseId,rating.comfort,rating.pump,rating.enjoyment,rating.stability,rating.setup,rating.overall,createdAt,updatedAt); },
    async insertPendingPurchase(purchase) {
      return plainRow(statements.insertPendingPurchase.get(purchase.transactionId,purchase.priceId,purchase.productId,purchase.paddleStatus||"ready",purchase.createdAt,purchase.updatedAt,purchase.userId,purchase.updatedAt));
    },
    async checkoutCreationForUser(userId) { return plainRow(statements.checkoutCreationForUser.get(userId)); },
    async claimCheckoutCreation({userId,priceId,claimId,expiresAt,now}) {
      return plainRow(statements.claimCheckoutCreation.get(priceId,claimId,expiresAt,now,now,userId,now,now));
    },
    async recordCheckoutCreationTransaction(userId,claimId,transactionId,updatedAt) {
      return plainRow(statements.recordCheckoutCreationTransaction.get(transactionId,updatedAt,userId,claimId,transactionId));
    },
    async extendCheckoutCreation(userId,claimId,expiresAt,updatedAt) {
      return plainRow(statements.extendCheckoutCreation.get(expiresAt,updatedAt,userId,claimId));
    },
    async releaseCheckoutCreation(userId,claimId,expectedTransactionId=null) {
      return Boolean(plainRow(statements.releaseCheckoutCreation.get(userId,claimId,expectedTransactionId)));
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
    async hasPaidDiscoveryAccess(userId,priceId=null) { return Boolean(statements.hasDiscoveryAccess.get(userId,priceId,priceId)); },
    async hasDiscoveryAccess(userId,priceId=null,now=Date.now()) {
      return Boolean(statements.hasDiscoveryAccess.get(userId,priceId,priceId)||statements.activeDiscoveryTrial.get(userId,now));
    },
    async discoveryTrial(userId) { return plainRow(statements.discoveryTrial.get(userId)); },
    async startDiscoveryTrial(userId,startedAt,expiresAt) { return plainRow(statements.startDiscoveryTrial.get(startedAt,expiresAt,userId)); },
    async discoveryAccessSummary(userId,priceId=null) { return accessSummary(plainRow(statements.discoveryAccessSummary.get(userId,priceId,priceId))); },
    async webhookEvent(eventId) { return plainRow(statements.webhookEvent.get(eventId)); },
    async recordWebhookEvent(event) {
      return Boolean(plainRow(statements.recordWebhookEvent.get(event.eventId,event.notificationId||null,event.eventType,event.occurredAt,event.processedAt)));
    },
    async adminPrincipal() { return plainRow(statements.adminPrincipal.get()); },
    async claimAdminPrincipal(userId,configuredEmail,boundAt) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const existing=plainRow(statements.adminPrincipal.get());
        if (existing) {
          db.exec("COMMIT");
          transactionOpen=false;
          return {principal:existing,boundNow:false};
        }
        const inserted=plainRow(statements.insertAdminPrincipal.get(configuredEmail,boundAt,userId,configuredEmail));
        db.exec("COMMIT");
        transactionOpen=false;
        return {principal:inserted||plainRow(statements.adminPrincipal.get()),boundNow:Boolean(inserted)};
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async createAdminElevation(sessionTokenHash,expiresAt,createdAt) {
      return plainRow(statements.upsertAdminElevation.get(expiresAt,createdAt,sessionTokenHash,createdAt));
    },
    async rotateAdminSessionForElevation(oldSessionTokenHash,newSession,expiresAt,audit,now) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const inserted=plainRow(statements.insertRotatedAdminSession.get(
          newSession.tokenHash,newSession.csrfToken,newSession.expiresAt,newSession.createdAt,
          oldSessionTokenHash,now,newSession.userId
        ));
        if (!inserted) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        const elevation=plainRow(statements.upsertAdminElevation.get(expiresAt,now,newSession.tokenHash,now));
        if (!elevation) throw new Error("Admin elevation could not be attached to the rotated session.");
        if (!plainRow(statements.insertAdminAuditIfSession.get(...adminAuditArgs(audit),newSession.tokenHash))) {
          throw new Error("Admin elevation audit could not be recorded atomically.");
        }
        if (!plainRow(statements.deleteRotatedAdminSession.get(oldSessionTokenHash,newSession.tokenHash))) {
          throw new Error("The previous admin session could not be invalidated atomically.");
        }
        db.exec("COMMIT");
        transactionOpen=false;
        return inserted;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async adminElevation(sessionTokenHash,now) { return plainRow(statements.adminElevation.get(sessionTokenHash,now)); },
    async deleteExpiredAdminElevations(now) { return affectedRows(statements.deleteExpiredAdminElevations.run(now)); },
    async adminOverview(now) { return plainRow(statements.adminOverview.get(now,now)); },
    async adminUserById(userId,now) { return plainRow(statements.adminUserById.get(now,now,now,userId)); },
    async adminUsers(query,limit,offset,now) {
      const search=adminSearchArgs(query);
      const users=plainRows(statements.adminUsers.all(now,now,...search,limit,offset));
      const total=Number(plainRow(statements.adminUserCount.get(...search))?.total||0);
      return {users,total};
    },
    async revokeUserSessions(userId,audit=null) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const user=plainRow(statements.revokeUserSessionsUser.get(userId));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        if (audit&&!plainRow(statements.insertAdminAuditIfChanged.get(...adminAuditArgs(audit)))) throw new Error("Admin audit could not be recorded atomically.");
        const revoked=plainRows(statements.revokeUserSessionsDelete.all(userId)).length;
        db.exec("COMMIT");
        transactionOpen=false;
        return {user,revoked};
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async suspendUser(userId,suspendedAt,audit=null) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const user=plainRow(statements.suspendUser.get(suspendedAt,userId));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        if (audit&&!plainRow(statements.insertAdminAuditIfChanged.get(...adminAuditArgs(audit)))) throw new Error("Admin audit could not be recorded atomically.");
        statements.revokeUserSessionsDelete.all(userId);
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
    async restoreUser(userId,audit=null) {
      if (!audit) return plainRow(statements.restoreUser.get(userId));
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const user=plainRow(statements.restoreUser.get(userId));
        if (!user) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        if (!plainRow(statements.insertAdminAuditIfChanged.get(...adminAuditArgs(audit)))) throw new Error("Admin audit could not be recorded atomically.");
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
    async recordAdminAudit(event) {
      return Boolean(plainRow(statements.insertAdminAudit.get(...adminAuditArgs(event))));
    },
    async adminAudit(limit) { return plainRows(statements.adminAudit.all(limit)); },
    async insertSupportTicket(ticket) {
      return plainRow(statements.insertSupportTicket.get(ticket.id,ticket.reference,ticket.userId||null,ticket.name,ticket.email,ticket.category,ticket.subject,ticket.referenceId||null,ticket.message,ticket.createdAt,ticket.updatedAt));
    },
    async supportTicketById(ticketId) { return plainRow(statements.supportTicketById.get(ticketId)); },
    async adminSupportTickets(status,limit,offset) {
      const tickets=plainRows(statements.adminSupportTickets.all(status,status,limit,offset));
      const total=Number(plainRow(statements.adminSupportCount.get(status,status))?.total||0);
      return {tickets,total};
    },
    async updateSupportTicket(ticketId,update,audit=null) {
      let transactionOpen=false;
      try {
        db.exec("BEGIN IMMEDIATE");
        transactionOpen=true;
        const ticket=plainRow(statements.updateSupportTicket.get(update.status,update.note||null,update.responseSent?1:0,update.updatedAt,update.updatedAt,ticketId,update.expectedUpdatedAt));
        if (!ticket) {
          db.exec("ROLLBACK");
          transactionOpen=false;
          return null;
        }
        if (audit&&!plainRow(statements.insertAdminAuditIfChanged.get(...adminAuditArgs(audit)))) throw new Error("Support audit could not be recorded atomically.");
        db.exec("COMMIT");
        transactionOpen=false;
        return ticket;
      } catch(error) {
        if (transactionOpen) {
          try { db.exec("ROLLBACK"); } catch { /* Preserve the original transaction error. */ }
        }
        throw error;
      }
    },
    async markSupportResponseSent(ticketId,sentAt) { return plainRow(statements.markSupportResponseSent.get(sentAt,sentAt,ticketId)); },
    async claimSupportRequestEvent(event,{since,ipLimit,emailLimit,globalLimit}) {
      return Boolean(plainRow(statements.claimSupportRequestEvent.get(
        event.id,event.ipHash,event.emailHash,event.createdAt,
        event.ipHash,since,ipLimit,event.emailHash,since,emailLimit,since,globalLimit
      )));
    },
    async deleteOldSupportRequestEvents(before) { return affectedRows(statements.deleteOldSupportRequestEvents.run(before)); },
    async close() { db.close(); }
  });
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

  return defineStore("turso",{
    // A successful query is the health signal. Some Turso-compatible row
    // implementations expose selected values only by numeric index, so the
    // probe must not depend on a particular row-object shape.
    ping:() => probeConnection(() => client.execute(SQL.ping)),
    userByEmail:(email) => first(SQL.userByEmail,[email]),
    userById:(id) => first(SQL.userById,[id]),
    accountCredentialsById:(id) => first(SQL.accountCredentialsById,[id]),
    insertUser:(user) => run(SQL.insertUser,[user.id,user.name,user.email,user.passwordHash,user.passwordSalt,user.createdAt,user.emailVerifiedAt??user.email_verified_at??null]),
    async insertSession(session) {
      const result=await run(SQL.insertSession,[session.tokenHash,session.csrfToken,session.expiresAt,session.createdAt,session.userId,Number(session.authVersion??1)]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
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
    accountActionByTokenHash:(tokenHash) => first(SQL.accountActionByTokenHash,[tokenHash]),
    accountActionForUser:(userId,purpose) => first(SQL.accountActionForUser,[userId,purpose]),
    async upsertAccountAction(action) {
      const result=await run(SQL.upsertAccountAction,accountActionArgs(action));
      return plainRow(result.rows?.[0],result.columns);
    },
    async markAccountActionDelivery(requestId,tokenHash,state,updatedAt) {
      const result=await run(SQL.markAccountActionDelivery,[state,updatedAt,requestId,tokenHash]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async stageAccountAction(action) {
      const result=await run(SQL.stageAccountAction,stagedAccountActionArgs(action));
      return plainRow(result.rows?.[0],result.columns);
    },
    async activateAccountAction(requestId,tokenHash,activatedAt) {
      const results=await client.batch([
        {sql:SQL.activateAccountAction,args:[activatedAt,requestId,tokenHash,activatedAt]},
        {sql:SQL.discardStagedAccountAction,args:[requestId,tokenHash]}
      ],"write");
      const action=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!action) return null;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)) {
        throw new Error("Staged account action could not be consumed atomically.");
      }
      return action;
    },
    async discardStagedAccountAction(requestId,tokenHash) {
      const result=await run(SQL.discardStagedAccountAction,[requestId,tokenHash]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async claimAccountActionSend(send,since,maxSends) {
      const result=await run(SQL.claimAccountActionSend,accountActionSendArgs(send,since,maxSends));
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async countAccountActionSends(emailHash,purpose,since) {
      return Number((await first(SQL.countAccountActionSends,[emailHash,purpose,since]))?.send_count||0);
    },
    activeAccountDeletion:(userId,now) => first(SQL.activeAccountDeletion,[userId,now]),
    async cancelAccountDeletion(userId) {
      const results=await client.batch([
        {sql:SQL.cancelAccountDeletion,args:[userId]},
        {sql:SQL.cancelStagedAccountDeletions,args:[userId]}
      ],"write");
      const active=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      const staged=plainRows(results[1]?.rows,results[1]?.columns);
      return Boolean(active||staged.length);
    },
    async cancelAccountDeletionWithAudit(userId,audit) {
      const results=await client.batch([
        {sql:SQL.cancelAccountDeletion,args:[userId]},
        {sql:SQL.insertAdminAuditIfChanged,args:adminAuditArgs(audit)},
        {sql:SQL.cancelStagedAccountDeletionsIfAudit,args:[userId,audit.id]}
      ],"write");
      const active=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!active) return false;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Deletion-cancellation audit could not be recorded atomically.");
      return true;
    },
    async completePasswordReset(tokenHash,passwordHash,passwordSalt,completedAt) {
      const action=await first(SQL.accountActionByTokenHash,[tokenHash]);
      if (!action||action.purpose!=="password_reset"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=completedAt) return null;
      const results=await client.batch([
        {sql:SQL.completePasswordResetUser,args:[passwordHash,passwordSalt,completedAt,tokenHash,completedAt]},
        {sql:SQL.completePasswordResetConsume,args:[completedAt,completedAt,tokenHash,completedAt]},
        {sql:SQL.completePasswordResetDeleteSessions,args:[tokenHash,completedAt]},
        {sql:SQL.completePasswordResetDeleteStagedActions,args:[tokenHash,completedAt]},
        {sql:SQL.completePasswordResetDeleteActions,args:[tokenHash,completedAt]}
      ],"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!user) return null;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Password reset could not be consumed atomically.");
      return user;
    },
    async pendingPurchasesForUser(userId) {
      return Number((await first(SQL.pendingPurchasesForUser,[userId]))?.pending_count||0);
    },
    unsettledPurchasesForUser:(userId) => all(SQL.unsettledPurchasesForUser,[userId]),
    activeCheckoutCreationForUser:(userId,now) => first(SQL.activeCheckoutCreationForUser,[userId,now]),
    async deleteAccount(tokenHash,deletedAt,emailHash) {
      const action=await first(SQL.accountActionByTokenHash,[tokenHash]);
      if (!action||action.purpose!=="account_delete"||action.delivery_state!=="sent"||action.consumed_at!=null||Number(action.expires_at)<=deletedAt) return {status:"invalid"};
      if (Number((await first(SQL.pendingPurchasesForUser,[action.user_id]))?.pending_count||0)>0) return {status:"purchase_pending"};
      if (await first(SQL.activeCheckoutCreationForUser,[action.user_id,deletedAt])) return {status:"checkout_pending"};
      const results=await client.batch([
        {sql:SQL.deleteUserWithAction,args:[tokenHash,deletedAt,deletedAt]},
        // This conditional cleanup is intentionally explicit. Turso PRAGMA
        // state is connection-scoped, so account privacy must not depend only
        // on ON DELETE CASCADE surviving a renewed serverless session.
        {sql:SQL.deleteCommunityPlanForDeletedUser,args:[action.user_id,action.user_id]},
        {sql:SQL.deleteCheckoutClaimsForDeletedUser,args:[action.user_id,action.user_id]},
        {sql:SQL.deleteVerificationSendsForDeletedUser,args:[action.user_id,action.email,action.user_id]},
        {sql:SQL.deleteVerificationsForDeletedUser,args:[action.user_id,action.email,action.user_id]},
        {sql:SQL.deleteActionSendsForDeletedUser,args:[emailHash,action.user_id]}
      ],"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (user) return {status:"deleted",user};
      if (Number((await first(SQL.pendingPurchasesForUser,[action.user_id]))?.pending_count||0)>0) return {status:"purchase_pending"};
      if (await first(SQL.activeCheckoutCreationForUser,[action.user_id,deletedAt])) return {status:"checkout_pending"};
      return {status:"invalid"};
    },
    async deleteOldAccountActionData(now,sendBefore=now-VERIFICATION_SEND_RETENTION_MS) {
      const consumedBefore=now-CONSUMED_VERIFICATION_RETENTION_MS;
      const results=await client.batch([
        {sql:SQL.deleteOldAccountActions,args:[now,consumedBefore]},
        {sql:SQL.deleteOldStagedAccountActions,args:[now]},
        {sql:SQL.deleteOldAccountActionSends,args:[sendBefore]}
      ],"write");
      return {actions:affectedRows(results[0])+affectedRows(results[1]),sends:affectedRows(results[2])};
    },
    plan:(userId) => first(SQL.plan,[userId]),
    async upsertPlan(userId,planJson,updatedAt,expectedUpdatedAt) {
      const result=await run(SQL.upsertPlan,[planJson,updatedAt,userId,expectedUpdatedAt,expectedUpdatedAt,expectedUpdatedAt,expectedUpdatedAt]);
      return plainRow(result.rows?.[0],result.columns);
    },
    communityWeeklyPlans:(limit,offset) => all(SQL.communityWeeklyPlans,[limit,offset]),
    communityWeeklyPlan:(id) => first(SQL.communityWeeklyPlan,[id]),
    communityWeeklyPlansForUser:(userId) => all(SQL.communityWeeklyPlansForUser,[userId]),
    communityWeeklyPlanForOwner:(id,userId) => first(SQL.communityWeeklyPlanForOwner,[id,userId]),
    async upsertCommunityWeeklyPlan(plan) {
      const result=await run(SQL.upsertCommunityWeeklyPlan,[
        plan.id,plan.title,plan.description,plan.planJson,plan.isPublished?1:0,
        plan.createdAt,plan.updatedAt,plan.userId
      ]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async upsertCommunityWeeklyPlanFromPlan(plan) {
      const result=await run(SQL.upsertCommunityWeeklyPlanFromPlan,[
        plan.id,plan.title,plan.description,plan.isPublished?1:0,
        plan.createdAt,plan.updatedAt,plan.userId,plan.expectedPlanUpdatedAt,plan.storedPlanJson
      ]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async setCommunityWeeklyPlanPublished(id,userId,isPublished,updatedAt) {
      const result=await run(SQL.setCommunityWeeklyPlanPublished,[isPublished?1:0,updatedAt,id,userId]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async deleteCommunityWeeklyPlan(id,userId) {
      const result=await run(SQL.deleteCommunityWeeklyPlan,[id,userId]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async applyCommunityWeeklyPlan({id,userId,sourceUpdatedAt,targetUpdatedAt,planJson,storedPlanJson,updatedAt}) {
      const result=await run(SQL.applyCommunityWeeklyPlan,[
        planJson,updatedAt,userId,id,sourceUpdatedAt,storedPlanJson,targetUpdatedAt
      ]);
      return plainRow(result.rows?.[0],result.columns);
    },
    monthlyPlan:(userId) => first(SQL.monthlyPlan,[userId]),
    upsertMonthlyPlan:(userId,planJson,updatedAt) => run(SQL.upsertMonthlyPlan,[userId,planJson,updatedAt]),
    preferences:(userId) => first(SQL.preferences,[userId]),
    upsertPreferences:(userId,preferencesJson,updatedAt) => run(SQL.upsertPreferences,[userId,preferencesJson,updatedAt]),
    ratingsForUser:(userId) => all(SQL.ratingsForUser,[userId]),
    ratingAggregates:() => all(SQL.ratingAggregates),
    ratingAggregate:(exerciseId) => first(SQL.ratingAggregate,[exerciseId]),
    upsertRating:(userId,exerciseId,rating,createdAt,updatedAt) => run(SQL.upsertRating,[userId,exerciseId,rating.comfort,rating.pump,rating.enjoyment,rating.stability,rating.setup,rating.overall,createdAt,updatedAt]),
    async insertPendingPurchase(purchase) {
      const result=await run(SQL.insertPendingPurchase,[purchase.transactionId,purchase.priceId,purchase.productId,purchase.paddleStatus||"ready",purchase.createdAt,purchase.updatedAt,purchase.userId,purchase.updatedAt]);
      return plainRow(result.rows?.[0],result.columns);
    },
    checkoutCreationForUser:(userId) => first(SQL.checkoutCreationForUser,[userId]),
    async claimCheckoutCreation({userId,priceId,claimId,expiresAt,now}) {
      const result=await run(SQL.claimCheckoutCreation,[priceId,claimId,expiresAt,now,now,userId,now,now]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async recordCheckoutCreationTransaction(userId,claimId,transactionId,updatedAt) {
      const result=await run(SQL.recordCheckoutCreationTransaction,[transactionId,updatedAt,userId,claimId,transactionId]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async extendCheckoutCreation(userId,claimId,expiresAt,updatedAt) {
      const result=await run(SQL.extendCheckoutCreation,[expiresAt,updatedAt,userId,claimId]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async releaseCheckoutCreation(userId,claimId,expectedTransactionId=null) {
      const result=await run(SQL.releaseCheckoutCreation,[userId,claimId,expectedTransactionId]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
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
    async hasPaidDiscoveryAccess(userId,priceId=null) { return Boolean(await first(SQL.hasDiscoveryAccess,[userId,priceId,priceId])); },
    async hasDiscoveryAccess(userId,priceId=null,now=Date.now()) {
      const [paid,trial]=await Promise.all([
        first(SQL.hasDiscoveryAccess,[userId,priceId,priceId]),
        first(SQL.activeDiscoveryTrial,[userId,now])
      ]);
      return Boolean(paid||trial);
    },
    discoveryTrial:(userId) => first(SQL.discoveryTrial,[userId]),
    async startDiscoveryTrial(userId,startedAt,expiresAt) {
      const result=await run(SQL.startDiscoveryTrial,[startedAt,expiresAt,userId]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async discoveryAccessSummary(userId,priceId=null) { return accessSummary(await first(SQL.discoveryAccessSummary,[userId,priceId,priceId])); },
    webhookEvent:(eventId) => first(SQL.webhookEvent,[eventId]),
    async recordWebhookEvent(event) {
      const result=await run(SQL.recordWebhookEvent,[event.eventId,event.notificationId||null,event.eventType,event.occurredAt,event.processedAt]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    adminPrincipal:() => first(SQL.adminPrincipal),
    async claimAdminPrincipal(userId,configuredEmail,boundAt) {
      const existing=await first(SQL.adminPrincipal);
      if (existing) return {principal:existing,boundNow:false};
      const results=await client.batch([
        {sql:SQL.insertAdminPrincipal,args:[configuredEmail,boundAt,userId,configuredEmail]}
      ],"write");
      const inserted=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      return {principal:inserted||await first(SQL.adminPrincipal),boundNow:Boolean(inserted)};
    },
    async createAdminElevation(sessionTokenHash,expiresAt,createdAt) {
      const result=await run(SQL.upsertAdminElevation,[expiresAt,createdAt,sessionTokenHash,createdAt]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async rotateAdminSessionForElevation(oldSessionTokenHash,newSession,expiresAt,audit,now) {
      const results=await client.batch([
        {sql:SQL.insertRotatedAdminSession,args:[newSession.tokenHash,newSession.csrfToken,newSession.expiresAt,newSession.createdAt,oldSessionTokenHash,now,newSession.userId]},
        {sql:SQL.upsertAdminElevation,args:[expiresAt,now,newSession.tokenHash,now]},
        {sql:SQL.insertAdminAuditIfSession,args:[...adminAuditArgs(audit),newSession.tokenHash]},
        {sql:SQL.deleteRotatedAdminSession,args:[oldSessionTokenHash,newSession.tokenHash]}
      ],"write");
      const inserted=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (!inserted) return null;
      if (!plainRow(results[1]?.rows?.[0],results[1]?.columns)||!plainRow(results[2]?.rows?.[0],results[2]?.columns)||!plainRow(results[3]?.rows?.[0],results[3]?.columns)) {
        throw new Error("Admin session rotation could not be completed atomically.");
      }
      return inserted;
    },
    adminElevation:(sessionTokenHash,now) => first(SQL.adminElevation,[sessionTokenHash,now]),
    async deleteExpiredAdminElevations(now) { return affectedRows(await run(SQL.deleteExpiredAdminElevations,[now])); },
    adminOverview:(now) => first(SQL.adminOverview,[now,now]),
    adminUserById:(userId,now) => first(SQL.adminUserById,[now,now,now,userId]),
    async adminUsers(query,limit,offset,now) {
      const search=adminSearchArgs(query);
      const [users,count]=await Promise.all([
        all(SQL.adminUsers,[now,now,...search,limit,offset]),
        first(SQL.adminUserCount,search)
      ]);
      return {users,total:Number(count?.total||0)};
    },
    async revokeUserSessions(userId,audit=null) {
      const statements=[{sql:SQL.revokeUserSessionsUser,args:[userId]}];
      if (audit) statements.push({sql:SQL.insertAdminAuditIfChanged,args:adminAuditArgs(audit)});
      statements.push({sql:SQL.revokeUserSessionsDelete,args:[userId]});
      const results=await client.batch(statements,"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (user&&audit&&!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Admin audit could not be recorded atomically.");
      const deleted=results[audit?2:1];
      return user?{user,revoked:plainRows(deleted?.rows||[],deleted?.columns).length}:null;
    },
    async suspendUser(userId,suspendedAt,audit=null) {
      const statements=[{sql:SQL.suspendUser,args:[suspendedAt,userId]}];
      if (audit) statements.push({sql:SQL.insertAdminAuditIfChanged,args:adminAuditArgs(audit)});
      statements.push({sql:SQL.revokeUserSessionsDelete,args:[userId]});
      const results=await client.batch(statements,"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (user&&audit&&!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Admin audit could not be recorded atomically.");
      return user;
    },
    async restoreUser(userId,audit=null) {
      if (!audit) {
        const result=await run(SQL.restoreUser,[userId]);
        return plainRow(result.rows?.[0],result.columns);
      }
      const results=await client.batch([
        {sql:SQL.restoreUser,args:[userId]},
        {sql:SQL.insertAdminAuditIfChanged,args:adminAuditArgs(audit)}
      ],"write");
      const user=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (user&&!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Admin audit could not be recorded atomically.");
      return user;
    },
    async recordAdminAudit(event) {
      const result=await run(SQL.insertAdminAudit,adminAuditArgs(event));
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    adminAudit:(limit) => all(SQL.adminAudit,[limit]),
    async insertSupportTicket(ticket) {
      const result=await run(SQL.insertSupportTicket,[ticket.id,ticket.reference,ticket.userId||null,ticket.name,ticket.email,ticket.category,ticket.subject,ticket.referenceId||null,ticket.message,ticket.createdAt,ticket.updatedAt]);
      return plainRow(result.rows?.[0],result.columns);
    },
    supportTicketById:(ticketId) => first(SQL.supportTicketById,[ticketId]),
    async adminSupportTickets(status,limit,offset) {
      const [tickets,count]=await Promise.all([
        all(SQL.adminSupportTickets,[status,status,limit,offset]),
        first(SQL.adminSupportCount,[status,status])
      ]);
      return {tickets,total:Number(count?.total||0)};
    },
    async updateSupportTicket(ticketId,update,audit=null) {
      if (!audit) {
        const result=await run(SQL.updateSupportTicket,[update.status,update.note||null,update.responseSent?1:0,update.updatedAt,update.updatedAt,ticketId,update.expectedUpdatedAt]);
        return plainRow(result.rows?.[0],result.columns);
      }
      const results=await client.batch([
        {sql:SQL.updateSupportTicket,args:[update.status,update.note||null,update.responseSent?1:0,update.updatedAt,update.updatedAt,ticketId,update.expectedUpdatedAt]},
        {sql:SQL.insertAdminAuditIfChanged,args:adminAuditArgs(audit)}
      ],"write");
      const ticket=plainRow(results[0]?.rows?.[0],results[0]?.columns);
      if (ticket&&!plainRow(results[1]?.rows?.[0],results[1]?.columns)) throw new Error("Support audit could not be recorded atomically.");
      return ticket;
    },
    async markSupportResponseSent(ticketId,sentAt) {
      const result=await run(SQL.markSupportResponseSent,[sentAt,sentAt,ticketId]);
      return plainRow(result.rows?.[0],result.columns);
    },
    async claimSupportRequestEvent(event,{since,ipLimit,emailLimit,globalLimit}) {
      const result=await run(SQL.claimSupportRequestEvent,[
        event.id,event.ipHash,event.emailHash,event.createdAt,
        event.ipHash,since,ipLimit,event.emailHash,since,emailLimit,since,globalLimit
      ]);
      return Boolean(plainRow(result.rows?.[0],result.columns));
    },
    async deleteOldSupportRequestEvents(before) { return affectedRows(await run(SQL.deleteOldSupportRequestEvents,[before])); },
    async close() { client.close(); }
  });
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
