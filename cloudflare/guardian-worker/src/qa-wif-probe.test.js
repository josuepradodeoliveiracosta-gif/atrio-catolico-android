import {test} from 'node:test';
import assert from 'node:assert/strict';
import {validateQaWifContext,probeQaWifRead} from './qa-wif-probe.js';
const env={
 GITHUB_REPOSITORY:'josuepradodeoliveiracosta-gif/atrio-catolico-android',
 GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REF:'refs/heads/feature/guardiao-v2-motor-isolado-20261030',
 QA_FIREBASE_PROJECT_ID:'atrio-catolico-qa-v2',QA_APPROVED_PROJECT_ID:'atrio-catolico-qa-v2',
 QA_SERVICE_ACCOUNT:'guardian-qa-reader@atrio-catolico-qa-v2.iam.gserviceaccount.com',
 QA_WIF_PROVIDER:'projects/53068022813/locations/global/workloadIdentityPools/guardian-github-qa/providers/github-qa',
 GUARDIAN_V2_TEST_MODE:'true',GUARDIAN_V2_ENABLED:'false',GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false',GUARDIAN_V2_QA_SHADOW_READS:'false',
 QA_ACCESS_TOKEN:'this-is-a-fake-access-token-not-for-network'
};
const fixture='projects/atrio-catolico-qa-v2/databases/(default)/documents/posts/qa_post_1';
const res=(x,status=200,h={})=>new Response(typeof x==='string'?x:JSON.stringify(x),{status,headers:h});
const good={name:fixture,fields:{qaFixture:{booleanValue:true},body:{stringValue:'PRIVATE DO NOT LOG'}}};
test('nega branch, projeto, IAM, ambiente, execução e flags indevidas',()=>{
 assert.equal(validateQaWifContext(env),true);
 for(const patch of [
 {GITHUB_REPOSITORY:'not-trusted/repo'},{GITHUB_REF:'refs/heads/main'},{GITHUB_EVENT_NAME:'pull_request'},
 {QA_FIREBASE_PROJECT_ID:'atrio-catolico'},{QA_APPROVED_PROJECT_ID:'atrio-catolico'},
 {QA_SERVICE_ACCOUNT:'owner@atrio-catolico-qa-v2.iam.gserviceaccount.com'},
 {QA_WIF_PROVIDER:'projects/53068022813/locations/global/workloadIdentityPools/other/providers/github-qa'},
 {GUARDIAN_V2_TEST_MODE:'false'},{GUARDIAN_V2_ENABLED:'true'},{GUARDIAN_V2_HOLD_ENABLED:'true'},
 {GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true'},{GUARDIAN_V2_QA_SHADOW_READS:'true'},
 {GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'},{GOOGLE_APPLICATION_CREDENTIALS:'/tmp/key.json'}
 ])assert.throws(()=>validateQaWifContext({...env,...patch}),/qa_identity_probe_denied/);
});
test('nega antes de qualquer rede se não tem token ou contexto confiável',async()=>{
 let count=0;const get=async()=>{count++;return res(good)};
 await assert.rejects(probeQaWifRead({...env,QA_ACCESS_TOKEN:''},get),/qa_identity_probe_denied/);
 await assert.rejects(probeQaWifRead({...env,GITHUB_REF:'refs/heads/main'},get),/qa_identity_probe_denied/);
 assert.equal(count,0);
});
test('permite um único GET ao recurso sintético, sem expor conteúdo ou token',async()=>{
 let calls=0;const result=await probeQaWifRead(env,async(url,opts)=>{
 calls++;assert.equal(url,'https://firestore.googleapis.com/v1/'+fixture);
 assert.equal(opts.method,'GET');assert.equal(opts.redirect,'error');
 assert.equal(opts.headers.Authorization,'Bearer '+env.QA_ACCESS_TOKEN);return res(good);
 });
 assert.equal(calls,1);assert.deepEqual(result,{status:'qa_fixture_authenticated_read'});
 assert.ok(!JSON.stringify(result).includes('PRIVATE'));
 assert.ok(!JSON.stringify(result).includes(env.QA_ACCESS_TOKEN));
});
test('IAM negado, documento falso e JSON inválido recusados; 404 não prova sucesso',async()=>{
 assert.deepEqual(await probeQaWifRead(env,async()=>res('{}',404)),{status:'qa_fixture_missing'});
 for(const item of [res('{}',403),res('{}',401),res({...good,name:'projects/atrio-catolico/databases/(default)/documents/posts/qa_post_1'}),res({...good,fields:{qaFixture:{booleanValue:false}}}),res('not-json')])
  await assert.rejects(probeQaWifRead(env,async()=>item),/qa_identity_probe_denied/);
});
test('bloqueia payload acima de 8 KiB com e sem Content-Length',async()=>{
 const big='x'.repeat(9000);
 await assert.rejects(probeQaWifRead(env,async()=>res(big,200,{'content-length':'9000'})),/qa_identity_probe_denied/);
 await assert.rejects(probeQaWifRead(env,async()=>res(big)),/qa_identity_probe_denied/);
});
test('falha de transporte nunca devolve segredo',async()=>{
 await assert.rejects(probeQaWifRead(env,async()=>{throw Error(env.QA_ACCESS_TOKEN)}),/qa_identity_probe_denied/);
});
