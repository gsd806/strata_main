"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { plainRow,probeConnection } = require("../src/database");

test("Turso array rows are mapped with their result-set columns",() => {
  const row=[42n,"Test Lifter","test@example.test"];
  Object.defineProperties(row,{
    id:{value:42n,enumerable:false},
    name:{value:"Test Lifter",enumerable:false},
    email:{value:"test@example.test",enumerable:false}
  });

  assert.deepEqual(plainRow(row,["id","name","email"]),{
    id:42,
    name:"Test Lifter",
    email:"test@example.test"
  });
});

test("ordinary local database rows remain supported",() => {
  assert.deepEqual(plainRow({id:"user-1",created_at:123n}),{
    id:"user-1",
    created_at:123
  });
});

test("column mapping preserves SQL nulls and the first duplicate name",() => {
  assert.deepEqual(plainRow([null,"later"],["value","value"]),{value:null});

  const objectShapedRow={id:"named-value"};
  assert.deepEqual(plainRow(objectShapedRow,["id"]),{id:"named-value"});
});

test("database health depends on query success, not returned row shape",async() => {
  assert.equal(await probeConnection(async() => ({rows:[[1]]})),true);
  assert.equal(await probeConnection(async() => ({rows:[{ok:1}]})),true);
});

test("database health propagates query failures",async() => {
  await assert.rejects(
    probeConnection(async() => { throw new Error("database unavailable"); }),
    /database unavailable/
  );
});
