import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {writeThreadNotices,cleanupInvalidDevice}
  from '../../push-worker/src/index.js';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {createQaPushOutboundGate,QA_PUSH_OUTBOUND_READINESS}
  from './qa-push-outbound-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const SQL=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
function fixture({deliver,verifyEffect=async()=>true}={}){
  const db=new DatabaseSync(':memory:');db.exec(SQL);
  const adapter={prepare(q){return {bind(...args){return {
    async all(){return {results:db.prepare(q).all(...args)};},
    async first(){return db.prepare(q).get(...args)||null;}
  };}};}};
  const barrier=createQaPrivilegedWriteBarrier(adapter);
  const calls=[];
  const output=async(url,opts)=>{
    calls.push({url,method:opts.method});
    if(deliver)return deliver(url,opts);
    if(new URL(url).pathname.endsWith(':batchWrite'))
      return new Response(JSON.stringify({status:[{}]}),{status:200});
    return new Response('{}',{status:200});
  };
  return {db,barrier,calls,qaFetch:createQaPushOutboundGate({
    barrier,deliver:output,verifyEffect})};
}
async function using(run,options){
  const t=fixture(options),previous=globalThis.fetch;
  try{globalThis.fetch=t.qaFetch;return await run(t);}
  finally{globalThis.fetch=previous;t.db.close();}
}
function notice(recipient=B,actor=A){
  return {topic:'atrio_thread_qa_post',recipients:[recipient],
    notice:{postId:'qa_post',replyId:'qa_reply',actorUid:actor,
      actorName:'QA',createdAt:'2026-10-31T12:00:00Z'}};
}
const invalid=()=>new Response(JSON.stringify({
  error:{code:404,status:'UNREGISTERED'}
}),{status:404});
const stale={path:'users/'+B+'/pushDevices/qa_device',
  updateTime:'2026-10-31T12:00:00.000000Z'};
const sendPath='https://fcm.googleapis.com/v1/projects/atrio-catolico/messages:send';
const message=(uid=B,token='qa-fixture-device-bob')=>({
  method:'POST',body:JSON.stringify({message:{token,data:{uid,kind:'admin'}}})
});

test('REAL thread notice: admit actor and recipient before fake Firestore I/O',async()=>using(async t=>{
  await writeThreadNotices('qa-oauth',notice());
  assert.equal(t.calls.length,1);
  assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
  assert.deepEqual(await t.barrier.status(B),{state:'active',inFlight:0});
  await t.barrier.beginFreeze(B);await t.barrier.finalizeFreeze(B);
  await assert.rejects(writeThreadNotices('qa-oauth',notice()),
    /qa_privileged_write_blocked/);
  assert.equal(t.calls.length,1,'no network after recipient freeze');
  await writeThreadNotices('qa-oauth',notice(A,A));
  assert.equal(t.calls.length,2,'Alice remains active');
}));

test('REAL thread notice blocks actor freeze before any outbound request',async()=>using(async t=>{
  await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
  await assert.rejects(writeThreadNotices('qa-oauth',notice()),
    /qa_privileged_write_blocked/);
  assert.equal(t.calls.length,0);
}));

test('REAL Firestore stale device cleanup checks owner and preserves other account',async()=>using(async t=>{
  assert.equal(await cleanupInvalidDevice('qa-oauth',stale,invalid()),true);
  assert.equal(t.calls.length,1);
  await t.barrier.beginFreeze(B);await t.barrier.finalizeFreeze(B);
  assert.equal(await cleanupInvalidDevice('qa-oauth',stale,invalid()),false);
  assert.equal(t.calls.length,1,'frozen device never deleted');
}));

