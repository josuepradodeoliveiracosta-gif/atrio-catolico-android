import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {processDocument} from '../../guardian-worker/src/index.js';
import {Firestore,ROOT,str} from '../../guardian-worker/src/firestore.js';
import {createQaPrivilegedWriteBarrier} from './qa-privileged-write-barrier.js';
import {
  createQaGuardianFirestoreTransportFirewall,
  QA_GUARDIAN_TRANSPORT_READINESS
} from './qa-guardian-transport-firewall.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const NOW='2026-10-31T12:00:00.000000Z';
const SETTINGS={enabled:true,allowHold:false};
const PHISH='Clique https://exemplo.invalid para informar sua senha';

function sample(uid,id) {
  return {name:ROOT+'/posts/qa_post/replies/'+id,updateTime:NOW,fields:{
    uid:str(uid),body:str(PHISH),createdAt:{timestampValue:NOW}
  }};
}
function harness(docs=[]) {
  const sql=new DatabaseSync(':memory:');
  sql.exec(readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8'));
  const bridge={prepare(query){return {bind(...args){return {
    async first(){return sql.prepare(query).get(...args)||null;},
    async all(){return {results:sql.prepare(query).all(...args)};}
  };}};}};
  const barrier=createQaPrivilegedWriteBarrier(bridge);
  const data=new Map(docs.map(d=>[d.name.slice(ROOT.length+1),structuredClone(d)]));
  let effects=0,ambiguous=false,verifiable=true,onCommit=null;
  const getDoc=async path=>data.get(path)||null;
  const commit=async writes=>{
    effects++;
    if(onCommit)await onCommit();
    if(ambiguous)throw Error('qa_ambiguous_commit');
    for(const w of writes) {
      const name=w.update?.name||w.delete||w.verify;
      const rel=name.slice(ROOT.length+1);
      const current=data.get(rel);
      if(w.currentDocument?.exists===false && current)throw Error('qa_conflict');
      if(w.currentDocument?.updateTime && current?.updateTime!==w.currentDocument.updateTime)
        throw Error('qa_stale_fixture');
    }
    for(const w of writes) {
      const name=w.update?.name||w.delete||w.verify;
      const rel=name.slice(ROOT.length+1);
      if(w.verify)continue;
      if(w.delete){data.delete(rel);continue;}
      const old=data.get(rel);
      data.set(rel,{name,updateTime:'2026-10-31T12:00:05.000000Z',
        fields:{...(old?.fields||{}),...w.update.fields}});
    }
    return {};
  };
  const firewall=createQaGuardianFirestoreTransportFirewall({
    barrier,getDoc,commit,verifyEffect:async()=>verifiable
  });
  const realFirestore=new Firestore('qa-guardian-fixture-token','atrio-catolico');
  const close=()=>sql.close();
  return {barrier,data,firewall,realFirestore,close,get effects(){return effects;},
    set ambiguous(x){ambiguous=x;},set verifiable(x){verifiable=x;},
    set onCommit(fn){onCommit=fn;}};
}
async function withFirewall(firewall,operation) {
  const original=globalThis.fetch;
  globalThis.fetch=firewall;
  try{return await operation();}finally{globalThis.fetch=original;}
}
test('unmodified Guardian path is refused at REST transport when owner frozen',async()=>{
  const frozen=sample(A,'transport_frozen');
  const other=sample(B,'transport_active');
  const t=harness([frozen,other]);
  try{
    await t.barrier.beginFreeze(A);
    await t.barrier.finalizeFreeze(A);
    await withFirewall(t.firewall,async()=>{
      await assert.rejects(
        processDocument(t.realFirestore,frozen,SETTINGS),
        /qa_privileged_write_blocked/
      );
      assert.equal(t.effects,0);
      assert.equal(await processDocument(t.realFirestore,other,SETTINGS),'review');
    });
    assert.equal(t.effects,1,'only Bob was allowed to simulate an external commit');
    assert.equal(t.data.has('posts/qa_post/replies/transport_frozen'),true);
    assert.equal((await t.barrier.status(B)).inFlight,0);
  }finally{t.close();}
});
test('unguarded real Firestore.commit cannot evade transport by direct call',async()=>{
  const frozen=sample(A,'raw_commit');
  const t=harness([frozen]);
  try{
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    await withFirewall(t.firewall,async()=>{
      await assert.rejects(t.realFirestore.commit([
        {update:{name:t.realFirestore.resource+'/guardian_cases/guard_'+ 'a'.repeat(32),
          fields:{ownerUid:str(A)}}},
        {update:{name:t.realFirestore.resource+'/guardian_notices/'+A+'/items/guard_'+ 'a'.repeat(32),
          fields:{caseId:str('guard_'+'a'.repeat(32))}}},
        {update:{name:t.realFirestore.resource+'/guardian_audit/guard_'+ 'a'.repeat(32),
          fields:{caseId:str('guard_'+'a'.repeat(32))}}}
      ]),/qa_privileged_write_blocked/);
    });
    assert.equal(t.effects,0);
  }finally{t.close();}
});
test('transport fails closed for foreign URLs, unknown paths and credentials',async()=>{
  const t=harness();
  try {
    const hdr={Authorization:'Bearer qa-guardian-fixture-token'};
    await assert.rejects(t.firewall('https://evil.example/collect',{method:'POST',headers:hdr}),
      /qa_guardian_transport_denied/);
    await assert.rejects(t.firewall(ROOT+'/profiles/'+A,{method:'GET',headers:hdr}),
      /qa_guardian_transport_denied/);
    await assert.rejects(t.firewall(ROOT+'/guardian_cases/test',{method:'GET',headers:{}}),
      /qa_guardian_transport_denied/);
    await assert.rejects(t.firewall(ROOT+':commit',{method:'POST',headers:hdr,
      body:JSON.stringify({writes:[{delete:'projects/atrio-catolico/databases/(default)/documents/users/'+A},
        {delete:'projects/atrio-catolico/databases/(default)/documents/users/'+B}]})}),
      /qa_guardian_transport_denied/);
    assert.equal(t.effects,0);
  }finally{t.close();}
});
test('ambiguous real transport result retains the durable SQLite ticket',async()=>{
  const source=sample(A,'ambiguous_transport');
  const t=harness([source]);
  try {
    t.ambiguous=true;
    await withFirewall(t.firewall,async()=>{
      await assert.rejects(processDocument(t.realFirestore,source,SETTINGS),
        /qa_ambiguous_commit/);
    });
    assert.equal(t.effects,1);
    assert.equal((await t.barrier.status(A)).inFlight,1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{t.close();}
});
test('unknown post-effect verification also keeps the account unfreezable',async()=>{
  const source=sample(A,'uncertain_verification');
  const t=harness([source]);
  try {
    t.verifiable=false;
    await withFirewall(t.firewall,async()=>{
      await assert.rejects(processDocument(t.realFirestore,source,SETTINGS),
        /qa_guardian_commit_unverified/);
    });
    assert.equal((await t.barrier.status(A)).inFlight,1);
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{t.close();}
});
test('transport awaits in-flight writes before freeze, never discards ticket',async()=>{
  const source=sample(A,'held_transport');
  const t=harness([source]);
  let release,entered;
  const started=new Promise(done=>{entered=done;});
  const blocked=new Promise(done=>{release=done;});
  t.onCommit=async()=>{entered();await blocked;};
  try {
    await withFirewall(t.firewall,async()=>{
      const pending=processDocument(t.realFirestore,source,SETTINGS);
      await started;
      await t.barrier.beginFreeze(A);
      await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
      release();
      assert.equal(await pending,'review');
    });
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
    assert.equal(t.effects,1);
  }finally{release?.();t.close();}
});
test('firewall is an isolated test component, never a production gate',()=>{
  assert.equal(QA_GUARDIAN_TRANSPORT_READINESS.productionIntegrated,false);
  assert.equal(QA_GUARDIAN_TRANSPORT_READINESS.allowsRemoteRequests,false);
});
