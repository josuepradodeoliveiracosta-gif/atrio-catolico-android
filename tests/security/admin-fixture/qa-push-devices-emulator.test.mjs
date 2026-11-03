/**
 * End-to-end QA using the REAL Firebase Admin SDK against the disposable
 * Firestore Emulator. Never loads a service-account key or a live project.
 * No FCM send/revoke call. All tokens are synthetic and never printed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore} from 'firebase-admin/firestore';
import {initializeTestEnvironment,assertFails}
  from '@firebase/rules-unit-testing';
import {doc,setDoc,serverTimestamp} from 'firebase/firestore';
import {
  reconcileQaPushDeviceDocsEmulator,QA_PUSH_DEVICE_UIDS,
  QA_PUSH_DEVICE_CASE
} from './qa-push-devices-emulator.mjs';

const PROJECT='demo-atrio-v11';
const A=QA_PUSH_DEVICE_UIDS.alice,B=QA_PUSH_DEVICE_UIDS.bob;
if(process.env.GCLOUD_PROJECT!==PROJECT||
   process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
   process.env.FIREBASE_CONFIG||
   process.env.GOOGLE_APPLICATION_CREDENTIALS||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
   process.env.GOOGLE_CLOUD_PROJECT||
   process.env.CLOUDINARY_API_SECRET||
   process.env.CLOUDINARY_API_KEY||
   process.env.CLOUDINARY_CLOUD_NAME||
   process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
  throw Error('qa_push_emulator_only');

const app=initializeApp({projectId:PROJECT},'qa-push-devices-real-sdk-only');
const db=getFirestore(app);
let rulesEnv;
test.after(async()=>{
  await rulesEnv?.cleanup();
  await deleteApp(app);
});

test('Firestore Admin SDK removes all QA device documents after freeze, with version CAS',async()=>{
  rulesEnv=await initializeTestEnvironment({
    projectId:PROJECT,
    firestore:{host:'127.0.0.1',port:8089,
      rules:readFileSync('firestore.rules','utf8')}
  });
  // Do not clear all Firestore or affect other suites sharing this emulator.
  await db.doc('users/'+A).set({displayName:'QA synthetic owner'});
  await db.doc('users/'+B).set({displayName:'QA synthetic control'});
  await db.doc('account_deletion_requests/'+A).set({
    status:'requested',source:'android'
  });
  const fixtureCount=27;
  for(let i=0;i<fixtureCount;i++){
    const id='qa-device-'+String(i).padStart(3,'0');
    await db.doc('users/'+A+'/pushDevices/'+id).set({
      token:i===0?'':i===1?'stale':i===2?null:
        'qa-synthetic-not-a-fcm-token-'+i,
      updatedAt:i%2===0?new Date('2020-01-01T00:00:00Z'):
        new Date('2026-11-03T10:00:00Z'),
      oldClient:i%3===0
    });
  }
  for(const name of ['qa-device-control-1','qa-device-control-2'])
    await db.doc('users/'+B+'/pushDevices/'+name).set({
      token:'qa-fake-neighbor-device',updatedAt:new Date('2026-11-03')
    });

  await assert.rejects(
    reconcileQaPushDeviceDocsEmulator({db,uid:A,caseId:QA_PUSH_DEVICE_CASE}),
    /qa_push_admin_freeze_or_request_missing/
  );
  assert.equal((await db.collection('users/'+A+'/pushDevices').get()).size,fixtureCount);
  await db.doc('account_deletion_freeze/'+A).create({
    uid:A,caseId:QA_PUSH_DEVICE_CASE,state:'frozen',epoch:1
  });
  // A new ordinary client registration after freeze is forbidden by the
  // existing Firestore security rules, independently of Admin SDK cleanup.
  const owner=rulesEnv.authenticatedContext(A);
  await assertFails(setDoc(doc(owner.firestore(),
    'users/'+A+'/pushDevices/qa-device-client-late'),{
      token:'qa-synthetic-client-token-long-enough',
      updatedAt:serverTimestamp()
    }));

  await assert.rejects(
    reconcileQaPushDeviceDocsEmulator({
      db,uid:B,caseId:QA_PUSH_DEVICE_CASE
    }),/qa_push_admin_unapproved_account_case/
  );
  await assert.rejects(
    reconcileQaPushDeviceDocsEmulator({
      db,uid:A,caseId:'fa00bbaa-4a09-4fd2-b399-001122334466'
    }),/qa_push_admin_unapproved_account_case/
  );

  // Re-register a newer version between inventory and batch. Firestore
  // lastUpdateTime preconditions MUST reject the whole batch; no partial wipe.
  await assert.rejects(reconcileQaPushDeviceDocsEmulator({
    db,uid:A,caseId:QA_PUSH_DEVICE_CASE,
    beforeCommitForQa:async()=>{
      await db.doc('users/'+A+'/pushDevices/qa-device-003').update({
        token:'qa-updated-token-after-inventory'
      });
    }
  }));
  assert.equal((await db.collection('users/'+A+'/pushDevices').get()).size,fixtureCount);
  assert.equal((await db.collection('users/'+B+'/pushDevices').get()).size,2);

  const result=await reconcileQaPushDeviceDocsEmulator({
    db,uid:A,caseId:QA_PUSH_DEVICE_CASE
  });
  assert.equal(result.status,'qa_emulator_device_documents_removed');
  assert.equal(result.syntheticOwnedDocsDeleted,fixtureCount);
  assert.equal(result.staleAndInvalidTokenDocsIncluded,true);
  assert.equal(result.independentReadbacks,2);
  assert.equal(result.neighborPreserved,true);
  assert.equal(result.realFcmTokenRevocationVerified,false);
  assert.equal(result.legacyTopicSubscriptionsVerified,false);
  assert.equal(result.productionWorkerFenceVerified,false);
  assert.equal(result.playReleaseAuthorized,false);
  assert.equal((await db.collection('users/'+A+'/pushDevices').get()).size,0);
  assert.equal((await db.collection('users/'+B+'/pushDevices').get()).size,2);
  assert.equal((await db.doc('account_deletion_freeze/'+A).get()).exists,true);
  assert.equal((await db.doc('users/'+B).get()).exists,true);
});
