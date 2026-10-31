import test from 'node:test';
import assert from 'node:assert/strict';
import {inventoryOwnedDocuments} from './owned-inventory.js';
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
  assert.ok(visited.includes('guardian_notices/alice_123/items'));
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
