import {test} from 'node:test';
import assert from 'node:assert/strict';
import {repliesQueryPreview,probeQaRepliesIndex} from './qa-query-probe.js';
const PROJECT='atrio-catolico-qa-v2';
const TOKEN='a'.repeat(48);
const args={project:PROJECT,approved:PROJECT,accessToken:TOKEN,now:Date.parse('2026-10-29T20:00:00Z')};
test('QA Firestore planner query has exact index shape and no user fields',()=>{
 const q=repliesQueryPreview(args.now).structuredQuery;
 assert.deepEqual(q.select,{fields:[{fieldPath:'__name__'}]});
 assert.deepEqual(q.from,[{collectionId:'replies',allDescendants:true}]);
 assert.equal(q.limit,1);
 assert.deepEqual(q.orderBy.map(x=>x.field.fieldPath),['createdAt','__name__']);
 assert.ok(q.orderBy.every(x=>x.direction==='DESCENDING'));
 assert.equal(q.where.compositeFilter.filters.length,2);
 assert.equal(q.where.compositeFilter.filters[0].fieldFilter.value.timestampValue,'2026-10-29T19:40:00.000Z');
 assert.equal(q.where.compositeFilter.filters[1].fieldFilter.value.timestampValue,'2026-10-29T20:00:00.000Z');
 const text=JSON.stringify(q);
 assert.ok(!text.includes('body')&&!text.includes('uid')&&!text.includes('title'));
});
test('production project blocked before any network call',async()=>{
 let calls=0;
 const result=await probeQaRepliesIndex({...args,project:'atrio-catolico',
  fetcher:()=>{calls++;throw Error('unauthorized')}});
 assert.deepEqual(result,{status:'blocked'});
 assert.equal(calls,0);
});
test('valid QA probe sends one bounded read query without returning data',async()=>{
 let count=0;
 const result=await probeQaRepliesIndex({...args,fetcher:async(url,options)=>{
  count++;
  assert.equal(url,'https://firestore.googleapis.com/v1/projects/atrio-catolico-qa-v2/databases/(default)/documents:runQuery');
  assert.equal(options.method,'POST');
  assert.equal(options.redirect,'error');
  assert.equal(options.headers.Authorization,'Bearer '+TOKEN);
  assert.equal(JSON.parse(options.body).structuredQuery.limit,1);
  assert.equal(JSON.parse(options.body).structuredQuery.select.fields[0].fieldPath,'__name__');
  return new Response(JSON.stringify([{document:{name:'projects/demo/databases/(default)/documents/posts/test/replies/qa1'}}]),{status:200});
 }});
 assert.deepEqual(result,{status:'query_ok'});
 assert.equal(count,1);
 assert.ok(!JSON.stringify(result).includes('qa1'));
});
test('index not ready, forbidden API and network errors fail closed',async()=>{
 for(const status of [400,401,403,404,409,429,500]){
  const result=await probeQaRepliesIndex({...args,fetcher:async()=>new Response('secret',{status})});
  assert.deepEqual(result,{status:'unavailable'});
 }
 assert.deepEqual(await probeQaRepliesIndex({...args,fetcher:async()=>{throw Error(TOKEN)}}),{status:'unavailable'});
});
test('malformed result, Firestore embedded errors and short token never indicate ready',async()=>{
 assert.deepEqual(await probeQaRepliesIndex({...args,accessToken:'bad'}),{status:'unavailable'});
 assert.deepEqual(await probeQaRepliesIndex({...args,fetcher:async()=>new Response('{}',{status:200})}),{status:'unavailable'});
 assert.deepEqual(await probeQaRepliesIndex({...args,fetcher:async()=>new Response('[{"error":{"code":400}}]',{status:200})}),{status:'unavailable'});
});
