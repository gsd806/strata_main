"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {mkdtempSync,rmSync}=require("node:fs"),{join}=require("node:path"),{tmpdir}=require("node:os");
const {DatabaseSync}=require("node:sqlite");
const {createStore}=require("../src/database");
const {SCHEMA,SQL}=require("../src/schema");
const {sanitizeWorkout,summarizeWorkout}=require("../src/workouts");
const {workoutFixture,fakeTursoFactory}=require("./support/workout-fixtures");

async function fixture(t,kind) {
  const directory=mkdtempSync(join(tmpdir(),"strata-workout-"));let database;
  const names=["NODE_ENV","STRATA_DATA_DIR","TURSO_DATABASE_URL","TURSO_AUTH_TOKEN"],old=names.map((key)=>process.env[key]);
  let store;
  try {
    Object.assign(process.env,{NODE_ENV:"test",STRATA_DATA_DIR:directory,TURSO_DATABASE_URL:kind==="turso"?"https://workout.invalid":"",TURSO_AUTH_TOKEN:kind==="turso"?"test-token":""});
    store=await createStore(join(__dirname,".."),{tursoClientFactory:fakeTursoFactory((db)=>{database=db;})});
  } finally {names.forEach((key,i)=>{if (old[i]===undefined) delete process.env[key];else process.env[key]=old[i];});}
  t.after(async()=>{await store.close();rmSync(directory,{recursive:true,force:true});});
  for (const id of ["owner","other"]) await store.insertUser({id,name:id,email:`${id}@example.test`,passwordHash:"hash",passwordSalt:"salt",createdAt:1,emailVerifiedAt:1});
  return {store,database,file:join(directory,"strata.sqlite")};
}
function record(userId,id="shared-workout",startedAt=1767600000000) {
  const workout=workoutFixture(id);workout.startedAt=startedAt;
  const clean=sanitizeWorkout(workout);
  return {userId,id,workoutJson:JSON.stringify(clean),summaryJson:JSON.stringify(summarizeWorkout(clean)),createHash:"immutable-create-hash",startedAt,updatedAt:1000};
}

for (const kind of ["local","turso"]) {
  test(`${kind} workouts use atomic CAS, isolated IDs, bounded summary reads, and deletion`,{concurrency:false},async(t)=>{
    const {store}=await fixture(t,kind),initial=record("owner");
    const created=await store.insertWorkout(initial);
    assert.equal(created.revision,1);assert.equal(created.updated_at,1000);
    assert.equal(await store.insertWorkout({...initial,workoutJson:"{\"overwritten\":true}"}),null);
    assert.equal((await store.workout("owner",initial.id)).workout_json,initial.workoutJson);
    assert.equal(await store.workout("other",initial.id),null);
    assert.equal(await store.deleteWorkout("other",initial.id,1),false);
    assert.equal(await store.updateWorkout({...initial,userId:"other"},1),null);
    assert.equal((await store.insertWorkout(record("other"))).revision,1,"each account owns a distinct ID namespace");
    const outcomes=await Promise.all(Array.from({length:20},(_,i)=>store.updateWorkout({...initial,workoutJson:JSON.stringify({winner:i}),updatedAt:1000},1)));
    assert.equal(outcomes.filter(Boolean).length,1,"exactly one concurrent writer wins");
    const saved=await store.workout("owner",initial.id);
    assert.equal(saved.revision,2);assert.equal(saved.updated_at,1001);assert.equal(saved.create_hash,initial.createHash);
    assert.equal(await store.updateWorkout(initial,1),null);assert.equal(await store.deleteWorkout("owner",initial.id,1),false);
    await store.insertWorkout(record("owner","newer",initial.startedAt+1));
    const summaries=await store.workouts("owner",1,0);
    assert.equal(summaries.length,1);assert.equal(JSON.parse(summaries[0].summary_json).id,"newer");
    assert.equal("workout_json" in summaries[0],false,"history must not transfer complete session JSON");
    assert.equal("create_hash" in summaries[0],false);
    assert.equal(JSON.parse((await store.workouts("owner",1,1))[0].summary_json).id,initial.id);
    assert.equal(await store.workoutCount("owner"),2);
    assert.equal(await store.deleteWorkout("owner",initial.id,2),true);
    assert.equal(await store.workout("owner",initial.id),null);assert.ok(await store.workout("other",initial.id));
  });
  test(`${kind} account deletion removes private workouts${kind==="turso"?" even if foreign keys are unavailable":" through its cascade"}`,{concurrency:false},async(t)=>{
    const {store,database,file}=await fixture(t,kind);
    await store.insertWorkout(record("owner"));await store.insertWorkout(record("other"));
    const now=Date.now();
    await store.upsertAccountAction({requestId:"delete-workout-owner",userId:"owner",purpose:"account_delete",tokenHash:"delete-owner-token",expiresAt:now+60000,deliveryState:"sent",createdAt:now,updatedAt:now});
    if (database) database.exec("PRAGMA foreign_keys=OFF");
    const result=await store.deleteAccount("delete-owner-token",now+1,"owner-hash");
    assert.equal(result.status,"deleted");assert.equal(await store.workoutCount("owner"),0);assert.equal(await store.workoutCount("other"),1);
    const db=database||new DatabaseSync(file);
    try {
      const queryPlan=db.prepare(`EXPLAIN QUERY PLAN ${SQL.workouts}`).all("other",21,0).map((row)=>row.detail).join(" ");
      assert.match(queryPlan,/workouts_user_started/);assert.doesNotMatch(queryPlan,/TEMP B-TREE/);
    } finally {if (!database) db.close();}
  });
}

