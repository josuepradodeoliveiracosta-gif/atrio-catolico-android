import test from 'node:test';
import assert from 'node:assert/strict';
import {
  discoverRelationalCandidates,summarizeRelationalCandidates,RELATIONAL_QUERY_SPECS
} from './relational-inventory.js';

const uid='alice_123';
const samples={
  owned_posts:[
    {path:'posts/post_1',fields:{uid}},
    {path:'posts/post_2',fields:{uid}}
  ],
  owned_replies:[{path:'posts/post_3/replies/reply_1',fields:{uid}}],
  notifications_actor:[
    {path:'users/bob/notifications/n1',fields:{actorUid:uid}}
  ],
  notifications_mention:[
    {path:'users/bob/notifications/n1',fields:{mentionUid:uid}}
  ],
  notifications_reply_to:[
    {path:'users/clara/notifications/n2',fields:{replyToUid:uid}}
  ],
  reports_reporter:[
    {path:'reports/report_1',fields:{reporterUid:uid}}
  ],
  guardian_cases_owner:[
    {path:'guardian_cases/case_1',fields:{ownerUid:uid}}
  ],
  guardian_cases_reviewer:[],
  guardian_audit_actor:[
    {path:'guardian_audit/audit_1',fields:{actor:uid}}
  ],
  quarantine_owner:[
    {path:'guardiao_quarantine/case_2',fields:{ownerUid:uid}}
  ]
};
const adapter=(rows=samples)=>({
  queryPage:async (spec,queryUid,cursor,limit)=>{
    assert.equal(queryUid,uid);
    assert.equal(limit,100);
    return {items:rows[spec.id]||[],nextPageToken:null};
  }
});

