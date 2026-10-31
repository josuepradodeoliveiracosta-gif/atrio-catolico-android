/**
 * E2E QA with ORIGINAL Avatar, Guardian and Push Worker entrypoints.
 * ONE SQLite ledger is shared between all three, no network or cloud D1.
 * A test failure must never be interpreted as readiness for production.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import avatar from '../../avatar-worker/src/index.js';
import guardian from '../../guardian-worker/src/index.js';
import push from '../../push-worker/src/index.js';
import {createQaSharedFreezeCoordinator,QA_SHARED_FREEZE_READINESS}
  from './qa-shared-freeze-coordinator.js';
import {QA_SHARED_WORKER_ENTRY_READINESS}
  from '../../privacy-shared-qa/src/worker-entry.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const workers=Object.freeze({avatar,guardian,push});
const scopes=Object.freeze({
  avatar:{ownerUid:A},guardian:{ownerUid:A},
  push:{actorUid:A,recipientUid:B}
});
function harness({effect,verify}={}){
  const sql=new DatabaseSync(':memory:');
  sql.exec(schema);
  const db={prepare(query){return {bind(...args){return {
    async all(){return {results:sql.prepare(query).all(...args)};},
    async first(){return sql.prepare(query).get(...args)||null;}
  };}};}};
  const coordinator=createQaSharedFreezeCoordinator(db);
  const seen=[];
  function env(){
    return {
      ATRIO_PRIVACY_QA_SHARED_MODE:'true',
      ATRIO_QA_PRIVACY_FIXTURE:'demo-atrio-v11',
      ATRIO_QA_PRIVACY_COORDINATOR:coordinator,
      ATRIO_QA_PRIVACY_FAKE_EFFECT:async(service,scope)=>{
        seen.push({service,scope,phase:'effect'});
        return effect?effect(service,scope):true;
      },
      ATRIO_QA_PRIVACY_FAKE_VERIFY:async(service,scope,result)=>{
        seen.push({service,scope,phase:'verify'});
        return verify?verify(service,scope,result):result===true;
      }
    };
  }
  return {coordinator,env,seen,close:()=>sql.close()};
}
function req(service,body=scopes[service],origin='https://qa-only.invalid'){
  return new Request(origin+'/__qa/shared-freeze/'+service,{
    method:'POST',headers:{'Content-Type':'application/json'},
    body:JSON.stringify(body)
  });
}
async function expect(worker,response,code=200,body='qa_shared_fixture_verified'){
  const res=await worker.fetch(response.request,response.env);
  assert.equal(res.status,code);
  assert.deepEqual(await res.json(),{status:body});
}
async function call(service,env,body=scopes[service],origin){
  const res=await workers[service].fetch(req(service,body,origin),env);
  return {http:res.status,data:(await res.json()).status};
}
const ok={http:200,data:'qa_shared_fixture_verified'};
const denied={http:503,data:'qa_shared_worker_denied'};
async function offline(action){
  const old=globalThis.fetch;
  let count=0;
  globalThis.fetch=async()=>{count++;throw Error('network_not_permitted_in_fixture')};
  try{const value=await action();assert.equal(count,0);return value;}
  finally{globalThis.fetch=old;}
}
test('all three original Worker routes share ONE atomic SQLite coordinator',async()=>{
  const t=harness();
  try{
    await offline(async()=>{
      for(const service of ['avatar','guardian','push'])
        assert.deepEqual(await call(service,t.env()),ok);
    });
    assert.deepEqual(t.seen.filter(x=>x.phase==='effect').map(x=>x.service),
      ['avatar','guardian','push']);
    assert.deepEqual(await t.coordinator.status(A),{state:'active',inFlight:0});
    assert.deepEqual(await t.coordinator.status(B),{state:'active',inFlight:0});
  }finally{t.close();}
});
test('freeze of Alice rejects ALL services that involve Alice, but Bob remains active',async()=>{
  const t=harness();
  try{
    assert.equal(await t.coordinator.beginFreeze(A),'draining');
    await offline(async()=>{
      for(const service of ['avatar','guardian','push'])
        assert.deepEqual(await call(service,t.env()),denied);
      assert.deepEqual(await call('guardian',t.env(),{ownerUid:B}),ok);
    });
    assert.equal(t.seen.filter(x=>x.phase==='effect').length,1);
    assert.equal(await t.coordinator.finalizeFreeze(A),'frozen');
    assert.deepEqual(await call('avatar',t.env()),denied);
    assert.deepEqual(await t.coordinator.status(B),{state:'active',inFlight:0});
  }finally{t.close();}
});
test('freeze of Bob also blocks a Push from Alice, without blocking Alice Avatar',async()=>{
  const t=harness();
  try{
    await t.coordinator.beginFreeze(B);
    await t.coordinator.finalizeFreeze(B);
    assert.deepEqual(await call('push',t.env()),denied);
    assert.deepEqual(await call('avatar',t.env()),ok);
    assert.equal(t.seen.filter(x=>x.phase==='effect').length,1);
  }finally{t.close();}
});
test('concurrent Avatar effect prevents Guardian and Push from finalizing freeze',async()=>{
  let entered,release;
  const started=new Promise(r=>{entered=r});
  const held=new Promise(r=>{release=r});
  const t=harness({effect:async service=>{
    if(service==='avatar'){entered();await held;}
    return true;
  }});
  try{
    await offline(async()=>{
      const pending=call('avatar',t.env());
      await started;
      assert.equal((await t.coordinator.status(A)).inFlight,1);
      await t.coordinator.beginFreeze(A);
      await assert.rejects(t.coordinator.finalizeFreeze(A),
        /qa_inflight_or_not_draining/);
      assert.deepEqual(await call('guardian',t.env()),denied);
      assert.deepEqual(await call('push',t.env()),denied);
      release();
      assert.deepEqual(await pending,ok);
      assert.equal(await t.coordinator.finalizeFreeze(A),'frozen');
    });
  }finally{release?.();t.close();}
});
test('unknown outcome in one Worker leaves durable ticket blocking other Workers',async()=>{
  const t=harness({effect:async service=>{
    if(service==='guardian')throw Error('fixture_ambiguous_transport');
    return true;
  }});
  try{
    assert.deepEqual(await call('guardian',t.env()),denied);
    assert.equal((await t.coordinator.status(A)).inFlight,1);
    await t.coordinator.beginFreeze(A);
    await assert.rejects(t.coordinator.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
    assert.deepEqual(await call('avatar',t.env()),denied);
    assert.deepEqual(await call('push',t.env()),denied);
  }finally{t.close();}
});
test('verification failure leaves BOTH participants in-flight for Push',async()=>{
  const t=harness({verify:async()=>false});
  try{
    assert.deepEqual(await call('push',t.env()),denied);
    assert.equal((await t.coordinator.status(A)).inFlight,1);
    assert.equal((await t.coordinator.status(B)).inFlight,1);
    await t.coordinator.beginFreeze(B);
    await assert.rejects(t.coordinator.finalizeFreeze(B),
      /qa_inflight_or_not_draining/);
    assert.deepEqual(await call('avatar',t.env()),denied);
  }finally{t.close();}
});
test('unrecognized URLs, services, UIDs, spoofed fields and topic are denied before effects',async()=>{
  const t=harness();
  try{
    for(const service of ['avatar','guardian','push']){
      const cases=[
        {ownerUid:'real-uid'},
        {ownerUid:A,kind:'avatar_remove'},
        {actorUid:A,recipientUid:B,topic:'atrio_thread_qa_post'},
        {actorUid:'real-uid',recipientUid:B},
        {actorUid:A,recipientUid:A}
      ];
      for(const body of cases)
        assert.deepEqual(await call(service,t.env(),body),denied);
    }
    for(const service of ['avatar','guardian','push']){
      assert.deepEqual(await call(service,t.env(),scopes[service],
        'https://real-cloud.example'),denied);
      const res=await workers[service].fetch(
        new Request('https://qa-only.invalid/normal/mutation',{
          method:'POST',body:'{}'}),t.env());
      assert.equal(res.status,503);
    }
    assert.equal(t.seen.length,0);
  }finally{t.close();}
});
test('injecting live credential keys, real D1 bindings or wrong fixture ID fails closed',async()=>{
  const t=harness();
  try{
    for(const service of ['avatar','guardian','push']){
      const env=t.env();
      let accessed=0;
      Object.defineProperty(env,'FIREBASE_SERVICE_ACCOUNT_JSON',{
        get(){accessed++;throw Error('live_secret_read')},
        configurable:true
      });
      assert.deepEqual(await call(service,env),denied);
      assert.equal(accessed,0);
      delete env.FIREBASE_SERVICE_ACCOUNT_JSON;
      env.ATRIO_QA_PRIVACY_FIXTURE='atrio-catolico';
      assert.deepEqual(await call(service,env),denied);
    }
    assert.equal(t.seen.length,0);
  }finally{t.close();}
});
test('Guardian cron stops and Push queue retries without body reads in shared mode',async()=>{
  const t=harness();
  try{
    await offline(async()=>{
      const ctx={waitUntil(){throw Error('unexpected_scheduled_work')}};
      await guardian.scheduled({scheduledTime:Date.now()},t.env(),ctx);
      const called=[];
      await push.queue({messages:[{
        get body(){throw Error('queue_body_access')},
        ack(){called.push('ack')},
        retry({delaySeconds}){called.push(delaySeconds)}
      }]},t.env());
      assert.deepEqual(called,[60]);
    });
    assert.equal(t.seen.length,0);
  }finally{t.close();}
});
test('mode misconfiguration rejects normal routes rather than falling into credentialled handling',async()=>{
  const t=harness();
  try{
    for(const service of ['avatar','guardian','push']){
      const env=t.env();
      env.ATRIO_PRIVACY_QA_SHARED_MODE='mistyped';
      assert.deepEqual(await call(service,env),denied);
    }
    assert.equal(t.seen.length,0);
  }finally{t.close();}
});
test('shared service exposes no production IAM or deletion readiness',()=>{
  assert.deepEqual(QA_SHARED_FREEZE_READINESS,{
    productionIntegrated:false,realIAM:false,sharedFixtureLedger:true,
    serviceConsumers:3,realAccountDeletionAllowed:false
  });
  assert.equal(QA_SHARED_WORKER_ENTRY_READINESS.productionIntegrated,false);
});
