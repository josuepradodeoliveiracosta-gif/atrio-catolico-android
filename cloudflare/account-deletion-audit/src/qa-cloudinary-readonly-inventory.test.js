import test from 'node:test';
import assert from 'node:assert/strict';
import {createQaCloudinaryReadonlyInventory}
  from './qa-cloudinary-readonly-inventory.js';
import {captureQaExternalBaseline,verifyQaExternalReadback}
  from './qa-external-readback.js';

const CLOUD='qa-atrio-privacy-stage01',PROD='prod-atrio-cloud';
const A='qa-freeze-alice',B='qa-freeze-bob';
const ID1='123e4567-e89b-42d3-a456-426614174001';
const ID2='123e4567-e89b-42d3-a456-426614174002';
const ROOT='atrio-privacy-qa-20261103/';
const aa={type:'authenticated',resource_type:'image',
  public_id:ROOT+A+'/'+ID1,asset_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
const bb={type:'upload',resource_type:'image',
  public_id:ROOT+B+'/'+ID2,asset_id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'};
function harness(){
  let assets=[aa,bb],cloud=CLOUD,failure=null;
  const calls=[],config={cloud_name:cloud,created_at:'2026-11-03T12:00:00Z'};
  const fetcher=async request=>{
    const url=new URL(request.url);
    calls.push({path:url.pathname,method:request.method,
      search:url.search,headers:request.headers});
    assert.equal(request.method,'GET');
    assert.equal(url.protocol,'https:');
    assert.equal(url.hostname,'api.cloudinary.com');
    if(failure)return failure(url);
    if(url.pathname.endsWith('/config'))
      return Response.json({...config,cloud_name:cloud});
    const type=url.pathname.split('/').at(-1);
    const prefix=url.searchParams.get('prefix');
    assert.equal(url.searchParams.get('max_results'),'25');
    assert.ok([A,B].some(uid=>prefix===ROOT+uid+'/'));
    const cursor=url.searchParams.get('next_cursor');
    if(cursor!==null)assert.match(cursor,/^[a-zA-Z0-9_-]+$/);
    return Response.json({resources:assets.filter(x=>x.type===type&&
      x.public_id.startsWith(prefix))});
  };
  const args={cloudName:CLOUD,productionCloudName:PROD,apiKey:'qaKey123',
    apiSecret:'qaSecretExampleOnly12345',fetcher};
  return {args,calls,removeAlice:()=>{assets=assets.filter(x=>
    !x.public_id.startsWith(ROOT+A+'/'));},setAssets:v=>{assets=v;},
    setCloud:v=>{cloud=v;},setFailure:v=>{failure=v;}};
}
const denied=async promise=>assert.rejects(promise,
  e=>e?.message==='qa_cloudinary_readonly_unverified');

test('Cloudinary QA config is verified via HTTPS GET before any inventory',async()=>{
  const h=harness();const adapter=await createQaCloudinaryReadonlyInventory(h.args);
  assert.equal(adapter.qaOnly,true);
  assert.equal(adapter.readOnly,true);
  assert.equal(adapter.productionReady,false);
  assert.equal(adapter.independentlyIsolatedAccountVerified,false);
  assert.equal(adapter.remoteDeletionVerified,false);
  assert.deepEqual((await adapter.readPage({uid:A,type:'authenticated',limit:25}))
    .items.map(x=>x.asset_id),[aa.asset_id]);
  assert.equal(h.calls.filter(x=>x.path.endsWith('/config')).length,2);
  assert.ok(h.calls.every(x=>x.method==='GET'));
  assert.ok(h.calls.every(x=>x.headers.get('Authorization')?.startsWith('Basic ')));
  assert.ok(!h.calls.some(x=>x.search.includes('qaSecretExampleOnly12345')));
  assert.equal('deleteAsset' in adapter,false);
  assert.equal('upload' in adapter,false);
});
test('Cloudinary probe never accepts production cloud or unknown project names',async()=>{
  const h=harness();let reads=0;
  const invalid=[
    {...h.args,cloudName:PROD,productionCloudName:PROD},
    {...h.args,cloudName:'atrio-avatares'},
    {...h.args,productionCloudName:undefined},
    {...h.args,cloudName:'qa-atrio-privacy-a',productionCloudName:'qa-atrio-privacy-a'},
    {...h.args,apiSecret:'x'},
    {...h.args,fetcher:undefined}
  ];
  for(const args of invalid)await denied(createQaCloudinaryReadonlyInventory({
    ...args,fetcher:args.fetcher===undefined?undefined:async()=>{reads++;throw Error('MUST_NOT_READ');}
  }));
  assert.equal(reads,0);
});
test('a QA-looking URL is not enough: config must match the expected cloud',async()=>{
  const h=harness();h.setCloud('other-production-cloud');
  await denied(createQaCloudinaryReadonlyInventory(h.args));
  assert.equal(h.calls.length,1);
});
test('identity drift after creating an adapter blocks inventory',async()=>{
  const h=harness();const api=await createQaCloudinaryReadonlyInventory(h.args);
  h.setCloud('different-cloud');
  await denied(api.readPage({uid:A,type:'authenticated',limit:25}));
  assert.ok(h.calls.filter(x=>x.path.endsWith('/resources/image/authenticated'))
    .length===0);
});
test('UID, type, page size, and cursor are fixed to synthetic QA namespace',async()=>{
  const h=harness();const api=await createQaCloudinaryReadonlyInventory(h.args);
  for(const x of [
    {uid:'actual-account',type:'upload',limit:25},
    {uid:A,type:'fetch',limit:25},{uid:A,type:'video',limit:25},
    {uid:A,type:'upload',limit:26},{uid:A,type:'upload',limit:0},
    {uid:A,type:'upload',limit:25,cursor:'../other'},
    {uid:A,type:'upload',limit:25,cursor:123}
  ])await denied(api.readPage(x));
  assert.equal(h.calls.length,1);
});
test('unknown resource identity or missing required API fields blocks',async()=>{
  for(const invalid of [
    {...aa,asset_id:'not-a-uuid'},
    {...aa,public_id:ROOT+B+'/'+ID1},
    {...aa,public_id:'atrio-avatares/'+A+'/'+ID1},
    {...aa,type:'private'}, {...aa,resource_type:'video'},
    {...aa,asset_id:null}
  ]){
    const h=harness();
    const api=await createQaCloudinaryReadonlyInventory(h.args);
    h.setFailure(url=>{
      if(url.pathname.endsWith('/config'))return Response.json({
        cloud_name:CLOUD,created_at:'2026-11-03T12:00:00Z'
      });
      return Response.json({resources:[invalid]});
    });
    await denied(api.readPage({uid:A,type:'authenticated',limit:25}));
  }
});
test('API faults, HTML, HTTP errors and oversized responses fail without leaking credentials',async()=>{
  for(const fault of [
    ()=>new Response('unavailable',{status:503}),
    ()=>new Response('<html>wrong account</html>',{
      status:200,headers:{'content-type':'text/html'}}),
    ()=>new Response('{broken',{status:200,headers:{'content-type':'application/json'}}),
    ()=>new Response('x'.repeat(66000),{status:200,
      headers:{'content-type':'application/json'}}),
    ()=>{throw Error('qaSecretExampleOnly12345-in-provider-message');}
  ]){
    const h=harness();h.setFailure(fault);
    let message='';
    try{await createQaCloudinaryReadonlyInventory(h.args)}
    catch(e){message=e.message;}
    assert.equal(message,'qa_cloudinary_readonly_unverified');
  }
});
test('continuation cursor is mapped exactly and pagination cannot silently overrun',async()=>{
  const h=harness();const api=await createQaCloudinaryReadonlyInventory(h.args);
  h.setFailure(url=>{
    if(url.pathname.endsWith('/config'))return Response.json({
      cloud_name:CLOUD,created_at:'2026-11-03T12:00:00Z'
    });
    if(!url.searchParams.has('next_cursor'))
      return Response.json({resources:[aa],next_cursor:'page2'});
    assert.equal(url.searchParams.get('next_cursor'),'page2');
    return Response.json({resources:[]});
  });
  const first=await api.readPage({uid:A,type:'authenticated',limit:25});
  assert.equal(first.nextCursor,'page2');
  const last=await api.readPage({uid:A,type:'authenticated',cursor:'page2',limit:25});
  assert.deepEqual(last.items,[]);
  assert.equal(last.nextCursor,null);
});
test('can feed the existing independent two-readback QA verifier without any delete API',async()=>{
  const h=harness();const cloudinary=await createQaCloudinaryReadonlyInventory(h.args);
  let deviceList=[
    {path:'users/'+A+'/pushDevices/qa-device-one',
      revision:'qa-rev-1',tokenFingerprint:'qa-fingerprint-a'},
    {path:'users/'+B+'/pushDevices/qa-device-one',
      revision:'qa-rev-1',tokenFingerprint:'qa-fingerprint-b'}
  ];
  const devices={readPage:async({uid,cursor})=>{
    assert.equal(cursor,null);
    return {items:deviceList.filter(x=>x.path.startsWith('users/'+uid+'/')),
      nextCursor:null,complete:true};
  }};
  const confirmFrozen=async uid=>({uid,state:'frozen',inFlight:0});
  const baseline=await captureQaExternalBaseline({cloudinary,devices,confirmFrozen});
  h.removeAlice();
  deviceList=deviceList.filter(x=>!x.path.startsWith('users/'+A+'/'));
  const result=await verifyQaExternalReadback({
    cloudinary,devices,confirmFrozen,baseline
  });
  assert.equal(result.independentReadbacks,2);
  assert.equal(result.syntheticOriginalsAbsent,true);
  assert.equal(result.cloudinaryBackupsVerified,false);
  assert.equal(result.playReleaseAuthorized,false);
});
