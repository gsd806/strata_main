"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {mkdirSync,mkdtempSync,rmSync}=require("node:fs");
const {join}=require("node:path");
const {DatabaseSync}=require("node:sqlite");
const {createStore}=require("../src/database");

const PROJECT_ROOT=join(__dirname,"..");
const TEST_RUNTIME=join(PROJECT_ROOT,"test-runtime");

function testDirectory(prefix) {
  mkdirSync(TEST_RUNTIME,{recursive:true});
  return mkdtempSync(join(TEST_RUNTIME,prefix));
}

async function fixture(prefix) {
  const root=testDirectory(prefix);
  const previous={
    nodeEnv:process.env.NODE_ENV,
    tursoUrl:process.env.TURSO_DATABASE_URL,
    tursoToken:process.env.TURSO_AUTH_TOKEN,
    dataDir:process.env.STRATA_DATA_DIR
  };
  process.env.NODE_ENV="test";
  delete process.env.TURSO_DATABASE_URL;
  delete process.env.TURSO_AUTH_TOKEN;
  process.env.STRATA_DATA_DIR=root;
  const store=await createStore(root);
  return {
    root,
    store,
    async close() {
      await store.close();
      if(previous.nodeEnv===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=previous.nodeEnv;
      if(previous.tursoUrl===undefined)delete process.env.TURSO_DATABASE_URL;else process.env.TURSO_DATABASE_URL=previous.tursoUrl;
      if(previous.tursoToken===undefined)delete process.env.TURSO_AUTH_TOKEN;else process.env.TURSO_AUTH_TOKEN=previous.tursoToken;
      if(previous.dataDir===undefined)delete process.env.STRATA_DATA_DIR;else process.env.STRATA_DATA_DIR=previous.dataDir;
      rmSync(root,{recursive:true,force:true});
    }
  };
}

function user(suffix,name,now) {
  return {
    id:`user-${suffix}`,
    name,
    email:`${suffix}@example.test`,
    passwordHash:`password-hash-${suffix}`,
    passwordSalt:`password-salt-${suffix}`,
    createdAt:now,
    emailVerifiedAt:now
  };
}

function communityPlan(suffix,userId,now,overrides={}) {
  return {
    id:`community-plan-${suffix}`,
    userId,
    title:`${suffix} weekly plan`,
    description:`A useful ${suffix} split.`,
    planJson:JSON.stringify({
      restDay:"Sunday",
      days:{
        Monday:[{exerciseId:`${suffix}-squat`,sets:3,reps:"8-10"}],
        Tuesday:[{exerciseId:`${suffix}-row`,sets:3,reps:"10-12"}]
      }
    }),
    isPublished:true,
    createdAt:now,
    updatedAt:now,
    ...overrides
  };
}

function inspectDatabase(root,inspect) {
  const db=new DatabaseSync(join(root,"strata.sqlite"),{enableForeignKeyConstraints:true});
  try {
    return inspect(db);
  } finally {
    db.close();
  }
}

test("community weekly plans persist while public reads expose only published, privacy-safe rows",{concurrency:false},async()=>{
  const {store,close}=await fixture("community-plans-read-");
  const now=1_850_000_000_000;
  const publisher=user("publisher","Public Lifter",now);
  const draftOwner=user("draft-owner","Draft Lifter",now+1);
  const published=communityPlan("published",publisher.id,now+10);
  const draft=communityPlan("draft",draftOwner.id,now+20,{isPublished:false});
  try {
    await store.insertUser(publisher);
    await store.insertUser(draftOwner);
    await store.upsertCommunityWeeklyPlan(published);
    await store.upsertCommunityWeeklyPlan(draft);

    const publicRows=await store.communityWeeklyPlans(20,0);
    assert.equal(publicRows.length,1);
    assert.equal(publicRows[0].id,published.id);
    assert.equal(publicRows[0].author_name,publisher.name);
    assert.equal(publicRows[0].plan_json,published.planJson);
    assert.equal("is_published" in publicRows[0],false,"the public row does not expose management state");
    assert.equal("email" in publicRows[0],false);
    assert.equal("author_email" in publicRows[0],false);
    assert.equal("password_hash" in publicRows[0],false);

    assert.equal((await store.communityWeeklyPlan(published.id)).author_name,publisher.name);
    assert.equal(await store.communityWeeklyPlan(draft.id),null,"drafts must never be available through the public lookup");

    const ownDraft=await store.communityWeeklyPlanForOwner(draft.id,draftOwner.id);
    assert.equal(ownDraft.id,draft.id);
    assert.equal(ownDraft.is_published,0);
    assert.equal(ownDraft.author_name,draftOwner.name);
    assert.equal(await store.communityWeeklyPlanForOwner(draft.id,publisher.id),null,"another account cannot use the owner lookup");
    assert.deepEqual((await store.communityWeeklyPlansForUser(draftOwner.id)).map((row)=>row.id),[draft.id]);
  } finally {
    await close();
  }
});

test("community weekly plan replacement, visibility, and deletion stay owner-scoped",{concurrency:false},async()=>{
  const {root,store,close}=await fixture("community-plans-owner-");
  const now=1_850_100_000_000;
  const owner=user("owner","Plan Owner",now);
  const intruder=user("intruder","Other Lifter",now+1);
  const first=communityPlan("first",owner.id,now+10);
  try {
    await store.insertUser(owner);
    await store.insertUser(intruder);
    await store.upsertCommunityWeeklyPlan(first);
    await store.upsertCommunityWeeklyPlan(communityPlan("replacement",owner.id,now+20,{
      title:"Updated owner plan",
      description:"The one current upload for this account."
    }));

    const owned=await store.communityWeeklyPlansForUser(owner.id);
    assert.equal(owned.length,1,"each account may have only one uploaded weekly plan");
    assert.equal(owned[0].title,"Updated owner plan");
    const currentId=owned[0].id;
    assert.equal(inspectDatabase(root,(db)=>Number(db.prepare("SELECT COUNT(*) AS count FROM community_weekly_plans WHERE user_id=?").get(owner.id).count)),1);

    await store.setCommunityWeeklyPlanPublished(currentId,intruder.id,false,now+30);
    assert.ok(await store.communityWeeklyPlan(currentId),"a different account cannot unpublish this plan");
    await store.deleteCommunityWeeklyPlan(currentId,intruder.id);
    assert.ok(await store.communityWeeklyPlan(currentId),"a different account cannot delete this plan");

    await store.setCommunityWeeklyPlanPublished(currentId,owner.id,false,now+40);
    assert.equal(await store.communityWeeklyPlan(currentId),null);
    const privateRow=await store.communityWeeklyPlanForOwner(currentId,owner.id);
    assert.equal(privateRow.is_published,0);
    assert.equal(privateRow.updated_at,now+40);

    await store.deleteCommunityWeeklyPlan(currentId,owner.id);
    assert.equal(await store.communityWeeklyPlanForOwner(currentId,owner.id),null);
    assert.deepEqual(await store.communityWeeklyPlansForUser(owner.id),[]);
  } finally {
    await close();
  }
});

test("publishing snapshots one exact saved-plan revision atomically",{concurrency:false},async()=>{
  const {store,close}=await fixture("community-plans-publish-revision-");
  const now=1_850_150_000_000;
  const owner=user("revision-owner","Revision Owner",now);
  const firstPrivatePlan=communityPlan("first-private",owner.id,now+10).planJson;
  const secondPrivatePlan=communityPlan("second-private",owner.id,now+20).planJson;
  const listing={
    id:"community-plan-revision",userId:owner.id,title:"Revision-bound plan",
    description:"Only the confirmed private revision is shared.",isPublished:true,
    createdAt:now+30,updatedAt:now+30
  };
  try {
    await store.insertUser(owner);
    const firstSave=await store.upsertPlan(owner.id,firstPrivatePlan,now+10);

    assert.equal(await store.upsertCommunityWeeklyPlanFromPlan({
      ...listing,expectedPlanUpdatedAt:firstSave.updated_at-1,storedPlanJson:firstPrivatePlan
    }),null,"a stale private-plan revision cannot be published");
    assert.deepEqual(await store.communityWeeklyPlansForUser(owner.id),[]);

    const published=await store.upsertCommunityWeeklyPlanFromPlan({
      ...listing,expectedPlanUpdatedAt:firstSave.updated_at,storedPlanJson:firstPrivatePlan
    });
    assert.equal(published.plan_json,firstPrivatePlan);
    assert.equal(published.id,listing.id);

    const secondSave=await store.upsertPlan(owner.id,secondPrivatePlan,now+40);
    assert.equal(await store.upsertCommunityWeeklyPlanFromPlan({
      ...listing,id:"ignored-replacement-id",updatedAt:now+50,
      expectedPlanUpdatedAt:firstSave.updated_at,storedPlanJson:firstPrivatePlan
    }),null,"a plan changed after validation cannot replace the published snapshot");
    assert.equal((await store.communityWeeklyPlansForUser(owner.id))[0].plan_json,firstPrivatePlan);

    const replaced=await store.upsertCommunityWeeklyPlanFromPlan({
      ...listing,id:"ignored-replacement-id",updatedAt:now+50,
      expectedPlanUpdatedAt:secondSave.updated_at,storedPlanJson:secondPrivatePlan
    });
    assert.equal(replaced.id,listing.id,"one-per-account replacement preserves the existing listing id");
    assert.equal(replaced.plan_json,secondPrivatePlan);
  } finally {
    await close();
  }
});

test("applying a published community plan is atomic and source account deletion cascades safely",{concurrency:false},async()=>{
  const {root,store,close}=await fixture("community-plans-apply-");
  const now=1_850_200_000_000;
  const publisher=user("source","Source Lifter",now);
  const draftPublisher=user("draft-source","Private Source",now+1);
  const recipient=user("recipient","Plan Recipient",now+2);
  const published=communityPlan("source",publisher.id,now+10);
  const draft=communityPlan("private-source",draftPublisher.id,now+20,{isPublished:false});
  const originalPrivatePlan=JSON.stringify({restDay:"Friday",days:{Saturday:[]}});
  try {
    await store.insertUser(publisher);
    await store.insertUser(draftPublisher);
    await store.insertUser(recipient);
    await store.upsertCommunityWeeklyPlan(published);
    await store.upsertCommunityWeeklyPlan(draft);
    await store.upsertPlan(recipient.id,originalPrivatePlan,now+30);

    assert.equal(await store.applyCommunityWeeklyPlan({
      id:draft.id,userId:recipient.id,sourceUpdatedAt:draft.updatedAt,targetUpdatedAt:now+30,
      planJson:draft.planJson,storedPlanJson:draft.planJson,updatedAt:now+40
    }),null,"an unpublished upload cannot be applied");
    assert.deepEqual(await store.plan(recipient.id),{plan_json:originalPrivatePlan,updated_at:now+30},"a rejected apply must not disturb the current private plan");

    assert.equal(await store.applyCommunityWeeklyPlan({
      id:published.id,userId:recipient.id,sourceUpdatedAt:published.updatedAt+1,targetUpdatedAt:now+30,
      planJson:published.planJson,storedPlanJson:published.planJson,updatedAt:now+41
    }),null,"a stale source revision cannot be applied");
    assert.equal(await store.applyCommunityWeeklyPlan({
      id:published.id,userId:recipient.id,sourceUpdatedAt:published.updatedAt,targetUpdatedAt:now+31,
      planJson:published.planJson,storedPlanJson:published.planJson,updatedAt:now+42
    }),null,"a stale recipient revision cannot overwrite a newer private plan");
    assert.deepEqual(await store.plan(recipient.id),{plan_json:originalPrivatePlan,updated_at:now+30});

    inspectDatabase(root,(db)=>db.prepare("UPDATE community_weekly_plans SET plan_json=? WHERE id=?").run("{broken",published.id));
    assert.equal(await store.applyCommunityWeeklyPlan({
      id:published.id,userId:recipient.id,sourceUpdatedAt:published.updatedAt,targetUpdatedAt:now+30,
      planJson:published.planJson,storedPlanJson:published.planJson,updatedAt:now+43
    }),null,"a source changed after validation cannot copy corrupt JSON");
    assert.deepEqual(await store.plan(recipient.id),{plan_json:originalPrivatePlan,updated_at:now+30});
    inspectDatabase(root,(db)=>db.prepare("UPDATE community_weekly_plans SET plan_json=? WHERE id=?").run(published.planJson,published.id));

    const applied=await store.applyCommunityWeeklyPlan({
      id:published.id,userId:recipient.id,sourceUpdatedAt:published.updatedAt,targetUpdatedAt:now+30,
      planJson:published.planJson,storedPlanJson:published.planJson,updatedAt:now+50
    });
    assert.deepEqual(applied,{plan_json:published.planJson,updated_at:now+50});
    assert.deepEqual(await store.plan(recipient.id),applied,"applying copies the selected upload into the recipient's private plan");

    const deletion={
      requestId:"delete-community-publisher",
      userId:publisher.id,
      purpose:"account_delete",
      tokenHash:"delete-community-publisher-token",
      expiresAt:now+60_000,
      deliveryState:"sent",
      createdAt:now+51,
      updatedAt:now+51
    };
    await store.upsertAccountAction(deletion);
    assert.deepEqual(await store.deleteAccount(deletion.tokenHash,now+52,"publisher-email-hash"),{
      status:"deleted",
      user:{id:publisher.id,email:publisher.email}
    });

    assert.equal(inspectDatabase(root,(db)=>Number(db.prepare("SELECT COUNT(*) AS count FROM community_weekly_plans WHERE user_id=?").get(publisher.id).count)),0,"account deletion must not leave an orphaned upload");
    assert.equal(await store.communityWeeklyPlan(published.id),null);
    assert.deepEqual(await store.plan(recipient.id),applied,"an already-applied private copy survives deletion of its source account");
  } finally {
    await close();
  }
});
