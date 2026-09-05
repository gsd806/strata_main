"use strict";

const test=require("node:test");
const assert=require("node:assert/strict");
const {createHmac}=require("node:crypto");
const {
  DEFAULT_PRODUCT_ID,
  DEFAULT_PRICE_ID,
  getPaymentConfig,
  verifyPaddleSignature,
  createPaddleTransaction,
  fetchPaddleTransaction,
  cancelPaddleTransaction,
  validateCheckoutTransaction,
  findPaddleCheckoutTransaction,
  fetchPaddleIpv4Cidrs,
  isPaddleWebhookAddress,
  validateCompletedTransaction,
  fullRevocationFromAdjustment
}=require("../src/payments");

const API_KEY="pdl_live_apikey_01fixture0000000000000000_fixture_secret_123";
const WEBHOOK_SECRET="pdl_ntfset_server_only_fixture";
const CLIENT_TOKEN="live_client_side_fixture_123456";
const NOW_SECONDS=1_788_393_600;

function liveEnv(overrides={}) {
  return {
    NODE_ENV:"production",
    PADDLE_CHECKOUT_ENABLED:"true",
    PADDLE_CLIENT_TOKEN:CLIENT_TOKEN,
    PADDLE_API_KEY:API_KEY,
    PADDLE_WEBHOOK_SECRET:WEBHOOK_SECRET,
    PADDLE_PRODUCT_ID:DEFAULT_PRODUCT_ID,
    PADDLE_PRICE_ID:DEFAULT_PRICE_ID,
    ...overrides
  };
}

function signature(rawBody,{timestamp=NOW_SECONDS,secret=WEBHOOK_SECRET}={}) {
  const body=Buffer.isBuffer(rawBody)?rawBody:Buffer.from(String(rawBody));
  return createHmac("sha256",secret)
    .update(Buffer.concat([Buffer.from(`${timestamp}:`),body]))
    .digest("hex");
}

function signatureHeader(rawBody,options={}) {
  const timestamp=options.timestamp??NOW_SECONDS;
  return `ts=${timestamp};h1=${signature(rawBody,{...options,timestamp})}`;
}

function completedTransaction(overrides={}) {
  const base={
    id:"txn_01m1ky8j916ybyacs836dxbz8x",
    status:"completed",
    customer_id:"ctm_01m1ky8j916ybyacs836dxbz8x",
    subscription_id:null,
    collection_mode:"automatic",
    currency_code:"USD",
    discount_id:null,
    custom_data:{strata_user_id:"user-1",strata_version:1},
    items:[{
      quantity:1,
      price:{
        id:DEFAULT_PRICE_ID,
        product_id:DEFAULT_PRODUCT_ID,
        billing_cycle:null
      }
    }],
    details:{totals:{subtotal:"599",discount:"0",tax:"0",total:"599",grand_total:"599"}}
  };
  return {...base,...overrides};
}

function checkoutTransaction(overrides={}) {
  const base={
    id:"txn_01m1kz00000000000000000000",
    status:"ready",
    subscription_id:null,
    collection_mode:"automatic",
    origin:"api",
    created_at:"2026-09-05T10:00:00.000Z",
    updated_at:"2026-09-05T10:00:01.000Z",
    custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-1",strata_version:1},
    items:[{
      quantity:1,
      price:{id:DEFAULT_PRICE_ID,product_id:DEFAULT_PRODUCT_ID,billing_cycle:null}
    }]
  };
  return {...base,...overrides};
}

function adjustment(overrides={}) {
  return {
    id:"adj_01m1ky8j916ybyacs836dxbz8x",
    transaction_id:"txn_01m1ky8j916ybyacs836dxbz8x",
    action:"refund",
    type:"full",
    status:"approved",
    ...overrides
  };
}

