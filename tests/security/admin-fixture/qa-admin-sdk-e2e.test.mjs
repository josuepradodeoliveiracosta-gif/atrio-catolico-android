/**
 * QA integration: Firebase Admin SDK + Auth Emulator, Firestore Emulator,
 * Cloudinary-like HTTP localhost, SQLite lease and the existing deletion
 * phases. ONE exact UID is shared between Auth and Firestore.
 *
 * NEVER run with Google credentials, live Firebase or Cloudinary.
 * The second fixture account and all its records MUST survive.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc} from 'firebase/firestore';
import {QaAdministrativeDeletionExecutor,QA_ADMIN_ORDER_TEMPLATE}
  from '../qa-admin-executor.mjs';
import {QaSqliteLease} from '../qa-deletion-sqlite-lease.mjs';
import {QA_FIXTURES,QA_STEPS} from '../qa-deletion-executor.mjs';
import {createQaCloudinaryHttpAdapter,QA_EXTERNAL_PHOTO,
  QA_EXTERNAL_BOB_PHOTO,QA_EXTERNAL_MEDIA_PATH}
  from '../qa-external-emulators.mjs';
import {createQaAdminSdkAuthAdapter,QA_ADMIN_SDK_UIDS}
  from './qa-admin-sdk-auth.mjs';

const A=QA_ADMIN_SDK_UIDS.alice,B=QA_ADMIN_SDK_UIDS.bob;
const PROJECT='demo-atrio-v11';
if(process.env.GCLOUD_PROJECT!==PROJECT ||
   process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089' ||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099' ||
   process.env.GOOGLE_APPLICATION_CREDENTIALS ||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
   process.env.CLOUDINARY_API_SECRET ||
   process.env.CLOUDINARY_API_KEY ||
   process.env.CLOUDINARY_CLOUD_NAME)
  throw Error('qa_same_uid_nonlocal_environment_denied');

const environment=await initializeTestEnvironment({
  projectId:PROJECT,firestore:{host:'127.0.0.1',port:8089,
    rules:readFileSync('firestore.rules','utf8')}
});
const mediaState=new Set([QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO]);
let failNextHttp=false;
let forbiddenMediaCalls=0;
const send=(res,status,data)=>{
  res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});
  res.end(JSON.stringify(data));
};
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  if(req.method==='GET'&&u.pathname.startsWith('/qa-assets/')){
    const id=decodeURIComponent(u.pathname.slice('/qa-assets/'.length));
    if(![QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO].includes(id))
      return send(res,404,{error:'qa_unlisted_asset'});
    return send(res,200,{public_id:id,exists:mediaState.has(id)});
  }
  if(req.method==='POST'&&u.pathname===QA_EXTERNAL_MEDIA_PATH){
    let raw='';
    for await(const part of req){
      raw+=part;
      if(raw.length>1500)return send(res,413,{error:'qa_payload_large'});
    }
    let data;
    try{data=JSON.parse(raw);}catch{return send(res,400,{error:'qa_bad_json'});}
    if(data?.fixtureUid!==A || data?.public_id!==QA_EXTERNAL_PHOTO ||
       data.invalidate!==true){
      forbiddenMediaCalls++;
      return send(res,403,{error:'qa_not_owner'});
    }
    if(failNextHttp){
      failNextHttp=false;
      return send(res,503,{error:'qa_transient_failure'});
    }
    const existed=mediaState.delete(QA_EXTERNAL_PHOTO);
    return send(res,200,{public_id:QA_EXTERNAL_PHOTO,
      result:existed?'deleted':'not_found'});
  }
  return send(res,404,{error:'qa_unexpected_route'});
});
async function listen(){
  return new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(0,'127.0.0.1',()=>{
      server.off('error',reject);
      resolve('http://127.0.0.1:'+server.address().port+'/');
    });
  });
}

let admin,secondAdmin,journal;
try {
  await test('Admin SDK SAME UID: remote outage, after-delete crash, new adapter retry',
    async()=>{
      const address=await listen();
      const media=createQaCloudinaryHttpAdapter(address);
      admin=createQaAdminSdkAuthAdapter();
      const alice=await admin.seed(A);
      const bob=await admin.seed(B);
      assert.equal(alice.uid,A);
      assert.equal(bob.uid,B);
      assert.equal(await admin.exists(A),true);
      assert.equal(await admin.exists(B),true);
      await assert.rejects(admin.remove(B),
        /qa_admin_sdk_other_user_delete_forbidden/);
      await environment.clearFirestore();
      await environment.withSecurityRulesDisabled(async context=>{
        const db=context.firestore();
        for(const path of [...QA_FIXTURES.nested,...QA_FIXTURES.relational,
          ...QA_FIXTURES.roots,...QA_FIXTURES.preserved]){
          await setDoc(doc(db,path),{
            uid:path.includes('qa-delete-bob')?B:A,origin:'qa-admin-sdk'
          });
        }
        await setDoc(doc(db,'account_deletion_requests/'+A),{
          status:'requested',source:'android',
          requestedAt:new Date('2026-10-31T12:00:00Z')
        });
        const profile=await getDoc(doc(db,'profiles/'+A));
        const owner=await getDoc(doc(db,'users/'+A));
        const bobProfile=await getDoc(doc(db,'profiles/'+B));
        assert.equal(profile.exists(),true);
        assert.equal(owner.exists(),true);
        assert.equal(bobProfile.exists(),true);
        assert.equal(profile.id,alice.uid); // EXACT SAME Auth + Firestore UID
        assert.equal(owner.id,alice.uid);
        assert.equal(bobProfile.id,bob.uid);

        journal=new DatabaseSync(':memory:');
        const fakeAuth=new Set([A,B]);
        const fakeMedia=new Set([QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO]);
        let failAuthOnce=true;
        const remoteAuth={
          exists:uid=>admin.exists(uid),
          remove:async uid=>{
            if(failAuthOnce){
              failAuthOnce=false;
              throw Error('qa_injected_admin_auth_unavailable');
            }
            return admin.remove(uid);
          }
        };
        const external={auth:remoteAuth,media};
        const openRunner=()=>new QaAdministrativeDeletionExecutor({
          db,journal,auth:fakeAuth,media:fakeMedia,external,
          lease:new QaSqliteLease(journal)
        });

        failNextHttp=true;
        await assert.rejects(openRunner().execute({
          order:QA_ADMIN_ORDER_TEMPLATE
        }),/qa_external_media_http_failure/);
        assert.equal(await admin.exists(A),true);
        assert.equal(mediaState.has(QA_EXTERNAL_PHOTO),true);
        assert.equal(fakeAuth.has(A),true);

        await assert.rejects(openRunner().execute({
          order:QA_ADMIN_ORDER_TEMPLATE
        }),/qa_injected_admin_auth_unavailable/);
        assert.equal(await admin.exists(A),true);
        assert.equal(await admin.exists(B),true);
        assert.equal(mediaState.has(QA_EXTERNAL_PHOTO),false);
        assert.equal(mediaState.has(QA_EXTERNAL_BOB_PHOTO),true);
        assert.equal(fakeAuth.has(A),true);

        // Effect happens on Auth Emulator; crash before SQLite checkpoint.
        await assert.rejects(openRunner().execute({
          order:QA_ADMIN_ORDER_TEMPLATE,
          failAfterEffect:'remove_auth_stub_last'
        }),/injected_failure_after_effect:remove_auth_stub_last/);
        assert.equal(await admin.exists(A),false);
        assert.equal(await admin.exists(B),true);
        assert.equal(fakeAuth.has(A),false);
        assert.equal(new QaSqliteLease(journal).isBoundTo(journal),true);

        // New Admin SDK app has NO user mapping; exact UID allows restart.
        await admin.close();
        admin=null;
        secondAdmin=createQaAdminSdkAuthAdapter();
        const restartedExternal={auth:secondAdmin,media};
        const resumed=new QaAdministrativeDeletionExecutor({
          db,journal,media:fakeMedia,auth:fakeAuth,external:restartedExternal,
          lease:new QaSqliteLease(journal)
        });
        const result=await resumed.execute({order:QA_ADMIN_ORDER_TEMPLATE});
        assert.equal(result.status,'qa_fixture_admin_workflow_finished');
        assert.equal(result.completedPhases,QA_STEPS.length);
        assert.equal(result.productionReady,false);
        assert.equal(result.firebaseAuthActuallyDeleted,false);
        assert.equal(result.reviewerIdentityReal,false);
        assert.equal(await secondAdmin.exists(A),false);
        assert.equal(await secondAdmin.exists(B),true);
        assert.equal(mediaState.has(QA_EXTERNAL_BOB_PHOTO),true);
        assert.equal(forbiddenMediaCalls,0);
        for(const path of QA_FIXTURES.preserved){
          const item=await getDoc(doc(db,path));
          assert.equal(item.exists(),true,path);
        }
        assert.equal((await getDoc(doc(db,'profiles/'+A))).exists(),false);
        assert.equal((await getDoc(doc(db,'users/'+A))).exists(),false);
        assert.equal((await getDoc(doc(db,'profiles/'+B))).exists(),true);
        const repeat=await resumed.execute({order:QA_ADMIN_ORDER_TEMPLATE});
        assert.equal(repeat.completedPhases,QA_STEPS.length);
        assert.equal(await secondAdmin.exists(B),true);
      });
    });

  await test('Admin SDK fails closed with unsafe environment and unauthorized UID',
    async()=>{
      if(!secondAdmin)throw Error('qa_admin_sdk_previous_test_required');
      await assert.rejects(secondAdmin.exists('real-member-uid'),
        /qa_admin_sdk_unrecognized_uid/);
      const before=process.env.FIREBASE_AUTH_EMULATOR_HOST;
      try{
        process.env.FIREBASE_AUTH_EMULATOR_HOST='identitytoolkit.googleapis.com:443';
        await assert.rejects(secondAdmin.exists(B),
          /qa_admin_sdk_live_environment_forbidden/);
      }finally{process.env.FIREBASE_AUTH_EMULATOR_HOST=before;}
      assert.equal(await secondAdmin.exists(B),true);
    });
} finally {
  await admin?.close();
  await secondAdmin?.close();
  if(journal)journal.close();
  if(server.listening)await new Promise(resolve=>server.close(resolve));
  await environment.cleanup();
}
