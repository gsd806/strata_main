"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {DatabaseSync}=require("node:sqlite");
const {MIGRATIONS,migrateLocalSchema,migrateTursoSchema}=require("../src/migrations");
const {SCHEMA,WORKOUT_ACTIVE_INDEX,RECONCILE_DUPLICATE_ACTIVE_WORKOUTS}=require("../src/schema");

function legacyDatabase() {
  const database=new DatabaseSync(":memory:",{enableForeignKeyConstraints:true});
  for (const statement of SCHEMA) if (statement!==WORKOUT_ACTIVE_INDEX) database.exec(statement);
  database.exec("CREATE INDEX IF NOT EXISTS discovery_trials_expires_at ON discovery_trials(expires_at)");
  database.exec("CREATE INDEX IF NOT EXISTS support_tickets_email ON support_tickets(email)");
  return database;
}

test("SQLite records each idempotent migration once",()=>{
  const database=legacyDatabase();
  try {
    const first=migrateLocalSchema(database,{activeWorkoutIndex:WORKOUT_ACTIVE_INDEX,reconcileActiveWorkouts:RECONCILE_DUPLICATE_ACTIVE_WORKOUTS,now:()=>1234});
    assert.deepEqual(first.applied,MIGRATIONS.map(({id})=>id));
    assert.equal(first.latest,MIGRATIONS.at(-1).id);
    assert.deepEqual(database.prepare("SELECT migration_id,applied_at FROM schema_migrations ORDER BY migration_id").all().map((row)=>({...row})),MIGRATIONS.map(({id})=>({migration_id:id,applied_at:1234})));
    const second=migrateLocalSchema(database,{activeWorkoutIndex:WORKOUT_ACTIVE_INDEX,reconcileActiveWorkouts:RECONCILE_DUPLICATE_ACTIVE_WORKOUTS,now:()=>9999});
    assert.deepEqual(second.applied,[]);
    assert.equal(database.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get().count,MIGRATIONS.length);
    const indexes=new Set(database.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map(({name})=>name));
    assert.equal(indexes.has("discovery_trials_expires_at"),false);
    assert.equal(indexes.has("support_tickets_email"),false);
    assert.equal(indexes.has("workouts_one_active_per_user"),true);
  } finally { database.close(); }
});

test("Turso migration runner records the same ordered ledger",async()=>{
  const database=legacyDatabase();
  async function execute(statement) {
    const sql=typeof statement==="string"?statement:statement.sql,args=typeof statement==="string"?[]:statement.args||[];
    const prepared=database.prepare(sql),returnsRows=/^\s*(?:SELECT|PRAGMA)\b/i.test(sql)||/\bRETURNING\b/i.test(sql);
    if (!returnsRows) { const result=prepared.run(...args);return {rows:[],columns:[],rowsAffected:Number(result.changes)}; }
    const rows=prepared.all(...args),columns=prepared.columns().map(({name})=>name);
    return {rows:rows.map((row)=>columns.map((name)=>row[name])),columns};
  }
  const client={execute,async batch(statements){database.exec("BEGIN IMMEDIATE");try{const results=[];for(const statement of statements)results.push(await execute(statement));database.exec("COMMIT");return results;}catch(error){database.exec("ROLLBACK");throw error;}}};
  try {
    const first=await migrateTursoSchema(client,{activeWorkoutIndex:WORKOUT_ACTIVE_INDEX,reconcileActiveWorkouts:RECONCILE_DUPLICATE_ACTIVE_WORKOUTS,now:()=>5678});
    assert.deepEqual(first.applied,MIGRATIONS.map(({id})=>id));
    const stored=database.prepare("SELECT migration_id,applied_at FROM schema_migrations ORDER BY migration_id").all().map((row)=>({...row}));
    assert.deepEqual(stored,MIGRATIONS.map(({id})=>({migration_id:id,applied_at:5678})));
    const second=await migrateTursoSchema(client,{activeWorkoutIndex:WORKOUT_ACTIVE_INDEX,reconcileActiveWorkouts:RECONCILE_DUPLICATE_ACTIVE_WORKOUTS,now:()=>9999});
    assert.deepEqual(second.applied,[]);
  } finally { database.close(); }
});
