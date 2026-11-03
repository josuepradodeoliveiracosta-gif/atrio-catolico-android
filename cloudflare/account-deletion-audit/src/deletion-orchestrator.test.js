import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildDeletionPlan, simulatePhases, OWNED_ROOTS, USER_SUBCOLLECTIONS,
  RELATIONAL_SCOPES, EXTERNAL_SCOPES
} from './deletion-orchestrator.js';

const uid='alice_123';
const record={fields:{status:{stringValue:'requested'}}};
const inventory=()=>({
  uid,pagesComplete:true,
  scopesComplete:[...RELATIONAL_SCOPES,...EXTERNAL_SCOPES],
  documents:[
    {path:'profiles/alice_123',kind:'owned'},
    {path:'users/alice_123/likedPosts/abc',kind:'owned'},
    {path:'guardian_notices/alice_123/items/case_1',kind:'owned'},
    {path:'posts/post_1',kind:'relational',ownerUid:uid},
    {path:'posts/post_2/replies/reply_1',kind:'relational',ownerUid:uid},
    {path:'users/bob/notifications/notice_1',kind:'relational',ownerUid:uid}
  ],
  externalResources:[{
    ownerUid:uid,scope:'cloudinary_avatar_upload',key:'atrio-avatares/alice_123/550e8400-e29b-41d4-a716-446655440000'
  }],
  hasUnknownCollections:false,hasLegalHold:false,
  mediaStateUncertain:false,contentReferencesUnresolved:false
});
const approvals=()=>({
  identityVerified:true,retentionReviewed:true,operatorApproved:true,
  retentionDecisionRecorded:true
});
const plan=(inv=inventory(),app=approvals(),rec=record)=>buildDeletionPlan(uid,rec,inv,app);

test('plan includes all known Firestore and external scopes and never exposes delete capability',()=>{
  assert.ok(OWNED_ROOTS.includes('profile_photos'));
  assert.ok(USER_SUBCOLLECTIONS.includes('pushDevices'));
  assert.ok(USER_SUBCOLLECTIONS.includes('blockedMembers'));
  assert.ok(USER_SUBCOLLECTIONS.includes('acceptedTerms'));
  assert.ok(RELATIONAL_SCOPES.includes('posts/*/replies/*/reactions/*'));
  assert.ok(RELATIONAL_SCOPES.includes('user_reports/*'));
  assert.ok(EXTERNAL_SCOPES.includes('firebase_auth'));
  const result=plan();
  assert.equal(result.received,true);
  assert.deepEqual(result.blockers,[]);
  assert.equal(result.safeToExecute,false);
  assert.equal(result.simulatedOnly,true);
  assert.equal(result.summary.ownedDocuments,3);
  assert.equal(result.summary.relationalDocuments,3);
  assert.equal(result.summary.externalResources,1);
  assert.equal(result.phases.at(-2).id,'remove_firebase_auth_last');
  assert.equal(result.phases.at(-1).id,'verify_and_finalize');
});
test('new UGC child collections and user reports remain within reviewed-only scope',()=>{
  const expanded=inventory();
  expanded.documents.push({path:'users/alice_123/blockedMembers/member_1',kind:'owned'});
  expanded.documents.push({path:'users/alice_123/acceptedTerms/ugc-v1',kind:'owned'});
  expanded.documents.push({path:'user_reports/ugc_case_1',kind:'relational',ownerUid:uid});
  const out=plan(expanded);
  assert.equal(out.safeToExecute,false);
  assert.ok(out.blockers.includes('moderation_evidence_requires_independent_resolution'));
  assert.equal(out.safeToExecute,false);
  const forged=inventory();
  forged.documents.push({path:'users/another/blockedMembers/alice_123',kind:'owned'});
  assert.ok(plan(forged).blockers.includes('owned_path_outside_allowlist'));
});