test("live configuration is fail-closed and serializes browser-safe fields only",()=>{
  assert.equal(DEFAULT_PRODUCT_ID,"pro_01m1ky8j916ybyacs836dxbz8x");
  assert.equal(DEFAULT_PRICE_ID,"pri_01m1kyc2zd313d7a3ssmg02424");

  const missing=getPaymentConfig({PADDLE_CHECKOUT_ENABLED:"true"});
  assert.equal(missing.environment,"live");
  assert.equal(missing.requestedEnabled,true);
  assert.equal(missing.configured,false);
  assert.equal(missing.enabled,false);
  assert.equal(missing.clientToken,"");
  assert.ok(missing.missing.length>=3);

  const notRequested=getPaymentConfig(liveEnv({PADDLE_CHECKOUT_ENABLED:"false"}));
  assert.equal(notRequested.configured,true);
  assert.equal(notRequested.requestedEnabled,false);
  assert.equal(notRequested.enabled,false);

  for(const overrides of [
    {PADDLE_CLIENT_TOKEN:"live_"},
    {PADDLE_CLIENT_TOKEN:"test_sandbox_token_fixture"},
    {PADDLE_CLIENT_TOKEN:"live_sandbox_mismatch_fixture"},
    {PADDLE_CLIENT_TOKEN:"live_replace-with-your-client-side-token"},
    {PADDLE_API_KEY:"pdl_sdbx_apikey_fixture_123456"},
    {PADDLE_API_KEY:"pdl_live_apikey_replace-with-your-private-live-api-key"},
    {PADDLE_WEBHOOK_SECRET:"short"},
    {PADDLE_WEBHOOK_SECRET:"pdl_ntfset_replace-with-your-endpoint-secret"},
    {PADDLE_PRODUCT_ID:"pro_invalid"},
    {PADDLE_PRICE_ID:"pri_invalid"}
  ]) {
    const config=getPaymentConfig(liveEnv(overrides));
    assert.equal(config.configured,false,JSON.stringify(overrides));
    assert.equal(config.enabled,false,JSON.stringify(overrides));
  }

  const configured=getPaymentConfig(liveEnv());
  assert.equal(configured.environment,"live");
  assert.equal(configured.configured,true);
  assert.equal(configured.enabled,true);
  assert.equal(configured.clientToken,CLIENT_TOKEN);
  assert.equal(configured.productId,DEFAULT_PRODUCT_ID);
  assert.equal(configured.priceId,DEFAULT_PRICE_ID);
  assert.deepEqual(configured.price,{amount:"5.99",currency:"USD"});
  assert.ok(Object.isFrozen(configured));

  const serialized=JSON.stringify(configured);
  assert.ok(serialized.includes(CLIENT_TOKEN),"The client-side token is intentionally browser-safe");
  assert.ok(!serialized.includes(API_KEY),"The API key must stay server-only");
  assert.ok(!serialized.includes(WEBHOOK_SECRET),"The webhook secret must stay server-only");
  assert.doesNotMatch(serialized,/pdl_(?:live|sandbox|sdbx)_apikey_/i);
  assert.doesNotMatch(serialized,/pdl_ntfset_/i);
});

test("Paddle signatures cover the exact raw body and accept any valid h1",()=>{
  const raw=Buffer.from('{\n  "event_type": "transaction.completed",\n  "note": "STRATA · الإمارات"\n}',"utf8");
  const valid=signatureHeader(raw);
  assert.equal(verifyPaddleSignature(raw,valid,WEBHOOK_SECRET,{now:NOW_SECONDS}),true);
  assert.equal(verifyPaddleSignature(raw.toString("utf8"),valid,WEBHOOK_SECRET,{now:NOW_SECONDS}),true);

  const correct=signature(raw);
  const rotated=`ts=${NOW_SECONDS};h1=${"0".repeat(64)};v=1;h1=${correct}`;
  assert.equal(verifyPaddleSignature(raw,rotated,WEBHOOK_SECRET,{now:NOW_SECONDS}),true);

  assert.equal(verifyPaddleSignature(Buffer.concat([raw,Buffer.from("\n")]),valid,WEBHOOK_SECRET,{now:NOW_SECONDS}),false);
  assert.equal(verifyPaddleSignature(Buffer.from(raw.toString("utf8").replace("  "," ")),valid,WEBHOOK_SECRET,{now:NOW_SECONDS}),false);
  assert.equal(verifyPaddleSignature(raw,valid,"pdl_ntfset_wrong_secret_fixture",{now:NOW_SECONDS}),false);
});

