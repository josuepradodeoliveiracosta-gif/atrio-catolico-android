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
    // A auditoria recursiva precisa descobrir o nome da subcoleção
    // antes de listar seus documentos, mesmo se o pai não existir.
    if(url.endsWith('/users/'+uid+':listCollectionIds'))
      return json({collectionIds:['notifications']});
    if(url.endsWith(':listCollectionIds'))return json({});
    if(url.includes('users/'+uid+'/notifications?')) return json({
      documents:[{name:ROOT+'users/'+uid+'/notifications/notice1',
        fields:{email:{stringValue:'private@do-not-return.invalid'}}}]
    });
    if(url.endsWith('/'+uid)) return new Response('',{status:404});
    return json({});
  });
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(result.ownedNestedTreeScanComplete,true);
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
                     'users/alice_123-other/unknownCollection']) {
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

test('getDocument cannot claim ownership from malformed or foreign HTTP 200',async()=>{
  for(const body of [
    {name:ROOT+'profiles/bob'},
    {name:'projects/other/databases/(default)/documents/profiles/'+uid},
    {fields:{displayName:{stringValue:'unverified'}}},
    [],
    {error:'server returned a success status without requested document'}
  ]) {
    const adapter=createFirestoreReadAdapter(uid,token,async()=>json(body));
    await assert.rejects(adapter.getDocument('profiles/'+uid),
      /unexpected_firestore_resource/);
  }
});
test('a page with partial or unknown response metadata is not empty inventory',async()=>{
  for(const body of [
    {unreachable:['projects/atrio-catolico/databases/(default)/documents/users/'+uid]},
    {documents:[],incomplete:true},
    {documents:[],nextPageToken:42},
    [],
    null
  ]) {
    const adapter=createFirestoreReadAdapter(uid,token,async()=>json(body));
    await assert.rejects(adapter.listPage('users/'+uid+'/notifications'),
      /invalid_firestore_response/);
  }
});
test('response byte size limit applies to UTF-8 not JS string length',async()=>{
  const adapter=createFirestoreReadAdapter(uid,token,async()=>json({
    documents:[],unknown:'é'.repeat(1_100_000)
  }));
  await assert.rejects(adapter.listPage('users/'+uid+'/notifications'),
    /firestore_response_too_large/);
});

test('Firestore REST adapter rejects empty or malformed nonterminal cursors',async()=>{
  const address='users/'+uid+'/pushDevices';
  for(const cursor of ['',false,0,'bad token','<>']) {
    const adapter=createFirestoreReadAdapter(uid,token,async()=>json({
      documents:[],nextPageToken:cursor
    }));
    await assert.rejects(adapter.listPage(address),/invalid_firestore_response/);
  }
  const legitimate=createFirestoreReadAdapter(uid,token,async()=>json({
    documents:[],nextPageToken:'valid_opaque_cursor'
  }));
  assert.equal((await legitimate.listPage(address)).nextPageToken,'valid_opaque_cursor');
});

test('read-only discovery enumerates orphaned collections via Firestore listCollectionIds',async()=>{
  const requests=[];
  const adapter=createFirestoreReadAdapter(uid,token,async(url,options)=>{
    requests.push({url,options});
    assert.equal(options.method,'POST'); // Firestore read RPC, not a write.
    assert.equal(options.redirect,'error');
    assert.equal(options.headers.Authorization,'Bearer '+token);
    assert.equal(options.headers['Content-Type'],'application/json');
    const payload=JSON.parse(options.body);
    assert.equal(payload.pageSize,100);
    if(payload.pageToken==='page-2')
      return json({collectionIds:['surpriseOrphan'],nextPageToken:'next-final'});
    if(payload.pageToken==='next-final')
      return json({collectionIds:['pushDevices']});
    return json({collectionIds:['notifications'],nextPageToken:'page-2'});
  });
  const first=await adapter.listChildCollections('users/'+uid);
  const second=await adapter.listChildCollections('users/'+uid,first.nextPageToken);
  const third=await adapter.listChildCollections('users/'+uid,second.nextPageToken);
  assert.deepEqual(first.collectionIds,['notifications']);
  assert.deepEqual(second.collectionIds,['surpriseOrphan']);
  assert.equal(third.nextPageToken,null);
  assert.ok(requests.every(x=>x.url.endsWith(':listCollectionIds')));
});
test('subcollection discovery is limited to exact owner roots with strict response schema',async()=>{
  const address='users/'+uid;
  const adapter=createFirestoreReadAdapter(uid,token,async()=>json({collectionIds:[]}));
  for(const invalid of ['users/bob','users/'+uid+'/pushDevices',
                        'posts/'+uid,'app_config/founder']) {
    await assert.rejects(adapter.listChildCollections(invalid),
      /disallowed_collection_discovery/);
  }
  for(const value of ['',false,0,'bad token','<>']) {
    const broken=createFirestoreReadAdapter(uid,token,async()=>json({
      collectionIds:[],nextPageToken:value
    }));
    await assert.rejects(broken.listChildCollections(address),
      /invalid_firestore_response/);
  }
  for(const payload of [
    {collectionIds:['valid','invalid/part']},
    {collectionIds:['..']},
    {collectionIds:'not-an-array'},
    {collectionIds:[],unreachable:['private']},
    [],
    null
  ]) {
    const broken=createFirestoreReadAdapter(uid,token,async()=>json(payload));
    await assert.rejects(broken.listChildCollections(address),
      /invalid_firestore_(?:response|collection_id)/);
  }
  const missing=createFirestoreReadAdapter(uid,token,async()=>new Response('',{status:503}));
  await assert.rejects(missing.listChildCollections(address),/firestore_discovery_failed/);
});

test('nested owned collections are readable but foreign siblings are denied',async()=>{
  const calls=[];
  const adapter=createFirestoreReadAdapter(uid,token,async(url,options)=>{
    calls.push({url,options});
    if(url.endsWith(':listCollectionIds'))
      return json({collectionIds:['deepChildren']});
    return json({documents:[{name:ROOT+
      'users/'+uid+'/notifications/missingParent/deepChildren/nestedLeaf'}]});
  });
  const parent='users/'+uid+'/notifications/missingParent';
  const child=parent+'/deepChildren';
  assert.deepEqual((await adapter.listChildCollections(parent)).collectionIds,['deepChildren']);
  assert.deepEqual((await adapter.listPage(child)).paths,[child+'/nestedLeaf']);
  assert.ok(calls.find(x=>x.url.includes('showMissing=true')));
  for(const bad of [
    'users/bob/notifications/missingParent/deepChildren',
    'users/'+uid+'/notifications/missingParent/deepChildren/nestedLeaf',
    'users/'+uid+'/notifications/missingParent/deepChildren/nestedLeaf/great/grand/too/deep'
  ]) {
    await assert.rejects(adapter.listPage(bad),/disallowed_collection_query/);
  }
  await assert.rejects(adapter.listChildCollections(
    'users/bob/notifications/hidden'),/disallowed_collection_discovery/);
});
test('nested Firestore listing validates response owner and depth',async()=>{
  const child='users/'+uid+'/notifications/a/deep';
  const foreign=createFirestoreReadAdapter(uid,token,async()=>json({
    documents:[{name:ROOT+'users/bob/notifications/a/deep/z'}]
  }));
  await assert.rejects(foreign.listPage(child),/unexpected_firestore_resource/);
  const missingParent=createFirestoreReadAdapter(uid,token,async(url)=>{
    assert.match(url,/showMissing=true/);
    return json({documents:[{name:ROOT+child+'/orphan'}]});
  });
  assert.deepEqual((await missingParent.listPage(child)).paths,[child+'/orphan']);
});
