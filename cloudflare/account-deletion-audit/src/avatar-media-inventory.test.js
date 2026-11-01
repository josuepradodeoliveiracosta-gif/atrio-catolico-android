import test from 'node:test';
import assert from 'node:assert/strict';
import {
  inventoryAvatarMedia,summarizeAvatarMedia,validAvatarPublicId,
  AVATAR_D1_SOURCES,AVATAR_CLOUDINARY_TYPES
} from './avatar-media-inventory.js';

const uid='qa-alice',other='qa-bob';
const id='123e4567-e89b-42d3-a456-426614174000';
const id2='123e4567-e89b-42d3-a456-426614174001';
const id3='123e4567-e89b-42d3-a456-426614174002';
const a='atrio-avatares/'+uid+'/'+id,b='atrio-avatares/'+uid+'/'+id2;
const c='atrio-avatares/'+uid+'/'+id3;
const fixture=({pending=[{uid,public_id:a}],rate=[],
  mutex=[],moderation=[],upload=[{type:'upload',public_id:b}],
  authenticated=[{type:'authenticated',public_id:a}],firestore=b}={})=>{
  const rows={
    'avatar_pending:uid':pending,'avatar_rate:uid':rate,
    'avatar_mutex:uid':mutex,'avatar_moderation:actor_uid':
      moderation.filter(x=>x.actor_uid===uid),
    'avatar_moderation:target_uid':moderation.filter(x=>x.target_uid===uid)
  };
  return {
    d1:{readPage:async(table,role,target,cursor,limit)=>{
      assert.equal(target,uid);assert.equal(limit,100);
      return {items:rows[table+':'+role]||[],nextCursor:null};
    }},
    cloud:{readPage:async(target,type,cursor,limit)=>{
      assert.equal(target,uid);assert.equal(limit,100);
      return {items:type==='upload'?upload:authenticated,nextCursor:null};
    }},
    photo:{getPublicId:async target=>{assert.equal(target,uid);return firestore;}}
  };
};
test('known sources cover all four D1 tables and both Cloudinary types',()=>{
  assert.deepEqual(AVATAR_D1_SOURCES.map(x=>x.table).sort(),[
    'avatar_pending','avatar_rate','avatar_mutex','avatar_moderation',
    'avatar_moderation'].sort());
  assert.deepEqual([...AVATAR_CLOUDINARY_TYPES],['upload','authenticated']);
  assert.equal(validAvatarPublicId(uid,a),true);
  assert.equal(validAvatarPublicId(other,a),false);
  assert.equal(validAvatarPublicId(uid,a+'/extra'),false);
});
test('normal pending/authenticated and published/upload are counted, not deletable',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture());
  assert.equal(x.summary.pending,1);
  assert.equal(x.summary.publishedFirestore,1);
  assert.equal(x.summary.cloudinaryPublic,1);
  assert.equal(x.summary.cloudinaryProtected,1);
  assert.deepEqual(x.blockers,[]);
  assert.equal(x.safeToExecute,false);
  assert.equal(x.globalMediaCoverageComplete,false);
  assert.ok(x.unverified.includes('device_local_profile_photos'));
});
test('orphan Cloudinary files are flagged even if no D1 record remains',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({
    pending:[],authenticated:[{type:'authenticated',public_id:a}],
    upload:[{type:'upload',public_id:b},{type:'upload',public_id:c}]
  }));
  assert.equal(x.summary.unreferenced,2);
  assert.ok(x.blockers.includes('unreferenced_cloudinary_assets'));
  const summary=summarizeAvatarMedia(x);
  const str=JSON.stringify(summary);
  for(const hidden of [uid,a,b,c,id,'Cloudinary-secret'])
    assert.equal(str.includes(hidden),false);
});
test('D1 points to missing pending asset',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({authenticated:[]}));
  assert.equal(x.summary.missingPending,1);
  assert.ok(x.blockers.includes('pending_d1_asset_not_found'));
});
test('Firestore points to missing published asset',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({upload:[]}));
  assert.equal(x.summary.missingPublished,1);
  assert.ok(x.blockers.includes('published_firestore_asset_not_found'));
});
test('cross-type confusion cannot permit silent deletion',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({
    upload:[{type:'upload',public_id:a},{type:'upload',public_id:b}],
    authenticated:[{type:'authenticated',public_id:a},{type:'authenticated',public_id:b}]
  }));
  assert.equal(x.summary.conflicts,2);
  assert.ok(x.blockers.includes('same_public_id_in_multiple_delivery_types'));
  assert.ok(x.blockers.includes('pending_asset_exposed_as_upload'));
  assert.ok(x.blockers.includes('published_asset_still_authenticated'));
});
test('moderation cases with another owner require retention review, not deletion',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({moderation:[
    {id:4,actor_uid:uid,target_uid:other},
    {id:5,actor_uid:other,target_uid:uid},
    {id:6,actor_uid:uid,target_uid:uid}
  ]}));
  assert.equal(x.summary.moderationRecords,3);
  assert.ok(x.blockers.includes('moderation_retention_review'));
  assert.equal(summarizeAvatarMedia(x).safeToExecute,false);
});
test('active mutex record is blocker; rate limiter never authorizes deletion',async()=>{
  const x=await inventoryAvatarMedia(uid,fixture({
    mutex:[{uid,expires_at:1760000000000}],
    rate:[{uid,next_at:1760000000000}]
  }));
  assert.ok(x.blockers.includes('avatar_operation_mutex_present'));
  assert.equal(x.summary.rateRecords,1);
  assert.equal(x.summary.mutexRecords,1);
});
test('unexpected cross-account Cloudinary ID is rejected',async()=>{
  const x=fixture({upload:[{type:'upload',public_id:
    'atrio-avatares/'+other+'/'+id}]});
  await assert.rejects(inventoryAvatarMedia(uid,x),/invalid_media_record/);
});
test('unexpected D1 owner and invalid pending ID are rejected',async()=>{
  await assert.rejects(inventoryAvatarMedia(uid,fixture({
    pending:[{uid:other,public_id:a}]
  })),/invalid_media_record/);
  await assert.rejects(inventoryAvatarMedia(uid,fixture({
    pending:[{uid,public_id:'atrio-avatares/'+uid+'/../../other'}]
  })),/invalid_media_record/);
});
test('unexpected Cloudinary types or private metadata are rejected',async()=>{
  await assert.rejects(inventoryAvatarMedia(uid,fixture({
    upload:[{type:'authenticated',public_id:b}]
  })),/invalid_media_record/);
  await assert.rejects(inventoryAvatarMedia(uid,fixture({
    upload:[{type:'upload',public_id:b,secure_url:'private_link'}]
  })),/invalid_media_record/);
});
test('unexpected Firestore photo public ID is rejected',async()=>{
  await assert.rejects(inventoryAvatarMedia(uid,fixture({
    firestore:'atrio-avatares/'+other+'/'+id
  })),/unexpected_firestore_photo/);
});
test('same cloud resource repeated on one or multiple pages is rejected',async()=>{
  const x=fixture();
  x.cloud.readPage=async(_uid,type,cursor)=>({
    items:type==='upload'?[{type:'upload',public_id:b}]:[{type:'authenticated',public_id:a}],
    nextCursor:type==='upload'&&!cursor?'page2':null
  });
  await assert.rejects(inventoryAvatarMedia(uid,x),/repeated_media_record/);
});
test('repeated pagination tokens and invalid cursors fail closed',async()=>{
  const x=fixture();
  x.d1.readPage=async(table,role)=>({
    items:[],nextCursor:table==='avatar_pending'&&role==='uid'?'repeat':null
  });
  await assert.rejects(inventoryAvatarMedia(uid,x),/invalid_media_cursor/);
  const y=fixture();
  y.cloud.readPage=async()=>({items:[],nextCursor:'not?allowed'});
  await assert.rejects(inventoryAvatarMedia(uid,y),/invalid_media_cursor/);
});
test('network or missing adapters never produce positive audit',async()=>{
  await assert.rejects(inventoryAvatarMedia(uid,{}),/missing_read_only_adapter/);
  await assert.rejects(inventoryAvatarMedia('bad/uid',fixture()),/invalid_uid/);
  const x=fixture();
  x.cloud.readPage=async()=>{throw Error('cloudinary_unavailable');};
  await assert.rejects(inventoryAvatarMedia(uid,x),/cloudinary_unavailable/);
});
test('reject forged summary that claims safe to execute',()=>{
  assert.throws(()=>summarizeAvatarMedia({safeToExecute:true,
    globalMediaCoverageComplete:true,knownSourcesAudited:true,
    summary:{},blockers:[],unverified:[]}),/invalid_media_audit/);
  assert.throws(()=>summarizeAvatarMedia({safeToExecute:false,
    globalMediaCoverageComplete:false,knownSourcesAudited:true,
    summary:{},blockers:[],unverified:[]}),/invalid_media_audit/);
});
