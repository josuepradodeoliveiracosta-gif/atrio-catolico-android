import test from 'node:test';
import assert from 'node:assert/strict';
import {makeDeletionPlan,ownedPrivatePath,reviewReason} from './inventory.js';
import {runDeletionSimulation,SIMULATION_PHASES} from './simulator.js';

const request = {fields:{status:{stringValue:'requested'}}};
function fixture() {
  return {
    simulationOnly:true,
    documents:[
      {path:'profiles/alice',ownerUid:'alice'},
      {path:'profiles/bob',ownerUid:'bob'},
      {path:'public_profiles/alice',ownerUid:'alice'},
      {path:'profile_photos/alice',ownerUid:'alice'},
      {path:'users/alice',ownerUid:'alice'},
      {path:'users/alice/notifications/n1',ownerUid:'alice'},
      {path:'users/alice/likedPosts/a',ownerUid:'alice'},
      {path:'users/bob/notifications/n2',ownerUid:'bob'},
      {path:'guardian_notices/alice/items/m1',ownerUid:'alice'},
      {path:'account_deletion_requests/alice',ownerUid:'alice'},
      {path:'posts/post_alice',ownerUid:'alice'},
      {path:'posts/post_alice/replies/reply_bob',ownerUid:'bob'},
      {path:'reports/report_1',ownerUid:'alice'}
    ],
    media:[
      {publicId:'atrio-avatares/alice/photo1',ownerUid:'alice'},
      {publicId:'atrio-avatares/bob/photo2',ownerUid:'bob'}
    ],
    pushTokens:[
      {tokenId:'token_alice',ownerUid:'alice'},
      {tokenId:'token_bob',ownerUid:'bob'}
    ],
    authUids:new Set(['alice','bob'])
  };
}
test('owns only exact document path segments, never UID prefixes',()=>{
  assert.equal(ownedPrivatePath('alice','users/alice/notifications/x'),true);
  assert.equal(ownedPrivatePath('alice','users/alice2/notifications/x'),false);
  assert.equal(ownedPrivatePath('alice','users/bob'),false);
  assert.equal(ownedPrivatePath('alice','posts/post_alice'),false);
  assert.equal(ownedPrivatePath('alice','/profiles/alice'),false);
  assert.equal(ownedPrivatePath('alice','profiles/alice/../bob'),false);
});
test('discovery plans nested subcollections, protects posts and legal records',()=>{
  const p=makeDeletionPlan('alice',request,fixture());
  assert.ok(p.privatePaths.includes('users/alice/notifications/n1'));
  assert.ok(p.privatePaths.includes('profile_photos/alice'));
  assert.ok(!p.privatePaths.includes('users/bob/notifications/n2'));
  assert.ok(!p.privatePaths.includes('posts/post_alice'));
  assert.ok(!p.privatePaths.includes('account_deletion_requests/alice'));
  assert.deepEqual(p.mediaIds,['atrio-avatares/alice/photo1']);
  assert.deepEqual(p.pushTokenIds,['token_alice']);
  assert.ok(p.requiresManualReview.includes('shared_posts_and_nested_replies'));
  assert.ok(p.requiresManualReview.includes('moderation_legal_retention'));
  assert.ok(p.requiresManualReview.includes('request_audit_retention'));
  assert.equal(p.completeInventory,false);
  assert.equal(p.approvedForProduction,false);
  assert.equal(p.authDeletionAuthorized,false);
});
test('unknown and malformed data is rejected before a simulated action',()=>{
  const examples=[
    f=>{f.documents.push({path:'profiles/alice2',ownerUid:'alice'});},
    f=>{f.documents.push({path:'users/alice/../bob',ownerUid:'alice'});},
    f=>{f.media.push({publicId:'atrio-avatares/bob/photo',ownerUid:'alice'});},
    f=>{f.pushTokens.push({tokenId:'bad/token',ownerUid:'alice'});}
  ];
  for(const change of examples){
    const f=fixture();change(f);
    if (f.documents.some(x=>x.path==='profiles/alice2')) {
      const p=makeDeletionPlan('alice',request,f);
      assert.ok(!p.privatePaths.includes('profiles/alice2'));
    } else assert.throws(()=>makeDeletionPlan('alice',request,f));
  }
  assert.throws(()=>makeDeletionPlan('alice',{},fixture()),/missing_verified_request/);
  assert.throws(()=>makeDeletionPlan('alice/other',request,fixture()),/invalid_uid/);
});
test('simulation deletes only local fixture data, shared content and audit remain',async()=>{
  const f=fixture(),journal={completed:[]};
  const out=await runDeletionSimulation({uid:'alice',request,fixture:f,journal});
  assert.equal(out.status,'simulation_finished_not_production');
  assert.equal(out.userDataDeletedInProduction,false);
  assert.equal(out.phasesCompleted,SIMULATION_PHASES.length);
  assert.equal(f.authUids.has('alice'),false);
  assert.equal(f.authUids.has('bob'),true);
  assert.ok(f.documents.some(x=>x.path==='users/bob/notifications/n2'));
  assert.ok(f.documents.some(x=>x.path==='posts/post_alice'));
  assert.ok(f.documents.some(x=>x.path==='posts/post_alice/replies/reply_bob'));
  assert.ok(f.documents.some(x=>x.path==='account_deletion_requests/alice'));
  assert.ok(f.documents.some(x=>x.path==='reports/report_1'));
  assert.ok(!f.documents.some(x=>x.path==='users/alice'));
  assert.ok(!f.documents.some(x=>x.path==='users/alice/notifications/n1'));
  assert.deepEqual(f.media,[{publicId:'atrio-avatares/bob/photo2',ownerUid:'bob'}]);
  assert.deepEqual(f.pushTokens,[{tokenId:'token_bob',ownerUid:'bob'}]);
  const duplicate=await runDeletionSimulation({uid:'alice',request,fixture:f,journal});
  assert.equal(duplicate.phasesCompleted,SIMULATION_PHASES.length);
});
test('interruption after data step can resume without premature auth removal',async()=>{
  const f=fixture(),journal={completed:[]};
  await assert.rejects(
    runDeletionSimulation({uid:'alice',request,fixture:f,journal,
      failAfter:'simulate_recursive_firestore_cleanup'}),
    /simulated_interruption/
  );
  assert.equal(f.authUids.has('alice'),true);
  assert.ok(journal.completed.includes('simulate_cloudinary_cleanup'));
  assert.ok(!journal.completed.includes('simulate_recursive_firestore_cleanup'));
  const out=await runDeletionSimulation({uid:'alice',request,fixture:f,journal});
  assert.equal(out.status,'simulation_finished_not_production');
  assert.equal(f.authUids.has('alice'),false);
});
test('incomplete private data blocks even simulated auth stage',async()=>{
  const f=fixture(),journal={completed:[]};
  // Simulate a data record that appeared after inventory snapshot.
  await assert.rejects(runDeletionSimulation({
    uid:'alice',request,fixture:f,journal,
    failAfter:'simulate_cloudinary_cleanup'
  }),/simulated_interruption/);
  f.documents.push({path:'users/alice/newNested/x',ownerUid:'alice'});
  await assert.rejects(runDeletionSimulation({uid:'alice',request,fixture:f,journal}),
    /orphan_private_data_before_auth/);
  assert.equal(f.authUids.has('alice'),true);
});
test('rejects any production-like fixture and mixed user checkpoint',async()=>{
  const f=fixture();
  await assert.rejects(runDeletionSimulation({uid:'alice',request,fixture:{},journal:{completed:[]}}),
    /synthetic_fixture_required/);
  await assert.rejects(runDeletionSimulation({uid:'alice',request,fixture:f,
    journal:{uid:'bob',completed:[]}}),/checkpoint_uid_mismatch/);
  await assert.rejects(runDeletionSimulation({uid:'alice',request:{},fixture:f,
    journal:{completed:[]}}),/missing_verified_request/);
});
test('all review classes remain categorised for manual decisions',()=>{
  assert.equal(reviewReason('reports/r1'),'moderation_legal_retention');
  assert.equal(reviewReason('guardian_cases/case'),'moderation_legal_retention');
  assert.equal(reviewReason('posts/post'),'shared_posts_and_nested_replies');
  assert.equal(reviewReason('account_deletion_requests/alice'),'request_audit_retention');
});
