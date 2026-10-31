import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {
  processDocument,reviewCase,resolveReviewCase,scanOnce
} from '../../guardian-worker/src/index.js';
import {ROOT,caseId,str} from '../../guardian-worker/src/firestore.js';
import {createQaPrivilegedWriteBarrier}
  from './qa-privileged-write-barrier.js';
import {createQaGuardianCommitGate}
  from './qa-guardian-commit-gate.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const schema=readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8');
const ID_TIME='2026-10-31T12:00:01.000000Z';
const enabled={enabled:true,allowHold:false};
const phishing='Clique https://exemplo.invalid para informar sua senha';

function item(owner,path,text=phishing){
  return {name:ROOT+'/'+path,updateTime:ID_TIME,fields:{
    uid:str(owner),body:str(text),createdAt:{timestampValue:ID_TIME},
    ...(path.split('/').length===2?{title:str('Título QA')}: {})
  }};
}
class InMemoryGuardianStore {
  constructor(docs=[]){
    this.resource=ROOT;
    this.documents=new Map(docs.map(d=>[d.name,structuredClone(d)]));
    this.effects=0;
    this.failNext=false;
    this.onCommit=null;
  }
  get(path){return this.documents.get(ROOT+'/'+path)||null;}
  scan(group){
    const col=group==='replies'?/^posts\/[^/]+\/replies\/[^/]+$/:
      group==='posts'?/^posts\/[^/]+$/:/^reports\/[^/]+$/;
    return [...this.documents.values()].filter(d=>d&&
      col.test(d.name.slice(ROOT.length+1)));
  }
  async commit(writes){
    this.effects++;
    if(this.failNext){this.failNext=false;throw Error('qa_firestore_ambiguous');}
    if(this.onCommit)await this.onCommit();
    // All writes are validated before modifying any fake document.
    for(const w of writes){
      const path=w.update?.name||w.delete||w.verify;
      const current=this.documents.get(path);
      if(w.currentDocument?.exists===false && current){
        const e=Error('conflict');e.status=409;throw e;
      }
      if(w.currentDocument?.updateTime&&
        (!current||current.updateTime!==w.currentDocument.updateTime)){
        const e=Error('version_conflict');e.status=409;throw e;
      }
    }
    for(const w of writes){
      const path=w.update?.name||w.delete||w.verify;
      if(w.verify)continue;
      // Test-only tombstone: no deletion APIs in the audit Worker tree.
      if(w.delete){this.documents.set(path,null);continue;}
      const previous=this.documents.get(path);
      this.documents.set(path,{name:path,updateTime:'2026-10-31T12:00:03.000000Z',
        fields:{...(previous?.fields||{}),...w.update.fields}});
    }
    return {};
  }
}
function setup(docs=[],verifyEffect=async()=>true){
  const sqlite=new DatabaseSync(':memory:');
  sqlite.exec(schema);
  const adapter={prepare(sql){return{bind(...args){return{
    async first(){return sqlite.prepare(sql).get(...args)||null;},
    async all(){return{results:sqlite.prepare(sql).all(...args)};}
  };}};}};
  const barrier=createQaPrivilegedWriteBarrier(adapter);
  const db=new InMemoryGuardianStore(docs);
  return {sqlite,db,barrier,
    gated:(actorUid=null)=>createQaGuardianCommitGate({db,barrier,actorUid,verifyEffect})};
}

test('real processDocument writes case, notice and audit only with active owner',async()=>{
  const source=item(A,'posts/qa_post/replies/qa_reply');
  const t=setup([source]);
  try{
    assert.equal(await processDocument(t.gated(),source,enabled),'review');
    const id=await caseId('posts/qa_post/replies/qa_reply');
    assert.ok(t.db.get('guardian_cases/'+id));
    assert.ok(t.db.get('guardian_notices/'+A+'/items/'+id));
    assert.equal(t.db.effects,1);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:0});
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    const second=item(A,'posts/qa_post/replies/qa_second');
    t.db.documents.set(second.name,second);
    await assert.rejects(processDocument(t.gated(),second,enabled),
      /qa_privileged_write_blocked/);
    assert.equal(t.db.effects,1,'no Firestore commit after freeze');
  }finally{t.sqlite.close();}
});

test('Guardião restores held reply only with BOTH reviewer and owner admitted',async()=>{
  const parent=item(B,'posts/qa_post','Olá irmãos!');
  const reply=item(A,'posts/qa_post/replies/qa_held');
  const t=setup([parent,reply]);
  try{
    assert.equal(await processDocument(t.gated(),reply,{enabled:true,allowHold:true}),'hold');
    assert.equal(t.db.get('posts/qa_post/replies/qa_held'),null);
    const id=await caseId('posts/qa_post/replies/qa_held');
    assert.equal(await reviewCase(t.gated(B),B,{
      caseId:id,action:'restore',note:'Restaurar no teste isolado'
    }),'restored');
    assert.ok(t.db.get('posts/qa_post/replies/qa_held'));
    assert.equal(t.db.effects,2);
    assert.equal((await t.barrier.status(A)).inFlight,0);
    assert.equal((await t.barrier.status(B)).inFlight,0);
  }finally{t.sqlite.close();}
});

