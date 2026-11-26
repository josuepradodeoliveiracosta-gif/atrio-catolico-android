import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreeInvocationMeter,FREE_DAILY_ENVELOPE,FREE_TRANSPORT_LIMITS} from '../../cloudflare/push-worker/scripts/qa-automatic-free-meter-lab.mjs';
const root='https://firestore.googleapis.com/v1/projects/atrio-catolico-qa-general/databases/(default)/documents';
test('charges batch and list maxima before dispatch, including missing docs',()=>{
 const m=createFreeInvocationMeter();
 m.beforeHttp('claim',root+':batchGet',{method:'POST',body:{documents:['projects/atrio-catolico-qa-general/databases/(default)/documents/a/b']}});
 m.beforeHttp('worker',root+'/users/alice/pushDevices?pageSize=6');
 assert.equal(m.snapshot().claim.reads,1);
 assert.equal(m.snapshot().worker.reads,6);
 assert.equal(m.snapshot().worker.requests,1);
});
test('rejects unknown origin, unbounded query, pagination and wrong project',()=>{
 const m=createFreeInvocationMeter();
 for(const [u,i] of [['https://other.invalid',{}],[root+'/users/a:runQuery',{method:'POST',body:{structuredQuery:{}}}],
 [root+'/users/a/pushDevices?pageSize=5&pageToken=next',{}],[root.replace('qa-general','prod')+'/a/b',{}]])
 assert.throws(()=>m.beforeHttp('worker',u,i),/qa_free_invocation_budget/);
 assert.equal(m.snapshot().worker.requests,0);
});
test('transport cannot borrow finalization reserve; failed attempts never refund',()=>{
 const m=createFreeInvocationMeter();
 for(let i=0;i<32;i++)m.beforeHttp('worker',root+'/a/b');
 assert.throws(()=>m.beforeHttp('worker',root+'/a/b'),/qa_free_invocation_budget/);
 m.beforeHttp('finish',root+':commit',{method:'POST',body:{writes:[{}]}});
 assert.equal(m.snapshot().finish.writes,1);
 assert.throws(()=>m.charge('finish',{writes:1}),/qa_free_invocation_budget/);
 assert.equal(m.snapshot().worker.requests,32);
});
test('candidate allocation leaves external margin and accounts for UTC overlap',()=>{
 assert.equal(Object.values(FREE_TRANSPORT_LIMITS).reduce((n,v)=>n+v.requests,0),45);
 assert.equal(FREE_DAILY_ENVELOPE.reads,16820);
 assert.equal(FREE_DAILY_ENVELOPE.writes,1000);
 assert.ok(FREE_DAILY_ENVELOPE.reads*2<50000);
});

test('preparation stages have independent caps and cannot consume finish allowance',()=>{
 const m=createFreeInvocationMeter();
 m.charge('discovery',{requests:2,reads:2});
 assert.throws(()=>m.charge('discovery',{requests:1}),/qa_free_invocation_budget/);
 m.charge('recovery',{requests:1,reads:1});
 m.charge('publication',{requests:8,reads:24,writes:3});
 assert.throws(()=>m.charge('publication',{writes:1}),/qa_free_invocation_budget/);
 m.charge('finish',{requests:3,reads:1,writes:1});
 assert.equal(m.snapshot().finish.writes,1);
});
