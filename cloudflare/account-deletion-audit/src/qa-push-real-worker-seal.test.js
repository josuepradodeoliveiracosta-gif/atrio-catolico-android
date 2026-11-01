/**
 * Invoke the ACTUAL Push Worker exports, not a copied simulator. This suite
 * verifies a conservative QA-only whole-Worker seal. It does not prove that
 * per-UID deletion or a distributed freeze is deployed.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import worker, {
  handleBroadcast,handleGuardiaoEvent,handleGuardiaoReview,
  auditDelivery,guardiaoAiAssessment,enrichGuardiaoReport,
  holdGuardiaoContent,writeThreadNotices,cleanupInvalidDevice,
  reserveGuardiaoAdminPush
} from '../../push-worker/src/index.js';
import {
  qaPushPrivacySealed,QA_PUSH_PRIVACY_SEAL_READINESS
} from '../../push-worker/src/privacy-qa-write-fence.js';

function isolatedEnv(value='true'){
  const checks={credentials:0,d1:0,network:0};
  const env={
    ATRIO_PRIVACY_QA_WRITE_FENCE:value,
    PUSH_ENABLED:'true',
    BROADCAST_ENABLED:'true',
    GUARDIAO_ENABLED:'true',
    QA_MANUAL_ENABLED:'true',
    get FIREBASE_SERVICE_ACCOUNT_JSON(){
      checks.credentials++;throw Error('qa_worker_credential_access');
    },
    get FIREBASE_WEB_API_KEY(){
      checks.credentials++;throw Error('qa_worker_auth_access');
    },
    get PUSH_DB(){
      checks.d1++;throw Error('qa_worker_d1_access');
    }
  };
  return {env,checks};
}
async function isolated(action){
  const old=globalThis.fetch;
  const attempted=[];
  globalThis.fetch=async(...args)=>{
    attempted.push(args[0]);throw Error('qa_worker_outbound_network');
  };
  try{return await action(attempted);}
  finally{globalThis.fetch=old;}
}
const request=path=>new Request('https://qa-only.invalid'+path,{
  method:'POST',body:JSON.stringify({type:'reply',postId:'qa_post',replyId:'qa_reply'})
});
async function status(result,expected){
  assert.equal(result.status,expected);
  const body=await result.json();
  assert.equal(body.status,'privacy_qa_sealed');
}
test('actual Worker HTTP entrypoints refuse every mutation before any credentials, D1 or fetch',async()=>{
  const {env,checks}=isolatedEnv();
  await isolated(async outbound=>{
    for(const path of ['/event','/broadcast','/moderation/event',
      '/moderation/review','/unknown','/qa/hidden']){
      await status(await worker.fetch(request(path),env),503);
    }
    await status(await worker.fetch(
      new Request('https://qa-only.invalid/health'),env),200);
    assert.equal(outbound.length,0);
  });
  assert.deepEqual(checks,{credentials:0,d1:0,network:0});
});
test('direct exported moderation and broadcast handlers are also sealed',async()=>{
  const {env,checks}=isolatedEnv();
  await isolated(async outbound=>{
    await status(await handleBroadcast(request('/broadcast'),env),503);
    await status(await handleGuardiaoEvent(request('/moderation/event'),env),503);
    await status(await handleGuardiaoReview(request('/moderation/review'),env),503);
    assert.equal(outbound.length,0);
  });
  assert.deepEqual(checks,{credentials:0,d1:0,network:0});
});
test('real queue retries without ack, data parsing or OAuth; no ghost bot writes',async()=>{
  const {env,checks}=isolatedEnv();
  const called=[];
  const messages=[0,1].map(i=>({
    get body(){throw Error('qa_worker_queue_body_read');},
    ack(){called.push('ack'+i);},
    retry(arg){called.push({i,arg});}
  }));
  await isolated(async outbound=>{
    await worker.queue({messages},env);
    assert.equal(outbound.length,0);
  });
  assert.deepEqual(called,[
    {i:0,arg:{delaySeconds:60}},{i:1,arg:{delaySeconds:60}}
  ]);
  assert.deepEqual(checks,{credentials:0,d1:0,network:0});
});
test('direct helpers with env reject outbound, D1 and Firestore side effects',async()=>{
  const {env,checks}=isolatedEnv();
  const forbiddenDb={prepare(){throw Error('qa_d1_touched');}};
  await isolated(async outbound=>{
    assert.equal(await auditDelivery(env,'reply','accepted_by_fcm'),undefined);
    assert.equal(await guardiaoAiAssessment(env,'qa-report','qa-text'),
      'unavailable');
    assert.equal(await enrichGuardiaoReport(env,'qa-token','qa-report',{},'qa-text'),
      'unavailable');
    assert.equal(await holdGuardiaoContent(env,'qa-token','qa-report',{},{},{}),false);
    assert.equal(await reserveGuardiaoAdminPush(forbiddenDb,env),false);
    assert.equal(await cleanupInvalidDevice('qa-token',{},new Response('{}'),env),false);
    await assert.rejects(writeThreadNotices('qa-token',{},env),/privacy_qa_sealed/);
    assert.equal(outbound.length,0);
  });
  assert.deepEqual(checks,{credentials:0,d1:0,network:0});
});
test('a mis-spelt nonempty seal value never silently opens write access',async()=>{
  const {env}=isolatedEnv('misconfigured');
  assert.equal(qaPushPrivacySealed(env),true);
  await status(await worker.fetch(request('/event'),env),503);
});
test('the seal is disabled by default and has no per-user or production claims',async()=>{
  assert.equal(qaPushPrivacySealed({}),false);
  assert.equal(qaPushPrivacySealed({ATRIO_PRIVACY_QA_WRITE_FENCE:'false'}),false);
  assert.equal((await (await worker.fetch(
    new Request('https://qa-only.invalid/health'),{}
  )).json()).status,'disabled');
  assert.deepEqual(QA_PUSH_PRIVACY_SEAL_READINESS,{
    productionIntegrated:false,perAccountFreeze:false,
    sealsEntireWorker:true,distributedBarrier:false,
    backendCredentialsRequired:false
  });
});
