/**
 * Next-stage QA: cross-process-like restart, independent SQLite connections,
 * concurrent freeze and an unreconciled operation held forever.
 *
 * These are disposable fixtures, not Cloudflare bindings or user data.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import avatar from '../../avatar-worker/src/index.js';
import guardian from '../../guardian-worker/src/index.js';
import push from '../../push-worker/src/index.js';
import {createQaSharedFreezeCoordinator}
  from './qa-shared-freeze-coordinator.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const SCHEMA=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
function fixture(){
  const folder=mkdtempSync(join(tmpdir(),'atrio-privacy-workers-qa-'));
  const file=join(folder,'fixture.sqlite');
  const opened=[];
  const connect=()=>{
    const raw=new DatabaseSync(file);
    opened.push(raw);
    return {raw,coordinator:createQaSharedFreezeCoordinator({
      prepare(sql){return {bind(...params){return {
        async all(){return {results:raw.prepare(sql).all(...params)};},
        async first(){return raw.prepare(sql).get(...params)||null;}
      };}};}
    })};
  };
  const a=connect();
  a.raw.exec(SCHEMA);
  const cleanup=()=>{
    for(const db of opened){try{db.close();}catch{}}
    rmSync(folder,{recursive:true,force:true});
  };
  const env=(coordinator,opts={})=>({
    ATRIO_PRIVACY_QA_SHARED_MODE:'true',
    ATRIO_QA_PRIVACY_FIXTURE:'demo-atrio-v11',
    ATRIO_QA_PRIVACY_COORDINATOR:coordinator,
    ATRIO_QA_PRIVACY_FAKE_EFFECT:opts.effect|| (async()=>true),
    ATRIO_QA_PRIVACY_FAKE_VERIFY:opts.verify|| (async()=>true)
  });
  return {a,connect,cleanup,env};
}
function call(worker,service,scope,env){
  return worker.fetch(new Request('https://qa-only.invalid/__qa/shared-freeze/'+service,{
    method:'POST',body:JSON.stringify(scope)
  }),env).then(async res=>({status:res.status,code:(await res.json()).status}));
}
const BLOCK={status:503,code:'qa_shared_worker_denied'};
const PASS={status:200,code:'qa_shared_fixture_verified'};
test('two independent DB connections see one frozen state for all three Workers',async()=>{
  const t=fixture();
  try{
    const b=t.connect();
    await t.a.coordinator.beginFreeze(A);
    assert.equal((await b.coordinator.status(A)).state,'draining');
    const e=t.env(b.coordinator);
    assert.deepEqual(await call(avatar,'avatar',{ownerUid:A},e),BLOCK);
    assert.deepEqual(await call(guardian,'guardian',{ownerUid:B},e),PASS);
    assert.deepEqual(await call(push,'push',{actorUid:A,recipientUid:B},e),BLOCK);
    await b.coordinator.finalizeFreeze(A);
    assert.equal((await t.a.coordinator.status(A)).state,'frozen');
    assert.deepEqual(await call(avatar,'avatar',{ownerUid:A},t.env(t.a.coordinator)),BLOCK);
  }finally{t.cleanup();}
});
test('a paused Avatar mutation holds a ticket across a second Worker connection',async()=>{
  const t=fixture();
  let enter,release;
  const started=new Promise(r=>{enter=r;});
  const hold=new Promise(r=>{release=r;});
  try{
    const other=t.connect();
    const work=call(avatar,'avatar',{ownerUid:A},t.env(t.a.coordinator,{
      effect:async()=>{enter();await hold;return true}
    }));
    await started;
    await other.coordinator.beginFreeze(A);
    await assert.rejects(other.coordinator.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
    assert.deepEqual(await call(guardian,'guardian',{ownerUid:A},
      t.env(other.coordinator)),BLOCK);
    assert.deepEqual(await call(push,'push',{actorUid:A,recipientUid:B},
      t.env(other.coordinator)),BLOCK);
    release();
    assert.deepEqual(await work,PASS);
    assert.equal(await other.coordinator.finalizeFreeze(A),'frozen');
  }finally{release?.();t.cleanup();}
});
test('an ambiguous Push delivery survives connection restart and blocks freeze',async()=>{
  const t=fixture();
  try{
    const initial=call(push,'push',{actorUid:A,recipientUid:B},
      t.env(t.a.coordinator,{effect:async()=>{throw Error('qa_fake_fcm_timeout')}}));
    assert.deepEqual(await initial,BLOCK);
    assert.equal((await t.a.coordinator.status(A)).inFlight,1);
    assert.equal((await t.a.coordinator.status(B)).inFlight,1);
    t.a.raw.close(); // Simulate first Worker process exit; ledger remains.
    const newProcess=t.connect();
    assert.equal((await newProcess.coordinator.status(A)).inFlight,1);
    await newProcess.coordinator.beginFreeze(B);
    await assert.rejects(newProcess.coordinator.finalizeFreeze(B),
      /qa_inflight_or_not_draining/);
    assert.deepEqual(await call(avatar,'avatar',{ownerUid:B},
      t.env(newProcess.coordinator)),BLOCK);
    assert.deepEqual(await call(guardian,'guardian',{ownerUid:A},
      t.env(newProcess.coordinator)),PASS);
    // No fake "reconciliation complete": the persisted ticket remains.
    assert.equal((await newProcess.coordinator.status(B)).inFlight,1);
  }finally{t.cleanup();}
});
test('negative verification leaves a two-account ledger ticket after restart',async()=>{
  const t=fixture();
  try{
    assert.deepEqual(await call(push,'push',{actorUid:A,recipientUid:B},
      t.env(t.a.coordinator,{verify:async()=>false})),BLOCK);
    const newProcess=t.connect();
    assert.equal((await newProcess.coordinator.status(A)).inFlight,1);
    assert.equal((await newProcess.coordinator.status(B)).inFlight,1);
    await newProcess.coordinator.beginFreeze(A);
    await assert.rejects(newProcess.coordinator.finalizeFreeze(A),
      /qa_inflight_or_not_draining/);
  }finally{t.cleanup();}
});