test("Paddle signature timestamps have deterministic tolerance boundaries",()=>{
  for(const timestamp of [NOW_SECONDS-5,NOW_SECONDS,NOW_SECONDS+5]) {
    const raw=Buffer.from(`{"timestamp":${timestamp}}`);
    assert.equal(
      verifyPaddleSignature(raw,signatureHeader(raw,{timestamp}),WEBHOOK_SECRET,{now:NOW_SECONDS,toleranceSeconds:5}),
      true,
      `timestamp ${timestamp}`
    );
  }
  for(const timestamp of [NOW_SECONDS-6,NOW_SECONDS+6]) {
    const raw=Buffer.from(`{"timestamp":${timestamp}}`);
    assert.equal(
      verifyPaddleSignature(raw,signatureHeader(raw,{timestamp}),WEBHOOK_SECRET,{now:NOW_SECONDS,toleranceSeconds:5}),
      false,
      `timestamp ${timestamp}`
    );
  }

  const raw=Buffer.from('{"event_id":"evt_fixture"}');
  const validH1=signature(raw);
  for(const header of [
    "",
    `h1=${validH1}`,
    `ts=${NOW_SECONDS}`,
    `ts=not-a-number;h1=${validH1}`,
    `ts=${NOW_SECONDS}.5;h1=${validH1}`,
    `ts=${NOW_SECONDS};ts=${NOW_SECONDS};h1=${validH1}`,
    `ts=${NOW_SECONDS};h1=not-hex`,
    `ts=${NOW_SECONDS};h1=${"a".repeat(63)}`,
    `ts=999999999999999999999999;h1=${validH1}`
  ]) assert.equal(verifyPaddleSignature(raw,header,WEBHOOK_SECRET,{now:NOW_SECONDS}),false,header);
});

