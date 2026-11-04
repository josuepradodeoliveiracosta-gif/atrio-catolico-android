import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryOwnedDocuments,discoverOwnedSubcollectionIds,discoverOwnedNestedDocuments}
  from './owned-inventory.js';
import {buildDeletionPlan} from './deletion-orchestrator.js';

const uid='alice_123';
const makeAdapter=({present=new Set(['profiles/alice_123']),
pages={}}={})=>({
  getDocument:async path=>present.has(path),
  listPage:async (collection,cursor,pageSize)=>{
    assert.equal(pageSize,100);
    return pages[collection]?.[cursor||'start'] || {paths:[],nextPageToken:null};
  }
});

test('enumerates direct account paths without inspecting document contents',async()=>{
  const adapter=makeAdapter({
    pages:{
      'users/alice_123/notifications':{
        start:{paths:['users/alice_123/notifications/a'],nextPageToken:'next'},
        next:{paths:['users/alice_123/notifications/b'],nextPageToken:null}
      },
      'guardian_notices/alice_123/items':{
        start:{paths:['guardian_notices/alice_123/items/c'],nextPageToken:null}
      }
    }
  });
  const out=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(out.directReadCompleted,true);
  assert.deepEqual(out.documents.map(x=>x.path).sort(),[
    'profiles/alice_123',
    'users/alice_123/notifications/a',
    'users/alice_123/notifications/b',
    'guardian_notices/alice_123/items/c'
  ].sort());
  assert.equal(out.pagesComplete,false);
  assert.equal(out.hasUnknownCollections,true);
  const review=buildDeletionPlan(uid,{fields:{status:{stringValue:'requested'}}},
    out,{identityVerified:true,retentionReviewed:true,operatorApproved:true});
  assert.equal(review.safeToExecute,false);
  assert.ok(review.blockers.includes('incomplete_pagination'));
});
test('subcollections are scanned even when parent document is absent',async()=>{
  let visited=[];
  const adapter={
    getDocument:async()=>false,
    listPage:async(collection)=>{visited.push(collection);return {paths:[],nextPageToken:null};}
  };
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(result.documents.length,0);
  assert.ok(visited.includes('users/alice_123/pushDevices'));
  assert.ok(visited.includes('users/alice_123/blockedMembers'));
  assert.ok(visited.includes('users/alice_123/acceptedTerms'));
  assert.ok(visited.includes('guardian_notices/alice_123/items'));
});
test('audits UGC block lists and consent records without any delete operation',async()=>{
  const out=await inventoryOwnedDocuments(uid,makeAdapter({pages:{
    'users/alice_123/blockedMembers':{start:{paths:[
      'users/alice_123/blockedMembers/blocked_1'],nextPageToken:null}},
    'users/alice_123/acceptedTerms':{start:{paths:[
      'users/alice_123/acceptedTerms/ugc-v1'],nextPageToken:null}}
  }}));
  assert.ok(out.documents.some(d=>d.path==='users/alice_123/blockedMembers/blocked_1'));
  assert.ok(out.documents.some(d=>d.path==='users/alice_123/acceptedTerms/ugc-v1'));
  assert.equal(out.pagesComplete,false);
});

test('does not accept paths of another account or nested unexpected collection',async()=>{
  const cases=['users/bob/notifications/x','users/alice_123/notifications/x/secret/y',
    '../users/alice_123/notifications/x','users/alice_123/likedPosts/x'];
  for(const path of cases) {
    const adapter=makeAdapter({pages:{'users/alice_123/notifications':{
      start:{paths:[path],nextPageToken:null}
    }}});
    await assert.rejects(inventoryOwnedDocuments(uid,adapter),/unexpected_collection_document/);
  }
});
test('a cursor repeated across pages cannot create an infinite loop',async()=>{
  const adapter=makeAdapter({pages:{'users/alice_123/savedPosts':{
    start:{paths:['users/alice_123/savedPosts/a'],nextPageToken:'same'},
    same:{paths:['users/alice_123/savedPosts/b'],nextPageToken:'same'}
  }}});
  await assert.rejects(inventoryOwnedDocuments(uid,adapter),/invalid_page_token/);
});
test('same document returned on different pages is a hard failure',async()=>{
  const path='users/alice_123/likedPosts/a';
  const adapter=makeAdapter({pages:{'users/alice_123/likedPosts':{
    start:{paths:[path],nextPageToken:'next'},
    next:{paths:[path],nextPageToken:null}
  }}});
  await assert.rejects(inventoryOwnedDocuments(uid,adapter),/duplicate_document/);
});
test('oversized response and malformed cursor are rejected',async()=>{
  const many=Array.from({length:101},(_,i)=>'users/alice_123/notifications/n'+i);
  const a=makeAdapter({pages:{'users/alice_123/notifications':{
    start:{paths:many,nextPageToken:null}
  }}});
  await assert.rejects(inventoryOwnedDocuments(uid,a),/invalid_page/);
  const b=makeAdapter({pages:{'users/alice_123/notifications':{
    start:{paths:[],nextPageToken:'!@INVALID!'}
  }}});
  await assert.rejects(inventoryOwnedDocuments(uid,b),/invalid_page_token/);
});
test('only an allowlisted uid and read-only adapter are allowed',async()=>{
  await assert.rejects(inventoryOwnedDocuments('../bob',makeAdapter()),/invalid_uid/);
  await assert.rejects(inventoryOwnedDocuments(uid,{}),/missing_read_only_adapter/);
  const a=makeAdapter();
  a.getDocument=async()=>({privateEmail:'not-boolean'});
  await assert.rejects(inventoryOwnedDocuments(uid,a),/invalid_document_response/);
});
test('network failure aborts entire inventory without claiming completion',async()=>{
  const adapter=makeAdapter();
  adapter.listPage=async()=>{throw Error('firestore_unavailable');};
  await assert.rejects(inventoryOwnedDocuments(uid,adapter),/firestore_unavailable/);
});

