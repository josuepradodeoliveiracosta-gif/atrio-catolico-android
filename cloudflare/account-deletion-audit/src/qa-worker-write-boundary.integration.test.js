/**
 * QA harness: executes REAL exported write functions from Avatar, Guardião
 * and Push against MOCK transports and a SQLite :memory: gate.
 *
 * IMPORTANT: The active Workers DO NOT call the gate yet. We intentionally
 * do not modify or deploy their production entrypoints. This tests the
 * proposed boundary and documents the remaining bypass risk.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {cloudSigned} from '../../avatar-worker/src/index.js';
import {processDocument} from '../../guardian-worker/src/index.js';
import {ROOT as GUARDIAN_ROOT} from '../../guardian-worker/src/firestore.js';
import {writeThreadNotices,cleanupInvalidDevice} from '../../push-worker/src/index.js';
import {createQaPrivilegedWriteBarrier,runQaPrivilegedOperation}
  from './qa-privileged-write-barrier.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const SCHEMA=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
function gateFixture(){
  const db=new DatabaseSync(':memory:');
  db.exec(SCHEMA);
  const adapter={
    prepare(sql){return {
      bind(...args){return {
        async first(){return db.prepare(sql).get(...args)||null;},
        async all(){return {results:db.prepare(sql).all(...args)};}
      };}
    };}
  };
  return {db,barrier:createQaPrivilegedWriteBarrier(adapter)};
}
async function inFixture(fn){
  const {db,barrier}=gateFixture();
  const original=globalThis.fetch;
  try{return await fn(barrier);}
  finally{
    globalThis.fetch=original;
    db.close();
  }
}
function fakeCloudinaryCalls(){
  const calls=[];
  globalThis.fetch=async(url,options)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://api.cloudinary.com');
    assert.equal(options.method,'POST');
    assert.equal(u.pathname,'/v1_1/qa-cloud/image/authenticated');
    const id=options.body.get('public_id');
    assert.ok(id.startsWith('atrio-avatares/'));
    calls.push({operation:'upload',id});
    return new Response(JSON.stringify({
      type:'authenticated',public_id:id,
      moderation:[{kind:'manual',status:'pending'}]
    }),{status:200});
  };
  return calls;
}
async function avatarUpload(uid){
  const env={CLOUDINARY_CLOUD_NAME:'qa-cloud',
    CLOUDINARY_API_KEY:'fake-key',CLOUDINARY_API_SECRET:'fake-secret'};
  return cloudSigned(env,'authenticated',{
    public_id:'atrio-avatares/'+uid+'/123e4567-e89b-42d3-a456-426614174000',
    overwrite:'false',moderation:'manual'
  },new Uint8Array([255,216,255,217]),'upload');
}
function guardianDoc(owner,replyId='qa_reply'){
  return {
    name:GUARDIAN_ROOT+'/posts/qa_post/replies/'+replyId,
    updateTime:'2026-10-31T12:00:00.000000Z',
    fields:{uid:{stringValue:owner},body:{stringValue:'Vou te matar amanhã'},
      createdAt:{timestampValue:'2026-10-31T11:59:00.000000Z'}}
  };
}
function fakeGuardianDb(){
  const commits=[];
  return {commits,resource:GUARDIAN_ROOT,
    get:async()=>null,
    commit:async writes=>{commits.push(writes);return {};}}
}
function fakePushFetch(){
  const batches=[];
  globalThis.fetch=async(url,opts)=>{
    const u=new URL(url);
    assert.equal(u.origin,'https://firestore.googleapis.com');
    assert.ok(u.pathname.endsWith('/documents:batchWrite'));
    assert.equal(opts.method,'POST');
    const payload=JSON.parse(opts.body);
    batches.push(payload.writes);
    return new Response(JSON.stringify({status:payload.writes.map(()=>({}))}),
      {status:200});
  };
  return batches;
}
function pushEvent(actor,recipients){
  return {topic:'atrio_thread_qa_post',recipients,
    notice:{postId:'qa_post',replyId:'qa_reply',actorUid:actor,
      actorName:'Usuário fictício',createdAt:'2026-10-31T12:00:00Z'}};
}

test('REAL Avatar Worker Cloudinary upload succeeds behind active QA gate only',async()=>inFixture(async gate=>{
  const calls=fakeCloudinaryCalls();
  const result=await runQaPrivilegedOperation(gate,'avatar_upload',{ownerUid:A},{
    effect:()=>avatarUpload(A),
    verify:async()=>calls.length===1
  });
  assert.equal(result.productionReady,false);
  assert.equal(calls.length,1);
  assert.deepEqual(await gate.status(A),{state:'active',inFlight:0});
  assert.equal(await gate.beginFreeze(A),'draining');
  await gate.finalizeFreeze(A);
  await assert.rejects(runQaPrivilegedOperation(gate,'avatar_upload',{ownerUid:A},{
    effect:()=>avatarUpload(A),verify:async()=>true
  }),/qa_privileged_write_blocked/);
  assert.equal(calls.length,1,'no Cloudinary request after freeze');
  const bob=await runQaPrivilegedOperation(gate,'avatar_upload',{ownerUid:B},{
    effect:()=>avatarUpload(B),verify:async()=>calls.length===2
  });
  assert.equal(bob.productionReady,false);
}));

test('REAL Guardian processDocument commit is denied for frozen owner',async()=>inFixture(async gate=>{
  const store=fakeGuardianDb();
  const alice=guardianDoc(A,'alice_reply');
  assert.equal(await runQaPrivilegedOperation(gate,'guardian_content_write',{ownerUid:A},{
    effect:async()=>{
      const result=await processDocument(store,alice,{enabled:true,allowHold:false});
      assert.equal(result,'review');
    },
    verify:async()=>store.commits.length===1
  }).then(x=>x.status),'qa_simulated_only');
  await gate.beginFreeze(A);await gate.finalizeFreeze(A);
  await assert.rejects(runQaPrivilegedOperation(gate,'guardian_content_write',{ownerUid:A},{
    effect:()=>processDocument(store,alice,{enabled:true,allowHold:false}),
    verify:async()=>true
  }),/qa_privileged_write_blocked/);
  assert.equal(store.commits.length,1);
  await runQaPrivilegedOperation(gate,'guardian_content_write',{ownerUid:B},{
    effect:()=>processDocument(store,guardianDoc(B,'bob_reply'),{
      enabled:true,allowHold:false}),
    verify:async()=>store.commits.length===2
  });
  assert.equal(store.commits.length,2);
}));

test('REAL Push Worker batchWrite checks actor AND recipient before sending',async()=>inFixture(async gate=>{
  const batches=fakePushFetch();
  await runQaPrivilegedOperation(gate,'push_thread_notice',{actorUid:A,recipientUid:B},{
    effect:()=>writeThreadNotices('fake-oauth-token',pushEvent(A,[B])),
    verify:async()=>batches.length===1&&batches[0].length===1
  });
  await gate.beginFreeze(B);
  await assert.rejects(runQaPrivilegedOperation(gate,'push_thread_notice',{
    actorUid:A,recipientUid:B
  },{
    effect:()=>writeThreadNotices('fake-oauth-token',pushEvent(A,[B])),
    verify:async()=>true
  }),/qa_privileged_write_blocked/);
  assert.equal(batches.length,1,'no Firestore write to frozen recipient');
  await gate.finalizeFreeze(B);
  await runQaPrivilegedOperation(gate,'push_thread_notice',{actorUid:A,recipientUid:A},{
    effect:()=>writeThreadNotices('fake-oauth-token',pushEvent(A,[A])),
    verify:async()=>batches.length===2
  });
  assert.equal(batches.length,2);
}));

test('REAL Push cleanupInvalidDevice DELETE blocked for frozen owner',async()=>inFixture(async gate=>{
  const calls=[];
  globalThis.fetch=async(url,opts)=>{
    assert.ok(new URL(url).pathname.includes('/users/'+B+'/pushDevices/'));
    assert.equal(opts.method,'DELETE');
    calls.push('deleted_fake_device');
    return new Response('{}',{status:200});
  };
  const invalid=()=>new Response(JSON.stringify({
    error:{code:404,status:'UNREGISTERED'}
  }),{status:404});
  const device={path:'users/'+B+'/pushDevices/device1',
    updateTime:'2026-10-31T12:00:00.000000Z'};
  await runQaPrivilegedOperation(gate,'push_cleanup_device',{ownerUid:B},{
    effect:async()=>assert.equal(
      await cleanupInvalidDevice('fake-oauth',device,invalid()),true),
    verify:async()=>calls.length===1
  });
  await gate.beginFreeze(B);await gate.finalizeFreeze(B);
  await assert.rejects(runQaPrivilegedOperation(gate,'push_cleanup_device',{ownerUid:B},{
    effect:()=>cleanupInvalidDevice('fake-oauth',device,invalid()),
    verify:async()=>true
  }),/qa_privileged_write_blocked/);
  assert.equal(calls.length,1);
}));

test('a real Avatar worker request failing ambiguously leaves open QA gate ticket',async()=>inFixture(async gate=>{
  let calls=0;
  globalThis.fetch=async()=>{
    calls++;
    throw Error('simulated_cloudinary_timeout');
  };
  await assert.rejects(runQaPrivilegedOperation(gate,'avatar_upload',{ownerUid:A},{
    effect:()=>avatarUpload(A),verify:async()=>true
  }),/simulated_cloudinary_timeout/);
  assert.equal(calls,1);
  await gate.beginFreeze(A);
  assert.deepEqual(await gate.status(A),{state:'draining',inFlight:1});
  await assert.rejects(gate.finalizeFreeze(A),/qa_inflight_or_not_draining/);
}));

test('KNOWN GAP: calling an unmodified Worker export directly can bypass QA gate',async()=>inFixture(async gate=>{
  const calls=fakeCloudinaryCalls();
  await gate.beginFreeze(A);await gate.finalizeFreeze(A);
  // Intentional evidence that no active Worker has been wired to this gate.
  // This is a NEGATIVE readiness test, not permission to deploy.
  await avatarUpload(A);
  assert.equal(calls.length,1);
  assert.equal((await gate.status(A)).state,'frozen');
  const integrationReadiness=Object.freeze({
    productionIntegrated:false,privilegedWriteFreezeGuaranteed:false
  });
  assert.equal(integrationReadiness.productionIntegrated,false);
}));

test('source audit names the three privileged Worker entrypoints and uncovered paths',()=>{
  const paths=[
    new URL('../../avatar-worker/src/index.js',import.meta.url),
    new URL('../../guardian-worker/src/index.js',import.meta.url),
    new URL('../../push-worker/src/index.js',import.meta.url)
  ];
  const [avatar,guardian,push]=paths.map(x=>readFileSync(x,'utf8'));
  assert.match(avatar,/async function upload\(env, uid, request\)/);
  assert.match(avatar,/async function status\(env,uid\)/);
  assert.match(avatar,/async function moderateRemove\(env,actor,request\)/);
  assert.match(avatar,/async function remove\(env,uid\)/);
  assert.match(guardian,/export async function processDocument\(/);
  assert.match(guardian,/export async function reviewCase\(/);
  assert.match(push,/export async function writeThreadNotices\(/);
  assert.match(push,/export async function cleanupInvalidDevice\(/);
  assert.match(push,/async function send\(token,device,uid,kind\)/);
  // The executable gate is still isolated in account-deletion-audit.
  assert.doesNotMatch(avatar,/createQaPrivilegedWriteBarrier/);
  assert.doesNotMatch(guardian,/createQaPrivilegedWriteBarrier/);
  assert.doesNotMatch(push,/createQaPrivilegedWriteBarrier/);
});
