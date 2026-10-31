import test from 'node:test';
import assert from 'node:assert/strict';
import {createAvatarD1ReadAdapter} from './avatar-d1-read-adapter.js';
import {createCloudinaryAvatarReadAdapter} from './avatar-cloudinary-read-adapter.js';
import {inventoryAvatarMedia,summarizeAvatarMedia} from './avatar-media-inventory.js';

const uid='qa-alice';
const key='123e4567-e89b-42d3-a456-426614174000';
const id='atrio-avatares/'+uid+'/'+key;
function d1Fake(rowsByTable={}){
  const calls=[];
  return {calls,prepare(sql){
    assert.ok(/^SELECT /i.test(sql),'D1 must be read-only');
    assert.doesNotMatch(sql,/\b(DELETE|INSERT|UPDATE|DROP|ALTER)\b/i);
    let args;
    return {bind(...input){args=input;return {
      all:async()=>{
        calls.push({sql,args});
        const name=Object.keys(rowsByTable).find(table=>sql.includes('FROM '+table+' '));
        return {results:rowsByTable[name]||[]};
      }
    };}};
  }};
}
const credentials={cloudName:'demo_cloud',apiKey:'123456789012345',apiSecret:'secret_for_fake_tests_only_123456'};
const response=(body,status=200)=>new Response(JSON.stringify(body),{status});

