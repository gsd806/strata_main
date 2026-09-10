// @ts-check
"use strict";

const EXPORT_PAGE_SIZE=50;

/** @param {unknown} value */
function storedJson(value){const raw=String(value??"");try{return JSON.parse(raw);}catch{return{unreadable:true,raw};}}
/** @param {unknown} value */
function optionalNumber(value){return value==null?null:Number(value);}
/** @param {any} row @param {string} field */
function jsonSnapshot(row,field){return row?{data:storedJson(row[field]),updatedAt:Number(row.updated_at)}:null;}
/** @param {any} row */
function exportWorkout(row){return{id:String(row.id),workout:storedJson(row.workout_json),summary:storedJson(row.summary_json),startedAt:Number(row.started_at),revision:Number(row.revision),updatedAt:Number(row.updated_at)};}

/** @param {import("./domain-types").AccountExportStoreRows} rows @param {number} now */
function exportPayload(rows,now){
  const profile=rows.profile;
  return{
    format:"strata-account-export",schemaVersion:1,exportedAt:new Date(now).toISOString(),
    account:{id:String(profile.id),name:String(profile.name),email:String(profile.email),createdAt:Number(profile.created_at),emailVerifiedAt:optionalNumber(profile.email_verified_at)},
    weeklyPlan:jsonSnapshot(rows.weeklyPlan,"plan_json"),monthlyPlan:jsonSnapshot(rows.monthlyPlan,"plan_json"),preferences:jsonSnapshot(rows.preferences,"preferences_json"),
    ratings:rows.ratings.map((row)=>({exerciseId:String(row.exercise_id),comfort:Number(row.comfort),pump:Number(row.pump),enjoyment:Number(row.enjoyment),stability:Number(row.stability),setup:Number(row.setup),overall:Number(row.overall),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)})),
    workouts:rows.workouts.map(exportWorkout),
    checkIns:rows.checkIns.map((row)=>({workoutId:String(row.workout_id),difficulty:Number(row.difficulty),energy:Number(row.energy),comfort:Number(row.comfort),enjoyment:Number(row.enjoyment),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)})),
    training:{block:rows.trainingBlock?{data:storedJson(rows.trainingBlock.block_json),revision:Number(rows.trainingBlock.revision),updatedAt:Number(rows.trainingBlock.updated_at)}:null,adaptations:rows.trainingAdaptations.map((row)=>({id:String(row.id),workoutId:String(row.workout_id),data:storedJson(row.adaptation_json),planUpdatedAt:Number(row.plan_updated_at),status:String(row.status),createdAt:Number(row.created_at),resolvedAt:optionalNumber(row.resolved_at)}))},
    communityPlans:rows.communityPlans.map((row)=>({id:String(row.id),title:String(row.title),description:String(row.description),plan:storedJson(row.plan_json),published:Boolean(row.is_published),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)})),
    access:{
      grants:(rows.grants||[]).map((row)=>({startedAt:optionalNumber(row.grant_starts_at),expiresAt:optionalNumber(row.grant_expires_at),revokedAt:optionalNumber(row.grant_revoked_at),checkoutBlocked:row.checkout_blocked_at!=null})),
      trials:rows.trials.map((row)=>({startedAt:Number(row.started_at),expiresAt:Number(row.expires_at)})),
      purchases:rows.purchases.map((row)=>({transactionId:String(row.transaction_id),priceId:String(row.price_id),productId:String(row.product_id),subscriptionId:row.subscription_id==null?null:String(row.subscription_id),status:String(row.paddle_status),completedAt:optionalNumber(row.completed_at),accessRevokedAt:optionalNumber(row.access_revoked_at),revocationReason:row.revocation_reason==null?null:String(row.revocation_reason),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)})),
      subscriptions:rows.subscriptions.map((row)=>({id:String(row.subscription_id),transactionId:String(row.transaction_id),status:String(row.status),priceId:String(row.price_id),productId:String(row.product_id),scheduledChange:row.scheduled_change_action==null?null:{action:String(row.scheduled_change_action),effectiveAt:optionalNumber(row.scheduled_change_at)},currentPeriodEndsAt:optionalNumber(row.current_period_ends_at),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)})),
      adjustments:rows.adjustments.map((row)=>({id:String(row.adjustment_id),transactionId:String(row.transaction_id),action:String(row.action),type:row.type==null?null:String(row.type),status:String(row.status),occurredAt:Number(row.occurred_at),updatedAt:Number(row.updated_at)}))
    },
    supportTickets:rows.supportTickets.map((row)=>({id:String(row.id),reference:String(row.reference),name:String(row.name),email:String(row.email),category:String(row.category),subject:String(row.subject),referenceId:row.reference_id==null?null:String(row.reference_id),message:String(row.message),status:String(row.status),lastResponseAt:optionalNumber(row.last_response_at),createdAt:Number(row.created_at),updatedAt:Number(row.updated_at)}))
  };
}