test('no request cannot become eligible even with operator approval',()=>{
  assert.ok(plan(inventory(),approvals(),null).blockers.includes('missing_verified_request'));
  assert.ok(plan(inventory(),approvals(),{fields:{status:{stringValue:'completed'}}})
    .blockers.includes('missing_verified_request'));
});
test('no owner identity, retention decision or approval blocks all processing',()=>{
  const x=plan(inventory(),{});
  assert.ok(x.blockers.includes('identity_verification_required'));
  assert.ok(x.blockers.includes('human_operator_approval_required'));
  assert.ok(x.blockers.includes('retention_policy_review_required'));
  assert.equal(simulatePhases(x).state,'blocked');
});
test('different UID or unverified pagination must block',()=>{
  assert.ok(plan({...inventory(),uid:'bob'}).blockers.includes('inventory_uid_mismatch'));
  assert.ok(plan({...inventory(),pagesComplete:false}).blockers.includes('incomplete_pagination'));
  const altered=inventory();
  altered.scopesComplete=altered.scopesComplete.filter(x=>x!=='fcm_devices');
  assert.ok(plan(altered).blockers.includes('unverified_external_or_relational_scope'));
});
test('unknown nested collections and unresolved cross-user references block',()=>{
  assert.ok(plan({...inventory(),hasUnknownCollections:true})
    .blockers.includes('unknown_collections_present'));
  assert.ok(plan({...inventory(),contentReferencesUnresolved:true})
    .blockers.includes('references_to_others_unresolved'));
  assert.ok(plan({...inventory(),mediaStateUncertain:true})
    .blockers.includes('cloudinary_state_unverified'));
});
test('legal hold requires recorded decision even with review checked',()=>{
  const a=approvals();a.retentionDecisionRecorded=false;
  assert.ok(plan({...inventory(),hasLegalHold:true},a)
    .blockers.includes('legal_hold_requires_decision'));
});
test('cannot treat another user document as owned via path manipulation',()=>{
  const a=inventory();
  a.documents.push({path:'users/bob',kind:'owned'});
  assert.ok(plan(a).blockers.includes('owned_path_outside_allowlist'));
  const b=inventory();
  b.documents.push({path:'users/alice_123/otherCollection/x',kind:'owned'});
  assert.ok(plan(b).blockers.includes('owned_path_outside_allowlist'));
});
test('cannot delete another member\'s posts or replies as own relational data',()=>{
  const a=inventory();
  a.documents.push({path:'posts/others_post',kind:'relational',ownerUid:'bob'});
  assert.ok(plan(a).blockers.includes('cross_account_record_not_owned'));
  const b=inventory();
  b.documents.push({path:'guardian_runtime/global',kind:'relational',ownerUid:uid});
  assert.ok(plan(b).blockers.includes('relational_path_outside_allowlist'));
});
test('reaction document ID must identify the requesting account, not a third party',()=>{
  const forged=inventory();
  forged.documents.push({path:'posts/p1/replies/r1/reactions/bob',
    kind:'relational',ownerUid:uid});
  assert.ok(plan(forged).blockers.includes('reaction_document_uid_mismatch'));
  assert.equal(plan(forged).safeToExecute,false);
  const legitimate=inventory();
  legitimate.documents.push({path:'posts/p1/replies/r1/reactions/'+uid,
    kind:'relational',ownerUid:uid});
  assert.ok(!plan(legitimate).blockers.includes('reaction_document_uid_mismatch'));
  assert.deepEqual(plan(legitimate).blockers,[]);
});

test('moderation evidence remains pending separate retention review even with broad approvals',()=>{
  for(const root of ['reports','user_reports','guardian_cases',
    'guardian_audit','guardiao_quarantine']){
    const item=inventory();
    item.documents.push({path:root+'/case_1',kind:'relational',ownerUid:uid});
    const result=plan(item);
    assert.ok(result.blockers.includes(
      'moderation_evidence_requires_independent_resolution'),root);
    assert.equal(result.safeToExecute,false);
  }
  const sameCase=inventory();
  sameCase.documents.push({path:'user_reports/'+uid+'_user_bob',
    kind:'relational',ownerUid:uid});
  assert.ok(plan(sameCase).blockers.includes(
    'moderation_evidence_requires_independent_resolution'));
  assert.deepEqual(plan().blockers,[]);
});

