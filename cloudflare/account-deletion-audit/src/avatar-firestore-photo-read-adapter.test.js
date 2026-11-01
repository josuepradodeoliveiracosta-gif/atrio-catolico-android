import test from 'node:test';
import assert from 'node:assert/strict';
import {createAvatarFirestorePhotoReadAdapter} from './avatar-firestore-photo-read-adapter.js';
import {inventoryAvatarMedia} from './avatar-media-inventory.js';

const uid='qa-alice';
const id='atrio-avatares/'+uid+'/123e4567-e89b-42d3-a456-426614174000';
const name='projects/atrio-catolico/databases/(default)/documents/profile_photos/'+uid;
const token='emulated_oauth_token_for_test_only_1234567';
const ok=data=>new Response(JSON.stringify(data),{status:200});

test('exact UID with field mask only, GET only and no redirects',async()=>{
  let calls=0;
  const read=createAvatarFirestorePhotoReadAdapter(uid,token,async(url,opts)=>{
    calls++;
    const u=new URL(url);
    assert.equal(u.hostname,'firestore.googleapis.com');
    assert.ok(u.pathname.endsWith('/profile_photos/'+uid));
    assert.equal(u.searchParams.get('mask.fieldPaths'),'photoPublicId');
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    return ok({name,fields:{photoPublicId:{stringValue:id}}});
  });
  assert.equal(await read.getPublicId(uid),id);
  await assert.rejects(read.getPublicId('qa-bob'),/disallowed_photo_owner/);
  assert.equal(calls,1);
});
test('missing photo record returns null without guessing default',async()=>{
  const read=createAvatarFirestorePhotoReadAdapter(uid,token,async()=>new Response('',{status:404}));
  assert.equal(await read.getPublicId(uid),null);
});
test('wrong account, arbitrary document path, malicious ID fail closed',async()=>{
  for(const record of [
    {name:name.replace(uid,'qa-bob'),fields:{photoPublicId:{stringValue:id}}},
    {name,fields:{photoPublicId:{stringValue:
      'atrio-avatares/qa-bob/123e4567-e89b-42d3-a456-426614174000'}}},
    {name,fields:{photoPublicId:{stringValue:'../../another-user'}}}
  ]){
    const read=createAvatarFirestorePhotoReadAdapter(uid,token,async()=>ok(record));
    await assert.rejects(read.getPublicId(uid),/invalid_photo_response|invalid_photo_reference/);
  }
});
test('never exposes unmasked PII in successful response',async()=>{
  const read=createAvatarFirestorePhotoReadAdapter(uid,token,async()=>ok({
    name,fields:{photoPublicId:{stringValue:id},email:{stringValue:'secret@example.test'}}
  }));
  await assert.rejects(read.getPublicId(uid),/invalid_photo_response/);
});
test('non-200, malformed JSON and overlong responses rejected',async()=>{
  const a=createAvatarFirestorePhotoReadAdapter(uid,token,async()=>new Response('error',{status:503}));
  await assert.rejects(a.getPublicId(uid),/firestore_photo_unavailable/);
  const b=createAvatarFirestorePhotoReadAdapter(uid,token,async()=>new Response('not JSON',{status:200}));
  await assert.rejects(b.getPublicId(uid),/invalid_photo_response/);
  const c=createAvatarFirestorePhotoReadAdapter(uid,token,
    async()=>new Response('x'.repeat(10001),{status:200}));
  await assert.rejects(c.getPublicId(uid),/firestore_photo_response_too_large/);
});
test('malformed OAuth token and invalid UID rejected before any network',()=>{
  assert.throws(()=>createAvatarFirestorePhotoReadAdapter('a/b',token),/invalid_uid/);
  assert.throws(()=>createAvatarFirestorePhotoReadAdapter(uid,'short'),/invalid_oauth_token/);
  assert.throws(()=>createAvatarFirestorePhotoReadAdapter(uid,token,null),/invalid_firestore_transport/);
});
test('Firestore avatar adapter integrates with D1 and Cloudinary inventories',async()=>{
  const photo=createAvatarFirestorePhotoReadAdapter(uid,token,
    async()=>ok({name,fields:{photoPublicId:{stringValue:id}}}));
  const d1={readPage:async()=>({items:[],nextCursor:null})};
  const cloud={readPage:async(_uid,type)=>({
    items:type==='upload'?[{type:'upload',public_id:id}]:[],nextCursor:null
  })};
  const audit=await inventoryAvatarMedia(uid,{d1,cloud,photo});
  assert.equal(audit.summary.publishedFirestore,1);
  assert.equal(audit.summary.missingPublished,0);
  assert.equal(audit.safeToExecute,false);
  assert.equal(audit.globalMediaCoverageComplete,false);
});