test("transaction creation fixes catalog and account metadata on the server",async()=>{
  const config=getPaymentConfig(liveEnv());
  const calls=[];
  const transactionId="txn_01m1kz00000000000000000000";
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    return {ok:true,json:async()=>({data:checkoutTransaction({
      id:transactionId,
      status:"draft",
      custom_data:{strata_user_id:"user-server-owned",strata_checkout_id:"checkout-server-owned",strata_version:1}
    })})};
  };
  const account={
    userId:"user-server-owned",
    checkoutId:"checkout-server-owned",
    email:"Buyer@Example.Test",
    priceId:"pri_attacker_controlled",
    productId:"pro_attacker_controlled",
    transactionId:"txn_attacker_controlled",
    collectionMode:"manual",
    customData:{strata_user_id:"victim-user"}
  };
  const result=await createPaddleTransaction(config,account,fetchImpl);
  assert.deepEqual(result,{transactionId,status:"draft"});
  assert.equal(calls.length,1);
  assert.equal(calls[0].url,"https://api.paddle.com/transactions");
  assert.equal(calls[0].options.method,"POST");
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${API_KEY}`);
  assert.equal(calls[0].options.headers["Content-Type"],"application/json");
  assert.equal(calls[0].options.headers["Paddle-Version"],"1");

  const body=JSON.parse(calls[0].options.body);
  assert.deepEqual(body,{
    items:[{price_id:DEFAULT_PRICE_ID,quantity:1}],
    collection_mode:"automatic",
    custom_data:{
      strata_user_id:"user-server-owned",
      strata_checkout_id:"checkout-server-owned",
      strata_version:1
    }
  });
  const serialized=JSON.stringify({result,body});
  assert.ok(!serialized.includes("attacker_controlled"));
  assert.ok(!serialized.includes("victim-user"));
  assert.ok(!serialized.includes(API_KEY));
  assert.ok(!serialized.includes(WEBHOOK_SECRET));
});

test("checkout transaction recovery validates the durable account and checkout references",()=>{
  const config=getPaymentConfig(liveEnv());
  const expected={userId:"user-1",checkoutId:"checkout-1"};
  assert.deepEqual(validateCheckoutTransaction(checkoutTransaction(),config,expected),{ok:true});

  const cases=[
    ["invalid transaction",{id:"not-a-transaction"},"transaction"],
    ["short transaction ID",{id:"txn_01m1kz0000000000000000000"},"transaction"],
    ["long transaction ID",{id:"txn_01m1kz000000000000000000000"},"transaction"],
    ["non-API origin",{origin:"web"},"origin"],
    ["subscription",{subscription_id:"sub_01m1kz00000000000000000000"},"subscription"],
    ["manual collection",{collection_mode:"manual"},"collection"],
    ["another account",{custom_data:{strata_user_id:"user-2",strata_checkout_id:"checkout-1"}},"account"],
    ["another checkout",{custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-2"}},"checkout"],
    ["wrong metadata version",{custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-1",strata_version:2}},"metadata"],
    ["extra item",{items:[...checkoutTransaction().items,...checkoutTransaction().items]},"items"],
    ["wrong quantity",{items:[{...checkoutTransaction().items[0],quantity:2}]},"quantity"],
    ["wrong price",{items:[{quantity:1,price:{id:"pri_01wrong00000000000000000000",product_id:DEFAULT_PRODUCT_ID,billing_cycle:null}}]},"price"],
    ["wrong product",{items:[{quantity:1,price:{id:DEFAULT_PRICE_ID,product_id:"pro_01wrong00000000000000000000",billing_cycle:null}}]},"product"],
    ["recurring price",{items:[{quantity:1,price:{id:DEFAULT_PRICE_ID,product_id:DEFAULT_PRODUCT_ID,billing_cycle:{interval:"month",frequency:1}}}]},"product"]
  ];
  for(const [label,overrides,reason] of cases) {
    assert.deepEqual(validateCheckoutTransaction(checkoutTransaction(overrides),config,expected),{ok:false,reason},label);
  }
});

test("checkout transaction recovery searches Paddle pages and returns only an exact durable match",async()=>{
  const config=getPaymentConfig(liveEnv());
  const createdAt=Date.parse("2026-09-05T10:00:00.000Z");
  const calls=[];
  const wrongCheckout=checkoutTransaction({
    id:"txn_01m1kz00000000000000000001",
    custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-other",strata_version:1}
  });
  const match=checkoutTransaction({id:"txn_01m1kz00000000000000000002"});
  const fetchImpl=async(url,options)=>{
    calls.push({url:String(url),options});
    if(calls.length===1) {
      return {
        ok:true,
        json:async()=>({
          data:[wrongCheckout],
          meta:{pagination:{has_more:true,next:"https://api.paddle.com/transactions?after=page-1"}}
        })
      };
    }
    return {ok:true,json:async()=>({data:[match],meta:{pagination:{has_more:false,next:null}}})};
  };

  assert.deepEqual(
    await findPaddleCheckoutTransaction(config,{userId:"user-1",checkoutId:"checkout-1",createdAt},fetchImpl),
    {transactionId:match.id,status:"ready",data:match}
  );
  assert.equal(calls.length,2);
  const firstUrl=new URL(calls[0].url);
  assert.equal(firstUrl.origin,"https://api.paddle.com");
  assert.equal(firstUrl.pathname,"/transactions");
  assert.equal(firstUrl.searchParams.get("created_at[GTE]"),"2026-09-05T09:59:00.000Z");
  assert.equal(firstUrl.searchParams.get("created_at[LTE]"),"2026-09-05T10:05:00.000Z");
  assert.equal(firstUrl.searchParams.get("origin"),"api");
  assert.equal(firstUrl.searchParams.get("collection_mode"),"automatic");
  assert.equal(firstUrl.searchParams.get("subscription_id"),"null");
  assert.equal(firstUrl.searchParams.get("order_by"),"created_at[ASC]");
  assert.equal(firstUrl.searchParams.get("per_page"),"30");
  assert.equal(calls[0].options.headers.Authorization,`Bearer ${API_KEY}`);
  assert.equal(calls[0].options.headers["Skip-Count"],"true");
  const secondUrl=new URL(calls[1].url);
  assert.equal(secondUrl.searchParams.get("after"),"page-1");
  assert.equal(secondUrl.searchParams.get("created_at[GTE]"),"2026-09-05T09:59:00.000Z");
  assert.equal(secondUrl.searchParams.get("created_at[LTE]"),"2026-09-05T10:05:00.000Z");
  assert.equal(secondUrl.searchParams.get("order_by"),"created_at[ASC]");

  const missing=await findPaddleCheckoutTransaction(
    config,
    {userId:"user-1",checkoutId:"checkout-missing",createdAt},
    async()=>({ok:true,json:async()=>({data:[match],meta:{pagination:{has_more:false,next:null}}})})
  );
  assert.equal(missing,null);
});

test("checkout transaction recovery rejects malformed lists and unsafe pagination",async(t)=>{
  const config=getPaymentConfig(liveEnv());
  const reference={userId:"user-1",checkoutId:"checkout-1",createdAt:Date.now()};
  await t.test("malformed list",async()=>{
    await assert.rejects(
      findPaddleCheckoutTransaction(config,reference,async()=>({ok:true,json:async()=>({data:{}})})),
      (error)=>error.status===502&&error.code==="PADDLE_RECONCILIATION_INVALID_RESPONSE"
    );
  });
  await t.test("cross-origin next page",async()=>{
    await assert.rejects(
      findPaddleCheckoutTransaction(config,reference,async()=>({
        ok:true,
        json:async()=>({data:[],meta:{pagination:{has_more:true,next:"https://attacker.example/transactions?page=2"}}})
      })),
      (error)=>error.status===502&&error.code==="PADDLE_RECONCILIATION_INVALID_RESPONSE"
    );
  });
  await t.test("missing cursor",async()=>{
    await assert.rejects(
      findPaddleCheckoutTransaction(config,reference,async()=>({
        ok:true,
        json:async()=>({data:[],meta:{pagination:{has_more:true,next:"https://api.paddle.com/transactions?page=2"}}})
      })),
      (error)=>error.status===502&&error.code==="PADDLE_RECONCILIATION_INVALID_RESPONSE"
    );
  });
  await t.test("pagination cycle",async()=>{
    let page=0;
    await assert.rejects(
      findPaddleCheckoutTransaction(config,reference,async()=>{
        page+=1;
        return {
          ok:true,
          json:async()=>({
            data:[],
            meta:{pagination:{has_more:true,next:"https://api.paddle.com/transactions?after=repeated"}}
          })
        };
      }),
      (error)=>page===2&&error.status===502&&error.code==="PADDLE_RECONCILIATION_INVALID_RESPONSE"
    );
  });
});

test("checkout transaction recovery exhausts every page in its bounded window",async()=>{
  const config=getPaymentConfig(liveEnv());
  const createdAt=Date.parse("2026-09-05T10:00:00.000Z");
  const match=checkoutTransaction({id:"txn_01m1kz00000000000000000009"});
  const calls=[];
  const fetchImpl=async(url)=>{
    calls.push(new URL(String(url)));
    const page=calls.length;
    return {
      ok:true,
      json:async()=>({
        data:page===7?[match]:[],
        meta:{pagination:{
          has_more:page<7,
          next:page<7?`https://api.paddle.com/transactions?after=page-${page}`:null
        }}
      })
    };
  };

  const result=await findPaddleCheckoutTransaction(config,{userId:"user-1",checkoutId:"checkout-1",createdAt},fetchImpl);
  assert.equal(result.transactionId,match.id);
  assert.equal(calls.length,7);
  for(const [index,url] of calls.entries()) {
    assert.equal(url.searchParams.get("created_at[GTE]"),"2026-09-05T09:59:00.000Z");
    assert.equal(url.searchParams.get("created_at[LTE]"),"2026-09-05T10:05:00.000Z");
    assert.equal(url.searchParams.get("order_by"),"created_at[ASC]");
    assert.equal(url.searchParams.get("after"),index?`page-${index}`:null);
  }
});

