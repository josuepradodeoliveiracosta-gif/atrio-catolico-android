import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRetentionWorksheet} from './qa-retention-worksheet.js';
import {retentionReviewRegistry} from './qa-retention-source-registry.js';
import {
 RETENTION_REVIEW_GROUPS,summarizeRetentionReviewPriorities,
 formatRetentionReviewPriorities
} from './qa-retention-review-priorities.js';

test('priority plan is exhaustive and deterministic for all 43 declared source IDs',()=>{
  const form=blankRetentionWorksheet();
  const result=summarizeRetentionReviewPriorities(form);
  const assigned=RETENTION_REVIEW_GROUPS.flatMap(g=>g.ids);
  assert.deepEqual([...assigned].sort(),
    retentionReviewRegistry().map(x=>x.id).sort());
  assert.equal(new Set(assigned).size,43);
  assert.equal(result.sources,43);
  assert.equal(result.pending,43);
  assert.equal(result.inReview,0);
  assert.deepEqual(result.groups.map(x=>x.sources),[6,7,9,6,7,8]);
  assert.deepEqual(result.groups.map(x=>x.priority),[1,1,1,2,2,3]);
  assert.equal(result.groups[0].nextSource,'external:firebase_auth');
  assert.equal(result.groups[1].nextSource,'firestore:/public_profiles/{uid}');
  assert.equal(result.groups[2].nextSource,'firestore:/user_reports/{reportId}');
  assert.equal(result.retentionApproved,false);
  assert.equal(result.deletionAuthorized,false);
  assert.equal(result.playAuthorized,false);
});
test('in-review state advances the plan without claiming independent legal verification',()=>{
  const form=blankRetentionWorksheet();
  const key='external:firebase_auth';
  const selected=form.entries.find(x=>x.id===key);
  selected.status='in_review';
  const result=summarizeRetentionReviewPriorities(form);
  assert.equal(result.pending,42);
  assert.equal(result.inReview,1);
  assert.equal(result.groups[0].pending,5);
  assert.equal(result.groups[0].inReview,1);
  assert.equal(result.groups[0].nextSource,
    'firestore:/account_deletion_requests/{uid}');
  assert.equal(result.playAuthorized,false);
});
test('output remains aggregate and may list schema paths, never worksheet notes',()=>{
  const form=blankRetentionWorksheet();
  const sentinel='SENSITIVE_PRIVATE_NOTE_SHOULD_NOT_APPEAR';
  const selected=form.entries.find(x=>x.id==='external:firebase_auth');
  selected.status='in_review';
  selected.dataPurpose=sentinel;
  const output=formatRetentionReviewPriorities(
    summarizeRetentionReviewPriorities(form));
  assert.match(output,/43 \| Pendentes: 42/);
  assert.match(output,/FICHA NÃO HOMOLOGADA/);
  assert.match(output,/Conteúdo e dados religiosos/);
  assert.doesNotMatch(output,new RegExp(sentinel));
  assert.doesNotMatch(output,/reviewer@|dataPurpose|retentionPeriodDays/);
});
test('malformed, duplicate or unauthorized worksheet cannot generate plan',()=>{
  const cases=[
    x=>x.entries.pop(),
    x=>x.entries[0].id=x.entries[1].id,
    x=>x.entries[0].status='approved',
    x=>x.reviewOnly=false,
    x=>x.entries[0].source='secrets'
  ];
  for(const mutation of cases){
    const x=structuredClone(blankRetentionWorksheet());
    mutation(x);
    assert.throws(()=>summarizeRetentionReviewPriorities(x));
  }
});
test('formatting rejects fake approved summaries',()=>{
  const base=summarizeRetentionReviewPriorities(blankRetentionWorksheet());
  assert.throws(()=>formatRetentionReviewPriorities({...base,playAuthorized:true}));
  assert.throws(()=>formatRetentionReviewPriorities({...base,retentionApproved:true}));
  assert.throws(()=>formatRetentionReviewPriorities({...base,reviewOnly:false}));
});