test('ambiguous pagination metadata never silently ends a deletion inventory',async()=>{
  const base='users/alice_123/pushDevices';
  for(const result of [
    {paths:[]},
    {paths:[],nextPageToken:undefined},
    {paths:[],nextPageToken:false},
    {paths:[],nextPageToken:0},
    {paths:[],nextPageToken:''},
    {paths:[],nextPageToken:{opaque:'cursor'}},
    {paths:[],nextPageToken:null,incomplete:true}
  ]) {
    const adapter=makeAdapter();
    adapter.listPage=async(collection)=>collection===base
      ? result : {paths:[],nextPageToken:null};
    await assert.rejects(inventoryOwnedDocuments(uid,adapter),
      /invalid_page(?:_token)?/);
  }
});
test('explicit null pagination terminator is accepted only as an incomplete QA audit',async()=>{
  const adapter=makeAdapter({
    pages:{'users/alice_123/pushDevices':{
      start:{paths:['users/alice_123/pushDevices/syntheticDevice'],nextPageToken:null}
    }}
  });
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.ok(result.documents.some(d=>d.path==='users/alice_123/pushDevices/syntheticDevice'));
  assert.equal(result.pagesComplete,false);
  assert.equal(result.hasUnknownCollections,true);
});

test('discovers unknown orphaned child collections even when root document is absent',async()=>{
  const visited=[];
  const adapter=makeAdapter({present:new Set()});
  adapter.listChildCollections=async(parent,cursor,pageSize)=>{
    visited.push(parent);
    assert.equal(pageSize,100);
    if(parent==='users/'+uid)return {
      collectionIds:['pushDevices','hiddenLegacy'],nextPageToken:null
    };
    if(parent==='profile_photos/'+uid)return {
      collectionIds:['oldMediaJobs'],nextPageToken:null
    };
    return {collectionIds:[],nextPageToken:null};
  };
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(result.directRootSubcollectionDiscoveryComplete,true);
  assert.equal(result.hasUnknownCollections,true);
  assert.equal(result.hasUnknownDirectSubcollections,true);
  assert.deepEqual(result.unknownDirectSubcollections.sort(),[
    'profile_photos/'+uid+'/oldMediaJobs',
    'users/'+uid+'/hiddenLegacy'
  ].sort());
  assert.ok(visited.includes('profiles/'+uid));
  assert.ok(visited.includes('users/'+uid));
  assert.ok(visited.includes('guardian_notices/'+uid));
  assert.equal(result.pagesComplete,false);
});
test('known subcollections can be discovered without declaring full deletion ready',async()=>{
  const adapter=makeAdapter();
  adapter.listChildCollections=async()=>({
    collectionIds:['notifications'],nextPageToken:null
  });
  // Some roots have no declared child namespaces: this remains an unknown.
  const blocked=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(blocked.hasUnknownCollections,true);
  assert.equal(blocked.hasUnknownDirectSubcollections,true);
  adapter.listChildCollections=async(parent)=>({
    collectionIds:parent==='users/'+uid?['pushDevices','notifications']:[],
    nextPageToken:null
  });
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(result.hasUnknownDirectSubcollections,false);
  assert.equal(result.directRootSubcollectionDiscoveryComplete,true);
  // Ausência de filhos desconhecidos no nível raiz NÃO exclui netos
  // ou novas coleções legadas sob documentos dos filhos.
  assert.equal(result.hasUnknownCollections,true);
  assert.equal(result.pagesComplete,false);
});
test('unknown subcollection pagination, duplicate IDs and bad metadata fail closed',async()=>{
  const cases=[
    {collectionIds:[]},
    {collectionIds:[],nextPageToken:''},
    {collectionIds:[],nextPageToken:false},
    {collectionIds:['dup','dup'],nextPageToken:null},
    {collectionIds:['bad/slash'],nextPageToken:null},
    {collectionIds:[],nextPageToken:null,incomplete:true}
  ];
  for(const response of cases){
    const adapter={listChildCollections:async()=>response};
    await assert.rejects(discoverOwnedSubcollectionIds(uid,adapter),
      /invalid_subcollection_page|invalid_subcollection_cursor|invalid_or_duplicate_subcollection_id/);
  }
  const adapter={listChildCollections:async(_,cursor)=>({
    collectionIds:[],nextPageToken:cursor||'repeat'
  })};
  await assert.rejects(discoverOwnedSubcollectionIds(uid,adapter),
    /invalid_subcollection_cursor/);
});