test("transaction creation fails closed with sanitized errors",async(t)=>{
  await t.test("disabled checkout",async()=>{
    const config=getPaymentConfig(liveEnv({PADDLE_CHECKOUT_ENABLED:"false"}));
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1"},async()=>{throw new Error("must not run");}),
      (error)=>error.status===503&&error.code==="CHECKOUT_UNAVAILABLE"&&!String(error.message).includes(API_KEY)
    );
  });

  await t.test("missing account",async()=>{
    const config=getPaymentConfig(liveEnv());
    await assert.rejects(
      createPaddleTransaction(config,{},async()=>{throw new Error("must not run");}),
      (error)=>error.status===401&&error.code==="SIGN_IN_REQUIRED"
    );
  });

  await t.test("network failure",async()=>{
    const config=getPaymentConfig(liveEnv());
    const upstream=`network failure containing ${API_KEY} and ${WEBHOOK_SECRET}`;
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1",checkoutId:"checkout-1"},async()=>{throw new Error(upstream);}),
      (error)=>{
        assert.equal(error.status,502);
        assert.equal(error.code,"PADDLE_UNAVAILABLE");
        assert.ok(!error.message.includes(API_KEY));
        assert.ok(!error.message.includes(WEBHOOK_SECRET));
        assert.ok(!error.message.includes(upstream));
        return true;
      }
    );
  });

  await t.test("rejected API response",async()=>{
    const config=getPaymentConfig(liveEnv());
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1",checkoutId:"checkout-1"},async()=>({
        ok:false,
        status:400,
        json:async()=>({error:{detail:`private upstream detail ${API_KEY}`}})
      })),
      (error)=>error.status===502&&error.code==="PADDLE_REQUEST_FAILED"&&!error.message.includes(API_KEY)
    );
  });

  await t.test("malformed success response",async()=>{
    const config=getPaymentConfig(liveEnv());
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1",checkoutId:"checkout-1"},async()=>({
        ok:true,
        json:async()=>({data:{id:`not-a-transaction-${WEBHOOK_SECRET}`}})
      })),
      (error)=>error.status===502&&error.code==="PADDLE_INVALID_RESPONSE"&&!error.message.includes(WEBHOOK_SECRET)
    );
  });

  await t.test("unexpected creation status",async()=>{
    const config=getPaymentConfig(liveEnv());
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1",checkoutId:"checkout-1"},async()=>({
        ok:true,
        json:async()=>({data:checkoutTransaction({status:"completed"})})
      })),
      (error)=>error.status===502&&error.code==="PADDLE_INVALID_RESPONSE"
    );
  });

  await t.test("missing checkout reference",async()=>{
    const config=getPaymentConfig(liveEnv());
    await assert.rejects(
      createPaddleTransaction(config,{userId:"user-1"},async()=>{throw new Error("must not run");}),
      (error)=>error instanceof TypeError&&error.message==="A checkout reference is required."
    );
  });

  await t.test("mismatched success response",async(t)=>{
    const config=getPaymentConfig(liveEnv());
    const cases=[
      ["short transaction ID",{id:"txn_01m1kz0000000000000000000"}],
      ["long transaction ID",{id:"txn_01m1kz000000000000000000000"}],
      ["non-API origin",{origin:"web"}],
      ["subscription",{subscription_id:"sub_01m1kz00000000000000000000"}],
      ["manual collection",{collection_mode:"manual"}],
      ["another account",{custom_data:{strata_user_id:"user-2",strata_checkout_id:"checkout-1",strata_version:1}}],
      ["another checkout",{custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-2",strata_version:1}}],
      ["wrong metadata version",{custom_data:{strata_user_id:"user-1",strata_checkout_id:"checkout-1",strata_version:2}}],
      ["wrong price",{items:[{quantity:1,price:{id:"pri_01wrong00000000000000000000",product_id:DEFAULT_PRODUCT_ID,billing_cycle:null}}]}],
      ["wrong product",{items:[{quantity:1,price:{id:DEFAULT_PRICE_ID,product_id:"pro_01wrong00000000000000000000",billing_cycle:null}}]}],
      ["recurring price",{items:[{quantity:1,price:{id:DEFAULT_PRICE_ID,product_id:DEFAULT_PRODUCT_ID,billing_cycle:{interval:"month",frequency:1}}}]}]
    ];
    for(const [label,overrides] of cases) {
      await t.test(label,async()=>{
        await assert.rejects(
          createPaddleTransaction(config,{userId:"user-1",checkoutId:"checkout-1"},async()=>({
            ok:true,
            json:async()=>({data:checkoutTransaction({status:"draft",...overrides})})
          })),
          (error)=>error.status===502&&error.code==="PADDLE_INVALID_RESPONSE"
        );
      });
    }
  });
});

