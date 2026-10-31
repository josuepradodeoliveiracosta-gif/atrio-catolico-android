import {test} from 'node:test';
import assert from 'node:assert/strict';
import {runQaKeylessCycle} from './qa-keyless-cycle.js';

const project='atrio-catolico-qa-v2';
const path='projects/'+project+'/databases/(default)/documents/posts/qa_post_1';
const env={
 GITHUB_REPOSITORY:'josuepradodeoliveiracosta-gif/atrio-catolico-android',
 GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_REF:'refs/heads/feature/guardiao-v2-wif-prova-qa-20261030',
 QA_FIREBASE_PROJECT_ID:project, QA_APPROVED_PROJECT_ID:project,
 QA_SERVICE_ACCOUNT:'guardian-qa-reader@'+project+'.iam.gserviceaccount.com',
 QA_WIF_PROVIDER:'projects/53068022813/locations/global/workloadIdentityPools/guardian-github-qa/providers/github-qa',
 GUARDIAN_V2_TEST_MODE:'true', GUARDIAN_V2_ENABLED:'false',
 GUARDIAN_V2_HOLD_ENABLED:'false', GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'false',
 GUARDIAN_V2_QA_SHADOW_READS:'false',
 QA_ACCESS_TOKEN:'synthetic-qa-token-for-offline-test-only'
};
const response=(data,status=200,headers={})=>new Response(
 typeof data==='string'?data:JSON.stringify(data),{status,headers});
const fixture=body=>({name:path,fields:{qaFixture:{booleanValue:true},body:{stringValue:body}}});

test('manual QA only; refuses main, schedules, production, active moderation before network',async()=>{
 let calls=0;const mock=async()=>{calls++;return response(fixture('Oi'))};
 for(const patch of [
  {GITHUB_REF:'refs/heads/main'}, {GITHUB_EVENT_NAME:'schedule'},
  {GITHUB_REPOSITORY:'attacker/repo'}, {QA_FIREBASE_PROJECT_ID:'atrio-catolico'},
  {GUARDIAN_V2_ENABLED:'true'}, {GUARDIAN_V2_HOLD_ENABLED:'true'},
  {GUARDIAN_V2_QA_FIRESTORE_BRIDGE:'true'}, {GUARDIAN_V2_QA_AUTO_DISPATCH:'true'},
  {GUARDIAN_V2_PRODUCTION_APPROVED:'true'}, {GUARDIAN_V2_IDENTITY_APPROVED:'true'},
  {GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{}'}, {GOOGLE_APPLICATION_CREDENTIALS:'/tmp/service.json'},
  {QA_ACCESS_TOKEN:''}
 ]) await assert.rejects(runQaKeylessCycle({...env,...patch},mock), /denied/);
 assert.equal(calls,0);
});
test('one fixed GET classifies QA document; returns only counters, no user text/token',async()=>{
 let n=0;const text='Clique https://exemplo.invalid e informe sua senha';
 const out=await runQaKeylessCycle(env,async(url,opt)=>{
  n++;assert.equal(url,'https://firestore.googleapis.com/v1/'+path);
  assert.equal(opt.method,'GET');assert.equal(opt.redirect,'error');
  assert.equal(opt.headers.Authorization,'Bearer '+env.QA_ACCESS_TOKEN);
  return response(fixture(text));
 });
 assert.equal(n,1);
 assert.deepEqual(out,{status:'qa_keyless_cycle_readonly_pass',documents:1,possibleSignals:1});
 assert.ok(!JSON.stringify(out).includes(text));
 assert.ok(!JSON.stringify(out).includes(env.QA_ACCESS_TOKEN));
});
test('legitimate religious discussion yields no signal',async()=>{
 const out=await runQaKeylessCycle(env,async()=>response(fixture('Quero aprender sobre a Eucaristia')));
 assert.equal(out.possibleSignals,0);
});
test('401,403,404, invalid fixture, bad UTF8 and oversized responses fail closed',async()=>{
 const problems=[response('{}',401),response('{}',403),response('{}',404),
  response({...fixture('X'),name:'projects/atrio-catolico/databases/(default)/documents/posts/qa_post_1'}),
  response({name:path,fields:{qaFixture:{booleanValue:false},body:{stringValue:'X'}}}),
  response({name:path,fields:{qaFixture:{booleanValue:true}}}),
  response('not json'),new Response(new Uint8Array([0xff,0xfe])),
  response('x'.repeat(8193)),response('x'.repeat(8193),200,{'content-length':'8193'})];
 for(const p of problems)await assert.rejects(runQaKeylessCycle(env,async()=>p),/denied/);
});
test('network errors and invalid classifier do not expose credentials or contents',async()=>{
 await assert.rejects(runQaKeylessCycle(env,async()=>{throw Error(env.QA_ACCESS_TOKEN)}),/denied/);
 await assert.rejects(runQaKeylessCycle(env,async()=>response(fixture('hi')),()=>{throw Error('secret content')}),/denied/);
 await assert.rejects(runQaKeylessCycle(env,async()=>response(fixture('hi')),()=>({level:'ban'})),/denied/);
});