test('duplicates and bad document paths or kind block',()=>{
  const a=inventory();
  a.documents.push({...a.documents[0]});
  assert.ok(plan(a).blockers.includes('duplicate_inventory_entry'));
  const b=inventory();
  b.documents.push({path:'profiles/../../bob',kind:'owned'});
  assert.ok(plan(b).blockers.includes('invalid_document_inventory'));
  const c=inventory();
  c.documents.push({path:'profiles/alice_123',kind:'DELETE_NOW'});
  assert.ok(plan(c).blockers.includes('invalid_document_inventory'));
});
test('external resource owner and scope must match inventory',()=>{
  const a=inventory();
  a.externalResources.push({ownerUid:'bob',scope:'cloudinary_avatar_upload',key:'x'});
  assert.ok(plan(a).blockers.includes('external_resource_not_verified'));
  const b=inventory();
  b.externalResources.push({ownerUid:uid,scope:'private_jks',key:'key'});
  assert.ok(plan(b).blockers.includes('external_resource_not_verified'));
});
test('external avatar public IDs and Firebase Auth keys must match the account',()=>{
  const known='atrio-avatares/alice_123/550e8400-e29b-41d4-a716-446655440000';
  for (const scope of ['cloudinary_avatar_upload',
                       'cloudinary_avatar_pending',
                       'cloudinary_avatar_authenticated']) {
    const right=inventory();
    right.externalResources=[{ownerUid:uid,scope,key:known}];
    assert.deepEqual(plan(right).blockers,[]);
    const wrong=inventory();
    wrong.externalResources=[{ownerUid:uid,scope,
      key:'atrio-avatares/bob/550e8400-e29b-41d4-a716-446655440000'}];
    assert.ok(plan(wrong).blockers.includes('external_resource_not_verified'));
    const malformed=inventory();
    malformed.externalResources=[{ownerUid:uid,scope,key:known+'/other'}];
    assert.ok(plan(malformed).blockers.includes('external_resource_not_verified'));
  }
  const authValid=inventory();
  authValid.externalResources=[{ownerUid:uid,scope:'firebase_auth',key:uid}];
  assert.deepEqual(plan(authValid).blockers,[]);
  const authWrong=inventory();
  authWrong.externalResources=[{ownerUid:uid,scope:'firebase_auth',key:'bob'}];
  assert.ok(plan(authWrong).blockers.includes('external_resource_not_verified'));
  assert.equal(plan(authWrong).safeToExecute,false);
});

test('inventory completeness flags are mandatory and fail closed when unknown',()=>{
  for (const [key,blocker] of [
    ['hasUnknownCollections','unknown_collections_present'],
    ['hasLegalHold','inventory_assurance_missing:hasLegalHold'],
    ['contentReferencesUnresolved','references_to_others_unresolved'],
    ['mediaStateUncertain','cloudinary_state_unverified']
  ]) {
    const missing=inventory();
    delete missing[key];
    assert.ok(plan(missing).blockers.includes('inventory_assurance_missing:'+key));
    const undefinedValue=inventory();
    undefinedValue[key]=null;
    assert.ok(plan(undefinedValue).blockers.includes('inventory_assurance_missing:'+key));
    const unexpected=inventory();
    unexpected[key]='false';
    assert.ok(plan(unexpected).blockers.includes('inventory_assurance_missing:'+key));
    if(key!=='hasLegalHold') {
      const present=inventory();
      present[key]=true;
      assert.ok(plan(present).blockers.includes(blocker));
    }
  }
  assert.deepEqual(plan().blockers,[]);
  assert.equal(plan({...inventory(),hasLegalHold:true}).safeToExecute,false);
});

