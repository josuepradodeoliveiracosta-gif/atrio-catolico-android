import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync,chmodSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {createQaThreeAccountMediaEngine,QA_PHOTO_ACCOUNTS}
  from './qa-three-account-media-engine.js';
import {createQaPersistentDeletionLedger}
  from './qa-persistent-case-ledger.js';
import {createControlledQaDeletionExecutor,CONTROLLED_DELETION_PHASES}
  from './controlled-executor.js';

const PROJECT='demo-atrio-v11';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const UIDS=[...QA_PHOTO_ACCOUNTS];
const PREFIX='atrio-privacy-qa-20261103/';
const originals=Object.freeze(Object.fromEntries(UIDS.map((uid,i)=>[
  uid,Object.freeze({
    assetId:String(i+1).repeat(32),
    publicId:PREFIX+uid+'/123e4567-e89b-42d3-a456-42661417400'+(i+1),
    sha256:String(i+4).repeat(64),
    type:i===0?'authenticated':i===1?'upload':'private'
  })
])));
const cloneAsset=x=>({...x});
function fixture(target,{timeoutAfterDelete=false}={}){
  const assets=new Map(UIDS.map(uid=>[uid,[cloneAsset(originals[uid])]]));
  const events=[];
  let frozen=true,approved=true,lease=true,mode='normal',failAfter=timeoutAfterDelete;
  const store={
    async list({uid}){
      events.push('list:'+uid);
      if(mode==='incomplete')return {complete:false,items:[],nextCursor:'page-2'};
      if(mode==='unexpected'&&uid===target)
        return {complete:true,nextCursor:null,items:[cloneAsset(originals[UIDS.find(x=>x!==target)])]};
      return {complete:true,nextCursor:null,
        items:(assets.get(uid)||[]).map(cloneAsset)};
    },
    async deleteConditional(req){
      events.push('delete:'+req.uid);
      assert.equal(req.uid,target);
      assert.equal(req.caseId,CASE);
      assert.equal(req.assetId,originals[target].assetId);
      assert.equal(req.publicId,originals[target].publicId);
      assert.equal(req.sha256,originals[target].sha256);
      const current=assets.get(req.uid);
      assert.equal(current.length,1);
      assert.deepEqual(current[0],originals[target]);
      assets.set(target,[]);
      if(failAfter){
        failAfter=false;
        throw Error('qa_timeout_after_media_commit');
      }
      return {status:'deleted',assetId:req.assetId,uid:req.uid};
    }
  };
  const ctx={uid:target,caseId:CASE,epoch:1};
  const opts={
    projectId:PROJECT,manifest:originals,store,
    assertAuthorized:async()=>approved,assertFrozen:async()=>frozen,
    assertLease:async()=>lease
  };
  return {
    target,assets,events,store,ctx,opts,
    engine:()=>createQaThreeAccountMediaEngine(opts),
    setFrozen:x=>{frozen=x;},
    setApproved:x=>{approved=x;},
    setLease:x=>{lease=x;},
    setMode:x=>{mode=x;},
    assertPreserved(){
      for(const uid of UIDS){
        if(uid!==target)assert.deepEqual(assets.get(uid),[originals[uid]]);
      }
    },
    deletionCalls:()=>events.filter(x=>x.startsWith('delete:')).length
  };
}