test('scopes include authors, cross-account notifications and moderation records',()=>{
  assert.deepEqual(RELATIONAL_QUERY_SPECS.map(x=>x.id),Object.keys(samples));
  assert.ok(RELATIONAL_QUERY_SPECS.every(x=>x.field && x.path && x.collectionGroup));
});
test('reads references without deleting another user content or moderation evidence',async()=>{
  const result=await discoverRelationalCandidates(uid,adapter());
  assert.equal(result.safeToExecute,false);
  assert.equal(result.globalCoverageComplete,false);
  assert.equal(result.queryPagesScanned,true);
  assert.equal(result.findings.length,9);
  assert.ok(result.findings.every(x=>x.automaticallyDeletable===false));
  const shared=result.findings.find(x=>x.path==='users/bob/notifications/n1');
  assert.deepEqual(shared.matchedQueries,['notifications_actor','notifications_mention']);
  assert.deepEqual(shared.requiresReview,['cross_account_reference']);
  assert.ok(result.unverifiedScopes.includes('orphaned_nested_collections'));
  assert.ok(result.unverifiedScopes.includes('reactions_by_document_id'));
});
test('public summary has aggregate counts and never reveals UID, names or paths',async()=>{
  const result=await discoverRelationalCandidates(uid,adapter());
  const summary=summarizeRelationalCandidates(result);
  assert.deepEqual(summary.groups,{
    author_content:3,cross_account_reference:2,moderation_retention:4
  });
  const json=JSON.stringify(summary);
  for(const secret of ['alice_123','bob','posts/post_1','reports/report_1']) {
    assert.equal(json.includes(secret),false);
  }
  assert.equal(summary.safeToExecute,false);
});
test('missing query adapter and unsafe UID fail before network',async()=>{
  await assert.rejects(discoverRelationalCandidates('alice/bob',adapter()),/invalid_uid/);
  await assert.rejects(discoverRelationalCandidates(uid,{}),/missing_query_adapter/);
});
test('other account data cannot be included even if adapter returns it',async()=>{
  const rows={...samples,owned_posts:[{path:'posts/private',fields:{uid:'bob'}}]};
  await assert.rejects(discoverRelationalCandidates(uid,adapter(rows)),
    /unexpected_relational_candidate/);
});
test('rejects extra private fields, including post text, token, or real email',async()=>{
  const rows={...samples,owned_posts:[{path:'posts/post_1',
    fields:{uid,body:'private text',email:'secret@example.test'}}]};
  await assert.rejects(discoverRelationalCandidates(uid,adapter(rows)),
    /unexpected_relational_candidate/);
});
test('rejects wrong collection path and nested unexpected data',async()=>{
  for(const path of ['profiles/alice_123','posts/x/replies/y/reactions/z',
    'posts/x/replies/y','posts/../../bob','posts/x/extra/y']) {
    const rows={...samples,owned_posts:[{path,fields:{uid}}]};
    await assert.rejects(discoverRelationalCandidates(uid,adapter(rows)),
      /unexpected_relational_candidate/);
  }
});
test('rejects wrong field projection even if UID value matches',async()=>{
  const rows={...samples,notifications_actor:[
    {path:'users/bob/notifications/n1',fields:{mentionUid:uid}}
  ]};
  await assert.rejects(discoverRelationalCandidates(uid,adapter(rows)),
    /unexpected_relational_candidate/);
});
test('duplicate item inside same query is rejected, not silently skipped',async()=>{
  const x={path:'posts/post_1',fields:{uid}};
  const rows={...samples,owned_posts:[x,x]};
  await assert.rejects(discoverRelationalCandidates(uid,adapter(rows)),
    /duplicate_candidate_in_query/);
});
test('paginates a query and rejects repeated page tokens',async()=>{
  const seen=[];
  const paged=adapter();
  paged.queryPage=async (spec,queryUid,cursor,limit)=>{
    seen.push([spec.id,cursor,limit]);
    if(spec.id==='owned_posts') {
      return cursor===null
        ? {items:[{path:'posts/post_1',fields:{uid}}],nextPageToken:'next_1'}
        : {items:[{path:'posts/post_2',fields:{uid}}],nextPageToken:null};
    }
    return {items:[],nextPageToken:null};
  };
  const a=await discoverRelationalCandidates(uid,paged);
  assert.equal(a.findings.length,2);
  assert.deepEqual(seen.slice(0,2),[['owned_posts',null,100],['owned_posts','next_1',100]]);
  paged.queryPage=async spec=>(spec.id==='owned_posts'
    ? {items:[],nextPageToken:'same'} : {items:[],nextPageToken:null});
  await assert.rejects(discoverRelationalCandidates(uid,paged),/invalid_query_cursor/);
});
test('fails closed on response larger than one page, invalid tokens and empty result',async()=>{
  const a=adapter();
  a.queryPage=async()=>({items:Array(101).fill({path:'posts/p',fields:{uid}}),
    nextPageToken:null});
  await assert.rejects(discoverRelationalCandidates(uid,a),/invalid_query_page/);
  a.queryPage=async()=>({items:[],nextPageToken:'!evil'});
  await assert.rejects(discoverRelationalCandidates(uid,a),/invalid_query_cursor/);
  a.queryPage=async()=>({items:'not_array',nextPageToken:null});
  await assert.rejects(discoverRelationalCandidates(uid,a),/invalid_query_page/);
  a.queryPage=async()=>({items:[],nextPageToken:null});
  const empty=await discoverRelationalCandidates(uid,a);
  assert.equal(empty.findings.length,0);
  assert.equal(empty.globalCoverageComplete,false);
});
test('network outage or malformed result aborts entire audit',async()=>{
  const a=adapter();
  a.queryPage=async()=>{throw Error('firestore_connection_lost');};
  await assert.rejects(discoverRelationalCandidates(uid,a),/firestore_connection_lost/);
  const b=adapter();
  b.queryPage=async()=>undefined;
  await assert.rejects(discoverRelationalCandidates(uid,b),/invalid_query_page/);
});
test('unknown or forged summary cannot be treated as complete inventory',()=>{
  assert.throws(()=>summarizeRelationalCandidates({findings:[],
    safeToExecute:true,globalCoverageComplete:true}),/invalid_inventory_result/);
  assert.throws(()=>summarizeRelationalCandidates({findings:[{
    automaticallyDeletable:false,requiresReview:['constructor']
  }],safeToExecute:false,globalCoverageComplete:false,unverifiedScopes:[]}),
    /invalid_inventory_result/);
  assert.throws(()=>summarizeRelationalCandidates({findings:[],
    safeToExecute:false,globalCoverageComplete:false,unverifiedScopes:null}),
    /invalid_inventory_result/);
  assert.throws(()=>summarizeRelationalCandidates({findings:[{
    automaticallyDeletable:true,requiresReview:['author_content']
  }],safeToExecute:false,globalCoverageComplete:false}),/invalid_inventory_result/);
});