test('FCM direct recipient must use a fixed QA token; topic is refused',async()=>using(async t=>{
  await t.qaFetch(sendPath,message());
  assert.equal(t.calls.length,1);
  await t.barrier.beginFreeze(B);await t.barrier.finalizeFreeze(B);
  await assert.rejects(t.qaFetch(sendPath,message()),/qa_privileged_write_blocked/);
  assert.equal(t.calls.length,1);
  for(const body of [
    {message:{topic:'atrio_comunicados_v1',data:{uid:A}}},
    {message:{token:'real-or-unrecognized-token',data:{uid:A}}},
    {message:{token:'qa-fixture-device-bob',data:{uid:A}}}
  ])await assert.rejects(t.qaFetch(sendPath,{method:'POST',body:JSON.stringify(body)}),
    /qa_push_uncovered_outbound/);
  assert.equal(t.calls.length,1);
}));

test('REAL Push fanout reserves actor and ALL recipients before a single fake batchWrite',async()=>using(async t=>{
  const e={...notice(B,A),recipients:[A,B]};
  await writeThreadNotices('qa-oauth',e);
  assert.equal(t.calls.length,1);
  assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
  assert.deepEqual(await t.barrier.status(B),{state:'active',inFlight:0});
  await t.barrier.beginFreeze(B);
  await assert.rejects(writeThreadNotices('qa-oauth',e),
    /qa_privileged_write_blocked/);
  assert.equal(t.calls.length,1,'no partial writes reach fake Firestore');
  await t.barrier.finalizeFreeze(B);
  await writeThreadNotices('qa-oauth',notice(A,A));
  assert.equal(t.calls.length,2,'independent Alice notice remains possible');
},{
  deliver:async(url,init)=>{
    const writes=JSON.parse(init.body).writes;
    return new Response(JSON.stringify({status:writes.map(()=>({}))}),{status:200});
  },
  verifyEffect:async({kind,scope,recipientUids,writeCount})=>{
    assert.equal(kind,'push_thread_notice');
    assert.ok(scope.actorUid===A);
    assert.equal(recipientUids.length,writeCount);
    assert.equal(new Set(recipientUids).size,writeCount);
    return true;
  }
}));

test('partial multi-recipient Firestore batch never releases actor or recipients',async()=>using(async t=>{
  const e={...notice(B,A),recipients:[A,B]};
  await assert.rejects(writeThreadNotices('qa-oauth',e),
    /qa_push_batch_unverified/);
  assert.equal(t.calls.length,1);
  assert.equal((await t.barrier.status(A)).inFlight,1);
  assert.equal((await t.barrier.status(B)).inFlight,1);
  await t.barrier.beginFreeze(B);
  await assert.rejects(t.barrier.finalizeFreeze(B),/qa_inflight_or_not_draining/);
},{
  deliver:async()=>new Response(JSON.stringify({status:[{}]}),{status:200})
}));

test('mismatched actors, repeated or unknown recipients reject BEFORE I/O',async()=>using(async t=>{
  const base='projects/atrio-catolico/databases/(default)/documents/';
  const endpoint='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents:batchWrite';
  const item=(recipient,actor,reply='qa_reply')=>({
    update:{name:base+'users/'+recipient+'/notifications/'+reply,
      fields:{
        postId:{stringValue:'qa_post'},replyId:{stringValue:reply},
        actorUid:{stringValue:actor},actorName:{stringValue:'QA'},
        createdAt:{timestampValue:'2026-10-31T12:00:00Z'},
        read:{booleanValue:false}
      }},
    currentDocument:{exists:false}
  });
  for(const writes of [
    [item(A,A),item(A,A)],
    [item(A,A),item(B,B)],
    [item(A,A),item('real-user',A)],
    [item(A,A),item(B,A,'qa_other_reply')],
    [item(A,A),item(B,A),item(B,A)]
  ]){
    await assert.rejects(t.qaFetch(endpoint,{
      method:'POST',body:JSON.stringify({writes})
    }),/qa_push_uncovered_outbound/);
  }
  assert.equal(t.calls.length,0);
  assert.equal((await t.barrier.status(A)).inFlight,0);
  assert.equal((await t.barrier.status(B)).inFlight,0);
}));

