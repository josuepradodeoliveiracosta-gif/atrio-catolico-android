/**
 * QA INTEGRATION — real Firebase Admin SDK calls against local Auth and
 * Firestore emulators; Cloudinary, D1 and FCM remain in-memory doubles.
 * No production endpoint, secret or project is supported. This is NOT
 * homologation of live users, legal retention or deployed Worker fencing.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getAuth} from 'firebase-admin/auth';
import {getFirestore} from 'firebase-admin/firestore';
import {
  createControlledQaDeletionExecutor,CONTROLLED_DELETION_PHASES
} from '../../../cloudflare/account-deletion-processor/src/controlled-executor.js';

const PROJECT='demo-atrio-v11';
const ALICE='qa-delete-candidate',BOB='qa-delete-neighbor';
const CASE='fa00bbaa-4a09-4fd2-b399-001122334455';
function guard(){
  if(process.env.GCLOUD_PROJECT!==PROJECT ||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
     process.env.GOOGLE_APPLICATION_CREDENTIALS ||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
     process.env.GOOGLE_CLOUD_PROJECT ||
     process.env.CLOUDINARY_API_SECRET ||
     process.env.CLOUDINARY_API_KEY ||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    throw Error('controlled_e2e_production_environment_denied');
}
guard();
const account=initializeApp({projectId:PROJECT},'controlled-e2e-only');
const auth=getAuth(account),db=getFirestore(account);
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

    const ledger=[],effects=[],media=new Set(['cloudinary-alice','d1-alice']);
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
        async acquire(x){ctxCheck(x);return {epoch:1,completed:[...ledger]};},
        async check(x){ctxCheck(x);return x.epoch===1;},
        async complete(x){
          ctxCheck(x);
          if(x.phase!==CONTROLLED_DELETION_PHASES[ledger.length])return false;
          ledger.push(x.phase);return true;
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
        async purge(x){ctxCheck(x);media.clear();effects.push('media-stub');},
        async empty(x){ctxCheck(x);return media.size===0;}
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
          assert.equal(media.size,0);assert.equal(fcm.size,0);
          effects.push('auth-sdk');
          await auth.deleteUser(ALICE);
        },
        async exists(x){ctxCheck(x);return authExists(ALICE);}
      }
    };
    const executor=createControlledQaDeletionExecutor({
      projectId:PROJECT,backend
    });
    const result=await executor.run({uid:ALICE,caseId:CASE});
    assert.equal(result.state,'isolated_qa_deletion_reconciled');
    assert.deepEqual(ledger,CONTROLLED_DELETION_PHASES);
    assert.equal(await authExists(ALICE),false);
    assert.equal(await authExists(BOB),true);
    assert.deepEqual(await readAll(aliceOwned),aliceOwned.map(()=>false));
    assert.deepEqual(await readAll(bobUntouched),bobUntouched.map(()=>true));
    assert.equal(await exists('account_deletion_freeze/'+ALICE),true);
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('firestore'));
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('media-stub'));
    assert.ok(effects.indexOf('auth-sdk')>effects.indexOf('fcm-stub'));
    assert.equal((await executor.run({uid:ALICE,caseId:CASE})).completed,7);
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
test.after(async()=>{await deleteApp(account);});
