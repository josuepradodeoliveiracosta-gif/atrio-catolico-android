import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {QaSqliteLease} from './qa-deletion-sqlite-lease.mjs';
import {removeQaAuthAfterReconciliation}
  from './qa-deletion-auth-fence.mjs';

const A='qa-delete-alice',B='qa-delete-bob';
const REPORT=Object.freeze({
  state:'qa_reconciled_known_scopes_only',
  productionReady:false,
  globalCoverageComplete:false,
  firebaseAuthActuallyChecked:false,
  cloudinaryActuallyChecked:false
});
const saved={host:process.env.FIRESTORE_EMULATOR_HOST,
  project:process.env.GCLOUD_PROJECT,
  credential:process.env.GOOGLE_APPLICATION_CREDENTIALS,
  service:process.env.FIREBASE_SERVICE_ACCOUNT_JSON,
  authHost:process.env.FIREBASE_AUTH_EMULATOR_HOST};
function setSafeEnv(){
  process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8089';
  process.env.GCLOUD_PROJECT='demo-atrio-v11';
  delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
  delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
}
function restore(){
  const values={
    FIRESTORE_EMULATOR_HOST:saved.host,GCLOUD_PROJECT:saved.project,
    GOOGLE_APPLICATION_CREDENTIALS:saved.credential,
    FIREBASE_SERVICE_ACCOUNT_JSON:saved.service,
    FIREBASE_AUTH_EMULATOR_HOST:saved.authHost
  };
  for(const [k,v] of Object.entries(values)){
    if(v===undefined)delete process.env[k];else process.env[k]=v;
  }
}
function fixture(overrides={}){
  const auth=new Set([A,B]);
  const media=new Set();
  return {
    uid:A,db:{marker:'local-demo-only'},auth,media,
    context:{writesFrozen:true},assertLease:()=>{},
    reconcile:async()=>REPORT,
    ...overrides
  };
}
function deferred(){
  let signal;
  const promise=new Promise(resolve=>{signal=resolve;});
  return {promise,signal};
}
setSafeEnv();
try {
  await test('normal QA effect removes only Alice after recheck',async()=>{
    const input=fixture();
    const out=await removeQaAuthAfterReconciliation(input);
    assert.equal(out.state,'qa_fake_auth_removed_only');
    assert.equal(out.productionReady,false);
    assert.equal(input.auth.has(A),false);
    assert.equal(input.auth.has(B),true);
    // The same checked operation is idempotent in a fake Set.
    await removeQaAuthAfterReconciliation(input);
    assert.equal(input.auth.has(B),true);
  });

  await test('lost REAL SQLite lease during asynchronous scan blocks Auth effect',
    async()=>{
      const dir=mkdtempSync(join(tmpdir(),'atrio-qa-auth-fence-'));
      const filename=join(dir,'journal.sqlite');
      let one,two;
      try{
        one=new DatabaseSync(filename);two=new DatabaseSync(filename);
        let now=1000;
        const oldLease=new QaSqliteLease(one,{now:()=>now});
        const newLease=new QaSqliteLease(two,{now:()=>now});
        const oldTicket=oldLease.acquire({ttlMs:100});
        const entered=deferred(),resume=deferred();
        const input=fixture({
          assertLease:()=>oldLease.assertOwned(oldTicket),
          reconcile:async()=>{entered.signal();await resume.promise;return REPORT;}
        });
        const running=removeQaAuthAfterReconciliation(input);
        await entered.promise;
        now=1101;
        const newTicket=newLease.acquire({ttlMs:100});
        resume.signal();
        await assert.rejects(running,/qa_lease_lost/);
        assert.equal(input.auth.has(A),true,
          'stale runner may never remove fake Auth even when scan looked clear');
        assert.equal(input.auth.has(B),true);
        // The new owner can safely perform a freshly authorized QA run.
        await removeQaAuthAfterReconciliation({
          ...input,assertLease:()=>newLease.assertOwned(newTicket),
          reconcile:async()=>REPORT
        });
        assert.equal(input.auth.has(A),false);
        assert.equal(input.auth.has(B),true);
      }finally{
        try{one?.close();}catch{}
        try{two?.close();}catch{}
        rmSync(dir,{recursive:true,force:true});
      }
    });

  await test('lost lease before scan blocks any reading or fake Auth mutation',
    async()=>{
      let reads=0;
      const input=fixture({
        assertLease:()=>{throw Error('qa_lease_lost');},
        reconcile:async()=>{reads++;return REPORT;}
      });
      await assert.rejects(removeQaAuthAfterReconciliation(input),/qa_lease_lost/);
      assert.equal(reads,0);
      assert.equal(input.auth.has(A),true);
    });

  await test('uncertain, partial or falsely production-ready reports fail closed',
    async()=>{
      for(const broken of [
        null,
        {...REPORT,productionReady:true},
        {...REPORT,globalCoverageComplete:true},
        {...REPORT,firebaseAuthActuallyChecked:true},
        {...REPORT,state:'complete'}
      ]){
        const input=fixture({reconcile:async()=>broken});
        await assert.rejects(removeQaAuthAfterReconciliation(input),
          /qa_auth_reconciliation_not_confirmed/);
        assert.equal(input.auth.has(A),true);
        assert.equal(input.auth.has(B),true);
      }
    });

  await test('reconciliation error must not be interpreted as absence',
    async()=>{
      const input=fixture({
        reconcile:async()=>{throw Error('firestore_query_unavailable');}
      });
      await assert.rejects(removeQaAuthAfterReconciliation(input),
        /firestore_query_unavailable/);
      assert.equal(input.auth.has(A),true);
    });


  await test('a new retention hold DURING asynchronous reconciliation blocks remote Auth',async()=>{
    const entered=deferred(),resume=deferred();
    let held=false,remoteCalls=0,preflightCalls=0;
    const input=fixture({
      reconcile:async()=>{
        entered.signal();await resume.promise;return REPORT;
      },
      preRemoteCheck:async uid=>{
        preflightCalls++;
        assert.equal(uid,A);
        if(held)throw Error('qa_retention_review_stale');
        return true;
      },
      removeRemote:async()=>{remoteCalls++;}
    });
    const pending=removeQaAuthAfterReconciliation(input);
    await entered.promise;
    held=true; // New moderation event while Firestore is in flight.
    resume.signal();
    await assert.rejects(pending,/qa_retention_review_stale/);
    assert.equal(preflightCalls,1);
    assert.equal(remoteCalls,0);
    assert.equal(input.auth.has(A),true);
    assert.equal(input.auth.has(B),true);
  });

  await test('ambiguous final preflight rejects Auth deletion with fail-closed result',async()=>{
    for(const value of [false,undefined,null,0]){
      let remoteCalls=0;
      const input=fixture({
        removeRemote:async()=>{remoteCalls++;},
        preRemoteCheck:async()=>value
      });
      await assert.rejects(removeQaAuthAfterReconciliation(input),
        /qa_auth_last_mile_preflight_unverified/);
      assert.equal(remoteCalls,0);
      assert.equal(input.auth.has(A),true);
      assert.equal(input.auth.has(B),true);
    }
    const missing=fixture({removeRemote:async()=>{}});
    await assert.rejects(removeQaAuthAfterReconciliation(missing),
      /qa_auth_invalid_fixture_context/);
    assert.equal(missing.auth.has(A),true);
  });

  await test('lost lease WHILE final preflight awaits blocks remote and fake Auth',async()=>{
    const entered=deferred(),resume=deferred();
    let leaseValid=true,remoteCalls=0;
    const input=fixture({
      assertLease:()=>{if(!leaseValid)throw Error('qa_lease_lost');},
      preRemoteCheck:async()=>{
        entered.signal();await resume.promise;
        return true;
      },
      removeRemote:async()=>{remoteCalls++;}
    });
    const pending=removeQaAuthAfterReconciliation(input);
    await entered.promise;
    leaseValid=false;
    resume.signal();
    await assert.rejects(pending,/qa_lease_lost/);
    assert.equal(remoteCalls,0);
    assert.equal(input.auth.has(A),true);
    assert.equal(input.auth.has(B),true);
  });

  await test('valid checked final boundary allows only synthetic account removal',async()=>{
    let checked=0,remoteCalls=0;
    const input=fixture({
      preRemoteCheck:async uid=>{assert.equal(uid,A);checked++;return true;},
      removeRemote:async uid=>{assert.equal(uid,A);remoteCalls++;}
    });
    await removeQaAuthAfterReconciliation(input);
    assert.equal(checked,1);
    assert.equal(remoteCalls,1);
    assert.equal(input.auth.has(A),false);
    assert.equal(input.auth.has(B),true);
  });

  await test('other user, missing freeze or real credentials are rejected',
    async()=>{
      for(const patch of [{uid:B},{context:{writesFrozen:false}},
        {auth:new Map([[A,true]])}]){
        const input=fixture(patch);
        await assert.rejects(removeQaAuthAfterReconciliation(input),
          /qa_auth_invalid_fixture_context/);
      }
      const input=fixture();
      process.env.GOOGLE_APPLICATION_CREDENTIALS='/tmp/never-use-prod.json';
      await assert.rejects(removeQaAuthAfterReconciliation(input),
        /qa_auth_live_environment_denied/);
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;
      process.env.FIREBASE_AUTH_EMULATOR_HOST='identitytoolkit.googleapis.com:443';
      await assert.rejects(removeQaAuthAfterReconciliation(input),
        /qa_auth_live_environment_denied/);
      delete process.env.FIREBASE_AUTH_EMULATOR_HOST;
      assert.equal(input.auth.has(A),true);
    });
} finally {
  restore();
}
