/**
 * Tests the actual Push Worker HTTP and queue entry points in a strictly
 * offline, fixture-only scoped-freeze mode; no Firebase/FCM/D1 cloud access.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import worker from '../../push-worker/src/index.js';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {QA_SCOPED_PUSH_READINESS}
  from '../../push-worker/src/privacy-qa-scoped-fence.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const ENDPOINT='https://qa-only.invalid/__qa/privacy/reply';
const SQL='INSERT OR IGNORE INTO delivered (event_key,created_at) VALUES (?,?)';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
function harness({send,verify}={}){
  const db=new DatabaseSync(':memory:');
  db.exec(schema);
  db.exec('CREATE TABLE delivered (event_key TEXT PRIMARY KEY,created_at INTEGER NOT NULL)');
  const bridge={prepare(query){return {bind(...values){return{
    async all(){return {results:db.prepare(query).all(...values)};},
    async first(){return db.prepare(query).get(...values)||null;}
  };}};}};
  const barrier=createQaPrivilegedWriteBarrier(bridge);
  const calls={d1:0,fcm:0,verify:0,network:0,credentials:0};
  const localD1={prepare(query){
    assert.equal(query,SQL);
    return {bind(...values){return {async run(){
      calls.d1++;
      const info=db.prepare(query).run(...values);
      return {meta:{changes:info.changes}};
    }};}};
  }};
  const env={
    ATRIO_PRIVACY_QA_SCOPED_FENCE:'true',
    ATRIO_QA_PRIVACY_FIXTURE:'demo-atrio-v11',
    ATRIO_QA_PRIVACY_BARRIER:barrier,
    ATRIO_QA_PRIVACY_DB:localD1,
    ATRIO_QA_PRIVACY_FAKE_FCM:async scope=>{
      calls.fcm++;
      assert.deepEqual(scope,{
        actorUid:A,recipientUid:B,postId:'qa_post',
        replyId:'qa_reply',fixtureOnly:true
      });
      return send?send(scope):true;
    },
    ATRIO_QA_PRIVACY_VERIFY:async scope=>{
      calls.verify++;
      assert.equal(scope.actorUid,A);
      assert.equal(scope.recipientUid,B);
      return verify?verify(scope):true;
    }
  };
  const close=()=>db.close();
  const count=()=>db.prepare('SELECT COUNT(*) AS n FROM delivered').get().n;
  return {env,barrier,calls,count,close};
}
function req(body={actorUid:A,recipientUid:B,postId:'qa_post',
  replyId:'qa_reply'},url=ENDPOINT){
  return new Request(url,{method:'POST',body:JSON.stringify(body)});
}
async function code(responseOrPromise,status,body){
  const resp=await responseOrPromise;
  assert.equal(resp.status,status);
  assert.equal((await resp.json()).status,body);
}
async function noNetwork(fn){
  const prior=globalThis.fetch;
  let requests=0;
  globalThis.fetch=async()=>{
    requests++;
    throw Error('qa_network_forbidden');
  };
  try{
    const result=await fn();
    assert.equal(requests,0);
    return result;
  }finally{globalThis.fetch=prior;}
}
test('original Worker accepts one verified, isolated fixture delivery and no network',async()=>{
  const t=harness();
  try{
    await noNetwork(()=>code(worker.fetch(req(),t.env),
      200,'qa_fixture_verified'));
    assert.equal(t.count(),1);
    assert.deepEqual(t.calls,{d1:1,fcm:1,verify:1,network:0,credentials:0});
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
    assert.deepEqual(await t.barrier.status(B),{state:'active',inFlight:0});
    await noNetwork(()=>code(worker.fetch(req(),t.env),
      200,'qa_duplicate_no_send'));
    assert.equal(t.calls.fcm,1);
    assert.equal(t.count(),1);
  }finally{t.close();}
});
test('frozen author OR recipient blocks before D1 and fake FCM',async()=>{
  for(const subject of [A,B]){
    const t=harness();
    try{
      await t.barrier.beginFreeze(subject);
      await t.barrier.finalizeFreeze(subject);
      await noNetwork(()=>code(worker.fetch(req(),t.env),
        503,'privacy_qa_scoped_denied'));
      assert.equal(t.count(),0);
      assert.equal(t.calls.d1,0);
      assert.equal(t.calls.fcm,0);
    }finally{t.close();}
  }
});
test('in-flight fake FCM prevents final freeze until effect is verified',async()=>{
  let entered,release;
  const start=new Promise(r=>{entered=r;});
  const wait=new Promise(r=>{release=r;});
  const t=harness({send:async()=>{entered();await wait;return true;}});
  try{
    await noNetwork(async()=>{
      const pending=worker.fetch(req(),t.env);
      await start;
      await t.barrier.beginFreeze(A);
      await assert.rejects(t.barrier.finalizeFreeze(A),
        /qa_inflight_or_not_draining/);
      release();
      await code(await pending,200,'qa_fixture_verified');
    });
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
    assert.equal(t.count(),1);
  }finally{release?.();t.close();}
});
test('ambiguous fake FCM result retains ticket and blocks final freeze',async()=>{
  const t=harness({send:async()=>false});
  try{
    await noNetwork(()=>code(worker.fetch(req(),t.env),
      503,'privacy_qa_scoped_denied'));
    assert.equal(t.count(),1);
    assert.equal((await t.barrier.status(A)).inFlight,1);
    assert.equal((await t.barrier.status(B)).inFlight,1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
  }finally{t.close();}
});
test('unverified fake message keeps the ticket unresolved for both subjects',async()=>{
  const t=harness({verify:async()=>false});
  try{
    await noNetwork(()=>code(worker.fetch(req(),t.env),
      503,'privacy_qa_scoped_denied'));
    assert.equal((await t.barrier.status(A)).inFlight,1);
    assert.equal((await t.barrier.status(B)).inFlight,1);
    assert.equal(t.calls.verify,1);
  }finally{t.close();}
});
test('topic, arbitrary identity, extra keys or real host cannot reach D1',async()=>{
  const t=harness();
  try{
    const invalid=[
      {actorUid:A,recipientUid:B,postId:'qa_post',replyId:'qa_reply',
        topic:'atrio_thread_qa_post'},
      {actorUid:'actual-user',recipientUid:B,postId:'qa_post',replyId:'qa_reply'},
      {actorUid:A,recipientUid:'actual-user',postId:'qa_post',replyId:'qa_reply'},
      {actorUid:A,recipientUid:A,postId:'qa_post',replyId:'qa_reply'},
      {actorUid:A,recipientUid:B,postId:'another',replyId:'qa_reply'},
      {actorUid:A,recipientUid:B,postId:'qa_post',replyId:'other'}
    ];
    await noNetwork(async()=>{
      for(const event of invalid)
        await code(await worker.fetch(req(event),t.env),503,'privacy_qa_scoped_denied');
      await code(await worker.fetch(req(undefined,'https://example.org/__qa/privacy/reply'),t.env),
        503,'privacy_qa_scoped_denied');
      await code(await worker.fetch(req(undefined,'https://qa-only.invalid/event'),t.env),
        503,'privacy_qa_scoped_denied');
    });
    assert.equal(t.calls.d1,0);
    assert.equal(t.calls.fcm,0);
  }finally{t.close();}
});
test('real secrets or real Push D1 binding reject before reading credential getters',async()=>{
  const t=harness();
  try{
    let read=0;
    Object.defineProperty(t.env,'FIREBASE_SERVICE_ACCOUNT_JSON',{
      configurable:true,
      get(){read++;throw Error('qa_secret_access');}
    });
    await code(await worker.fetch(req(),t.env),503,'privacy_qa_scoped_denied');
    assert.equal(read,0);
    assert.equal(t.calls.d1,0);
    delete t.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    t.env.PUSH_DB={prepare(){throw Error('real_D1_access');}};
    await code(await worker.fetch(req(),t.env),503,'privacy_qa_scoped_denied');
    assert.equal(t.calls.d1,0);
  }finally{t.close();}
});
test('QA scoped mode blocks normal routes and queues before credential access',async()=>{
  const t=harness();
  try{
    await noNetwork(async()=>{
      await code(await worker.fetch(new Request('https://qa-only.invalid/health'),t.env),
        200,'privacy_qa_scoped_only');
      for(const path of ['/event','/broadcast','/moderation/event',
        '/moderation/review','/unknown']){
        await code(await worker.fetch(req(undefined,'https://qa-only.invalid'+path),t.env),
          503,'privacy_qa_scoped_denied');
      }
    });
    const observed=[];
    await worker.queue({messages:[{get body(){throw Error('queue_body_read');},
      ack(){observed.push('ack');},
      retry(options){observed.push(options.delaySeconds);}
    }]},t.env);
    assert.deepEqual(observed,[60]);
    assert.equal(t.calls.d1,0);
    assert.equal(t.calls.fcm,0);
  }finally{t.close();}
});
test('invalid mode value remains fully closed and general seal takes priority',async()=>{
  const t=harness();
  try{
    t.env.ATRIO_PRIVACY_QA_SCOPED_FENCE='typo';
    await code(await worker.fetch(req(),t.env),503,'privacy_qa_scoped_denied');
    t.env.ATRIO_PRIVACY_QA_SCOPED_FENCE='true';
    t.env.ATRIO_PRIVACY_QA_WRITE_FENCE='true';
    await code(await worker.fetch(req(),t.env),503,'privacy_qa_sealed');
    assert.equal(t.calls.d1,0);
  }finally{t.close();}
});
test('only offline fixtures exist; production, topics and deletion stay blocked',()=>{
  assert.deepEqual(QA_SCOPED_PUSH_READINESS,{
    productionIntegrated:false,accountScopedFixtureOnly:true,
    protectsDeployedWorkers:false,remoteD1OrFcm:false,
    topicDeliveryAllowed:false,realAccountDeletionAllowed:false
  });
});
