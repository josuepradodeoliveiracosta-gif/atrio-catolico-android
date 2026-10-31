import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  createQaPrivilegedWriteBarrier,runQaPrivilegedOperation,QA_PRIVILEGED_KINDS
} from './qa-privileged-write-barrier.js';

const alice='qa-freeze-alice',bob='qa-freeze-bob';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
async function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-privileged-qa-'));
  const filepath=join(dir,'test.sqlite');
  const opened=[];
  const connect=()=>{
    const sqlite=new DatabaseSync(filepath);
    sqlite.exec('PRAGMA busy_timeout=1000');
    opened.push(sqlite);
    return {
      prepare(sql){return {
        bind(...args){return {
          async first(){return sqlite.prepare(sql).get(...args)||null;},
          async all(){return {results:sqlite.prepare(sql).all(...args)};}
        };}
      };}
    };
  };
  try{
    const db=connect();opened[0].exec(schema);
    return await fn({db,connect,raw:()=>opened[0]});
  }finally{
    for(const db of opened)try{db.close();}catch(_){}
    rmSync(dir,{recursive:true,force:true});
  }
}
test('the schema accepts only two fixed QA identities; no customer UID',async()=>fixture(async({db,raw})=>{
  const b=createQaPrivilegedWriteBarrier(db);
  assert.deepEqual(await b.status(alice),{state:'active',inFlight:0});
  assert.deepEqual(await b.status(bob),{state:'active',inFlight:0});
  assert.throws(()=>raw().prepare(
    'INSERT INTO qa_privileged_accounts(uid) VALUES (?)'
  ).run('a-real-uid'),/CHECK constraint/);
  await assert.rejects(b.begin('avatar_upload',{ownerUid:'a-real-uid'}),/qa_unknown_identity/);
}));

test('all privileged operation kinds have explicit accepted scope',async()=>fixture(async({db})=>{
  const b=createQaPrivilegedWriteBarrier(db);
  assert.equal(QA_PRIVILEGED_KINDS.length,9);
  const scopes={
    avatar_upload:{ownerUid:alice},avatar_promote:{ownerUid:alice},
    avatar_remove:{ownerUid:alice},avatar_moderation:{ownerUid:alice,actorUid:bob},
    guardian_content_write:{ownerUid:alice},
    guardian_review_write:{ownerUid:alice,actorUid:bob},
    push_thread_notice:{actorUid:alice,recipientUid:bob},
    push_fcm_send:{recipientUid:alice},
    push_cleanup_device:{ownerUid:bob}
  };
  for(const kind of QA_PRIVILEGED_KINDS){
    const ticket=await b.begin(kind,scopes[kind]);
    assert.ok(ticket.accounts.length>=1);
    assert.equal(await b.complete(ticket,{verified:async()=>true}),true);
  }
  assert.deepEqual(await b.status(alice),{state:'active',inFlight:0});
  assert.deepEqual(await b.status(bob),{state:'active',inFlight:0});
}));

test('draining denies new privileged writes, even from another Worker process',async()=>fixture(async({db,connect})=>{
  const owner=createQaPrivilegedWriteBarrier(db);
  const other=createQaPrivilegedWriteBarrier(connect());
  const ticket=await owner.begin('avatar_upload',{ownerUid:alice});
  assert.equal(await other.beginFreeze(alice),'draining');
  await assert.rejects(owner.begin('avatar_promote',{ownerUid:alice}),
    /qa_privileged_write_blocked/);
  await assert.rejects(other.finalizeFreeze(alice),/qa_inflight_or_not_draining/);
  assert.equal((await owner.status(alice)).inFlight,1);
  assert.equal(await owner.complete(ticket,{verified:async()=>true}),true);
  assert.equal(await other.finalizeFreeze(alice),'frozen');
  await assert.rejects(owner.begin('avatar_remove',{ownerUid:alice}),
    /qa_privileged_write_blocked/);
  const independent=await other.begin('avatar_upload',{ownerUid:bob});
  await other.complete(independent,{verified:async()=>true});
}));

test('cross-account notice admission is ALL OR NOTHING when recipient drains',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  await gate.beginFreeze(alice);
  await assert.rejects(gate.begin('push_thread_notice',{actorUid:bob,recipientUid:alice}),
    /qa_privileged_write_blocked/);
  assert.equal((await gate.status(bob)).inFlight,0);
  assert.equal((await gate.status(alice)).inFlight,0);
  assert.equal(await gate.finalizeFreeze(alice),'frozen');
}));

test('freeze cannot finalize until all old cross-account operations settle',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  const first=await gate.begin('push_thread_notice',{actorUid:alice,recipientUid:bob});
  const second=await gate.begin('avatar_upload',{ownerUid:alice});
  await gate.beginFreeze(alice);
  await assert.rejects(gate.finalizeFreeze(alice),/qa_inflight_or_not_draining/);
  await gate.complete(second,{verified:async()=>true});
  await assert.rejects(gate.finalizeFreeze(alice),/qa_inflight_or_not_draining/);
  await gate.complete(first,{verified:async()=>true});
  assert.equal(await gate.finalizeFreeze(alice),'frozen');
}));