test('recursive owned audit traverses grandchildren and missing document parents',async()=>{
  const lists=new Map([
    ['users/'+uid,['notifications']],
    ['users/'+uid+'/notifications/missing',['hiddenChild']],
    ['users/'+uid+'/notifications/missing/hiddenChild/deep',['leaf']]
  ]);
  const documents=new Map([
    ['users/'+uid+'/notifications',['users/'+uid+'/notifications/missing']],
    ['users/'+uid+'/notifications/missing/hiddenChild',[
      'users/'+uid+'/notifications/missing/hiddenChild/deep']],
    ['users/'+uid+'/notifications/missing/hiddenChild/deep/leaf',[
      'users/'+uid+'/notifications/missing/hiddenChild/deep/leaf/final']]
  ]);
  const visited=[];
  const adapter={
    getDocument:async()=>false,
    listChildCollections:async(parent)=>({
      collectionIds:lists.get(parent)||[],nextPageToken:null
    }),
    listPage:async(name)=>{
      visited.push(name);
      return {paths:documents.get(name)||[],nextPageToken:null};
    }
  };
  const result=await inventoryOwnedDocuments(uid,adapter);
  assert.equal(result.ownedNestedTreeScanComplete,true);
  assert.equal(result.nestedOwnedCollectionCount,2);
  assert.equal(result.pagesComplete,false);
  assert.equal(result.hasUnknownCollections,true);
  assert.deepEqual(result.documents.map(x=>x.path),[
    'users/'+uid+'/notifications/missing',
    'users/'+uid+'/notifications/missing/hiddenChild/deep',
    'users/'+uid+'/notifications/missing/hiddenChild/deep/leaf/final'
  ]);
  assert.ok(visited.includes('users/'+uid+'/notifications/missing/hiddenChild'));
});
test('deep traversal rejects malformed nested cursor before treating tree as complete',async()=>{
  const topology=await discoverOwnedSubcollectionIds(uid,{
    listChildCollections:async parent=>({
      collectionIds:parent==='users/'+uid?['notifications']:[],
      nextPageToken:null
    })
  });
  const adapter={
    listPage:async name=>({
      paths:name==='users/'+uid+'/notifications'?
        ['users/'+uid+'/notifications/a']:[],nextPageToken:null
    }),
    listChildCollections:async parent=>parent==='users/'+uid+'/notifications/a'?
      {collectionIds:[],nextPageToken:''}:
      {collectionIds:[],nextPageToken:null}
  };
  await assert.rejects(discoverOwnedNestedDocuments(uid,adapter,topology),
    /invalid_nested_subcollection_cursor/);
});
test('no recursive audit may proceed past depth or ownership bounds',async()=>{
  const topology=await discoverOwnedSubcollectionIds(uid,{
    listChildCollections:async parent=>({
      collectionIds:parent==='users/'+uid?['notifications']:[],
      nextPageToken:null
    })
  });
  const adapter={
    listPage:async name=>({
      paths:[name+'/a'],nextPageToken:null
    }),
    listChildCollections:async()=>({
      collectionIds:['nested'],nextPageToken:null
    })
  };
  await assert.rejects(discoverOwnedNestedDocuments(uid,adapter,topology),
    /nested_depth_limit/);
  const invalid={
    ...adapter,
    listPage:async name=>({
      paths:[name.replace('users/'+uid,'users/bob')+'/a'],nextPageToken:null
    })
  };
  await assert.rejects(discoverOwnedNestedDocuments(uid,invalid,topology),
    /unexpected_collection_document/);
});
