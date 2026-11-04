/**
 * QA INTEGRATION — real Firebase Admin SDK calls against local Auth and
 * Firestore emulators; avatar D1 uses in-memory SQLite. Media uses strict
 * Cloudinary-shaped HTTP localhost and FCM remains a synthetic double.
 * No production endpoint, secret or project is supported. This is NOT
 * homologation of live users, legal retention or deployed Worker fencing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {DatabaseSync} from 'node:sqlite';
import {createServer} from 'node:http';
import {createQaControlledCloudinaryLoopback}
  from './qa-controlled-cloudinary-loopback.mjs';
import {mkdtempSync,chmodSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQaPersistentDeletionLedger}
  from '../../../cloudflare/account-deletion-processor/src/qa-persistent-case-ledger.js';
import {scrubQaAvatarD1}
  from '../../../cloudflare/account-deletion-processor/src/qa-avatar-d1-cleanup.js';
import {
  createControlledQaDeletionExecutor,CONTROLLED_DELETION_PHASES
} from '../../../cloudflare/account-deletion-processor/src/controlled-executor.js';

const PROJECT='demo-atrio-v11';
const ALICE='qa-delete-candidate',BOB='qa-delete-neighbor';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
const ALICE_AVATAR='atrio-avatares/'+ALICE+'/123e4567-e89b-42d3-a456-426614174001';
const BOB_AVATAR='atrio-avatares/'+BOB+'/123e4567-e89b-42d3-a456-426614174002';
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.CLOUDINARY_CLOUD_NAME ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    throw Error('controlled_e2e_production_environment_denied');
}
guard();
const account=initializeApp({projectId:PROJECT},'controlled-e2e-only');
const auth=getAuth(account),db=getFirestore(account);
let avatarDb=null,drainDb=null,mediaServer=null;
let journalDb=null,journalDir=null,journalPath=null;
const aliceOwned=[
  'users/'+ALICE+'/pushDevices/device-a',
  'users/'+ALICE+'/notifications/notice-a',
  'posts/post-candidate/replies/reply-candidate',
  'posts/post-candidate',
  'users/'+BOB+'/notifications/notice-from-candidate',
  'users/'+ALICE,
  'profiles/'+ALICE
];
const aliceRefs=['posts/post-candidate','posts/post-candidate/replies/reply-candidate'];
const bobUntouched=[
  'profiles/'+BOB,'users/'+BOB,
  'posts/post-neighbor','users/'+BOB+'/notifications/neighbor-own'
];
const set=(path,data)=>db.doc(path).set(data);
const exists=async path=>(await db.doc(path).get()).exists;
const authExists=async uid=>{
  try{return (await auth.getUser(uid)).uid===uid;}
  catch(e){if(e?.code==='auth/user-not-found')return false;throw e;}
};
const readAll=async paths=>Promise.all(paths.map(exists));
try{
  test('homologação local Firebase: Auth por último, bloqueio ativo e vizinho preservado',async()=>{
    guard();
    // Distinct disposable UIDs, independent of the other QA fixtures.
    for(const uid of [ALICE,BOB])
      await auth.createUser({uid,email:uid+'@example.invalid',disabled:false});
    await set('account_deletion_requests/'+ALICE,{
      status:'requested',source:'android',
      requestedAt:new Date('2026-11-03T12:00:00Z')
    });
    await set('profiles/'+ALICE,{displayName:'Candidata QA'});
    await set('users/'+ALICE,{name:'Conta fictícia'});
    await set('users/'+ALICE+'/pushDevices/device-a',{uid:ALICE,token:'FAKE'});
    await set('users/'+ALICE+'/notifications/notice-a',{uid:ALICE,actorUid:BOB});
    await set('posts/post-candidate',{uid:ALICE,title:'Fictício'});
    await set('posts/post-candidate/replies/reply-candidate',{uid:ALICE,body:'Fictício'});
    await set('users/'+BOB+'/notifications/notice-from-candidate',{
      actorUid:ALICE,postId:'post-candidate'
    });
    await set('profiles/'+BOB,{displayName:'Outro participante'});
    await set('users/'+BOB,{name:'Conta preservada'});
    await set('posts/post-neighbor',{uid:BOB,title:'Preservar'});
    await set('users/'+BOB+'/notifications/neighbor-own',{actorUid:BOB});

    avatarDb=new DatabaseSync(':memory:');
    avatarDb.exec([
      'CREATE TABLE avatar_pending(uid TEXT PRIMARY KEY NOT NULL,public_id TEXT NOT NULL UNIQUE,created_at INTEGER NOT NULL)',
      'CREATE TABLE avatar_rate(uid TEXT PRIMARY KEY NOT NULL,next_at INTEGER NOT NULL)',
      'CREATE TABLE avatar_mutex(uid TEXT PRIMARY KEY NOT NULL,nonce TEXT NOT NULL,expires_at INTEGER NOT NULL)',
      'CREATE TABLE avatar_moderation(id INTEGER PRIMARY KEY AUTOINCREMENT,actor_uid TEXT NOT NULL,target_uid TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL)'
    ].join(';')+';');
    // The avatar cleanup adapter insists on its own FOUR-table schema.
    // Keep independent privileged-write admission evidence in a distinct
    // disposable in-memory SQLite database; never weaken that allowlist.
    drainDb=new DatabaseSync(':memory:');
    drainDb.exec(
      "CREATE TABLE qa_privileged_inflight(operation_id TEXT PRIMARY KEY NOT NULL,uid TEXT NOT NULL CHECK(uid IN ('qa-delete-candidate','qa-delete-neighbor')),state TEXT NOT NULL CHECK(state='pending'))"
    );
    for(const [uid,id] of [[ALICE,ALICE_AVATAR],[BOB,BOB_AVATAR]]){
      avatarDb.prepare('INSERT INTO avatar_pending VALUES (?,?,?)').run(uid,id,100);
      avatarDb.prepare('INSERT INTO avatar_rate VALUES (?,?)').run(uid,200);
    }
    const avatarAbsent=()=>['avatar_pending','avatar_rate','avatar_mutex']
      .every(table=>avatarDb.prepare('SELECT COUNT(*) AS n FROM '+table+' WHERE uid=?')
        .get(ALICE).n===0) &&
      avatarDb.prepare('SELECT COUNT(*) AS n FROM avatar_moderation WHERE actor_uid=? OR target_uid=?')
        .get(ALICE,ALICE).n===0;
    // The real Firebase SDK integration now uses a DURABLE, private journal,
    // rather than an in-memory checkpoint array. The array below is only
    // an independent assertion log, never the source of authorization.
    journalDir=mkdtempSync(join(tmpdir(),'atrio-qa-delete-ledger-'));
    journalPath=join(journalDir,'ledger.sqlite');
    journalDb=new DatabaseSync(journalPath);
    chmodSync(journalPath,0o600);
    const journal=createQaPersistentDeletionLedger({
      projectId:PROJECT,db:journalDb
    });
    const ledger=[],effects=[],avatarCloudinary=new Set([ALICE_AVATAR,BOB_AVATAR]);
    let mediaDeletes=0;
    const respond=(res,status,data)=>{
      res.writeHead(status,{'Content-Type':'application/json',
        'Cache-Control':'no-store'});
      res.end(JSON.stringify(data));
    };
    mediaServer=createServer(async(req,res)=>{
      const u=new URL(req.url,'http://127.0.0.1');
      if(req.method==='GET'&&u.pathname==='/qa-controlled-cloudinary/inventory'){
        const uid=u.searchParams.get('uid');
        const type=u.searchParams.get('type');
        if(![ALICE,BOB].includes(uid)||
           !['upload','authenticated','private'].includes(type)||
           u.searchParams.get('limit')!=='25'||u.searchParams.has('cursor')||
           [...u.searchParams.keys()].sort().join(',')!=='limit,type,uid')
          return respond(res,403,{error:'unapproved_inventory'});
        const assets=[...avatarCloudinary].filter(id=>
          id.startsWith('atrio-avatares/'+uid+'/') &&
          (id===ALICE_AVATAR?'authenticated':'upload')===type);
        return respond(res,200,{items:assets.map(public_id=>({
          public_id,type})),nextCursor:null});
      }
      if(req.method==='POST'&&u.pathname==='/qa-controlled-cloudinary/destroy'){
        const parts=[];let length=0;
        for await(const part of req){
          length+=part.length;
          if(length>1024)return respond(res,413,{error:'too_large'});
          parts.push(part);
        }
        let body;
        try{body=JSON.parse(Buffer.concat(parts).toString('utf8'));}
        catch{return respond(res,400,{error:'bad_json'});}
        if(!body||Object.keys(body).sort().join(',')!==
          'fixtureUid,invalidate,public_id,type'||
           body.fixtureUid!==ALICE||body.public_id!==ALICE_AVATAR||
           body.invalidate!==true||body.type!=='authenticated')
          return respond(res,403,{error:'wrong_fixture'});
        mediaDeletes++;
        const changed=avatarCloudinary.delete(ALICE_AVATAR);
        return respond(res,200,{public_id:ALICE_AVATAR,
          result:changed?'deleted':'not_found'});
      }
      return respond(res,404,{error:'unknown_route'});
    });
    const mediaUrl=await new Promise((resolve,reject)=>{
      mediaServer.once('error',reject);
      mediaServer.listen(0,'127.0.0.1',()=>{
        mediaServer.off('error',reject);
        resolve('http://127.0.0.1:'+mediaServer.address().port+'/');
      });
    });
    assert.throws(()=>createQaControlledCloudinaryLoopback(
      'https://api.cloudinary.com/'),/only_private_loopback/);
    const mediaAdapter=createQaControlledCloudinaryLoopback(mediaUrl);
    let injectedAuthTimeout=true;
    const fcm=new Set(['token-alice']);
    const ctxCheck=x=>{
      guard();
      if(x?.uid!==ALICE||x?.caseId!==CASE)
        throw Error('qa_case_context_mismatch');
    };
    const backend={
      approvals:{
        async confirm(x){
          ctxCheck(x);
          const record=await db.doc('account_deletion_requests/'+ALICE).get();
          return record.exists && record.data()?.status==='requested' &&
            record.data()?.source==='android' && record.data()?.requestedAt instanceof Date===false &&
            record.data()?.requestedAt?.toDate?.()?.toISOString()==='2026-11-03T12:00:00.000Z';
        }
      },
      ledger:{
        async acquire(x){ctxCheck(x);return journal.acquire(x);},
        async check(x){ctxCheck(x);return journal.check(x);},
        async complete(x){
          ctxCheck(x);
          const ok=await journal.complete(x);
          if(ok)ledger.push(x.phase);
          return ok;
        }
      },
      freeze:{
        async enable(x){
          ctxCheck(x);
          await db.runTransaction(async tx=>{
            const request=await tx.get(db.doc('account_deletion_requests/'+ALICE));
            const marker=await tx.get(db.doc('account_deletion_freeze/'+ALICE));
            if(!request.exists || request.data()?.status!=='requested')
              throw Error('qa_verified_request_required');
            if(marker.exists && marker.data()?.caseId!==CASE)
              throw Error('qa_marker_belongs_to_other_case');
            if(!marker.exists)tx.create(db.doc('account_deletion_freeze/'+ALICE),
              {caseId:CASE,uid:ALICE,state:'frozen',epoch:1});
          });
          effects.push('freeze');
        },
        async verify(x){
          ctxCheck(x);
          const marker=await db.doc('account_deletion_freeze/'+ALICE).get();
          return marker.exists && marker.data()?.caseId===CASE &&
            marker.data()?.state==='frozen' && marker.data()?.epoch===1;
        },
        async drained(x){
          ctxCheck(x);
          // Independent fresh read of in-flight operations from disposable
          // SQLite. Does not attest production Workers or remote providers.
          const pending=drainDb.prepare(
            'SELECT COUNT(*) AS n FROM qa_privileged_inflight WHERE uid=?'
          ).get(ALICE).n;
          return Number.isSafeInteger(pending) && pending===0;
        }
      },
      firestore:{
        async purge(x){
          ctxCheck(x);
          for(const path of aliceOwned){
            if(!path.includes(ALICE) && !aliceRefs.includes(path) &&
               path!=='users/'+BOB+'/notifications/notice-from-candidate')
              throw Error('qa_unapproved_delete_path');
            await db.doc(path).delete();
          }
          effects.push('firestore');
        },
        async assess(x){
          ctxCheck(x);
          const found=(await readAll(aliceOwned)).filter(Boolean).length;
          // Independently check indexed references as well as exact paths.
          const posts=await db.collection('posts').where('uid','==',ALICE).get();
          const replies=await db.collectionGroup('replies').where('uid','==',ALICE).get();
          const notices=await db.collectionGroup('notifications')
            .where('actorUid','==',ALICE).get();
          return {
            allKnownScopesScanned:true,
            foreignReferencesResolved:true,
            retentionAdjudicated:true, // QA-only fixture: no moderation evidence
            remaining:found+posts.size+replies.size+notices.size,
            unknownScopes:0
          };
        }
      },
      media:{
        async purge(x){
          ctxCheck(x);
          await mediaAdapter.purge(); // strict loopback HTTP; no live Cloudinary
          await scrubQaAvatarD1({
            db:avatarDb,uid:ALICE,
            assertAuthorized:async()=>backend.approvals.confirm(x),
            assertFrozen:async()=>backend.freeze.verify(x),
            verifyCloudinaryGone:async(uid,id)=>
              uid===ALICE && id===ALICE_AVATAR &&
              (await mediaAdapter.empty())===true
          });
          effects.push('media-d1-sqlite');
        },
        async empty(x){
          ctxCheck(x);
          return avatarAbsent() && (await mediaAdapter.empty())===true;
        }
      },
      fcm:{
        async revoke(x){ctxCheck(x);fcm.clear();effects.push('fcm-stub');},
        async empty(x){ctxCheck(x);return fcm.size===0;}
      },
      auth:{
        async remove(x){
          ctxCheck(x);
          // Independent final verification before the real Emulator SDK call.
          assert.deepEqual(await readAll(aliceOwned),aliceOwned.map(()=>false));
          assert.equal(avatarAbsent(),true);
          assert.equal(await mediaAdapter.empty(),true);
          assert.equal(avatarCloudinary.has(ALICE_AVATAR),false);
          assert.equal(fcm.size,0);
          effects.push('auth-sdk');
          await auth.deleteUser(ALICE);
          // Real Auth Emulator side effect succeeds, but response is lost.
          // A second delete without reconciling could be destructive.
          if(injectedAuthTimeout){
            injectedAuthTimeout=false;
            throw Error('qa_injected_timeout_after_auth_delete');
          }
        },
        async exists(x){ctxCheck(x);return authExists(ALICE);}
      }
    };
    const executor=createControlledQaDeletionExecutor({
      projectId:PROJECT,backend
    });
    await assert.rejects(
      executor.run({uid:ALICE,caseId:CASE}),
      /qa_injected_timeout_after_auth_delete/
    );
    // All earlier effects actually happened; Auth has been deleted by the
    // Firebase Admin SDK, but its checkpoint is still uncertain.
    assert.equal(await authExists(ALICE),false);
    assert.equal(await authExists(BOB),true);
    assert.deepEqual(ledger,CONTROLLED_DELETION_PHASES.slice(0,5));
    assert.equal((await journal.status({uid:ALICE,caseId:CASE})).state,'active');
    await assert.rejects(
      executor.run({uid:ALICE,caseId:CASE}),/qa_persistent_ledger_active_case_needs_review/
    );
    await assert.rejects(journal.approveRecovery({uid:ALICE,caseId:CASE},{
      independentReview:async()=>false
    }),/qa_persistent_ledger_review_rejected/);
    const approval=await journal.approveRecovery({uid:ALICE,caseId:CASE},{
      independentReview:async snapshot=>{
        const status=await backend.firestore.assess({
          uid:ALICE,caseId:CASE,epoch:snapshot.epoch
        });
        return snapshot.uid===ALICE && snapshot.caseId===CASE &&
          snapshot.epoch===1 &&
          snapshot.completed.join(',')===
            CONTROLLED_DELETION_PHASES.slice(0,5).join(',') &&
          (await authExists(ALICE))===false &&
          status.remaining===0 && status.unknownScopes===0 &&
          avatarAbsent() && await mediaAdapter.empty()===true &&
          fcm.size===0 &&
          await backend.freeze.verify({
            uid:ALICE,caseId:CASE,epoch:snapshot.epoch
          })===true;
      }
    });
    assert.equal(approval.productionApproved,false);
    assert.equal(await journal.check({
      uid:ALICE,caseId:CASE,epoch:1
    }),false);
    // New process-like connection resumes under epoch 2, rechecks all
    // prior phases, and skips the already-removed Auth user.
    journalDb.close();
    journalDb=new DatabaseSync(journalPath);
    chmodSync(journalPath,0o600);
    const resumedLedger=createQaPersistentDeletionLedger({
      projectId:PROJECT,db:journalDb
    });
    backend.ledger=resumedLedger;
    const resumedExecutor=createControlledQaDeletionExecutor({
      projectId:PROJECT,backend
    });
    const result=await resumedExecutor.run({uid:ALICE,caseId:CASE});
    assert.equal(result.state,'isolated_qa_deletion_reconciled');
    assert.equal((await resumedLedger.status({uid:ALICE,caseId:CASE})).epoch,2);
    // The original audit array belonged to the interrupted process.
    // Only the REOPENED durable journal is the source of phase truth.
    assert.deepEqual(ledger,CONTROLLED_DELETION_PHASES.slice(0,5));
    assert.deepEqual((await resumedLedger.status({uid:ALICE,caseId:CASE})).completed,
      CONTROLLED_DELETION_PHASES);
    assert.equal((await resumedLedger.status({uid:ALICE,caseId:CASE})).state,'complete');
    assert.equal(await authExists(ALICE),false);
    assert.equal(await authExists(BOB),true);
    assert.deepEqual(await readAll(aliceOwned),aliceOwned.map(()=>false));
    assert.deepEqual(await readAll(bobUntouched),bobUntouched.map(()=>true));
    assert.equal(await exists('account_deletion_freeze/'+ALICE),true);
    assert.equal(avatarAbsent(),true);
    assert.equal(avatarCloudinary.has(BOB_AVATAR),true);
    assert.equal(await mediaAdapter.empty(),true);
    assert.equal(mediaDeletes,1);
    assert.equal(avatarDb.prepare('SELECT COUNT(*) AS n FROM avatar_pending WHERE uid=?')
      .get(BOB).n,1);
    assert.equal(avatarDb.prepare('SELECT COUNT(*) AS n FROM avatar_rate WHERE uid=?')
      .get(BOB).n,1);
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('firestore'));
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('media-d1-sqlite'));
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('fcm-stub'));
    // Simulate process restart: reload the case ledger from a fresh SQLite
    // connection and re-verify all completed phases without re-deleting Auth.
    journalDb.close();
    journalDb=new DatabaseSync(journalPath);
    chmodSync(journalPath,0o600);
    const persisted=createQaPersistentDeletionLedger({
      projectId:PROJECT,db:journalDb
    });
    backend.ledger=persisted;
    const restarted=createControlledQaDeletionExecutor({
      projectId:PROJECT,backend
    });
    assert.equal((await restarted.run({uid:ALICE,caseId:CASE})).completed,7);
    assert.equal((await persisted.status({uid:ALICE,caseId:CASE})).state,'complete');
    assert.equal(effects.filter(x=>x==='auth-sdk').length,1);
    // An unresolved in-flight ticket invalidates even a completed case.
    // Closing this QA ticket re-enables read-only reconciliation, not deletion.
    drainDb.prepare("INSERT INTO qa_privileged_inflight VALUES (?,?,'pending')")
      .run('qa-delayed-avatar-write',ALICE);
    assert.equal(await backend.freeze.verify({uid:ALICE,caseId:CASE}),true);
    assert.equal(await backend.freeze.drained({uid:ALICE,caseId:CASE}),false);
    // A previously completed freeze checkpoint is now invalid: the
    // executor correctly rejects the case before any external effect.
    await assert.rejects(restarted.run({uid:ALICE,caseId:CASE}),
      /controlled_deletion_denied:completed_phase_no_longer_valid/);
    assert.equal(await authExists(BOB),true);
    assert.equal(effects.filter(x=>x==='auth-sdk').length,1);
    drainDb.prepare('DELETE FROM qa_privileged_inflight WHERE operation_id=?')
      .run('qa-delayed-avatar-write');
    assert.equal((await restarted.run({uid:ALICE,caseId:CASE})).completed,7);
    assert.equal(effects.filter(x=>x==='auth-sdk').length,1);
    // Admin SDK bypasses Firestore Rules: prove that a participating writer
    // can observe the persisted freeze rather than resurrect the account.
    await assert.rejects(db.runTransaction(async tx=>{
      const marker=await tx.get(db.doc('account_deletion_freeze/'+ALICE));
      if(marker.exists)throw Error('qa_privileged_write_frozen');
      tx.set(db.doc('users/'+ALICE+'/pushDevices/late'),{token:'would-resurrect'});
    }),/qa_privileged_write_frozen/);
    assert.equal(await exists('users/'+ALICE+'/pushDevices/late'),false);
  });
}finally{
  // Node test() runs asynchronously after registration: cleanup belongs to
  // test.after(), not a surrounding synchronous finally block.
}

test('Auth Emulator lookup that creates a late foreign Firestore reference blocks final Auth deletion',async()=>{
  guard();
  if(process.env.FIREBASE_CONFIG||process.env.GOOGLE_APPLICATION_CREDENTIALS)
    throw Error('qa_emulator_only_no_credentials');
  // Dedicated users avoid touching the already completed E2E case.
  const owner='qa-delete-auth-readback',neighbor='qa-delete-auth-control';
  const caseId='fa00bbaa-4a09-4fd2-b399-001122334466';
  const profile='profiles/'+owner;
  const neighborProfile='profiles/'+neighbor;
  const lateRef='users/'+neighbor+'/notifications/late-auth-race';
  await auth.createUser({uid:owner,email:owner+'@example.invalid'});
  await auth.createUser({uid:neighbor,email:neighbor+'@example.invalid'});
  await set(profile,{uid:owner,body:'QA owned source'});
  await set(neighborProfile,{uid:neighbor,body:'QA neighbor preserved'});
  await set('account_deletion_requests/'+owner,{
    status:'requested',source:'android',
    requestedAt:new Date('2026-11-04T11:00:00Z')
  });
  const journal=[];
  let mediaRemoved=false,deviceRevoked=false,authRemovals=0,lateInjected=false;
  const check=x=>{
    guard();
    if(x?.uid!==owner||x?.caseId!==caseId)
      throw Error('qa_late_auth_case_mismatch');
  };
  const backend={
    approvals:{async confirm(x){check(x);return true;}},
    ledger:{
      async acquire(x){check(x);return {epoch:1,completed:[...journal]};},
      async check(x){check(x);return x.epoch===1;},
      async complete(x){
        check(x);
        if(x.epoch!==1||x.phase!==CONTROLLED_DELETION_PHASES[journal.length])
          return false;
        journal.push(x.phase);
        return true;
      }
    },
    freeze:{
      async enable(x){
        check(x);
        await set('account_deletion_freeze/'+owner,{
          uid:owner,caseId,state:'frozen',epoch:1
        });
      },
      async verify(x){
        check(x);
        const marker=await db.doc('account_deletion_freeze/'+owner).get();
        return marker.exists&&marker.data()?.uid===owner&&
          marker.data()?.caseId===caseId&&marker.data()?.state==='frozen';
      },
      async drained(x){check(x);return true;}
    },
    firestore:{
      async purge(x){check(x);await db.doc(profile).delete();},
      async assess(x){
        check(x);
        const [owned,foreign]=await Promise.all([
          db.doc(profile).get(),db.doc(lateRef).get()
        ]);
        return {allKnownScopesScanned:true,
          foreignReferencesResolved:true,
          retentionAdjudicated:true,
          remaining:Number(owned.exists)+Number(
            foreign.exists&&foreign.data()?.actorUid===owner
          ),unknownScopes:0};
      }
    },
    media:{
      async purge(x){check(x);mediaRemoved=true;},
      async empty(x){check(x);return mediaRemoved;}
    },
    fcm:{
      async revoke(x){check(x);deviceRevoked=true;},
      async empty(x){check(x);return deviceRevoked;}
    },
    auth:{
      async exists(x){
        check(x);
        const isPresent=await authExists(owner);
        if(isPresent&&!lateInjected){
          lateInjected=true;
          // Simulates an unsafe privileged writer bypassing Firestore Rules
          // while Firebase Admin SDK is performing an Auth presence read.
          await set(lateRef,{
            actorUid:owner,recipientUid:neighbor,origin:'QA race only'
          });
        }
        return isPresent;
      },
      async remove(x){
        check(x);
        authRemovals++;
        await auth.deleteUser(owner);
      }
    }
  };
  const executor=createControlledQaDeletionExecutor({
    projectId:PROJECT,backend
  });
  await assert.rejects(executor.run({uid:owner,caseId}),
    /controlled_deletion_denied:firestore_residual_or_unknown/);
  assert.equal(lateInjected,true);
  assert.equal(authRemovals,0,'Auth SDK deleteUser must NOT begin');
  assert.equal(await authExists(owner),true);
  assert.equal(await authExists(neighbor),true);
  assert.equal(await exists(neighborProfile),true);
  assert.equal(await exists(lateRef),true);
  assert.deepEqual(journal,CONTROLLED_DELETION_PHASES.slice(0,5));
  assert.equal(mediaRemoved,true);
  assert.equal(deviceRevoked,true);
  assert.equal(await exists('account_deletion_freeze/'+owner),true);
  // The genuine SDK mutation stopped before the irreversible Auth step.
  // This fixture does NOT claim global Firestore scope coverage, IAM or
  // authorization for production deletion.
});


test('real Auth Emulator deletion cannot be checkpointed if a reference appears during absent-user readback',async()=>{
  guard();
  if(process.env.FIREBASE_CONFIG||process.env.GOOGLE_APPLICATION_CREDENTIALS)
    throw Error('qa_post_auth_emulator_only_no_credentials');
  const owner='qa-delete-postauth-candidate',
    neighbor='qa-delete-postauth-neighbor',
    caseId='fa00bbaa-4a09-4fd2-b399-001122334477',
    owned='profiles/'+owner,
    neighborProfile='profiles/'+neighbor,
    late='users/'+neighbor+'/notifications/qa-postauth-race';
  await auth.createUser({uid:owner,email:owner+'@example.invalid'});
  await auth.createUser({uid:neighbor,email:neighbor+'@example.invalid'});
  await set(owned,{uid:owner,origin:'QA only'});
  await set(neighborProfile,{uid:neighbor,origin:'QA preserved'});
  await set('account_deletion_requests/'+owner,{
    status:'requested',source:'android',
    requestedAt:new Date('2026-11-04T12:00:00Z')
  });
  const journal=[],events=[];
  let clearedMedia=false,clearedFcm=false,injected=false,authDeletes=0;
  const check=x=>{
    guard();
    if(x?.uid!==owner||x?.caseId!==caseId)
      throw Error('qa_post_auth_case_mismatch');
  };
  const backend={
    approvals:{async confirm(x){check(x);return true;}},
    ledger:{
      async acquire(x){check(x);return {epoch:1,completed:[...journal]};},
      async check(x){check(x);return x.epoch===1;},
      async complete(x){
        check(x);
        if(x.epoch!==1||
           CONTROLLED_DELETION_PHASES[journal.length]!==x.phase)return false;
        journal.push(x.phase);
        return true;
      }
    },
    freeze:{
      async enable(x){
        check(x);
        await db.doc('account_deletion_freeze/'+owner).set({
          caseId,uid:owner,state:'frozen',epoch:1
        });
      },
      async verify(x){
        check(x);
        const marker=await db.doc('account_deletion_freeze/'+owner).get();
        return marker.exists && marker.data()?.uid===owner &&
          marker.data()?.caseId===caseId&&marker.data()?.state==='frozen';
      },
      async drained(x){check(x);return true;}
    },
    firestore:{
      async purge(x){check(x);await db.doc(owned).delete();},
      async assess(x){
        check(x);
        const [main,foreign]=await Promise.all([
          db.doc(owned).get(),db.doc(late).get()
        ]);
        return {allKnownScopesScanned:true,foreignReferencesResolved:true,
          retentionAdjudicated:true,
          remaining:Number(main.exists)+Number(
            foreign.exists&&foreign.data()?.actorUid===owner
          ),unknownScopes:0};
      }
    },
    media:{
      async purge(x){check(x);clearedMedia=true;events.push('media');},
      async empty(x){check(x);return clearedMedia;}
    },
    fcm:{
      async revoke(x){check(x);clearedFcm=true;events.push('fcm');},
      async empty(x){check(x);return clearedFcm;}
    },
    auth:{
      async remove(x){
        check(x);authDeletes++;
        events.push('auth');
        await auth.deleteUser(owner);
      },
      async exists(x){
        check(x);
        const present=await authExists(owner);
        if(present===false&&!injected){
          injected=true;
          // A privileged writer racing after remote Auth deletion would
          // resurrect a third-party reference. Never accept stale success.
          await set(late,{actorUid:owner,recipientUid:neighbor,
            origin:'QA injected after Auth deleted'});
        }
        return present;
      }
    }
  };
  const executor=createControlledQaDeletionExecutor({
    projectId:PROJECT,backend
  });
  await assert.rejects(executor.run({uid:owner,caseId}),
    /controlled_deletion_denied:firestore_residual_or_unknown/);
  assert.equal(injected,true);
  assert.equal(authDeletes,1,
    'genuine Firebase Auth Emulator delete happened once before the race');
  assert.equal(await authExists(owner),false);
  assert.equal(await authExists(neighbor),true);
  assert.equal(await exists(late),true);
  assert.equal(await exists(neighborProfile),true);
  assert.deepEqual(journal,CONTROLLED_DELETION_PHASES.slice(0,5),
    'no Auth checkpoint should be committed from stale readback');
  assert.deepEqual(events,['media','fcm','auth']);
  assert.equal(await exists('account_deletion_freeze/'+owner),true);
  // This deliberately stops in an INTERRUPTED state. Restart needs
  // independently reviewed recovery, not a blind second deleteUser call.
});

test.after(async()=>{
  drainDb?.close();
  avatarDb?.close();
  journalDb?.close();
  if(mediaServer)await new Promise(resolve=>mediaServer.close(resolve));
  if(journalDir)rmSync(journalDir,{recursive:true,force:true});
  await deleteApp(account);
});
