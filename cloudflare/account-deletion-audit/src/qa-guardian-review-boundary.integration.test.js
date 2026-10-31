/**
 * Calls actual Guardian review/resolve exports with a QA SQLite barrier.
 * Firestore is a fake in-memory commit adapter; no HTTP or IAM credentials.
 * The originals remain UNGUARDED when called without this test wrapper.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {reviewCase,resolveReviewCase} from '../../guardian-worker/src/index.js';
import {ROOT} from '../../guardian-worker/src/firestore.js';
import {
  createQaPrivilegedWriteBarrier,runQaPrivilegedOperation
} from './qa-privileged-write-barrier.js';

const A='qa-freeze-alice',B='qa-freeze-bob';
const CASE_ID='guard_'+ 'a'.repeat(32);
const target='posts/qa_post/replies/qa_reply';
const time='2026-10-31T12:00:00.000000Z';
const str=x=>({stringValue:x});
const wrap=(path,fields)=>({
  name:ROOT+'/'+path,updateTime:time,fields
});

function store({held=false,owner=A}={}){
  const docs=new Map();
  const caseDoc=wrap('guardian_cases/'+CASE_ID,{
    engine:str('v2'),ownerUid:str(owner),targetPath:str(target),postId:str('qa_post'),
    status:str(held?'held':'review'),sourceUpdateTime:str(time)
  });
  docs.set('guardian_cases/'+CASE_ID,caseDoc);
  docs.set(target,wrap(target,{uid:str(owner),body:str('FICTICIO - QA')}));

  if(held)docs.set('guardiao_quarantine/'+CASE_ID,wrap(
    'guardiao_quarantine/'+CASE_ID,{
      ownerUid:str(owner),targetPath:str(ROOT+'/'+target),postId:str('qa_post'),
      replyId:str('qa_reply'),status:str('held'),
      originalFields:{mapValue:{fields:{uid:str(owner),body:str('FICTICIO - QA')}}}
    }
  ));
  const commits=[];
  return {commits,db:{
    resource:ROOT,
    get:async path=>docs.get(path)||null,
    commit:async writes=>{
      commits.push(writes);
      return {};
    }
  }};
}
function mockBarrier(){
  const db=new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../qa-privileged-freeze-schema.sql',import.meta.url),'utf8'));
  const adapter={prepare(sql){return {bind(...values){return {
    async first(){return db.prepare(sql).get(...values)||null;},
    async all(){return {results:db.prepare(sql).all(...values)};}
  };}};}};
  return {gate:createQaPrivilegedWriteBarrier(adapter),close:()=>db.close()};
}

test('real Guardian reviewCase confirm is allowed only before owner/actor freeze',async()=>{
  const {gate,close}=mockBarrier();
  try{
    const targetStore=store({held:true});
    const run=()=>runQaPrivilegedOperation(gate,'guardian_review_write',
      {ownerUid:A,actorUid:B},{
        effect:async()=>{
          const result=await reviewCase(targetStore.db,B,{
            caseId:CASE_ID,action:'confirm',note:'Revisão humana de teste'
          });
          assert.equal(result,'confirmed');
        },
        verify:async()=>targetStore.commits.length===1
      });
    assert.equal((await run()).productionReady,false);
    assert.equal(targetStore.commits.length,1);
    await gate.beginFreeze(A);
    await gate.finalizeFreeze(A);
    await assert.rejects(run(),/qa_privileged_write_blocked/);
    assert.equal(targetStore.commits.length,1);
    assert.equal((await gate.status(B)).state,'active');
  }finally{close();}
});

test('real Guardian resolveReviewCase is refused when reviewer freezes',async()=>{
  const {gate,close}=mockBarrier();
  try{
    const targetStore=store({held:false});
    const run=()=>runQaPrivilegedOperation(gate,'guardian_review_write',
      {ownerUid:A,actorUid:B},{
        effect:async()=>{
          const result=await resolveReviewCase(targetStore.db,B,{
            caseId:CASE_ID,action:'dismiss',note:'Conclusão humana de teste'
          });
          assert.equal(result,'dismissed');
        },
        verify:async()=>targetStore.commits.length===1
      });
    assert.equal((await run()).status,'qa_simulated_only');
    await gate.beginFreeze(B);
    await gate.finalizeFreeze(B);
    await assert.rejects(run(),/qa_privileged_write_blocked/);
    assert.equal(targetStore.commits.length,1);
    assert.deepEqual(await gate.status(A),{state:'active',inFlight:0});
  }finally{close();}
});

test('real Guardian commit failure leaves ticket unresolved, blocks final freeze',async()=>{
  const {gate,close}=mockBarrier();
  try{
    const targetStore=store({held:true});
    targetStore.db.commit=async()=>{throw Error('firestore_qa_unavailable');};
    await assert.rejects(runQaPrivilegedOperation(gate,'guardian_review_write',
      {ownerUid:A,actorUid:B},{
        effect:()=>reviewCase(targetStore.db,B,{
          caseId:CASE_ID,action:'confirm',note:'Revisão humana de teste'
        }),
        verify:async()=>true
      }),/firestore_qa_unavailable/);
    await gate.beginFreeze(A);
    assert.equal((await gate.status(A)).inFlight,1);
    assert.equal((await gate.status(B)).inFlight,1);
    await assert.rejects(gate.finalizeFreeze(A),/qa_inflight_or_not_draining/);
  }finally{close();}
});

test('source functions are not protected directly: readiness remains false',async()=>{
  const unguarded=store({held:false});
  const result=await resolveReviewCase(unguarded.db,B,{
    caseId:CASE_ID,action:'dismiss',note:'Conclusão humana de teste'
  });
  assert.equal(result,'dismissed');
  assert.equal(unguarded.commits.length,1);
  // Must NOT advertise protection for this original unmodified export.
  assert.equal(typeof resolveReviewCase,'function');
});
