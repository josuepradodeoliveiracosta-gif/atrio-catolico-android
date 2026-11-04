import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {CONTROLLED_DELETION_PHASES}
  from './controlled-executor.js';
import {createQaPersistentDeletionLedger}
  from './qa-persistent-case-ledger.js';

const PROJECT='demo-atrio-v11';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const A='qa-delete-candidate';
const ctx={uid:A,caseId:CASE};

function fixture(){
  const folder=mkdtempSync(join(tmpdir(),'atrio-qa-delete-ledger-'));
  const file=join(folder,'ledger.sqlite');
  let db=new DatabaseSync(file);
  chmodSync(file,0o600);
  const make=()=>createQaPersistentDeletionLedger({projectId:PROJECT,db});
  let ledger=make();
  return {
    file,get ledger(){return ledger;},get db(){return db;},
    restart(){
      db.close();db=new DatabaseSync(file);chmodSync(file,0o600);
      ledger=make();return ledger;
    },
    close(){db.close();rmSync(folder,{recursive:true,force:true});}
  };
}
test('immutable case-bound checkpoint, fresh restart, explicit recovery and final readback',async()=>{
  const f=fixture();
  try{
    const first=await f.ledger.acquire(ctx);
    assert.equal(first.epoch,1);
    assert.deepEqual(first.completed,[]);
    assert.equal(await f.ledger.complete({...ctx,epoch:1,
      phase:CONTROLLED_DELETION_PHASES[1]}),false);
    assert.equal(await f.ledger.complete({...ctx,epoch:1,
      phase:CONTROLLED_DELETION_PHASES[0]}),true);
    f.restart();
    assert.deepEqual((await f.ledger.status(ctx)).completed,
      CONTROLLED_DELETION_PHASES.slice(0,1));
    await assert.rejects(f.ledger.acquire(ctx),/active_case_needs_review/);
    await assert.rejects(f.ledger.approveRecovery(ctx,{
      independentReview:async()=>false
    }),/review_rejected/);
    assert.equal((await f.ledger.status(ctx)).state,'active');
    const proof=await f.ledger.approveRecovery(ctx,{
      independentReview:async snap=>
        snap.uid===A&&snap.caseId===CASE&&snap.epoch===1&&
        snap.completed.length===1
    });
    assert.equal(proof.externalEffectsVerified,false);
    assert.equal(await f.ledger.check({...ctx,epoch:1}),false);
    f.restart();
    const resumed=await f.ledger.acquire(ctx);
    assert.equal(resumed.epoch,2);
    assert.deepEqual(resumed.completed,CONTROLLED_DELETION_PHASES.slice(0,1));
    for(const phase of CONTROLLED_DELETION_PHASES.slice(1))
      assert.equal(await f.ledger.complete({...ctx,epoch:2,phase}),true);
    assert.equal((await f.ledger.status(ctx)).state,'complete');
    f.restart();
    assert.deepEqual((await f.ledger.acquire(ctx)).completed,
      CONTROLLED_DELETION_PHASES);
    assert.equal(await f.ledger.complete({...ctx,epoch:2,
      phase:'verify_final'}),false);
  }finally{f.close();}
});
test('same UID other case and live project cannot acquire',async()=>{
  const f=fixture();
  try{
    assert.throws(()=>createQaPersistentDeletionLedger({
      projectId:'atrio-catolico',db:f.db
    }),/real_project_denied/);
    await f.ledger.acquire(ctx);
    await assert.rejects(f.ledger.acquire({
      ...ctx,caseId:'fa00bbaa-4a09-4fd2-b399-001122334466'
    }),/case_id_changed/);
    await assert.rejects(f.ledger.acquire({uid:'some-real-user',caseId:CASE}),
      /unapproved_case/);
    assert.equal((await f.ledger.status(ctx)).epoch,1);
  }finally{f.close();}
});
test('concurrent acquisitions never yield two active leases',async()=>{
  const f=fixture();
  try{
    const outcomes=await Promise.allSettled([
      f.ledger.acquire(ctx),f.ledger.acquire(ctx)
    ]);
    assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
    assert.equal(outcomes.filter(x=>x.status==='rejected').length,1);
    assert.equal((await f.ledger.status(ctx)).state,'active');
  }finally{f.close();}
});
test('review of stale checkpoint cannot authorize resumed execution',async()=>{
  const f=fixture();
  try{
    await f.ledger.acquire(ctx);
    await assert.rejects(f.ledger.approveRecovery(ctx,{
      independentReview:async()=>{
        await f.ledger.complete({...ctx,epoch:1,
          phase:CONTROLLED_DELETION_PHASES[0]});
        return true;
      }
    }),/review_stale/);
    assert.equal((await f.ledger.status(ctx)).state,'active');
    await assert.rejects(f.ledger.acquire(ctx),/active_case_needs_review/);
  }finally{f.close();}
});
test('an unknown or corrupted checkpoint never advances to Auth',async()=>{
  const f=fixture();
  try{
    await f.ledger.acquire(ctx);
    f.db.prepare(
      'UPDATE qa_controlled_case_ledger SET completed_json=? WHERE uid=?'
    ).run('["delete_auth_last"]',A);
    await assert.rejects(f.ledger.status(ctx),/invalid_checkpoint/);
    await assert.rejects(f.ledger.approveRecovery(ctx,{
      independentReview:async()=>true
    }),/invalid_checkpoint/);
    await assert.rejects(f.ledger.complete({...ctx,epoch:1,
      phase:'delete_auth_last'}),/invalid_checkpoint/);
  }finally{f.close();}
});
test('database with extra tables, insecure permissions or in-memory db rejected',()=>{
  const f=fixture();
  try{
    f.db.exec('CREATE TABLE unreviewed_tokens(uid TEXT)');
    assert.throws(()=>createQaPersistentDeletionLedger({
      projectId:PROJECT,db:f.db
    }),/unexpected_schema/);
  }finally{f.close();}
  const memory=new DatabaseSync(':memory:');
  try{assert.throws(()=>createQaPersistentDeletionLedger({
    projectId:PROJECT,db:memory
  }),/durable_unattached_database_required/);}
  finally{memory.close();}
});
test('a readable-by-others QA journal is never used for deletion authority',()=>{
  const f=fixture();
  try{
    chmodSync(f.file,0o644);
    assert.throws(()=>createQaPersistentDeletionLedger({
      projectId:PROJECT,db:f.db
    }),/insecure_database_permissions/);
    chmodSync(f.file,0o600);
    assert.equal((f.ledger.status instanceof Function),true);
  }finally{f.close();}
});
test('recovering a complete case cannot erase or replace checkpoints',async()=>{
  const f=fixture();
  try{
    await f.ledger.acquire(ctx);
    for(const phase of CONTROLLED_DELETION_PHASES)
      assert.equal(await f.ledger.complete({...ctx,epoch:1,phase}),true);
    await assert.rejects(f.ledger.approveRecovery(ctx,{
      independentReview:async()=>true
    }),/case_not_interrupted/);
    assert.deepEqual((await f.ledger.status(ctx)).completed,
      CONTROLLED_DELETION_PHASES);
  }finally{f.close();}
});