/** @param {import("./domain-types").HttpResponse} res @param {string} chunk */
function writeChunk(res,chunk){
  if(res.destroyed||res.writableEnded)return Promise.resolve(false);
  if(res.write(chunk))return Promise.resolve(true);
  return new Promise((resolve,reject)=>{
    const cleanup=()=>{res.off("drain",drain);res.off("close",close);res.off("error",error);};
    const drain=()=>{cleanup();resolve(true);},close=()=>{cleanup();resolve(false);};
    /** @param {Error} failure */
    const error=(failure)=>{cleanup();reject(failure);};
    res.once("drain",drain);res.once("close",close);res.once("error",error);
  });
}

/**
 * Stream workout data in bounded storage pages instead of materializing the
 * account's complete history and a second synchronous compression buffer.
 * @param {import("./domain-types").HttpResponse} res
 * @param {import("./domain-types").AccountSelfServiceStore} store
 * @param {string} userId
 * @param {import("./domain-types").AccountExportStoreRows} rows
 * @param {number} exportedAt
 * @param {import("./domain-types").HttpHeaders} headers
 */
async function streamExport(res,store,userId,rows,exportedAt,headers){
  const date=new Date(exportedAt).toISOString().slice(0,10),base=JSON.stringify(exportPayload({...rows,workouts:[]},exportedAt)),marker='"workouts":[]',index=base.indexOf(marker);
  if(index<0)throw new Error("Account export could not be serialized.");
  res.writeHead(200,{...headers,"Content-Type":"application/json; charset=utf-8","Cache-Control":"private, no-store","Pragma":"no-cache","Expires":"0","Content-Disposition":`attachment; filename="strata-account-export-${date}.json"`,"X-Strata-Export":"account-v1"});
  if(!await writeChunk(res,`${base.slice(0,index)}"workouts":[`))return;
  let afterStartedAt=-1,afterId="",exported=0,first=true;
  while(true){
    const page=await store.accountExportWorkouts(userId,afterStartedAt,afterId,EXPORT_PAGE_SIZE);
    if(!Array.isArray(page)||page.length>EXPORT_PAGE_SIZE)throw new Error("Account workout export returned an invalid page.");
    for(const row of page){
      const startedAt=Number(row.started_at),id=String(row.id);
      if(!Number.isSafeInteger(startedAt)||startedAt<0||startedAt<afterStartedAt||startedAt===afterStartedAt&&id<=afterId)throw new Error("Account workout export lost its stable ordering boundary.");
      if(!await writeChunk(res,`${first?"":","}${JSON.stringify(exportWorkout(row))}`))return;
      afterStartedAt=startedAt;afterId=id;first=false;exported+=1;
      if(exported>10_000)throw new Error("Account workout export exceeded the reviewed account limit.");
    }
    if(page.length<EXPORT_PAGE_SIZE)break;
  }
  if(!res.destroyed&&!res.writableEnded)res.end(`]${base.slice(index+marker.length)}`);
}

module.exports={EXPORT_PAGE_SIZE,exportPayload,exportWorkout,streamExport};
