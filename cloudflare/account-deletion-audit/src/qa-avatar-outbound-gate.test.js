import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectQaAvatarOutbound,withQaAvatarOutboundGate,
  QA_AVATAR_OUTBOUND_READINESS} from './qa-avatar-outbound-gate.js';
const A='qa-freeze-alice',B='qa-freeze-bob';
const scope={ownerUid:A,actorUid:B};
const id=uid=>'atrio-avatares/'+uid+'/123e4567-e89b-42d3-a456-426614174000';
const cloud='https://api.cloudinary.com/v1_1/qa-cloud/';
const firestore='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/';
function signed(action,uid=A,alter={}){
  const data=new FormData();
  for(const [k,v] of Object.entries({
    public_id:id(uid),timestamp:'1793468400',
    signature:'fake-signed-request',api_key:'fake-key',
    ...alter
  }))data.append(k,v);
  return {url:cloud+'image/'+action,init:{method:'POST',body:data}};
}
test('allow only owner-owned QA Cloudinary upload and destroy paths',()=>{
  const upload=signed('authenticated',A,{overwrite:'false',moderation:'manual'});
  assert.equal(inspectQaAvatarOutbound(upload.url,upload.init,scope),'authenticated');
  const dest=signed('destroy',A,{type:'authenticated',invalidate:'true'});
  assert.equal(inspectQaAvatarOutbound(dest.url,dest.init,scope),'destroy');
  for(const entry of [
    signed('authenticated',B,{overwrite:'false',moderation:'manual'}),
    signed('destroy',B,{type:'authenticated',invalidate:'true'}),
    signed('rename',B,{from_public_id:id(B),to_public_id:id(B),
      type:'authenticated',to_type:'upload',overwrite:'false'}),
    signed('rename',A,{from_public_id:id(A),to_public_id:id(B),
      type:'authenticated',to_type:'upload',overwrite:'false'})
  ])assert.throws(()=>inspectQaAvatarOutbound(entry.url,entry.init,scope),
    /qa_avatar_outbound_(cross_account_media|unapproved_rename)/);
});
test('Firestore photos cannot be written or removed under another UID',()=>{
  const origin=firestore+'profile_photos/';
  assert.equal(inspectQaAvatarOutbound(origin+A,{method:'DELETE'},scope),'photo_remove');
  const valid={fields:{
    photoPublicId:{stringValue:id(A)},
    photoUpdatedAt:{timestampValue:'2026-10-31T15:30:00.000Z'},
    photoUrl:{stringValue:
      'https://res.cloudinary.com/qa-cloud/image/upload/c_fill,w_400/v1/'+id(A)+'.jpg'}
  }};
  assert.equal(inspectQaAvatarOutbound(origin+A,{
    method:'PATCH',body:JSON.stringify(valid)},scope),'photo_publish');
  for(const [url,init] of [
    [origin+B,{method:'DELETE'}],
    [origin+B,{method:'PATCH',body:JSON.stringify(valid)}],
    [origin+A,{method:'PATCH',body:JSON.stringify({...valid,fields:{
      ...valid.fields,photoPublicId:{stringValue:id(B)}
    }})}],
    [origin+A,{method:'PATCH',body:JSON.stringify({...valid,fields:{
      ...valid.fields,photoUrl:{stringValue:'https://evil.invalid/malicious.jpg'}
    }})}]
  ])assert.throws(()=>inspectQaAvatarOutbound(url,init,scope),
    /qa_avatar_outbound_(cross_account_firestore|invalid_firestore_payload)/);
});
test('moderator actions cannot point at other Cloudinary resource or admins account',()=>{
  const moderation=(uid)=>cloud+'resources/image/authenticated/'+id(uid);
  assert.equal(inspectQaAvatarOutbound(moderation(A),{
    method:'POST',body:new URLSearchParams({moderation_status:'approved'})
  },scope),'media_moderation');
  assert.equal(inspectQaAvatarOutbound(firestore+'admins/'+B,{},scope),'moderator_read');
  assert.throws(()=>inspectQaAvatarOutbound(moderation(B),{
    method:'POST',body:new URLSearchParams({moderation_status:'approved'})
  },scope),/qa_avatar_outbound_cross_account_media/);
  assert.throws(()=>inspectQaAvatarOutbound(firestore+'admins/'+A,{},scope),
    /qa_avatar_outbound_cross_account_firestore/);
});
test('QA Avatar only permits injected fake transport, restores fetch after rejection',async()=>{
  const env={
    CLOUDINARY_CLOUD_NAME:'qa-cloud',CLOUDINARY_API_KEY:'fake-key',
    CLOUDINARY_API_SECRET:'fake-secret',FIREBASE_WEB_API_KEY:'qa-fake-web-key',
    FIREBASE_SERVICE_ACCOUNT_JSON:'{}'
  };
  const original=globalThis.fetch;
  let seen=0;
  const transport=async()=>{seen++;return new Response('{}',{status:200});};
  assert.equal(await withQaAvatarOutboundGate({env,scope,transport,
    run:()=>fetch(firestore+'profile_photos/'+A,{method:'DELETE'})
  }).then(x=>x.status),200);
  assert.equal(seen,1);
  assert.equal(globalThis.fetch,original);
  await assert.rejects(withQaAvatarOutboundGate({env,scope,transport,
    run:()=>fetch('https://production.invalid/account',{method:'POST'})
  }),/qa_avatar_outbound_unapproved_network_destination/);
  assert.equal(seen,1);
  assert.equal(globalThis.fetch,original);
  assert.equal(QA_AVATAR_OUTBOUND_READINESS.productionIntegrated,false);
});
test('fake credential guard rejects accidental real Cloudinary configuration',async()=>{
  const env={CLOUDINARY_CLOUD_NAME:'production',
    CLOUDINARY_API_KEY:'secret',CLOUDINARY_API_SECRET:'secret',
    FIREBASE_WEB_API_KEY:'real',FIREBASE_SERVICE_ACCOUNT_JSON:'{}'};
  let run=false;
  await assert.rejects(withQaAvatarOutboundGate({env,scope,
    transport:async()=>{run=true;},
    run:async()=>{run=true;}
  }),/qa_avatar_outbound_unsafe_environment/);
  assert.equal(run,false);
});