test('failed Cloudinary-like effect leaves open ticket: manual reconciliation required',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  let called=0;
  await assert.rejects(runQaPrivilegedOperation(gate,'avatar_upload',
    {ownerUid:alice},{effect:async()=>{called++;throw Error('cloudinary_timeout_unknown');},
      verify:async()=>true}),/cloudinary_timeout_unknown/);
  assert.equal(called,1);
  await gate.beginFreeze(alice);
  assert.deepEqual(await gate.status(alice),{state:'draining',inFlight:1});
  await assert.rejects(gate.finalizeFreeze(alice),/qa_inflight_or_not_draining/);
}));

test('unknown Firebase or FCM write result leaves a ticket and prevents false success',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  await assert.rejects(runQaPrivilegedOperation(gate,'push_fcm_send',
    {recipientUid:alice},{effect:async()=>{},verify:async()=>false}),
    /qa_unverified_external_effect/);
  const ticket=await gate.begin('guardian_content_write',{ownerUid:bob});
  await assert.rejects(gate.complete(ticket,{verified:async()=>
    {throw Error('firestore_postcheck_offline');}}),/firestore_postcheck_offline/);
  assert.equal((await gate.status(alice)).inFlight,1);
  assert.equal((await gate.status(bob)).inFlight,1);
}));

test('no external service operation starts after freeze is requested',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  const operations=[];
  await gate.beginFreeze(alice);
  for(const [kind,scope] of [
    ['avatar_remove',{ownerUid:alice}],
    ['guardian_content_write',{ownerUid:alice}],
    ['push_thread_notice',{actorUid:bob,recipientUid:alice}],
    ['push_fcm_send',{recipientUid:alice}],
  ]){
    await assert.rejects(runQaPrivilegedOperation(gate,kind,scope,{
      effect:async()=>operations.push(kind),verify:async()=>true
    }),/qa_privileged_write_blocked/);
  }
  assert.deepEqual(operations,[]);
  const ok=await runQaPrivilegedOperation(gate,'avatar_upload',{ownerUid:bob},
    {effect:async()=>operations.push('bob_upload'),verify:async()=>true});
  assert.equal(ok.productionReady,false);
  assert.deepEqual(operations,['bob_upload']);
}));

test('slow in-flight effect is allowed to settle, but cannot start a new one',async()=>fixture(async({db,connect})=>{
  const gateA=createQaPrivilegedWriteBarrier(db);
  const gateB=createQaPrivilegedWriteBarrier(connect());
  let started;
  const began=new Promise(resolve=>{started=resolve;});
  let resume;
  const paused=new Promise(resolve=>{resume=resolve;});
  const inFlight=runQaPrivilegedOperation(gateA,'avatar_promote',
    {ownerUid:alice},{
      effect:async()=>{started();await paused;},
      verify:async()=>true
    });
  await began;
  await gateB.beginFreeze(alice);
  await assert.rejects(gateB.finalizeFreeze(alice),/qa_inflight_or_not_draining/);
  await assert.rejects(gateA.begin('avatar_upload',{ownerUid:alice}),
    /qa_privileged_write_blocked/);
  resume();
  await inFlight;
  assert.equal(await gateB.finalizeFreeze(alice),'frozen');
}));

test('forged tickets, unknown operations and extra fields fail before side effects',async()=>fixture(async({db})=>{
  const gate=createQaPrivilegedWriteBarrier(db);
  let calls=0;
  for(const [kind,scope] of [
    ['free_all_accounts',{ownerUid:alice}],
    ['avatar_upload',{ownerUid:bob,otherUid:alice}],
    ['avatar_upload',{ownerUid:'other'}],
    ['push_thread_notice',{actorUid:alice}]
  ]){
    await assert.rejects(runQaPrivilegedOperation(gate,kind,scope,{
      effect:async()=>calls++,verify:async()=>true
    }),/qa_invalid_privileged_operation|qa_invalid_privileged_scope|qa_unknown_identity/);
  }
  assert.equal(calls,0);
  const real=await gate.begin('avatar_remove',{ownerUid:alice});
  await assert.rejects(gate.complete({...real,id:'not-uuid'},{
    verified:async()=>true}),/qa_invalid_ticket/);
  await gate.complete(real,{verified:async()=>true});
  await assert.rejects(gate.complete(real,{verified:async()=>true}),
    /qa_ticket_already_closed_or_forged/);
}));

test('reopened SQLite connection preserves frozen state and prevents new mutations',async()=>fixture(async({db,connect})=>{
  const a=createQaPrivilegedWriteBarrier(db);
  await a.beginFreeze(alice);
  await a.finalizeFreeze(alice);
  const b=createQaPrivilegedWriteBarrier(connect());
  assert.deepEqual(await b.status(alice),{state:'frozen',inFlight:0});
  await assert.rejects(b.begin('avatar_upload',{ownerUid:alice}),
    /qa_privileged_write_blocked/);
  const authorized=await b.begin('push_fcm_send',{recipientUid:bob});
  await b.complete(authorized,{verified:async()=>true});
}));
