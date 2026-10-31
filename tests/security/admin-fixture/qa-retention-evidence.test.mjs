import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {createQaRetentionEvidenceAdapter,QA_RETENTION_READINESS}
  from './qa-retention-evidence.mjs';

const A='qa-delete-alice',REQUEST='2026-10-31T12:00:00.000Z';
const early=Date.parse('2026-10-31T15:00:00.000Z');
const reviewers=['qa-privacy-reviewer','qa-security-reviewer'];
function fixture(run){
  const db=new DatabaseSync(':memory:');
  let clock=early;
  const gate=createQaRetentionEvidenceAdapter(db,{now:()=>clock});
  const review=(changes={})=>gate.review({
    uid:A,requestAt:REQUEST,decision:'clear',approvals:reviewers,
    reviewedAt:'2026-10-31T14:00:00.000Z',
    expiresAt:'2026-10-31T20:00:00.000Z',...changes
  });
  return Promise.resolve().then(()=>run({db,gate,review,advance:v=>{clock=v;}}))
    .finally(()=>db.close());
}
test('retention review is separate from the hardcoded order and denies missing approvals',()=>fixture(async({gate,review})=>{
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_missing/);
  assert.throws(()=>review({approvals:[reviewers[0]]}),/qa_retention_invalid_reviewers/);
  assert.throws(()=>review({requestAt:'2026-10-31T12:00:01.000Z'}),
    /qa_retention_unmatched_request/);
  assert.throws(()=>review({decision:'unknown'}),/qa_retention_invalid_decision/);
  assert.equal(review(),true);
  assert.equal(await gate.verify(A,REQUEST),true);
  assert.equal(QA_RETENTION_READINESS.reviewerIdentityReal,false);
}));
test('new or resolved legal hold invalidates an earlier decision until re-reviewed',()=>fixture(async({gate,review})=>{
  review();
  gate.hold(A,'qa-case-moderation-1');
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_stale/);
  review();
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_active_hold/);
  gate.resolve(A,'qa-case-moderation-1');
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_stale/);
  review();
  assert.equal(await gate.verify(A,REQUEST),true);
}));
test('receipt expires, and tampering with the persisted reviewer evidence fails closed',()=>fixture(async({gate,review,db,advance})=>{
  review();
  advance(Date.parse('2026-10-31T20:01:00.000Z'));
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_expired/);
  advance(early);
  db.prepare("UPDATE qa_retention_reviews SET security='untrusted' WHERE uid=?").run(A);
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_unapproved/);
}));
test('reopen a resolved hold must invalidate the previous clear decision',()=>fixture(async({gate,review})=>{
  gate.hold(A,'qa-case-reopened');
  gate.resolve(A,'qa-case-reopened');
  review();
  gate.hold(A,'qa-case-reopened');
  await assert.rejects(gate.verify(A,REQUEST),/qa_retention_review_stale/);
}));
test('invalid QA environment and UID are rejected before any review operation',()=>fixture(async({gate,review})=>{
  await assert.rejects(gate.verify('real-user',REQUEST),/qa_retention_unlisted_identity/);
  const old=process.env.FIRESTORE_EMULATOR_HOST;
  try{
    process.env.FIRESTORE_EMULATOR_HOST='firestore.googleapis.com:443';
    await assert.rejects(gate.verify(A,REQUEST),/qa_retention_nonlocal_environment/);
    assert.throws(()=>review(),/qa_retention_nonlocal_environment/);
  }finally{process.env.FIRESTORE_EMULATOR_HOST=old;}
}));
