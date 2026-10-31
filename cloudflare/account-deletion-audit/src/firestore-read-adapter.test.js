import test from 'node:test';
import assert from 'node:assert/strict';
import {createFirestoreReadAdapter} from './firestore-read-adapter.js';
import {inventoryOwnedDocuments} from './owned-inventory.js';

const uid='alice_123';
const token='dummy-oauth-token'.repeat(6);
const ROOT='projects/atrio-catolico/databases/(default)/documents/';
const json=(data,status=200)=>new Response(JSON.stringify(data),{status});

test('only authorized root document paths may be read',async()=>{
  const seen=[];
  const adapter=createFirestoreReadAdapter(uid,token,async(url,opts)=>{
    seen.push({url,opts});
    return json({name:ROOT+'profiles/'+uid});
  });
  assert.equal(await adapter.getDocument('profiles/'+uid),true);
  assert.equal(seen[0].opts.method,'GET');
  assert.equal(seen[0].opts.redirect,'error');
  assert.equal(seen[0].opts.headers.Authorization,'Bearer '+token);
  assert.ok(seen[0].url.startsWith('https://firestore.googleapis.com/'));
  await assert.rejects(adapter.getDocument('profiles/bob'),/disallowed_doc_path/);
  await assert.rejects(adapter.getDocument('app_config/founder'),/disallowed_doc_path/);
  assert.equal(seen.length,1);
});
test('missing parent document is not confused with missing children',async()=>{
  const queries=[];
  const adapter=createFirestoreReadAdapter(uid,token,async(url)=>{
    queries.push(url);
    if(url.includes('users/'+uid+'/notifications?')) return json({
      documents:[{name:ROOT+'users/'+uid+'/notifications/notice1',
        fields:{email:{stringValue:'private@do-not-return.invalid'}}}]
    });
    if(url.endsWith('/'+uid)) return new Response('',{status:404});
    return json({});
  });
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.ok(result.documents.some(x=>x.path==='users/'+uid+'/notifications/notice1'));
  assert.equal(result.pagesComplete,false);
  assert.ok(!JSON.stringify(result).includes('private@do-not-return.invalid'));
});
test('paginates Firestore collections without exposing fields',async()=>{
  const urls=[];
  const adapter=createFirestoreReadAdapter(uid,token,async url=>{
    urls.push(url);
    if(url.includes('pageToken=next')) return json({
      documents:[{name:ROOT+'users/'+uid+'/notifications/n2',fields:{text:{stringValue:'private'}}}]
    });
    return json({documents:[{name:ROOT+'users/'+uid+'/notifications/n1'}],
      nextPageToken:'next'});
  });
  const page1=await adapter.listPage('users/'+uid+'/notifications',null,100);
  const page2=await adapter.listPage('users/'+uid+'/notifications',page1.nextPageToken,100);
  assert.deepEqual(page1.paths,['users/'+uid+'/notifications/n1']);
  assert.deepEqual(page2.paths,['users/'+uid+'/notifications/n2']);
  assert.equal(JSON.stringify(page2).includes('private'),false);
  assert.ok(urls[1].includes('pageToken=next'));
});
test('rejects unauthorized collection paths and page parameters without network',async()=>{
  const fetcher=async()=>{throw Error('must_not_fetch');};
  const adapter=createFirestoreReadAdapter(uid,token,fetcher);
  for(const path of ['users/bob/notifications','posts','guardian_runtime/global',
                     'users/alice_123/unknownCollection']) {
    await assert.rejects(adapter.listPage(path),/disallowed_collection_query/);
  }
  await assert.rejects(adapter.listPage('users/'+uid+'/likedPosts',null,101),/disallowed_collection_query/);
  await assert.rejects(adapter.listPage('users/'+uid+'/likedPosts','not?token',100),/disallowed_collection_query/);
});
test('unexpected other-user response cannot become part of inventory',async()=>{
  const adapter=createFirestoreReadAdapter(uid,token,async()=>json({
    documents:[{name:ROOT+'users/bob/notifications/personal'}]
  }));
  await assert.rejects(adapter.listPage('users/'+uid+'/notifications'),/unexpected_firestore_resource/);
});
test('HTTP errors and malformed payloads are rejected',async()=>{
  const address='users/'+uid+'/notifications';
  const offline=createFirestoreReadAdapter(uid,token,async()=>new Response('',{status:503}));
  await assert.rejects(offline.listPage(address),/firestore_read_failed/);
  const malformed=createFirestoreReadAdapter(uid,token,async()=>new Response('NOT JSON',{status:200}));
  await assert.rejects(malformed.listPage(address),/invalid_firestore_response/);
  const wrong=createFirestoreReadAdapter(uid,token,async()=>json({documents:'not_array'}));
  await assert.rejects(wrong.listPage(address),/invalid_firestore_response/);
  const tooLarge=createFirestoreReadAdapter(uid,token,async()=>new Response('x'.repeat(2_000_001),{status:200}));
  await assert.rejects(tooLarge.listPage(address),/firestore_response_too_large/);
});
test('the adapter never accepts arbitrary projects or raw missing credentials',()=>{
  assert.throws(()=>createFirestoreReadAdapter('../bob',token),/invalid_uid/);
  assert.throws(()=>createFirestoreReadAdapter(uid,''),/invalid_oauth_token/);
  assert.throws(()=>createFirestoreReadAdapter(uid,token+'\n'),/invalid_oauth_token/);
  assert.throws(()=>createFirestoreReadAdapter(uid,token,null),/invalid_read_transport/);
});
