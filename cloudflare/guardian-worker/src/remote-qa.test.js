import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Firestore} from './firestore.js';
import {validateRemoteQa,validateShadowOutcome} from './remote-gate.js';

const project='atrio-catolico-qa-v2';
const allow={
 GUARDIAN_QA_REMOTE_READY:'true',
 QA_FIREBASE_PROJECT_ID:project,
 QA_APPROVED_PROJECT_ID:project,
 QA_ACCESS_TOKEN:'test-only-token-that-is-long-enough'
};

test('manual remote gate requires explicit repository authorization',()=>{
 assert.equal(validateRemoteQa(allow),project);
 for(const [k,v] of Object.entries({
   GUARDIAN_QA_REMOTE_READY:'false',
   QA_FIREBASE_PROJECT_ID:'atrio-catolico',
   QA_APPROVED_PROJECT_ID:'atrio-catolico-qa-other',
   QA_ACCESS_TOKEN:''
 }))assert.throws(()=>validateRemoteQa({...allow,[k]:v}),Error,k);
});
test('remote gate rejects arbitrary project names and oversize',()=>{
 for(const id of ['atrio-catolico','atrio-catolico-qa-'+('a'.repeat(40)),'unrelated-qa','']){
   assert.throws(()=>validateRemoteQa({...allow,QA_FIREBASE_PROJECT_ID:id,QA_APPROVED_PROJECT_ID:id}),Error);
 }
});
test('QA query never permits access to production project',async()=>{
 const prod=new Firestore('dummy','atrio-catolico');
 await assert.rejects(prod.scanQa('posts'),/qa_project_required/);
});
test('QA query enforces 20-minute window and 15-document cap',async()=>{
 const db=new Firestore('dummy',project);
 for(const [minutes,max] of [[21,15],[20,16],[0,15],[20,0]]){
   await assert.rejects(db.scanQa('posts',minutes,max),/qa_limits_invalid/);
 }
 await assert.rejects(db.scanQa('admins'),/qa_limits_invalid/);
});
test('QA query has server-side synthetic marker filter and projection',async()=>{
 const db=new Firestore('dummy',project);
 const old=globalThis.fetch;const queries=[];
 globalThis.fetch=async(url,opt)=>{
  assert.equal(url,db.root+':runQuery'); assert.equal(opt.method,'POST');
  queries.push(JSON.parse(opt.body).structuredQuery);
  return new Response('[]',{status:200});
 };
 try{
   for(const group of ['posts','replies','reports'])assert.deepEqual(await db.scanQa(group,20,15),[]);
   assert.equal(queries.length,3);
   for(const [i,q] of queries.entries()){
      assert.equal(q.limit,15);
      assert.equal(q.from[0].allDescendants,i===1);
      const filters=q.where.compositeFilter.filters;
      assert.equal(filters[0].fieldFilter.field.fieldPath,'qaFixture');
      assert.equal(filters[0].fieldFilter.value.booleanValue,true);
      assert.equal(filters[1].fieldFilter.field.fieldPath,'createdAt');
      assert.equal(filters[1].fieldFilter.op,'GREATER_THAN_OR_EQUAL');
      assert.ok(q.select.fields.every(x=>['body','title','qaFixture'].includes(x.fieldPath)));
      if(i===2)assert.deepEqual(q.select.fields,[{fieldPath:'qaFixture'}]);
   }
 }finally{globalThis.fetch=old;}
});
test('QA query failure reports error without treating it as clear content',async()=>{
 const old=globalThis.fetch;const db=new Firestore('dummy',project);
 globalThis.fetch=async()=>new Response(JSON.stringify({error:{status:'PERMISSION_DENIED'}}),{status:403});
 try{await assert.rejects(db.scanQa('posts'),e=>e.status===403);}
 finally{globalThis.fetch=old;}
});
test('read-only query API provides no write handle to classifier',async()=>{
 const db=new Firestore('dummy',project);
 const old=globalThis.fetch;
 let calls=0;
 globalThis.fetch=async()=>{calls++;return new Response('[]',{status:200})};
 try{
  const reader={scan:(...args)=>db.scanQa(...args)};
  assert.equal(typeof reader.commit,'undefined');
  assert.equal(typeof reader.create,'undefined');
  await reader.scan('posts',20,15);
  assert.equal(calls,1);
 }finally{globalThis.fetch=old;}
});

test('remote read-only refuses empty QA datasets and failed queries',()=>{
 const counts={clear:0,review:0,hold_candidate:0,warning:0,reports:0,error:0};
 assert.throws(()=>validateShadowOutcome({status:'shadow_read_only',counts}),/fixtures_missing/);
 assert.throws(()=>validateShadowOutcome({status:'shadow_read_only',counts:{...counts,error:1}}),/qa_query_failed/);
 assert.deepEqual(validateShadowOutcome({status:'shadow_read_only',counts:{...counts,clear:1}}),{...counts,clear:1});
});
