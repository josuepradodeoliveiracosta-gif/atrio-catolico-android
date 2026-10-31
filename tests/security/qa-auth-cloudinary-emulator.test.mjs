/**
 * E2E QA ONLY: real Firebase Auth + Firestore EMULATORS and a local Node HTTP
 * Cloudinary-like fake. Nothing is deployed; no Firebase Admin credentials,
 * cloud provider secrets, real tokens, URLs or user accounts are consulted.
 *
 * The Auth REST delete is a test user's self-delete, NOT an Admin SDK operation.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFileSync} from 'node:fs';
import {DatabaseSync} from 'node:sqlite';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {setDoc,doc,getDoc} from 'firebase/firestore';
import {QaAdministrativeDeletionExecutor,QA_ADMIN_ORDER_TEMPLATE}
  from './qa-admin-executor.mjs';
import {QaSqliteLease} from './qa-deletion-sqlite-lease.mjs';
import {QA_FIXTURES} from './qa-deletion-executor.mjs';
import {createQaAvatarD1PreAuthAdapter}
  from './admin-fixture/qa-avatar-d1-pre-auth.mjs';
import {createQaRetentionEvidenceAdapter}
  from './admin-fixture/qa-retention-evidence.mjs';
import {createQaAuthEmulatorAdapter,createQaCloudinaryHttpAdapter,
  QA_EXTERNAL_UID,QA_EXTERNAL_BOB,QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO,
  QA_EXTERNAL_ORPHAN_PHOTO,QA_EXTERNAL_MEDIA_PATH,QA_EXTERNAL_MEDIA_INVENTORY_PATH} from './qa-external-emulators.mjs';

const PROJECT='demo-atrio-v11',HOST='127.0.0.1:8089',AUTH='127.0.0.1:9099';
if(process.env.GCLOUD_PROJECT!==PROJECT ||
   process.env.FIRESTORE_EMULATOR_HOST!==HOST ||
   process.env.FIREBASE_AUTH_EMULATOR_HOST!==AUTH ||
   process.env.GOOGLE_APPLICATION_CREDENTIALS ||
   process.env.FIREBASE_SERVICE_ACCOUNT_JSON ||
   process.env.CLOUDINARY_API_SECRET ||
   process.env.CLOUDINARY_API_KEY ||
   process.env.CLOUDINARY_CLOUD_NAME)
  throw Error('qa_e2e_requires_local_disposable_auth_and_firestore_emulators');

const state={
  media:new Set([QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO]),
  failNextDestroy:false,
  failNextInventory:false,
  foreignDeletionAttempts:0,
  routes:[]
};
const respond=(res,status,body)=>{
  res.writeHead(status,{'Content-Type':'application/json',
    'Cache-Control':'no-store'});
  res.end(JSON.stringify(body));
};
const server=createServer(async(req,res)=>{
  const u=new URL(req.url,'http://127.0.0.1');
  state.routes.push(req.method+' '+u.pathname);
  if(req.method==='GET' && u.pathname.startsWith('/qa-assets/')){
    const id=decodeURIComponent(u.pathname.slice('/qa-assets/'.length));
    if(![QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO].includes(id))
      return respond(res,404,{error:'unlisted_fixture'});
    return respond(res,200,{public_id:id,exists:state.media.has(id)});
  }
  if(req.method==='GET' && u.pathname===QA_EXTERNAL_MEDIA_INVENTORY_PATH){
    if(state.failNextInventory){
      state.failNextInventory=false;
      return respond(res,503,{error:'qa_inventory_unavailable'});
    }
    if(u.searchParams.get('uid')!==QA_EXTERNAL_UID ||
       !['upload','authenticated'].includes(u.searchParams.get('type')) ||
       u.searchParams.get('limit')!=='100' ||u.searchParams.has('cursor'))
      return respond(res,403,{error:'qa_inventory_invalid_scope'});
    const type=u.searchParams.get('type');
    const assets=[...state.media].filter(id=>id.startsWith(
      'atrio-avatares/'+QA_EXTERNAL_UID+'/') &&
      (id===QA_EXTERNAL_ORPHAN_PHOTO?'upload':'authenticated')===type);
    return respond(res,200,{items:assets.map(public_id=>({type,public_id})),
      nextCursor:null});
  }
  if(req.method==='POST' && u.pathname===QA_EXTERNAL_MEDIA_PATH){
    let raw='';
    for await(const chunk of req){raw+=chunk;if(raw.length>1500)break;}
    let body;
    try{body=JSON.parse(raw);}catch{return respond(res,400,{error:'invalid'});}
    if(body?.fixtureUid!==QA_EXTERNAL_UID ||
       body?.public_id!==QA_EXTERNAL_PHOTO || body.invalidate!==true){
      state.foreignDeletionAttempts++;
      return respond(res,403,{error:'foreign_fixture_denied'});
    }
    if(state.failNextDestroy){
      state.failNextDestroy=false;
      return respond(res,503,{error:'injected_cloudinary_outage'});
    }
    const existed=state.media.delete(body.public_id);
    return respond(res,200,{public_id:body.public_id,
      result:existed?'deleted':'not_found'});
  }
  return respond(res,404,{error:'qa_route_not_found'});
});
const listen=()=>new Promise((resolve,reject)=>{
  server.once('error',reject);
  server.listen(0,'127.0.0.1',()=>{
    server.off('error',reject);
    resolve('http://127.0.0.1:'+server.address().port+'/');
  });
});
const close=()=>new Promise(resolve=>server.close(resolve));
const env=await initializeTestEnvironment({projectId:PROJECT,firestore:{
  host:'127.0.0.1',port:8089,
  rules:readFileSync('firestore.rules','utf8')
}});
const auth=createQaAuthEmulatorAdapter(); // shared fixture mapping for this process

try {
  await test('Auth Emulator and isolated Cloudinary HTTP: outage, retry, Auth LAST',
    async()=>{
      const base=await listen();
      try {
        await auth.seed(QA_EXTERNAL_UID);
        await auth.seed(QA_EXTERNAL_BOB);
        assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
        assert.equal(await auth.exists(QA_EXTERNAL_BOB),true);
        const media=createQaCloudinaryHttpAdapter(base);
        assert.equal(await media.exists(),true);
        await env.clearFirestore();
        await env.withSecurityRulesDisabled(async ctx=>{
          const db=ctx.firestore();
          for(const path of [...QA_FIXTURES.nested,...QA_FIXTURES.relational,
            ...QA_FIXTURES.roots,...QA_FIXTURES.preserved]){
            await setDoc(doc(db,path),{uid:path.includes('qa-delete-bob')
              ? QA_EXTERNAL_BOB:QA_EXTERNAL_UID,origin:'fixture'});
          }
          await setDoc(doc(db,'account_deletion_requests/'+QA_EXTERNAL_UID),{
            status:'requested',source:'android',
            requestedAt:new Date('2026-10-31T12:00:00Z')
          });
          const journal=new DatabaseSync(':memory:');
          const stubMedia=new Set([QA_EXTERNAL_PHOTO,QA_EXTERNAL_BOB_PHOTO]);
          const stubAuth=new Set([QA_EXTERNAL_UID,QA_EXTERNAL_BOB]);
          const d1Sqlite=new DatabaseSync(':memory:');
          d1Sqlite.exec(readFileSync(
            new URL('../../cloudflare/avatar-worker/schema.sql',import.meta.url),'utf8'));
          // Bob's unrelated data remains untouched throughout the run.
          d1Sqlite.prepare('INSERT INTO avatar_rate(uid,next_at) VALUES (?,?)')
            .run(QA_EXTERNAL_BOB,100);
          const d1=createQaAvatarD1PreAuthAdapter(d1Sqlite);
          const retention=createQaRetentionEvidenceAdapter(d1Sqlite,{
            now:()=>Date.parse('2026-10-31T15:00:00.000Z')
          });
          const review=()=>retention.review({
            uid:QA_EXTERNAL_UID,
            requestAt:'2026-10-31T12:00:00.000Z',decision:'clear',
            approvals:['qa-privacy-reviewer','qa-security-reviewer'],
            reviewedAt:'2026-10-31T14:00:00.000Z',
            expiresAt:'2026-10-31T20:00:00.000Z'
          });
          const external={auth,media,d1,retention};
          try{
            const missing=new QaAdministrativeDeletionExecutor({
              db,journal,media:stubMedia,auth:stubAuth,external,
              lease:new QaSqliteLease(journal)
            });
            await assert.rejects(missing.execute({
              order:QA_ADMIN_ORDER_TEMPLATE
            }),/qa_retention_review_missing/);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            review();
            state.failNextDestroy=true;
            const first=new QaAdministrativeDeletionExecutor({
              db,journal,media:stubMedia,auth:stubAuth,external,
              lease:new QaSqliteLease(journal)
            });
            await assert.rejects(first.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_external_media_http_failure/);
            // External outage interrupts BEFORE the Auth effect, not after.
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            assert.equal(await auth.exists(QA_EXTERNAL_BOB),true);
            assert.equal(state.media.has(QA_EXTERNAL_PHOTO),true);
            assert.equal(state.media.has(QA_EXTERNAL_BOB_PHOTO),true);
            assert.equal(stubAuth.has(QA_EXTERNAL_UID),true);
            assert.equal(first.executor.completed().includes('remove_auth_stub_last'),false);
            const restarted=new QaAdministrativeDeletionExecutor({
              db,journal,media:stubMedia,auth:stubAuth,external,
              lease:new QaSqliteLease(journal)
            });
            // A newly discovered orphan is NOT part of the known-ID delete.
            // Its presence must block Auth even though photo1 is gone.
            state.media.add(QA_EXTERNAL_ORPHAN_PHOTO);
            await assert.rejects(
              restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_external_owned_media_remaining/);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            assert.equal(stubAuth.has(QA_EXTERNAL_UID),true);
            assert.equal(state.media.has(QA_EXTERNAL_BOB_PHOTO),true);
            state.media.delete(QA_EXTERNAL_ORPHAN_PHOTO);
            state.failNextInventory=true;
            await assert.rejects(
              restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_external_media_inventory_http_failure/);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            // The known media is absent; an unreviewed D1 row is still a
            // blocker before the FIRST Auth deletion attempt.
            d1Sqlite.prepare('INSERT INTO avatar_pending(uid,public_id,created_at) VALUES (?,?,?)')
              .run(QA_EXTERNAL_UID,QA_EXTERNAL_ORPHAN_PHOTO,1);
            await assert.rejects(
              restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_avatar_d1_owned_rows_remaining/);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            d1Sqlite.prepare('DELETE FROM avatar_pending WHERE uid=?')
              .run(QA_EXTERNAL_UID);
            retention.hold(QA_EXTERNAL_UID,'qa-case-new-hold');
            await assert.rejects(restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_retention_review_stale/);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),true);
            retention.resolve(QA_EXTERNAL_UID,'qa-case-new-hold');
            await assert.rejects(restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE}),
              /qa_retention_review_stale/);
            review();
            const result=await restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE});
            assert.equal(result.status,'qa_fixture_admin_workflow_finished');
            assert.equal(result.authEmulatorFixtureExercised,true);
            assert.equal(result.cloudinaryHttpFixtureExercised,true);
            assert.equal(result.productionReady,false);
            assert.equal(result.firebaseAuthActuallyDeleted,false);
            assert.equal(result.cloudinaryActuallyDeleted,false);
            assert.equal(await auth.exists(QA_EXTERNAL_UID),false);
            assert.equal(await auth.exists(QA_EXTERNAL_BOB),true);
            assert.equal(state.media.has(QA_EXTERNAL_PHOTO),false);
            assert.equal(state.media.has(QA_EXTERNAL_BOB_PHOTO),true);
            assert.equal(d1Sqlite.prepare('SELECT uid FROM avatar_rate WHERE uid=?')
              .get(QA_EXTERNAL_BOB).uid,QA_EXTERNAL_BOB);
            assert.equal(state.foreignDeletionAttempts,0);
            for(const path of QA_FIXTURES.preserved)
              assert.equal((await getDoc(doc(db,path))).exists(),true,path);
            const again=await restarted.execute({order:QA_ADMIN_ORDER_TEMPLATE});
            assert.equal(again.completedPhases,8);
            assert.equal(await auth.exists(QA_EXTERNAL_BOB),true);
            assert.equal(state.media.has(QA_EXTERNAL_BOB_PHOTO),true);
            assert.ok(state.routes.some(x=>x.startsWith('POST '+QA_EXTERNAL_MEDIA_PATH)));
          }finally{journal.close();d1Sqlite.close();}
        });
      }finally{await close();}
    });

  await test('external adapters reject real endpoints and foreign fixture deletion',
    async()=>{
      assert.throws(()=>createQaCloudinaryHttpAdapter(
        'https://api.cloudinary.com/'),/qa_external_nonlocal_media_endpoint/);
      assert.throws(()=>createQaCloudinaryHttpAdapter(
        'http://127.0.0.1:9099/'),/qa_external_reserved_emulator_port/);
      await assert.rejects(auth.remove(QA_EXTERNAL_BOB),
        /qa_external_auth_other_user_delete_denied/);
      assert.equal(await auth.exists(QA_EXTERNAL_BOB),true);
    });
} finally {
  await env.cleanup();
}
