import test from 'node:test';
import assert from 'node:assert/strict';
import {blankRetentionWorksheet,auditRetentionWorksheet}
  from './qa-retention-worksheet.js';

const draft=()=>structuredClone(blankRetentionWorksheet());
const clone=x=>structuredClone(x);
const value='Revisão operacional documentada; confirmação humana externa obrigatória.';
function fill(entry){
  entry.status='in_review';
  for(const key of Object.keys(entry)){
    if(entry[key]===null)entry[key]=value;
  }
  entry.operationalEvidenceUrl='https://github.com/test/reviews/issues/101';
  entry.legalReviewEvidenceUrl='https://github.com/test/reviews/issues/102';
  entry.legalReviewer='revisor.privacidade';
  entry.technicalReviewer='revisor.seguranca';
  entry.reviewedAt='2026-11-02T12:00:00.000Z';
  return entry;
}

test('blank worksheet pins all 43 known source IDs without inventing decisions',()=>{
  const form=draft();
  const status=auditRetentionWorksheet(form);
  assert.equal(form.schema,1);
  assert.equal(form.purpose,'atrio-retention-review-internal');
  assert.equal(form.reviewOnly,true);
  assert.equal(status.sources,43);
  assert.equal(status.blank,43);
  assert.equal(status.incomplete,0);
  assert.equal(status.readyForIndependentReview,0);
  assert.equal(status.localEvidenceStructurallyComplete,false);
  assert.equal(status.googlePlayReleaseAuthorized,false);
});
test('partial reviews are visible but cannot become false approval',()=>{
  const form=draft();
  form.entries[0].status='in_review';
  form.entries[0].legalBasis=value;
  const status=auditRetentionWorksheet(form);
  assert.equal(status.blank,42);
  assert.equal(status.incomplete,1);
  assert.equal(status.localEvidenceStructurallyComplete,false);
  assert.equal(status.independentEvidenceVerified,false);
});
test('even a complete synthetic worksheet is never legal or production approval',()=>{
  const form=draft();
  for(const entry of form.entries)fill(entry);
  const status=auditRetentionWorksheet(form);
  assert.equal(status.readyForIndependentReview,43);
  assert.equal(status.localEvidenceStructurallyComplete,true);
  assert.equal(status.independentEvidenceVerified,false);
  assert.equal(status.reviewerIdentityAuthenticated,false);
  assert.equal(status.legalRetentionApproved,false);
  assert.equal(status.productionDeletionExecutorVerified,false);
  assert.equal(status.googlePlayReleaseAuthorized,false);
  form.entries[0].status='pending';
  assert.equal(auditRetentionWorksheet(form).readyForIndependentReview,42);
});
test('inventory, shape, source metadata and identity checks fail closed',()=>{
  const good=draft();
  const changes=[
    x=>x.entries.pop(),
    x=>x.entries.push(clone(x.entries[0])),
    x=>{x.entries[0].id='external:unknown';},
    x=>{x.entries[0].source='push';},
    x=>{x.entries[0].classification='safe_to_delete';},
    x=>{x.entries[0].unexpected=true;},
    x=>{x.reviewOnly=false;},
    x=>{x.purpose='play-release-approved';},
    x=>{x.schema=2;},
    x=>{x.entries[0].status='approved';}
  ];
  for(const fn of changes){
    const x=clone(good);fn(x);
    assert.throws(()=>auditRetentionWorksheet(x));
  }
});
test('external evidence and reviewers cannot carry malformed or placeholder approvals',()=>{
  const changes=[
    x=>{x.entries[0].operationalEvidenceUrl='http://example.com/yes';},
    x=>{x.entries[0].legalReviewEvidenceUrl='https://github.com/review?token=abc';},
    x=>{x.entries[0].thirdPartyHandling='a confirmar';},
    x=>{x.entries[0].deletionOrAnonymization='[PENDENTE]';},
    x=>{x.entries[0].reviewedAt='2080-01-01T00:00:00.000Z';},
    x=>{x.entries[0].reviewedAt='not really a timestamp';},
    x=>{x.entries[0].legalReviewer=x.entries[0].technicalReviewer;},
    x=>{x.entries[0].legalBasis='password=secret';}
  ];
  const original=draft();fill(original.entries[0]);
  for(const fn of changes){
    const x=clone(original);fn(x);
    assert.throws(()=>auditRetentionWorksheet(x));
  }
});