test("transaction reconciliation reads and cancels only a specific live transaction",async()=>{
  const config=getPaymentConfig(liveEnv());
  const transactionId="txn_01m1kz00000000000000000000";
  const calls=[];
  const fetchImpl=async(url,options)=>{
    calls.push({url,options});
    const status=options.method==="PATCH"?"canceled":"ready";
    return {ok:true,json:async()=>({data:{id:transactionId,status}})};
  };
  assert.deepEqual(await fetchPaddleTransaction(config,transactionId,fetchImpl),{transactionId,status:"ready",data:{id:transactionId,status:"ready"}});
  assert.deepEqual(await cancelPaddleTransaction(config,transactionId,fetchImpl),{transactionId,status:"canceled"});
  assert.equal(calls[0].url,`https://api.paddle.com/transactions/${transactionId}`);
  assert.equal(calls[0].options.method,"GET");
  assert.equal(calls[1].options.method,"PATCH");
  assert.deepEqual(JSON.parse(calls[1].options.body),{status:"canceled"});
  for(const call of calls)assert.equal(call.options.headers.Authorization,`Bearer ${API_KEY}`);
});

test("transaction reconciliation fails closed with sanitized provider errors",async()=>{
  const config=getPaymentConfig(liveEnv());
  const transactionId="txn_01m1kz00000000000000000000";
  await assert.rejects(
    ()=>fetchPaddleTransaction(config,transactionId,async()=>{throw new Error(`leak ${API_KEY}`);}),
    (error)=>error.status===502&&error.code==="PADDLE_RECONCILIATION_UNAVAILABLE"&&!error.message.includes(API_KEY)
  );
  await assert.rejects(
    ()=>fetchPaddleTransaction(config,transactionId,async()=>({ok:true,json:async()=>({data:{id:transactionId,status:"unknown"}})})),
    (error)=>error.code==="PADDLE_RECONCILIATION_INVALID_RESPONSE"
  );
  await assert.rejects(
    ()=>cancelPaddleTransaction(config,transactionId,async()=>({ok:true,json:async()=>({data:{id:transactionId,status:"completed"}})})),
    (error)=>error.code==="PADDLE_RECONCILIATION_FAILED"
  );
  for(const invalidId of [
    "txn_01m1kz0000000000000000000",
    "txn_01m1kz000000000000000000000"
  ]) {
    await assert.rejects(
      ()=>fetchPaddleTransaction(config,invalidId,async()=>{throw new Error("must not run");}),
      (error)=>error instanceof TypeError
    );
  }
});