test('multi-recipient completion requires independent verifier approval',async()=>using(async t=>{
  const e={...notice(B,A),recipients:[A,B]};
  await assert.rejects(writeThreadNotices('qa-oauth',e),
    /qa_push_effect_unverified/);
  assert.equal(t.calls.length,1);
  assert.equal((await t.barrier.status(A)).inFlight,1);
  assert.equal((await t.barrier.status(B)).inFlight,1);
},{
  deliver:async(url,init)=>{
    const writes=JSON.parse(init.body).writes;
    return new Response(JSON.stringify({status:writes.map(()=>({}))}),{status:200});
  },
  verifyEffect:async({recipientUids})=>recipientUids.length===1
}));

test('duplicate, malformed or unscoped Firestore writes fail closed',async()=>using(async t=>{
  const ROOT='projects/atrio-catolico/databases/(default)/documents/';
  const one={update:{name:ROOT+'users/'+B+'/notifications/qa_reply',
    fields:{actorUid:{stringValue:A},replyId:{stringValue:'qa_reply'},
      postId:{stringValue:'qa_post'}}},
    currentDocument:{exists:false}};
  const url='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents:batchWrite';
  for(const writes of [[one,one],[{...one,update:{...one.update,
    name:ROOT+'users/'+A+'/profiles/private'}}],
  [{...one,update:{...one.update,fields:{...one.update.fields,
    actorUid:{stringValue:'another-user'}}}}]])
    await assert.rejects(t.qaFetch(url,{method:'POST',
      body:JSON.stringify({writes})}),/qa_push_uncovered_outbound/);
  assert.equal(t.calls.length,0);
}));

test('unknown network routes fail before calling fake delivery',async()=>using(async t=>{
  for(const [url,init] of [
    ['https://example.org/collect',{method:'POST'}],
    [sendPath,{method:'GET'}],
    ['https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/users/'+B+
      '/pushDevices/device',{method:'DELETE'}],
  ])await assert.rejects(t.qaFetch(url,init),/qa_push_uncovered_outbound/);
  assert.equal(t.calls.length,0);
}));

test('ambiguous HTTP response keeps in-flight ticket and blocks freeze completion',
  async()=>using(async t=>{
    await assert.rejects(t.qaFetch(sendPath,message()),/qa_push_outbound_ambiguous/);
    assert.equal(t.calls.length,1);
    await t.barrier.beginFreeze(B);
    assert.deepEqual(await t.barrier.status(B),{state:'draining',inFlight:1});
    await assert.rejects(t.barrier.finalizeFreeze(B),/qa_inflight_or_not_draining/);
  },{deliver:async()=>new Response('{}',{status:503})})
);

test('unverified FCM outcome also keeps ticket for reconciliation',async()=>using(async t=>{
  await assert.rejects(t.qaFetch(sendPath,message()),/qa_push_effect_unverified/);
  await t.barrier.beginFreeze(B);
  await assert.rejects(t.barrier.finalizeFreeze(B),/qa_inflight_or_not_draining/);
},{verifyEffect:async()=>false}));

test('partial Firestore batch is not considered verified despite HTTP 200',async()=>using(async t=>{
  await assert.rejects(writeThreadNotices('qa-oauth',notice()),
    /qa_push_batch_unverified/);
  assert.equal((await t.barrier.status(B)).inFlight,1);
},{deliver:async()=>new Response(JSON.stringify({status:[{code:7}]}),{status:200})}));

test('known production bypass remains until real Worker integration and authorization',async()=>using(async t=>{
  await t.barrier.beginFreeze(B);await t.barrier.finalizeFreeze(B);
  // Simulate a separate Worker still using its ORIGINAL, unwrapped network.
  let bypassCalls=0;
  globalThis.fetch=async()=>{bypassCalls++;return new Response(
    JSON.stringify({status:[{}]}),{status:200});};
  await writeThreadNotices('qa-oauth',notice());
  assert.equal(bypassCalls,1,'fixture demonstrates uncovered production route');
  assert.equal(QA_PUSH_OUTBOUND_READINESS.productionIntegrated,false);
  assert.equal(QA_PUSH_OUTBOUND_READINESS.topicAndFanoutCovered,false);
}));


