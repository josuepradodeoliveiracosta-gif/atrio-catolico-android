import test from 'node:test';
import assert from 'node:assert/strict';
import {planDeletionReview} from './plan.js';
const valid={projectId:'demo-atrio-v11',uid:'test-person',
  request:{uid:'test-person',source:'web',status:'requested',
    requestedAt:'2026-10-31T12:00:00.000Z'}};
test('somente simula: nenhuma escrita ou exclusão',()=>{
  const plan=planDeletionReview(valid);
  assert.equal(plan.mode,'DRY_RUN_ONLY');
  assert.equal(plan.deletionAuthorized,false);
  assert.equal(plan.firestoreWrites,0);
  assert.equal(plan.identityDeletes,0);
  assert.equal(plan.cloudinaryDeletes,0);
  assert.equal(plan.accountAuth,'REVIEW_LAST_AFTER_ALL_OTHER_DATA');
  assert.ok(plan.nestedCollections.includes('users/test-person/notifications/*'));
});
test('nega producao e qualquer projeto não autorizado',()=>{
  for(const p of ['atrio-catolico','qualquer-outro','']) {
    assert.throws(()=>planDeletionReview({...valid,projectId:p}),/qa_only/);
  }
});
test('rejeita conta de terceiro, status forjado e IDs perigosos',()=>{
  assert.throws(()=>planDeletionReview({...valid,uid:'other-user'}));
  assert.throws(()=>planDeletionReview({...valid,uid:'../owner',request:{...valid.request,uid:'../owner'}}));
  assert.throws(()=>planDeletionReview({...valid,request:{...valid.request,status:'completed'}}));
  assert.throws(()=>planDeletionReview({...valid,request:{...valid.request,source:'unknown'}}));
  assert.throws(()=>planDeletionReview({...valid,request:{...valid.request,requestedAt:'bad'}}));
});
