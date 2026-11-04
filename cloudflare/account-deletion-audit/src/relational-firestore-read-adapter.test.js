import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelationalFirestoreReadAdapter} from './relational-firestore-read-adapter.js';
import {RELATIONAL_QUERY_SPECS} from './relational-inventory.js';

const UID='qa_delete_alice', OAUTH='A'.repeat(48);
const ROOT='projects/atrio-catolico/databases/(default)/documents/';
const READ_TIME='2026-11-01T14:30:00Z';
const SPEC=RELATIONAL_QUERY_SPECS.find(x=>x.id==='notifications_actor');
function doc(id,overrides={}) {
  return {document:{name:ROOT+'users/qa_delete_bob/notifications/'+id,
    fields:{actorUid:{stringValue:UID}}},readTime:READ_TIME,...overrides};
}
function mock(data,status=200) {
  return createRelationalFirestoreReadAdapter(UID,OAUTH,
    async()=>new Response(JSON.stringify(data),{status}));
}

test('read-only structuredQuery REST contract, pages and projections',async()=>{
  const calls=[];
  const pages=[[doc('note01'),doc('note02')],
    [doc('note03'),{readTime:READ_TIME,done:true}]];
  const adapter=createRelationalFirestoreReadAdapter(UID,OAUTH,
    async(url,options)=>{calls.push({url,options});
      return new Response(JSON.stringify(pages.shift()),{status:200});
    });
  const first=await adapter.queryPage(SPEC,UID,null,2);
  assert.deepEqual(first.items[0],{
    path:'users/qa_delete_bob/notifications/note01',
    fields:{actorUid:UID}});
  assert.equal(first.nextPageToken,ROOT+'users/qa_delete_bob/notifications/note02');
  const last=await adapter.queryPage(SPEC,UID,first.nextPageToken,2);
  assert.equal(last.items.length,1);
  assert.equal(last.nextPageToken,null);
  for(const {url,options} of calls){
    assert.equal(url,'https://firestore.googleapis.com/v1/'+ROOT.slice(0,-1)+':runQuery');
    assert.equal(options.method,'POST');
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+OAUTH);
    const q=JSON.parse(options.body).structuredQuery;
    assert.deepEqual(q.select.fields,[{fieldPath:'actorUid'}]);
    assert.deepEqual(q.where.fieldFilter.value,{stringValue:UID});
    assert.equal(q.from[0].allDescendants,true);
    assert.equal(q.from[0].collectionId,'notifications');
    assert.equal(q.orderBy[0].field.fieldPath,'__name__');
    assert.equal(q.limit,2);
  }
  assert.deepEqual(JSON.parse(calls[1].options.body).structuredQuery.startAt.values,
    [{referenceValue:first.nextPageToken}]);
});

test('valid empty Firestore response never claims global coverage',async()=>{
  for(const response of [[{readTime:READ_TIME}],
      [{readTime:READ_TIME,done:true}]]) {
    const result=await mock(response).queryPage(SPEC,UID);
    assert.deepEqual(result,{items:[],nextPageToken:null});
    assert.equal(result.safeToExecute,undefined);
  }
});

test('fail closed on skipped, incomplete, invalid or unsolicited envelopes',async()=>{
  const bad=[
    [doc('n1',{skippedResults:1})],
    [doc('n1',{skippedResults:'1'})],
    [doc('n1',{done:false})],
    [doc('n1',{done:true}),doc('n2')],
    [doc('n1'),{readTime:READ_TIME},doc('n2')],
    [doc('n1',{transaction:'fixture'})],
    [doc('n1',{explainMetrics:{}})],
    [doc('n1',{readTime:null})],
    [doc('n1',{readTime:'not-a-date'})],
    [{readTime:READ_TIME,done:false}]
  ];
  for(const rows of bad)
    await assert.rejects(mock(rows).queryPage(SPEC,UID),
      /untrusted_query_envelope|unexpected_empty_query_envelope/);
});

test('reject foreign records, added private data and unstable ordering',async()=>{
  for(const rows of [
    [doc('n1',{document:{name:ROOT+'users/bob/notifications/n1',
      fields:{actorUid:{stringValue:'bob'}}}})],
    [doc('n1',{document:{name:ROOT+'profiles/qa_delete_alice',
      fields:{actorUid:{stringValue:UID}}}})],
    [doc('n1',{document:{name:ROOT+'users/bob/notifications/n1',
      fields:{actorUid:{stringValue:UID},body:{stringValue:'private'}}}})],
    [doc('n2'),doc('n1')],
    [doc('n1'),doc('n1')]
  ])await assert.rejects(mock(rows).queryPage(SPEC,UID),
    /unexpected_query_document|out_of_order_query_response/);
});

test('reject unapproved spec, other UID, dangerous cursor before HTTP',async()=>{
  let calls=0;
  const a=createRelationalFirestoreReadAdapter(UID,OAUTH,async()=>{
    calls++;return new Response(JSON.stringify([{readTime:READ_TIME}]),{status:200});
  });
  await assert.rejects(a.queryPage({...SPEC,field:'otherUid'},UID),
    /disallowed_query_spec/);
  await assert.rejects(a.queryPage(SPEC,'otherUid'),/invalid_query_parameters/);
  await assert.rejects(a.queryPage(SPEC,UID,'profiles/alice'),/invalid_query_parameters/);
  await assert.rejects(a.queryPage(SPEC,UID,null,101),/invalid_query_parameters/);
  assert.equal(calls,0);
  assert.throws(()=>createRelationalFirestoreReadAdapter(UID,'fake',async()=>{}),
    /invalid_oauth_token/);
});

test('reject unavailable, malformed, oversized responses',async()=>{
  const unavailable=createRelationalFirestoreReadAdapter(UID,OAUTH,async()=>({
    status:403,text:async()=>''}));
  await assert.rejects(unavailable.queryPage(SPEC,UID),/firestore_query_unavailable/);
  await assert.rejects(mock({document:doc('n1').document}).queryPage(SPEC,UID),
    /invalid_query_response/);
  await assert.rejects(mock([doc('n1'),doc('n2')]).queryPage(SPEC,UID,null,1),
    /invalid_query_response/);
  await assert.rejects(mock([{readTime:READ_TIME,extra:'é'.repeat(1_100_000)}])
    .queryPage(SPEC,UID),/firestore_response_too_large/);
});
