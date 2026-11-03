import test from 'node:test';
import assert from 'node:assert/strict';
import {RELATIONAL_SCOPES,EXTERNAL_SCOPES}
  from './deletion-orchestrator.js';
import {blankModerationCaseDossier,auditModerationCaseDossier}
  from './qa-moderation-case-review.js';

const uid='alice_123';
const now=new Date('2026-11-03T15:00:00.000Z');
const inventory=()=>({
  uid,pagesComplete:true,
  scopesComplete:[...RELATIONAL_SCOPES,...EXTERNAL_SCOPES],
  documents:[
    {path:'users/alice_123',kind:'owned'},
    {path:'user_reports/synthetic_user_report',kind:'relational',ownerUid:uid},
    {path:'reports/synthetic_post_report',kind:'relational',ownerUid:uid},
    {path:'guardian_cases/synthetic_case',kind:'relational',ownerUid:uid},
    {path:'guardian_audit/synthetic_audit',kind:'relational',ownerUid:uid},
    {path:'guardiao_quarantine/synthetic_quarantine',kind:'relational',ownerUid:uid}
  ]
});
const valid=(d)=>{
  for(const row of d.cases){
    Object.assign(row,{
      status:'in_review',treatment:'retain_until',
      legalBasis:'Avaliação independente da base jurídica para conservação.',
      thirdPartyImpactReviewed:true,
      retentionUntil:'2027-01-01T00:00:00.000Z',
      technicalReviewer:'technical.reviewer',
      legalReviewer:'legal.reviewer',
      reviewedAt:'2026-11-03T14:00:00.000Z',
      evidenceUrl:'https://atriocatolico.org/revisao-privada',
      implementationNotes:'Tratamento proposto sujeito a validação jurídica e técnica.',
    });
  }
  return d;
};
test('template covers every moderation root and never approves deletion',()=>{
  const d=blankModerationCaseDossier(uid,inventory());
  assert.equal(d.cases.length,5);
  assert.deepEqual(d.cases.map(x=>x.path),[
    'guardian_audit/synthetic_audit',
    'guardian_cases/synthetic_case',
    'guardiao_quarantine/synthetic_quarantine',
    'reports/synthetic_post_report',
    'user_reports/synthetic_user_report'
  ]);
  const r=auditModerationCaseDossier(uid,inventory(),d,{now});
  assert.equal(r.pending,5);
  assert.equal(r.structurallyComplete,false);
  for(const k of ['liveInventoryAuthenticated','reviewerIdentitiesAuthenticated',
    'legalDecisionsApproved','crossServiceRetentionComplete',
    'accountDeletionAuthorized','googlePlayReleaseAuthorized'])
    assert.equal(r[k],false);
});
test('complete proposed disposition is only ready for independent verification',()=>{
  const d=valid(blankModerationCaseDossier(uid,inventory()));
  const r=auditModerationCaseDossier(uid,inventory(),d,{now});
  assert.deepEqual([r.pending,r.incomplete,r.readyForIndependentVerification],
    [0,0,5]);
  assert.equal(r.structurallyComplete,true);
  assert.equal(r.legalDecisionsApproved,false);
  assert.equal(r.googlePlayReleaseAuthorized,false);
  assert.equal(r.caseDetailsDisclosed,false);
  assert.doesNotMatch(JSON.stringify(r),/synthetic_|legal\.reviewer|revisao-privada/);
});
test('missing or forged inventory coverage cannot create a dossier',()=>{
  const corrupt=[
    {...inventory(),uid:'bob'},
    {...inventory(),pagesComplete:false},
    {...inventory(),scopesComplete:['reports/*']},
    {...inventory(),documents:[{path:'reports/case',kind:'owned'}]},
    {...inventory(),documents:[{path:'reports/case',kind:'relational',ownerUid:'bob'}]},
    {...inventory(),documents:[{path:'reports/case/extra/child',kind:'relational',ownerUid:uid}]},
    {...inventory(),documents:[
      {path:'reports/case',kind:'relational',ownerUid:uid},
      {path:'reports/case',kind:'relational',ownerUid:uid}
    ]}
  ];
  for(const inv of corrupt)
    assert.throws(()=>blankModerationCaseDossier(uid,inv),/qa_moderation_review_/);
});
test('every case must be present, in order, and committed to the same inventory',()=>{
  const d=valid(blankModerationCaseDossier(uid,inventory()));
  const cases=[
    {...d,cases:d.cases.slice(1)},
    {...d,cases:[...d.cases.slice(0,4),d.cases[0]]},
    {...d,cases:[d.cases[1],d.cases[0],...d.cases.slice(2)]},
    {...d,inventoryDigest:'0'.repeat(64)},
    {...d,uid:'bob'},
    {...d,reviewOnly:false},
    {...d,unexpected:'value'}
  ];
  for(const invalid of cases)
    assert.throws(()=>auditModerationCaseDossier(uid,inventory(),invalid,{now}),
      /qa_moderation_review_/);
  const changed=inventory();
  changed.documents.push({
    path:'user_reports/new_synthetic_case',kind:'relational',ownerUid:uid
  });
  assert.throws(()=>auditModerationCaseDossier(uid,changed,d,{now}),
    /qa_moderation_review_/);
});
test('pending rows cannot smuggle proposals or approvals',()=>{
  const d=blankModerationCaseDossier(uid,inventory());
  d.cases[0].treatment='propose_erasure';
  assert.throws(()=>auditModerationCaseDossier(uid,inventory(),d,{now}),
    /qa_moderation_review_pending_case_contains_proposal/);
});
test('one reviewer, fake URL, stale time or absent third-party review stays incomplete',()=>{
  const candidates=[
    {technicalReviewer:'legal.reviewer'},
    {evidenceUrl:'https://example.com/legal'},
    {evidenceUrl:'https://atrio-catolico.org/?token=123'},
    {reviewedAt:'2027-01-01T12:00:00.000Z'},
    {retentionUntil:null},
    {thirdPartyImpactReviewed:false},
    {implementationNotes:'TODO'},
    {legalBasis:'curto'},
    {treatment:'delete_now'}
  ];
  for(const data of candidates){
    const d=valid(blankModerationCaseDossier(uid,inventory()));
    Object.assign(d.cases[0],data);
    const r=auditModerationCaseDossier(uid,inventory(),d,{now});
    assert.equal(r.incomplete,1);
    assert.equal(r.readyForIndependentVerification,4);
    assert.equal(r.googlePlayReleaseAuthorized,false);
  }
});
test('no moderation cases is not a release approval',()=>{
  const inv=inventory();
  inv.documents=[];
  const result=auditModerationCaseDossier(uid,inv,
    blankModerationCaseDossier(uid,inv),{now});
  assert.equal(result.moderationCases,0);
  assert.equal(result.structurallyComplete,true);
  assert.equal(result.accountDeletionAuthorized,false);
  assert.equal(result.crossServiceRetentionComplete,false);
});
