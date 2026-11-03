import test from 'node:test';
import assert from 'node:assert/strict';
import {RELATIONAL_SCOPES,EXTERNAL_SCOPES}
  from './deletion-orchestrator.js';
import {blankModerationCaseDossier}
  from './qa-moderation-case-review.js';
import {inspectDeletionModerationPreflight}
  from './qa-moderation-deletion-preflight.js';

const uid='alice_123',time=new Date('2026-11-03T16:00:00.000Z');
const requestRecord={fields:{status:{stringValue:'requested'}}};
const approvals={identityVerified:true,retentionReviewed:true,
  operatorApproved:true,retentionDecisionRecorded:true};
const fixture=()=>({
  uid,pagesComplete:true,
  scopesComplete:[...RELATIONAL_SCOPES,...EXTERNAL_SCOPES],
  documents:[
    {path:'profiles/alice_123',kind:'owned'},
    {path:'reports/qa_case_1',kind:'relational',ownerUid:uid},
    {path:'user_reports/qa_case_2',kind:'relational',ownerUid:uid}
  ],
  externalResources:[],
  hasUnknownCollections:false,hasLegalHold:false,
  contentReferencesUnresolved:false,mediaStateUncertain:false
});
const inspect=(inv,dossier,extras={})=>
  inspectDeletionModerationPreflight({
    uid,requestRecord,inventory:inv,approvals,dossier,now:time,...extras
  });
const reviewed=(form)=>{
  for(const row of form.cases)Object.assign(row,{
    status:'in_review',treatment:'propose_anonymization',
    legalBasis:'Revisão independente das hipóteses jurídicas e de proteção.',
    thirdPartyImpactReviewed:true,retentionUntil:null,
    technicalReviewer:'technical.reviewer',
    legalReviewer:'privacy.reviewer',
    reviewedAt:'2026-11-03T15:00:00.000Z',
    evidenceUrl:'https://atriocatolico.org/revisao-documentada',
    implementationNotes:'Proposta de anonimização condicionada a parecer independente.'
  });
  return form;
};
test('pending per-case records remain blocked and result never exposes case identities',()=>{
  const inv=fixture();
  const result=inspect(inv,blankModerationCaseDossier(uid,inv));
  assert.deepEqual([result.moderation.cases,result.moderation.pending],
    [2,2]);
  assert.ok(result.blockers.includes('moderation_evidence_requires_independent_resolution'));
  assert.ok(result.blockers.includes('moderation_case_proposal_incomplete'));
  assert.ok(result.blockers.includes('moderation_independent_legal_resolution_required'));
  for(const field of ['destructiveOperationsEnabled','accountDeletionAuthorized',
    'googlePlayReleaseAuthorized','liveInventoryVerified',
    'moderatorIdentityVerified','retentionDecisionApproved'])
    assert.equal(result[field],false);
  assert.doesNotMatch(JSON.stringify(result),/qa_case_|alice_123|evidenceUrl|reporterUid/);
});
test('structurally complete proposals never clear the deletion planner or enable Auth',()=>{
  const inv=fixture();
  const result=inspect(inv,reviewed(blankModerationCaseDossier(uid,inv)));
  assert.equal(result.moderation.structurallyComplete,true);
  assert.equal(result.moderation.readyForIndependentVerification,2);
  assert.ok(result.blockers.includes('moderation_evidence_requires_independent_resolution'));
  assert.ok(result.blockers.includes('moderation_independent_legal_resolution_required'));
  assert.equal(result.blockers.includes('moderation_case_proposal_incomplete'),false);
  assert.equal(result.state,'blocked_review_only');
  assert.equal(result.planSimulatedOnly,true);
  assert.equal(result.destructiveOperationsEnabled,false);
});
test('missing, altered, stale, forged or incomplete worksheet fails closed',()=>{
  const inv=fixture();
  const approved=reviewed(blankModerationCaseDossier(uid,inv));
  const changed=fixture();
  changed.documents.push({path:'reports/qa_new',kind:'relational',ownerUid:uid});
  const options=[
    [inv,null],
    [inv,{...approved,uid:'bob'}],
    [inv,{...approved,cases:[...approved.cases].reverse()}],
    [inv,{...approved,inventoryDigest:'0'.repeat(64)}],
    [changed,approved],
    [{...inv,pagesComplete:false},approved],
    [{...inv,scopesComplete:[]},approved],
  ];
  for(const [evidence,form] of options){
    const result=inspect(evidence,form);
    assert.equal(result.moderation.dossierValid,false);
    assert.equal(result.moderation.cases,null);
    assert.ok(result.blockers.includes('moderation_dossier_missing_or_invalid'));
    assert.equal(result.accountDeletionAuthorized,false);
  }
});
test('request and operator failures are preserved alongside dossier problems',()=>{
  const inv=fixture();
  const result=inspect(inv,blankModerationCaseDossier(uid,inv),{
    approvals:{identityVerified:false,retentionReviewed:false,operatorApproved:false},
    requestRecord:null
  });
  for(const required of ['missing_verified_request','identity_verification_required',
    'retention_policy_review_required','human_operator_approval_required'])
    assert.ok(result.blockers.includes(required));
  assert.equal(result.state,'blocked_review_only');
});
test('empty moderation list cannot manufacture permission to execute',()=>{
  const inv=fixture();inv.documents=inv.documents.slice(0,1);
  const result=inspect(inv,blankModerationCaseDossier(uid,inv));
  assert.equal(result.moderation.cases,0);
  assert.equal(result.moderation.structurallyComplete,true);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.googlePlayReleaseAuthorized,false);
  assert.equal(result.accountDeletionAuthorized,false);
  assert.equal(result.destructiveOperationsEnabled,false);
});
test('invalid UID never returns a misleading preflight',()=>{
  assert.throws(()=>inspectDeletionModerationPreflight({
    uid:'../../other',inventory:fixture()
  }),/invalid_uid/);
});