test('each of three QA accounts may be deleted in isolation; other two photos unchanged',async t=>{
  for(const uid of UIDS){
    await t.test(uid,async()=>{
      const f=fixture(uid),engine=f.engine();
      assert.equal(await engine.empty(f.ctx),false);
      assert.equal((await engine.purge(f.ctx)).productionReady,false);
      assert.equal(await engine.empty(f.ctx),true);
      assert.deepEqual(f.assets.get(uid),[]);
      f.assertPreserved();
      assert.equal(f.deletionCalls(),1);
      await engine.purge(f.ctx); // already removed; no duplicate
      assert.equal(f.deletionCalls(),1);
    });
  }
});
test('incomplete ownership inventory prevents any destructive action',async()=>{
  const f=fixture(UIDS[0]);f.setMode('incomplete');
  await assert.rejects(f.engine().purge(f.ctx),
    /qa_three_media_denied:incomplete_or_ambiguous_inventory/);
  assert.equal(f.deletionCalls(),0);
  for(const uid of UIDS)assert.deepEqual(f.assets.get(uid),[originals[uid]]);
});
test('cross-account media returned for selected owner is rejected before delete',async()=>{
  const f=fixture(UIDS[0]);f.setMode('unexpected');
  await assert.rejects(f.engine().purge(f.ctx),
    /qa_three_media_denied:unexpected_or_foreign_asset/);
  assert.equal(f.deletionCalls(),0);f.assertPreserved();
});
test('missing control photo blocks deleting selected account',async()=>{
  const f=fixture(UIDS[0]);f.assets.set(UIDS[2],[]);
  await assert.rejects(f.engine().purge(f.ctx),
    /qa_three_media_denied:control_photo_missing_or_changed/);
  assert.equal(f.deletionCalls(),0);
  assert.deepEqual(f.assets.get(UIDS[0]),[originals[UIDS[0]]]);
});
test('revoked authorization, unverified freeze, stale epoch prevent deletion',async()=>{
  for(const field of ['setApproved','setFrozen','setLease']){
    const f=fixture(UIDS[0]);
    f[field](false);
    await assert.rejects(f.engine().purge(f.ctx),/qa_three_media_denied:/);
    assert.equal(f.deletionCalls(),0);
  }
});
test('real UIDs, copied asset ids, unexpected manifest keys and wrong project denied',async()=>{
  const f=fixture(UIDS[0]);
  assert.throws(()=>createQaThreeAccountMediaEngine({...f.opts,
    projectId:'atrio-catolico'}),/not_disposable_project/);
  assert.throws(()=>createQaThreeAccountMediaEngine({...f.opts,
    manifest:{...originals,[UIDS[1]]:{...originals[UIDS[1]],
      assetId:originals[UIDS[0]].assetId}}}),/invalid_or_shared_asset/);
  assert.throws(()=>createQaThreeAccountMediaEngine({...f.opts,
    manifest:{...originals,real_user:originals[UIDS[0]]}}),
    /incomplete_qa_manifest/);
  await assert.rejects(f.engine().purge({...f.ctx,uid:'some-real-uid'}),
    /invalid_disposable_case/);
});
test('timeout after conditional delete never authorizes an automatic duplicate',async()=>{
  const f=fixture(UIDS[0],{timeoutAfterDelete:true}),engine=f.engine();
  await assert.rejects(engine.purge(f.ctx),/qa_timeout_after_media_commit/);
  f.assertPreserved();
  assert.equal(await engine.empty(f.ctx),true);
  assert.equal(f.deletionCalls(),1);
  await engine.purge(f.ctx);
  assert.equal(f.deletionCalls(),1);
});
test('post-delete control loss is detected; no false proof of complete deletion',async()=>{
  const f=fixture(UIDS[0]);
  const orig=f.store.deleteConditional;
  f.store.deleteConditional=async req=>{
    const x=await orig(req);
    f.assets.set(UIDS[1],[]);
    return x;
  };
  await assert.rejects(f.engine().purge(f.ctx),
    /qa_three_media_denied:control_photo_missing_or_changed/);
  assert.equal(f.deletionCalls(),1);
  assert.deepEqual(f.assets.get(UIDS[0]),[]);
});
function ledgerFixture(){
  const dir=mkdtempSync(join(tmpdir(),'atrio-qa-delete-ledger-'));
  const filename=join(dir,'ledger.sqlite');
  let db=new DatabaseSync(filename);chmodSync(filename,0o600);
  let ledger=createQaPersistentDeletionLedger({projectId:PROJECT,db});
  return {
    get ledger(){return ledger;},
    restart(){
      db.close();db=new DatabaseSync(filename);chmodSync(filename,0o600);
      ledger=createQaPersistentDeletionLedger({projectId:PROJECT,db});
    },
    close(){db.close();rmSync(dir,{recursive:true,force:true});}
  };
}
function backendFixture(mediaFixture,dbFixture){
  let frozen=false,docs=2,tokens=1,auth=true;
  const backend={
    approvals:{
      async confirm(){return true;},
      async authorizeRecoveryRetry(){return true;} // QA-only test stub
    },
    ledger:{
      acquire:x=>dbFixture.ledger.acquire(x),
      check:x=>dbFixture.ledger.check(x),
      complete:x=>dbFixture.ledger.complete(x)
    },
    freeze:{
      async enable(){frozen=true;},
      async verify(){return frozen;}
    },
    firestore:{
      async purge(){docs=0;},
      async assess(){return {allKnownScopesScanned:true,
        foreignReferencesResolved:true,retentionAdjudicated:true,
        remaining:docs,unknownScopes:0};}
    },
    media:{
      purge:x=>mediaFixture.engine().purge(x),
      empty:x=>mediaFixture.engine().empty(x)
    },
    fcm:{
      async revoke(){tokens=0;},
      async empty(){return tokens===0;}
    },
    auth:{
      async remove(){auth=false;},
      async exists(){return auth;}
    }
  };
  const proof={frozen:()=>frozen,authPresent:()=>auth};
  return {backend,proof};
}
test('real seven-phase executor deletes only selected synthetic photo for all three UIDs',async t=>{
  for(const uid of UIDS){
    await t.test(uid,async()=>{
      const media=fixture(uid),db=ledgerFixture();
      try{
        const {backend,proof}=backendFixture(media,db);
        media.opts.assertFrozen=async()=>proof.frozen();
        media.opts.assertLease=x=>db.ledger.check(x);
        const engine=createControlledQaDeletionExecutor({projectId:PROJECT,backend});
        const result=await engine.run({uid,caseId:CASE});
        assert.equal(result.completed,7);
        assert.equal(proof.authPresent(),false);
        assert.equal(media.deletionCalls(),1);
        media.assertPreserved();
        assert.deepEqual((await db.ledger.status({uid,caseId:CASE})).completed,
          CONTROLLED_DELETION_PHASES);
        db.restart();
        const repeat=await engine.run({uid,caseId:CASE});
        assert.equal(repeat.completed,7);
        assert.equal(media.deletionCalls(),1);
      }finally{db.close();}
    });
  }
});
test('executor recovery after media timeout never calls delete twice or touches controls',async()=>{
  const media=fixture(UIDS[0],{timeoutAfterDelete:true}),db=ledgerFixture();
  try{
    const {backend,proof}=backendFixture(media,db);
    media.opts.assertFrozen=async()=>proof.frozen();
    media.opts.assertLease=x=>db.ledger.check(x);
    const engine=createControlledQaDeletionExecutor({projectId:PROJECT,backend});
    const ctx={uid:UIDS[0],caseId:CASE};
    await assert.rejects(engine.run(ctx),/qa_timeout_after_media_commit/);
    assert.equal(media.deletionCalls(),1);
    assert.equal(proof.authPresent(),true);
    await assert.rejects(engine.run(ctx),/active_case_needs_review/);
    await db.ledger.approveRecovery(ctx,{independentReview:async snap=>
      snap.uid===UIDS[0]&&snap.completed.length===2&&
      await media.engine().empty({...ctx,epoch:snap.epoch})===true
    });
    db.restart();
    const result=await engine.run(ctx);
    assert.equal(result.completed,7);
    assert.equal(proof.authPresent(),false);
    assert.equal(media.deletionCalls(),1);
    media.assertPreserved();
  }finally{db.close();}
});