test('claimed full scope inventory rejects duplicate, extra and unknown scopes',()=>{
  const a=inventory();
  a.scopesComplete.push(a.scopesComplete[0]);
  assert.ok(plan(a).blockers.includes('unverified_external_or_relational_scope'));
  const b=inventory();
  b.scopesComplete[0]='made_up_scope';
  assert.ok(plan(b).blockers.includes('unverified_external_or_relational_scope'));
  const c=inventory();
  c.scopesComplete.push('additional_fake_scope');
  assert.ok(plan(c).blockers.includes('unverified_external_or_relational_scope'));
  assert.deepEqual(plan().blockers,[]);
});

test('duplicate external resources and empty identifiers block',()=>{
  const a=inventory();
  a.externalResources.push({...a.externalResources[0]});
  assert.ok(plan(a).blockers.includes('duplicate_external_resource'));
  const b=inventory();
  b.externalResources=[{ownerUid:uid,scope:'fcm_devices',key:''}];
  assert.ok(plan(b).blockers.includes('external_resource_not_verified'));
});

test('large and malformed inventories block and remain non-destructive',()=>{
  assert.ok(plan({...inventory(),documents:null}).blockers.includes('invalid_document_inventory'));
  assert.ok(plan({...inventory(),documents:Array(20001).fill({path:'profiles/alice_123',kind:'owned'})})
    .blockers.includes('invalid_document_inventory'));
  assert.ok(plan({...inventory(),externalResources:'not_array'})
    .blockers.includes('unverified_external_resource_inventory'));
});
test('no PII or actual record identifiers are returned',()=>{
  const i=inventory();
  i.documents.push({path:'profiles/alice_123',kind:'owned',email:'private@never.example'});
  const result=plan(i);
  const response=JSON.stringify(result);
  assert.ok(!response.includes('private@never.example'));
  assert.ok(!response.includes('alice_123'));
  assert.ok(!response.includes('post_1'));
  assert.ok(!response.includes('atrio-avatares'));
});
test('simulation handles one step at a time and resumes from checkpoint',()=>{
  const p=plan();
  let status=simulatePhases(p,{}, {singleStep:true});
  assert.equal(status.state,'simulating');
  const completedFirst=status.completed;
  status=simulatePhases(p,{completed:completedFirst}, {singleStep:true});
  assert.equal(status.completed.length,2);
  assert.equal(status.completed[0],'freeze_new_writes');
  const finished=simulatePhases(p,{completed:status.completed});
  assert.equal(finished.state,'simulated_only');
  assert.equal(finished.completed.length,p.phases.length);
  assert.equal(simulatePhases(p,{completed:finished.completed}).completed.length,p.phases.length);
});
test('simulated failure stops before step and can be retried without duplicating checkpoint',()=>{
  const p=plan();
  const result=simulatePhases(p,{}, {failAt:'remove_cloudinary_media'});
  assert.equal(result.state,'retry_required');
  assert.equal(result.next,'remove_cloudinary_media');
  assert.equal(result.completed.includes('remove_cloudinary_media'),false);
  const retry=simulatePhases(p,{completed:result.completed});
  assert.equal(retry.state,'simulated_only');
});
test('unknown checkpoints and forged executable plans are rejected',()=>{
  const p=plan();
  assert.throws(()=>simulatePhases(p,{completed:['erase_entire_database']}),/unknown_checkpoint/);
  assert.throws(()=>simulatePhases(p,{completed:['remove_firebase_auth_last']}),/out_of_order_checkpoint/);
  assert.throws(()=>simulatePhases(p,{completed:['freeze_new_writes','freeze_new_writes']}),/duplicate_checkpoint_phase/);
  assert.throws(()=>simulatePhases({...p,safeToExecute:true}),/not_a_simulation/);
  assert.throws(()=>buildDeletionPlan('../escape',record,inventory(),approvals()),/invalid_uid/);
});
