/**
 * Failure matrix for the seven irreversible-looking deletion phases.
 *
 * LOCAL SQLite + synthetic providers only. This exercises the real
 * controlled-executor state machine, an on-disk ledger, a crash after a
 * provider effect, explicit independent review, and a fresh process-like
 * DB connection. It never accesses Firebase, FCM or Cloudinary remotely.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {createQaPersistentDeletionLedger}
  from './qa-persistent-case-ledger.js';
import {CONTROLLED_DELETION_PHASES,createControlledQaDeletionExecutor}
  from './controlled-executor.js';

const PROJECT='demo-atrio-v11';
const ctx=Object.freeze({
  uid:'qa-delete-candidate',
  caseId:'fa00bbaa-4a09-4fd2-b399-001122334455'
});
const MUTATIONS=new Set([
  'freeze_writes','purge_firestore','purge_media_and_d1',
  'revoke_fcm','delete_auth_last'
]);
function fixture(target,location='after'){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-delete-ledger-'));
  const file=join(dir,'ledger.sqlite');
  let db=new DatabaseSync(file);
  chmodSync(file,0o600);
  let ledger=createQaPersistentDeletionLedger({projectId:PROJECT,db});
  let shouldFail=true;
  let mediaReadUnreachable=false;
  let firestoreAmbiguous=false,mediaUnknown=false,fcmUnknown=false,authUnknown=false;
  let allowRetry=true;
  let allowedRetryPhase=null;
  const retryCalls=[];
  const effects=[];
  const state={
    frozen:false,documents:3,media:2,tokens:2,auth:true,
    neighbor:Object.freeze({documents:7,media:3,tokens:3,auth:true})
  };
  const validate=x=>{
    assert.equal(x.uid,ctx.uid);
    assert.equal(x.caseId,ctx.caseId);
    assert.ok(x.epoch===undefined||(Number.isInteger(x.epoch)&&x.epoch>=1));
  };
  const mutation=(phase,change)=>async x=>{
    validate(x);
    if(location==='before'&&target===phase&&shouldFail){
      shouldFail=false;
      throw Error('qa_failed_before_'+phase);
    }
    effects.push(phase);
    change();
  };
  const backend={
    approvals:{
      async confirm(x){validate(x);return true;},
      async authorizeRecoveryRetry(x){
        validate(x);
        assert.equal(x.epoch,2);
        assert.ok(CONTROLLED_DELETION_PHASES.includes(x.phase));
        retryCalls.push(x.phase);
        return allowRetry && (allowedRetryPhase===null||
          allowedRetryPhase===x.phase);
      }
    },
    ledger:{
      async acquire(x){validate(x);return ledger.acquire(x);},
      async check(x){validate(x);return ledger.check(x);},
      async complete(x){
        validate(x);
        if(location==='after'&&x.phase===target&&shouldFail){
          shouldFail=false;
          throw Error('qa_failed_after_'+target);
        }
        return ledger.complete(x);
      }
    },
    freeze:{
      enable:mutation('freeze_writes',()=>{state.frozen=true;}),
      async verify(x){validate(x);return state.frozen;}
    },
    firestore:{
      purge:mutation('purge_firestore',()=>{state.documents=0;}),
      async assess(x){
        validate(x);
        return {allKnownScopesScanned:!firestoreAmbiguous,
          foreignReferencesResolved:true,retentionAdjudicated:true,
          remaining:state.documents,unknownScopes:firestoreAmbiguous?1:0};
      }
    },
    media:{
      purge:mutation('purge_media_and_d1',()=>{state.media=0;}),
      async empty(x){
        validate(x);
        if(mediaReadUnreachable)throw Error('qa_independent_readback_unavailable');
        return mediaUnknown?undefined:state.media===0;
      }
    },
    fcm:{
      revoke:mutation('revoke_fcm',()=>{state.tokens=0;}),
      async empty(x){validate(x);return fcmUnknown?null:state.tokens===0;}
    },
    auth:{
      remove:mutation('delete_auth_last',()=>{state.auth=false;}),
      async exists(x){validate(x);return authUnknown?'unknown':state.auth;}
    }
  };
  const build=()=>createControlledQaDeletionExecutor({projectId:PROJECT,backend});
  return {
    effects,state,build,backend,retryCalls,
    setAllowRetry:x=>{allowRetry=Boolean(x);},
    setAllowedRetryPhase:x=>{allowedRetryPhase=x;},
    setFirestoreAmbiguous:x=>{firestoreAmbiguous=Boolean(x);},
    setMediaUnknown:x=>{mediaUnknown=Boolean(x);},
    setFcmUnknown:x=>{fcmUnknown=Boolean(x);},
    setAuthUnknown:x=>{authUnknown=Boolean(x);},
    setMediaReadUnreachable:x=>{mediaReadUnreachable=Boolean(x);},
    get ledger(){return ledger;},
    restart(){
      db.close();db=new DatabaseSync(file);chmodSync(file,0o600);
      ledger=createQaPersistentDeletionLedger({projectId:PROJECT,db});
    },
    close(){db.close();rmSync(dir,{recursive:true,force:true});}
  };
}

async function scenario(target,location){
  const f=fixture(target,location);
  try{
    const operation=f.build();
    const error=location==='before'?
      'qa_failed_before_'+target:'qa_failed_after_'+target;
    await assert.rejects(operation.run(ctx),new RegExp(error));
    const first=await f.ledger.status(ctx);
    const index=CONTROLLED_DELETION_PHASES.indexOf(target);
    assert.equal(first.state,'active');
    assert.equal(first.epoch,1);
    assert.deepEqual(first.completed,CONTROLLED_DELETION_PHASES.slice(0,index));
    assert.deepEqual(f.state.neighbor,{
      documents:7,media:3,tokens:3,auth:true
    });
    await assert.rejects(operation.run(ctx),
      /qa_persistent_ledger_active_case_needs_review/);
    // Reject an unverified resume even when the operator names a phase.
    await assert.rejects(f.ledger.approveRecovery(ctx,{
      independentReview:async()=>false
    }),/qa_persistent_ledger_review_rejected/);
    assert.equal((await f.ledger.status(ctx)).state,'active');

    // Explicit synthetic review checks the original case and current
    // provider state. Real production review must be independently signed.
    const approval=await f.ledger.approveRecovery(ctx,{
      independentReview:async snapshot=>{
        assert.equal(snapshot.uid,ctx.uid);
        assert.equal(snapshot.caseId,ctx.caseId);
        assert.equal(snapshot.epoch,1);
        assert.deepEqual(snapshot.completed,
          CONTROLLED_DELETION_PHASES.slice(0,index));
        return snapshot.completed.every(x=>CONTROLLED_DELETION_PHASES.includes(x)) &&
          (index===0||f.state.frozen===true);
      }
    });
    assert.equal(approval.productionApproved,false);
    assert.equal(await f.ledger.check({...ctx,epoch:1}),false);

    // A new SQLite connection must accept the review, issue epoch=2 and
    // reconcile the remote effect before attempting another mutation.
    f.restart();
    const result=await f.build().run(ctx);
    assert.equal(result.state,'isolated_qa_deletion_reconciled');
    assert.equal(result.productionAuthorized,false);
    assert.deepEqual((await f.ledger.status(ctx)).completed,
      CONTROLLED_DELETION_PHASES);
    assert.equal((await f.ledger.status(ctx)).epoch,2);
    assert.equal((await f.ledger.status(ctx)).state,'complete');
    assert.deepEqual(f.state,{
      frozen:true,documents:0,media:0,tokens:0,auth:false,
      neighbor:{documents:7,media:3,tokens:3,auth:true}
    });
    // Verify and checkpoint independently: NEVER repeat a confirmed
    // provider effect after a timeout in this synthetic QA environment.
    for(const phase of MUTATIONS){
      assert.equal(f.effects.filter(x=>x===phase).length,1,
        'duplicate provider mutation: '+phase+' after '+target);
    }
    f.restart();
    const repeated=await f.build().run(ctx);
    assert.equal(repeated.completed,7);
    assert.equal(f.effects.length,MUTATIONS.size);
  }finally{f.close();}
}

test('timeouts AFTER each of the 7 phases resume without duplicate mutations',async t=>{
  for(const phase of CONTROLLED_DELETION_PHASES)
    await t.test(phase,async()=>scenario(phase,'after'));
});
test('failures BEFORE each mutating phase execute exactly once after review',async t=>{
  for(const phase of MUTATIONS)
    await t.test(phase,async()=>scenario(phase,'before'));
});
test('unavailable readback during recovery blocks re-execution and keeps case active',async()=>{
  const f=fixture('purge_media_and_d1','after');
  try{
    await assert.rejects(f.build().run(ctx),
      /qa_failed_after_purge_media_and_d1/);
    assert.equal(f.effects.filter(x=>x==='purge_media_and_d1').length,1);
    await f.ledger.approveRecovery(ctx,{independentReview:async()=>true});
    f.restart();
    f.setMediaReadUnreachable(true);
    await assert.rejects(f.build().run(ctx),
      /qa_independent_readback_unavailable/);
    assert.equal(f.effects.filter(x=>x==='purge_media_and_d1').length,1);
    assert.equal((await f.ledger.status(ctx)).state,'active');
    assert.equal((await f.ledger.status(ctx)).epoch,2);
    await assert.rejects(f.build().run(ctx),
      /qa_persistent_ledger_active_case_needs_review/);
  }finally{f.close();}
});

test('phase-specific second approval blocks replay when a recovered phase remains present',async()=>{
  const f=fixture('freeze_writes','after');
  try{
    await assert.rejects(f.build().run(ctx),/qa_failed_after_freeze_writes/);
    assert.deepEqual(f.effects,['freeze_writes']);
    await f.ledger.approveRecovery(ctx,{independentReview:async()=>true});
    f.restart();
    f.setAllowRetry(false);
    await assert.rejects(f.build().run(ctx),
      /controlled_deletion_denied:recovery_retry_unapproved/);
    assert.deepEqual(f.effects,['freeze_writes']);
    assert.deepEqual(f.retryCalls,['purge_firestore']);
    assert.deepEqual((await f.ledger.status(ctx)).completed,['freeze_writes']);
    await assert.rejects(f.build().run(ctx),
      /qa_persistent_ledger_active_case_needs_review/);
  }finally{f.close();}
});
test('wrong-phase recovery approval cannot authorize a different provider effect',async()=>{
  const f=fixture('freeze_writes','after');
  try{
    await assert.rejects(f.build().run(ctx),/qa_failed_after_freeze_writes/);
    await f.ledger.approveRecovery(ctx,{independentReview:async()=>true});
    f.restart();
    f.setAllowedRetryPhase('delete_auth_last');
    await assert.rejects(f.build().run(ctx),
      /controlled_deletion_denied:recovery_retry_unapproved/);
    assert.deepEqual(f.retryCalls,['purge_firestore']);
    assert.deepEqual(f.effects,['freeze_writes']);
  }finally{f.close();}
});
test('absent phase-specific reviewer is fail-closed even after general recovery',async()=>{
  const f=fixture('freeze_writes','after');
  try{
    await assert.rejects(f.build().run(ctx),/qa_failed_after_freeze_writes/);
    await f.ledger.approveRecovery(ctx,{independentReview:async()=>true});
    f.restart();
    delete f.backend.approvals.authorizeRecoveryRetry;
    await assert.rejects(f.build().run(ctx),
      /controlled_deletion_denied:recovery_retry_authority_missing/);
    assert.deepEqual(f.effects,['freeze_writes']);
    assert.deepEqual((await f.ledger.status(ctx)).completed,['freeze_writes']);
  }finally{f.close();}
});

test('unknown provider state cannot authorize a destructive retry even with phase approval',async t=>{
  for(const item of [
    {target:'freeze_writes',location:'after',
      setter:'setFirestoreAmbiguous',reason:'firestore_readback_unknown'},
    {target:'purge_media_and_d1',location:'before',
      setter:'setMediaUnknown',reason:'media_readback_unknown'},
    {target:'revoke_fcm',location:'before',
      setter:'setFcmUnknown',reason:'fcm_readback_unknown'},
    {target:'delete_auth_last',location:'before',
      setter:'setAuthUnknown',reason:'auth_readback_unknown'}
  ]){
    await t.test(item.reason,async()=>{
      const f=fixture(item.target,item.location);
      try{
        await assert.rejects(f.build().run(ctx),
          new RegExp('qa_failed_'+item.location+'_'+item.target));
        const before=f.effects.length;
        await f.ledger.approveRecovery(ctx,{independentReview:async()=>true});
        f.restart();
        f[item.setter](true);
        await assert.rejects(f.build().run(ctx),
          new RegExp('controlled_deletion_denied:'+item.reason));
        assert.equal(f.effects.length,before,'unknown must never repeat a mutation');
        assert.equal((await f.ledger.status(ctx)).state,'active');
        assert.equal((await f.ledger.status(ctx)).epoch,2);
        assert.deepEqual(f.retryCalls,[],
          'unknown must be rejected before asking for retry authorization');
      }finally{f.close();}
    });
  }
});