test("completed one-time transactions validate at full price or a zero total",()=>{
  const config=getPaymentConfig(liveEnv());
  assert.deepEqual(validateCompletedTransaction(completedTransaction(),config),{ok:true});

  const promoted=completedTransaction({
    discount_id:"dsc_01m1ky8j916ybyacs836dxbz8x",
    details:{totals:{subtotal:"599",discount:"599",tax:"0",total:"0",grand_total:"0"}}
  });
  assert.deepEqual(validateCompletedTransaction(promoted,config),{ok:true});
});

test("incomplete, recurring, or mismatched transactions never validate",async(t)=>{
  const config=getPaymentConfig(liveEnv());
  const cases=[
    ["missing data",null,"status"],
    ["wrong status",completedTransaction({status:"paid"}),"status"],
    ["invalid transaction",completedTransaction({id:"txn_01m1ky8j916ybyacs836dxbz8"}),"transaction"],
    ["subscription",completedTransaction({subscription_id:"sub_01m1ky8j916ybyacs836dxbz8x"}),"subscription"],
    ["manual collection",completedTransaction({collection_mode:"manual"}),"collection"],
    ["missing collection",completedTransaction({collection_mode:undefined}),"collection"],
    ["no items",completedTransaction({items:[]}),"items"],
    ["extra item",completedTransaction({items:[...completedTransaction().items,...completedTransaction().items]}),"items"],
    ["wrong quantity",completedTransaction({items:[{...completedTransaction().items[0],quantity:2}]}),"quantity"],
    ["fractional quantity",completedTransaction({items:[{...completedTransaction().items[0],quantity:1.5}]}),"quantity"],
    ["wrong price",completedTransaction({items:[{quantity:1,price:{...completedTransaction().items[0].price,id:"pri_attacker"}}]}),"price"],
    ["wrong product",completedTransaction({items:[{quantity:1,price:{...completedTransaction().items[0].price,product_id:"pro_attacker"}}]}),"product"],
    ["recurring price",completedTransaction({items:[{quantity:1,price:{...completedTransaction().items[0].price,billing_cycle:{interval:"month",frequency:1}}}]}),"recurring"]
  ];
  for(const [name,data,reason] of cases) {
    await t.test(name,()=>assert.deepEqual(validateCompletedTransaction(data,config),{ok:false,reason}));
  }
});

