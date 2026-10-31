import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {createQaPushD1DeliveryGate,QA_PUSH_D1_DELIVERY_READINESS}
  from './qa-push-d1-delivery-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const frozenEvent={actorUid:A,recipientUid:B};
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
function fixture({deliver,verifyOutbound=async()=>true,
  verifyDelivery=async()=>true}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec(schema);
  sql.exec('CREATE TABLE delivered (event_key TEXT PRIMARY KEY, created_at INTEGER NOT NULL)');
  const captured={d1:[],fcm:[]};
  const bridge={prepare(query){return {bind(...args){return {
    async all(){return {results:sql.prepare(query).all(...args)};},
    async first(){return sql.prepare(query).get(...args)||null;}
  };}};}};
  const d1={prepare(query){
    const expected='INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)';
    if(query!==expected)throw Error('qa_unexpected_d1_sql');
    return {bind(...args){return {async run(){
      captured.d1.push({sql:query,args});
      const result=sql.prepare(query).run(...args);
      return {meta:{changes:result.changes}};
    }};}};
  }};
  const barrier=createQaPrivilegedWriteBarrier(bridge);
  const output=async(url,opts)=>{
    captured.fcm.push({url,body:JSON.parse(opts.body)});
    if(deliver)return deliver(url,opts);
    return new Response(JSON.stringify({name:'messages/qa'}),{status:200});
  };
  const gate=createQaPushD1DeliveryGate({
    db:d1,barrier,deliver:output,verifyOutbound,verifyDelivery,
    now:()=>1_793_448_000_000
  });
  return {sql,gate,barrier,captured,close:()=>sql.close(),
    markerCount:()=>sql.prepare('SELECT COUNT(*) AS n FROM delivered').get().n};
}
test('actual Push D1 SQL and exact FCM fixture are covered by one outer ticket',async()=>{
  const t=fixture();
  try{
    const result=await t.gate.reply(frozenEvent);
    assert.deepEqual(result,{status:'qa_delivery_verified',productionReady:false});
    assert.equal(t.markerCount(),1);
    assert.equal(t.captured.d1.length,1);
    assert.equal(t.captured.fcm.length,1);
    assert.equal(t.captured.fcm[0].body.message.data.actorUid,A);
    assert.equal(t.captured.fcm[0].body.message.data.uid,B);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
    assert.deepEqual(await t.barrier.status(B),{state:'active',inFlight:0});
  }finally{t.close();}
});
test('freeze of recipient or actor denies D1 marker and FCM before side effects',async()=>{
  for(const frozen of [A,B]){
    const t=fixture();
    try{
      await t.barrier.beginFreeze(frozen);await t.barrier.finalizeFreeze(frozen);
      await assert.rejects(t.gate.reply(frozenEvent),/qa_privileged_write_blocked/);
      assert.equal(t.markerCount(),0);
      assert.equal(t.captured.d1.length,0);
      assert.equal(t.captured.fcm.length,0);
    }finally{t.close();}
  }
});
test('duplicate event cannot send the same FCM again',async()=>{
  const t=fixture();
  try{
    await t.gate.reply(frozenEvent);
    const duplicate=await t.gate.reply(frozenEvent);
    assert.equal(duplicate.status,'qa_duplicate_no_send');
    assert.equal(t.captured.fcm.length,1);
    assert.equal(t.markerCount(),1);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
  }finally{t.close();}
});
test('TOPIC, invented users, forged post and unspecified identity never reach D1',async()=>{
  const t=fixture();
  try{
    for(const invalid of [
      {...frozenEvent,topic:'atrio_thread_qa_post'},
      {...frozenEvent,topic:'atrio_comunicados_v1'},
      {...frozenEvent,recipientUid:'real-customer'},
      {...frozenEvent,actorUid:'real-customer'},
      {...frozenEvent,postId:'not_qa_post'},
      {...frozenEvent,replyId:'not_qa_reply'},
      {...frozenEvent,actorUid:B,recipientUid:B},
      {recipientUid:B}
    ])await assert.rejects(t.gate.reply(invalid),/qa_push_d1_unscoped_or_topic/);
    assert.equal(t.captured.d1.length,0);
    assert.equal(t.captured.fcm.length,0);
  }finally{t.close();}
});
test('ambiguous FCM outcome keeps both durable tickets after a D1 marker',async()=>{
  const t=fixture({deliver:async()=>new Response('failure',{status:503})});
  try{
    await assert.rejects(t.gate.reply(frozenEvent),
      /qa_push_outbound_ambiguous/);
    assert.equal(t.markerCount(),1);
    assert.equal(t.captured.fcm.length,1);
    assert.equal((await t.barrier.status(A)).inFlight,2);
    assert.equal((await t.barrier.status(B)).inFlight,2);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
  }finally{t.close();}
});
test('external acceptance without independent verification blocks freeze',async()=>{
  const t=fixture({verifyDelivery:async()=>false});
  try{
    await assert.rejects(t.gate.reply(frozenEvent),
      /qa_push_d1_delivery_unverified/);
    assert.equal(t.markerCount(),1);
    assert.equal(t.captured.fcm.length,1);
    assert.equal((await t.barrier.status(A)).inFlight,1);
    assert.equal((await t.barrier.status(B)).inFlight,1);
    await t.barrier.beginFreeze(B);
    await assert.rejects(t.barrier.finalizeFreeze(B),
      /qa_inflight_or_not_draining/);
  }finally{t.close();}
});
test('freeze while FCM fixture is in-flight waits until FCM verification finishes',async()=>{
  let entered,release;
  const started=new Promise(done=>{entered=done;});
  const hold=new Promise(done=>{release=done;});
  const t=fixture({deliver:async()=>{
    entered();await hold;
    return new Response('{}',{status:200});
  }});
  try{
    const pending=t.gate.reply(frozenEvent);
    await started;
    assert.equal(t.markerCount(),1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
    release();
    assert.equal((await pending).status,'qa_delivery_verified');
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
  }finally{release?.();t.close();}
});
test('failed delivery verification stops a subsequent retry before any new I/O',async()=>{
  const t=fixture({verifyDelivery:async()=>false});
  try{
    await assert.rejects(t.gate.reply(frozenEvent),/qa_push_d1_delivery_unverified/);
    assert.equal(t.captured.fcm.length,1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.gate.reply(frozenEvent),/qa_privileged_write_blocked/);
    assert.equal(t.captured.fcm.length,1);
  }finally{t.close();}
});
test('no real credentials, D1 binding or topic mode are authorized by QA component',()=>{
  assert.equal(QA_PUSH_D1_DELIVERY_READINESS.productionIntegrated,false);
  assert.equal(QA_PUSH_D1_DELIVERY_READINESS.actualWorkerModified,false);
  assert.equal(QA_PUSH_D1_DELIVERY_READINESS.topicSupported,false);
  assert.equal(QA_PUSH_D1_DELIVERY_READINESS.remoteD1OrFcmSupported,false);
});
