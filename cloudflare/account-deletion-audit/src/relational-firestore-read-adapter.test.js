import test from 'node:test';
import assert from 'node:assert/strict';
import {createRelationalFirestoreReadAdapter} from './relational-firestore-read-adapter.js';
import {RELATIONAL_QUERY_SPECS,discoverRelationalCandidates} from './relational-inventory.js';

const uid='alice_123';
const token='ya29.valid_test_oauth_token_for_qa';
const root='projects/atrio-catolico/databases/(default)/documents';
const doc=(path,field,owner=uid,extra={})=>({
  document:{name:root+'/'+path,fields:{[field]:{stringValue:owner},...extra}}
});
const response=entries=>new Response(JSON.stringify(entries),{status:200});
const posts=RELATIONAL_QUERY_SPECS.find(x=>x.id==='owned_posts');

test('uses only hardcoded project, group, equality, field projection and order',async()=>{
  const log=[];
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async(url,opts)=>{
    log.push({url,opts});
    return response([doc('posts/post_1','uid')]);
  });
  const items=await adapter.queryPage(posts,uid);
  assert.deepEqual(items.items,[{path:'posts/post_1',fields:{uid}}]);
  assert.equal(items.nextPageToken,null);
  assert.equal(log[0].url,'https://firestore.googleapis.com/v1/'+root+':runQuery');
  assert.equal(log[0].opts.method,'POST');
  assert.equal(log[0].opts.redirect,'error');
  assert.equal(log[0].opts.headers.Authorization,'Bearer '+token);
  const q=JSON.parse(log[0].opts.body).structuredQuery;
  assert.deepEqual(q.from,[{collectionId:'posts',allDescendants:true}]);
  assert.deepEqual(q.select.fields,[{fieldPath:'uid'}]);
  assert.equal(q.where.fieldFilter.op,'EQUAL');
  assert.equal(q.where.fieldFilter.value.stringValue,uid);
  assert.deepEqual(q.orderBy,[{field:{fieldPath:'__name__'},direction:'ASCENDING'}]);
  assert.equal(q.limit,100);
});
test('pagination cursor is a verified Firestore path, not arbitrary URL',async()=>{
  const log=[];
  const first=Array.from({length:100},(_,i)=>doc('posts/post_'+String(i).padStart(3,'0'),'uid'));
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async(url,opts)=>{
    const query=JSON.parse(opts.body).structuredQuery;
    log.push(query);
    return response(log.length===1?first:[doc('posts/post_101','uid')]);
  });
  const page1=await adapter.queryPage(posts,uid);
  assert.equal(page1.items.length,100);
  assert.equal(page1.nextPageToken,root+'/posts/post_099');
  const page2=await adapter.queryPage(posts,uid,page1.nextPageToken);
  assert.equal(page2.items.length,1);
  assert.equal(page2.nextPageToken,null);
  assert.deepEqual(log[1].startAt,{
    values:[{referenceValue:root+'/posts/post_099'}],before:false
  });
});
test('exact cursor rejects other projects, collections or user-supplied URLs',async()=>{
  let called=false;
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async()=>{
    called=true;throw Error('should_not_call');
  });
  for(const cursor of ['https://evil.example/a',root+'/profiles/other',
    'projects/other/databases/(default)/documents/posts/id',
    root+'/posts/x/replies/y','!illegal']) {
    await assert.rejects(adapter.queryPage(posts,uid,cursor),/invalid_query_parameters/);
  }
  await assert.rejects(adapter.queryPage(posts,'bob'),/invalid_query_parameters/);
  await assert.rejects(adapter.queryPage({...posts,field:'ownerUid'},uid),
    /disallowed_query_spec/);
  await assert.rejects(adapter.queryPage(posts,uid,null,1000),/invalid_query_parameters/);
  assert.equal(called,false);
});
test('rejects wrong UID even if query service claims equality',async()=>{
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async()=>
    response([doc('posts/post_1','uid','bob')]));
  await assert.rejects(adapter.queryPage(posts,uid),/unexpected_query_document/);
});
test('rejects leaked private body, email or FCM token in query response',async()=>{
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async()=>
    response([doc('posts/post_1','uid',uid,{body:{stringValue:'private'}})]));
  await assert.rejects(adapter.queryPage(posts,uid),/unexpected_query_document/);
});
test('rejects duplicate, unsorted paths and incorrect collection nesting',async()=>{
  for(const rows of [
    [doc('posts/post_2','uid'),doc('posts/post_1','uid')],
    [doc('posts/post_1','uid'),doc('posts/post_1','uid')],
    [doc('posts/post_1/replies/reply_1','uid')]
  ]) {
    const adapter=createRelationalFirestoreReadAdapter(uid,token,async()=>response(rows));
    await assert.rejects(adapter.queryPage(posts,uid),
      /out_of_order_query_response|unexpected_query_document/);
  }
});
test('empty Firestore envelopes are valid but malformed responses fail',async()=>{
  const a=createRelationalFirestoreReadAdapter(uid,token,async()=>response([{readTime:'2026-10-31T00:00:00Z'}]));
  assert.deepEqual((await a.queryPage(posts,uid)).items,[]);
  const b=createRelationalFirestoreReadAdapter(uid,token,async()=>response([{},{}]));
  await assert.rejects(b.queryPage(posts,uid),/unexpected_empty_query_envelope/);
  const c=createRelationalFirestoreReadAdapter(uid,token,async()=>new Response('NOT JSON',{status:200}));
  await assert.rejects(c.queryPage(posts,uid),/invalid_query_response/);
});
test('HTTP errors, missing token and oversized responses are rejected',async()=>{
  assert.throws(()=>createRelationalFirestoreReadAdapter(uid,'bad'),/invalid_oauth_token/);
  assert.throws(()=>createRelationalFirestoreReadAdapter('x/evil',token),/invalid_uid/);
  const a=createRelationalFirestoreReadAdapter(uid,token,async()=>new Response('',{status:503}));
  await assert.rejects(a.queryPage(posts,uid),/firestore_query_unavailable/);
  const b=createRelationalFirestoreReadAdapter(uid,token,async()=>new Response('x'.repeat(2_000_001)));
  await assert.rejects(b.queryPage(posts,uid),/firestore_response_too_large/);
});
test('full simulated relational discovery integrates with REST adapter but remains blocked',async()=>{
  const adapter=createRelationalFirestoreReadAdapter(uid,token,async(url,opts)=>{
    const q=JSON.parse(opts.body).structuredQuery;
    if(q.from[0].collectionId==='posts') return response([doc('posts/post_1','uid')]);
    return response([{readTime:'2026-10-31T00:00:00Z'}]);
  });
  const result=await discoverRelationalCandidates(uid,adapter);
  assert.equal(result.findings.length,1);
  assert.equal(result.findings[0].path,'posts/post_1');
  assert.equal(result.globalCoverageComplete,false);
  assert.equal(result.safeToExecute,false);
});