test("only approved full refunds and chargebacks request revocation",()=>{
  const transactionId="txn_01m1ky8j916ybyacs836dxbz8x";
  assert.deepEqual(fullRevocationFromAdjustment(adjustment()),{transactionId,reason:"refund"});
  assert.deepEqual(fullRevocationFromAdjustment(adjustment({action:"chargeback"})),{transactionId,reason:"chargeback"});

  for(const data of [
    null,
    adjustment({status:"pending_approval"}),
    adjustment({status:"rejected"}),
    adjustment({status:"reversed"}),
    adjustment({type:"partial"}),
    adjustment({action:"credit"}),
    adjustment({action:"chargeback_warning"}),
    adjustment({action:"chargeback_reverse"}),
    adjustment({transaction_id:""}),
    adjustment({transaction_id:"txn_01m1ky8j916ybyacs836dxbz8"}),
    adjustment({transaction_id:"txn_01m1ky8j916ybyacs836dxbz8xx"})
  ]) assert.equal(fullRevocationFromAdjustment(data),null,JSON.stringify(data));
});

test("live Paddle webhook CIDRs are fetched privately and parsed",async()=>{
  const config=getPaymentConfig(liveEnv());
  let request;
  const cidrs=await fetchPaddleIpv4Cidrs(config,async(url,options)=>{
    request={url,options};
    return {ok:true,json:async()=>({data:{ipv4_cidrs:["34.232.58.13/32","10.20.0.0/16","34.232.58.13/32"]}})};
  });
  assert.equal(request.url,"https://api.paddle.com/ips");
  assert.equal(request.options.headers.Authorization,`Bearer ${API_KEY}`);
  assert.deepEqual(cidrs,["34.232.58.13/32","10.20.0.0/16"]);
});

test("webhook source matching supports exact and broader live CIDRs",()=>{
  const cidrs=["34.232.58.13/32","10.20.0.0/16"];
  assert.equal(isPaddleWebhookAddress("34.232.58.13",cidrs),true);
  assert.equal(isPaddleWebhookAddress("::ffff:34.232.58.13",cidrs),true);
  assert.equal(isPaddleWebhookAddress("10.20.99.4",cidrs),true);
  assert.equal(isPaddleWebhookAddress("34.232.58.14",cidrs),false);
  assert.equal(isPaddleWebhookAddress("not-an-ip",cidrs),false);
});