test('D1 adapter uses SELECT statements, UID binding and fixed tables',async()=>{
  const db=d1Fake({
    avatar_pending:[{uid,public_id:id}],
    avatar_rate:[{uid,next_at:17600000}],
    avatar_mutex:[{uid,expires_at:17600000}]
  });
  const reader=createAvatarD1ReadAdapter(db,uid);
  const p=await reader.readPage('avatar_pending','uid',uid);
  assert.deepEqual(p.items,[{uid,public_id:id}]);
  assert.equal(p.nextCursor,null);
  assert.deepEqual(db.calls[0].args,[uid]);
  await reader.readPage('avatar_rate','uid',uid);
  await reader.readPage('avatar_mutex','uid',uid);
  assert.equal(db.calls.length,3);
});
test('D1 moderation uses keyset pagination and rejects cross-account queries',async()=>{
  const db=d1Fake({avatar_moderation:[
    {id:2,actor_uid:uid,target_uid:'qa-bob'},
    {id:3,actor_uid:uid,target_uid:'qa-bob'}
  ]});
  const reader=createAvatarD1ReadAdapter(db,uid);
  const page=await reader.readPage('avatar_moderation','actor_uid',uid,'1',2);
  assert.deepEqual(page.items.map(x=>x.id),[2,3]);
  assert.equal(page.nextCursor,'3');
  assert.deepEqual(db.calls[0].args,[uid,1,2]);
  await assert.rejects(reader.readPage('avatar_moderation','actor_uid','qa-bob'),
    /disallowed_d1_request/);
  await assert.rejects(reader.readPage('avatar_moderation','actor_uid',uid,'1 OR 1=1'),
    /disallowed_d1_cursor/);
  await assert.rejects(reader.readPage('guardian_runtime','uid',uid),
    /disallowed_d1_request/);
  assert.equal(db.calls.length,1);
});
test('D1 pagination and malformed responses fail closed',async()=>{
  const db=d1Fake({avatar_pending:[{uid,public_id:id},{uid,public_id:id}]});
  await assert.rejects(createAvatarD1ReadAdapter(db,uid).readPage('avatar_pending','uid',uid),
    /invalid_d1_response/);
  const adapter=createAvatarD1ReadAdapter(d1Fake(),uid);
  await assert.rejects(adapter.readPage('avatar_pending','uid',uid,'1'),
    /disallowed_d1_cursor/);
  assert.throws(()=>createAvatarD1ReadAdapter({},"bad/uid"),/invalid_uid/);
  assert.throws(()=>createAvatarD1ReadAdapter({},uid),/invalid_d1_binding/);
});
test('Cloudinary requests GET only, per-UID prefix, both delivery types',async()=>{
  const calls=[];
  const fetcher=async(url,options)=>{
    calls.push({url,options});
    return response({resources:[{
      type:url.includes('/upload?')?'upload':'authenticated',
      public_id:id,secure_url:'https://private.example/should-not-return',
      context:{email:'not-in-output'}
    }],next_cursor:'cursor_2'});
  };
  const reader=createCloudinaryAvatarReadAdapter(credentials,fetcher);
  const publicPage=await reader.readPage(uid,'upload');
  const privatePage=await reader.readPage(uid,'authenticated','cursor_2');
  assert.equal(publicPage.items.length,1);
  assert.deepEqual(publicPage.items[0],{type:'upload',public_id:id});
  assert.equal(JSON.stringify(publicPage).includes('private.example'),false);
  assert.equal(calls.length,2);
  for(const call of calls){
    const u=new URL(call.url);
    assert.equal(u.hostname,'api.cloudinary.com');
    assert.equal(u.searchParams.get('prefix'),'atrio-avatares/'+uid+'/');
    assert.equal(call.options.method,'GET');
    assert.equal(call.options.redirect,'error');
    assert.ok(call.options.headers.Authorization.startsWith('Basic '));
  }
  assert.equal(new URL(calls[1].url).searchParams.get('next_cursor'),'cursor_2');
});
test('Cloudinary rejects other types, malformed credentials, unsafe cursor',async()=>{
  const noNetwork=async()=>{throw Error('should_not_call');};
  const reader=createCloudinaryAvatarReadAdapter(credentials,noNetwork);
  await assert.rejects(reader.readPage(uid,'destroy'),/invalid_cloudinary_query/);
  await assert.rejects(reader.readPage('other/uid','upload'),/invalid_cloudinary_query/);
  await assert.rejects(reader.readPage(uid,'upload','https://evil.example'),/invalid_cloudinary_query/);
  assert.throws(()=>createCloudinaryAvatarReadAdapter({...credentials,cloudName:'x/evil'}),
    /invalid_cloudinary_config/);
});
test('Cloudinary provider errors and oversized result fail closed',async()=>{
  const offline=createCloudinaryAvatarReadAdapter(credentials,
    async()=>new Response('no access',{status:403}));
  await assert.rejects(offline.readPage(uid,'upload'),/cloudinary_unavailable/);
  const bad=createCloudinaryAvatarReadAdapter(credentials,
    async()=>new Response('NOT JSON',{status:200}));
  await assert.rejects(bad.readPage(uid,'upload'),/invalid_cloudinary_response/);
  const huge=createCloudinaryAvatarReadAdapter(credentials,
    async()=>new Response('x'.repeat(700001),{status:200}));
  await assert.rejects(huge.readPage(uid,'upload'),/cloudinary_response_too_large/);
});
test('D1 and Cloudinary mock readers integrate with media audit without deleting',async()=>{
  const db=d1Fake({avatar_pending:[{uid,public_id:id}]});
  const d1=createAvatarD1ReadAdapter(db,uid);
  const cloud=createCloudinaryAvatarReadAdapter(credentials,async(url)=>
    response({resources:url.includes('/authenticated?')
      ?[{public_id:id,type:'authenticated'}]:[]}));
  const photo={getPublicId:async id=>{assert.equal(id,uid);return null;}};
  const result=await inventoryAvatarMedia(uid,{d1,cloud,photo});
  const summary=summarizeAvatarMedia(result);
  assert.equal(summary.counts.pending,1);
  assert.equal(summary.counts.cloudinaryProtected,1);
  assert.equal(summary.safeToExecute,false);
  assert.equal(result.globalMediaCoverageComplete,false);
  assert.ok(db.calls.every(x=>x.sql.startsWith('SELECT ')));
  assert.ok(!JSON.stringify(summary).includes(id));
});