test("workout migration is additive and a reopened store preserves existing user and plan data",{concurrency:false},async()=>{
  const directory=mkdtempSync(join(tmpdir(),"strata-workout-migration-")),file=join(directory,"strata.sqlite"),db=new DatabaseSync(file,{enableForeignKeyConstraints:true});
  for (const sql of SCHEMA) if (!/CREATE (?:TABLE|INDEX) IF NOT EXISTS workouts/.test(sql)) db.exec(sql);
  db.prepare("INSERT INTO users (id,name,email,password_hash,password_salt,created_at) VALUES (?,?,?,?,?,?)").run("legacy","Legacy","legacy@example.test","hash","salt",42);
  db.prepare("INSERT INTO plans (user_id,plan_json,updated_at) VALUES (?,?,?)").run("legacy","{\"legacy\":true}",123);
  const before=db.prepare("SELECT * FROM users").get();db.close();
  const previous={NODE_ENV:process.env.NODE_ENV,STRATA_DATA_DIR:process.env.STRATA_DATA_DIR,TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL};
  let store;
  try {
    Object.assign(process.env,{NODE_ENV:"test",STRATA_DATA_DIR:directory,TURSO_DATABASE_URL:""});store=await createStore(join(__dirname,".."));
    assert.deepEqual(await store.plan("legacy"),{plan_json:'{"legacy":true}',updated_at:123});
    await store.insertWorkout(record("legacy"));await store.close();store=await createStore(join(__dirname,".."));
    assert.ok(await store.workout("legacy","shared-workout"));
    const migrated=new DatabaseSync(file);assert.deepEqual(migrated.prepare("SELECT * FROM users").get(),before);migrated.close();
  } finally {
    await store?.close();for (const [key,value] of Object.entries(previous)) {if (value===undefined) delete process.env[key];else process.env[key]=value;}
    rmSync(directory,{recursive:true,force:true});
  }
});

test("workout storage cap is atomic and does not block CAS updates or other owners",{concurrency:false},async(t)=>{
  const {store,database}=await fixture(t,"turso"),initial=record("owner");await store.insertWorkout(initial);
  database.prepare("WITH RECURSIVE n(i) AS (SELECT 1 UNION ALL SELECT i+1 FROM n WHERE i<9999) INSERT INTO workouts (user_id,id,workout_json,summary_json,create_hash,started_at,revision,updated_at) SELECT 'owner','bulk-'||i,'{}','{}','hash',1,1,1 FROM n").run();
  assert.equal(await store.workoutCount("owner"),10000);
  assert.equal(await store.insertWorkout(record("owner","overflow")),null);
  assert.equal((await store.updateWorkout(initial,1)).revision,2);
  assert.ok(await store.insertWorkout(record("other","other-workout")));
});