test('frozen moderator cannot restore content even for active owner',async()=>{
  const reply=item(A,'posts/qa_post/replies/qa_hold2');
  const parent=item(B,'posts/qa_post','Discussão QA');
  const t=setup([parent,reply]);
  try{
    await processDocument(t.gated(),reply,{enabled:true,allowHold:true});
    const id=await caseId('posts/qa_post/replies/qa_hold2');
    await t.barrier.beginFreeze(B);await t.barrier.finalizeFreeze(B);
    await assert.rejects(reviewCase(t.gated(B),B,{
      caseId:id,action:'restore',note:'Restauro negado em QA'
    }),/qa_privileged_write_blocked/);
    assert.equal(t.db.effects,1);
    assert.equal(t.db.get('posts/qa_post/replies/qa_hold2'),null);
  }finally{t.sqlite.close();}
});

test('resolveReviewCase honors freeze and blocks moderation notice to frozen owner',async()=>{
  const source=item(A,'posts/qa_post/replies/qa_review');
  const t=setup([source]);
  try{
    await processDocument(t.gated(),source,enabled);
    const id=await caseId('posts/qa_post/replies/qa_review');
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    await assert.rejects(resolveReviewCase(t.gated(B),B,{
      caseId:id,action:'dismiss',note:'Resolução de teste'
    }),/qa_privileged_write_blocked/);
    assert.equal(t.db.effects,1);
    assert.ok(t.db.get('posts/qa_post/replies/qa_review'));
  }finally{t.sqlite.close();}
});

test('scanOnce uses the guarded commit adapter for each document',async()=>{
  const sourceA=item(A,'posts/qa_post/replies/frozen_A');
  const sourceB=item(B,'posts/qa_post/replies/active_B');
  const t=setup([sourceA,sourceB]);
  try{
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    const counts=await scanOnce(t.gated(),enabled);
    assert.equal(counts.error,1,'frozen owner writes fail closed');
    assert.equal(counts.review,1,'active owner still classified');
    assert.equal(t.db.effects,1);
  }finally{t.sqlite.close();}
});

test('Firestore ambiguous commit keeps in-flight ticket and refuses freeze',async()=>{
  const source=item(A,'posts/qa_post/replies/failure');
  const t=setup([source]);
  try{
    t.db.failNext=true;
    await assert.rejects(processDocument(t.gated(),source,enabled),
      /qa_firestore_ambiguous/);
    assert.deepEqual(await t.barrier.status(A),{state:'active',inFlight:1});
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{t.sqlite.close();}
});

test('unverified commit does not release ticket even if mock commit returned success',async()=>{
  const source=item(A,'posts/qa_post/replies/uncertain');
  const t=setup([source],async()=>false);
  try{
    await assert.rejects(processDocument(t.gated(),source,enabled),
      /qa_guardian_commit_unverified/);
    assert.equal(t.db.effects,1);
    assert.equal((await t.barrier.status(A)).inFlight,1);
  }finally{t.sqlite.close();}
});

test('freeze waits for an already-started Guardian commit before finalizing',async()=>{
  const source=item(A,'posts/qa_post/replies/inflight');
  const t=setup([source]);
  try{
    let started,resume;
    const entered=new Promise(r=>{started=r;});
    const barrier=new Promise(r=>{resume=r;});
    t.db.onCommit=async()=>{started();await barrier;};
    const operation=processDocument(t.gated(),source,enabled);
    await entered;
    await t.barrier.beginFreeze(A);
    await assert.rejects(t.barrier.finalizeFreeze(A),/qa_inflight_or_not_draining/);
    resume();
    assert.equal(await operation,'review');
    assert.equal(await t.barrier.finalizeFreeze(A),'frozen');
  }finally{t.sqlite.close();}
});

test('unknown writes and forged owner cannot be committed by injected store',async()=>{
  const t=setup();
  try{
    const g=t.gated();
    await assert.rejects(g.commit([{delete:ROOT+'/profiles/'+A},{
      update:{name:ROOT+'/guardian_notices/'+A+'/items/x',fields:{}}}
    ]),/qa_guardian_unexpected_path/);
    await assert.rejects(g.commit([
      {update:{name:ROOT+'/guardian_cases/fake',fields:{ownerUid:str(B)}}},
      {update:{name:ROOT+'/guardian_notices/'+A+'/items/fake',fields:{}}}
    ]),/qa_guardian_unscoped_commit/);
    await assert.rejects(g.update('guardian_config/policy',{}),
      /qa_unguarded_guardian_update/);
    await assert.rejects(g.create('reports/new',{}),
      /qa_unguarded_guardian_create/);
    assert.equal(t.db.effects,0);
  }finally{t.sqlite.close();}
});

test('direct original function with unguarded db remains a known bypass',async()=>{
  const source=item(A,'posts/qa_post/replies/direct');
  const t=setup([source]);
  try{
    await t.barrier.beginFreeze(A);await t.barrier.finalizeFreeze(A);
    assert.equal(await processDocument(t.db,source,enabled),'review');
    assert.equal(t.db.effects,1);
    assert.equal((await t.barrier.status(A)).state,'frozen');
    // This negative evidence prevents calling the feature production-ready.
  }finally{t.sqlite.close();}
});