const replyMessage=(recipientUid=B,actorUid=A)=>({
  method:'POST',
  body:JSON.stringify({message:{
    token:recipientUid===A?'qa-fixture-device-alice':'qa-fixture-device-bob',
    data:{uid:recipientUid,kind:'reply',actorUid,postId:'qa_post',replyId:'qa_reply'}
  }})
});

test('FCM reply atomically admits author AND recipient; either freeze prevents send',async()=>using(async t=>{
  await t.qaFetch(sendPath,replyMessage());
  assert.equal(t.calls.length,1);
  assert.equal((await t.barrier.status(A)).inFlight,0);
  assert.equal((await t.barrier.status(B)).inFlight,0);
  await t.barrier.beginFreeze(A);
  await t.barrier.finalizeFreeze(A);
  await assert.rejects(t.qaFetch(sendPath,replyMessage()),/qa_privileged_write_blocked/);
  assert.equal(t.calls.length,1);
  // Unrelated administrative FCM for Bob can continue; author Alice remains frozen.
  await t.qaFetch(sendPath,message());
  assert.equal(t.calls.length,2);
}));

test('FCM reply destination freeze also prevents a new external effect',async()=>using(async t=>{
  await t.barrier.beginFreeze(B);
  await t.barrier.finalizeFreeze(B);
  await assert.rejects(t.qaFetch(sendPath,replyMessage()),/qa_privileged_write_blocked/);
  assert.equal(t.calls.length,0);
  assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
}));

test('FCM unscoped, forged and legacy reply payloads fail before any network request',async()=>using(async t=>{
  const cases=[
    {uid:B,kind:'reply'},
    {uid:B,kind:'reply',actorUid:'real-account',postId:'qa_post',replyId:'qa_reply'},
    {uid:B,kind:'reply',actorUid:A,postId:'different',replyId:'qa_reply'},
    {uid:B,kind:'admin',actorUid:A},
    {uid:B,kind:'reply',actorUid:A,postId:'qa_post'}
  ];
  for(const data of cases){
    await assert.rejects(t.qaFetch(sendPath,{method:'POST',body:JSON.stringify({
      message:{token:'qa-fixture-device-bob',data}
    })}),/qa_push_uncovered_outbound/);
  }
  assert.equal(t.calls.length,0);
  assert.equal((await t.barrier.status(A)).inFlight,0);
  assert.equal((await t.barrier.status(B)).inFlight,0);
}));

test('ambiguous FCM reply effect holds BOTH accounts until reconciliation',async()=>using(async t=>{
  await assert.rejects(t.qaFetch(sendPath,replyMessage()),
    /qa_push_outbound_ambiguous/);
  assert.equal((await t.barrier.status(A)).inFlight,1);
  assert.equal((await t.barrier.status(B)).inFlight,1);
  await t.barrier.beginFreeze(B);
  await assert.rejects(t.barrier.finalizeFreeze(B),/qa_inflight_or_not_draining/);
},{
  deliver:async()=>new Response('service unavailable',{status:503})
}));

test('FCM reply requires independent verification for BOTH participants',async()=>using(async t=>{
  await assert.rejects(t.qaFetch(sendPath,replyMessage()),
    /qa_push_effect_unverified/);
  assert.equal((await t.barrier.status(A)).inFlight,1);
  assert.equal((await t.barrier.status(B)).inFlight,1);
},{
  verifyEffect:async({kind,scope})=>{
    assert.equal(kind,'push_fcm_send');
    assert.deepEqual(scope,{actorUid:A,recipientUid:B});
    return false;
  }
}));
