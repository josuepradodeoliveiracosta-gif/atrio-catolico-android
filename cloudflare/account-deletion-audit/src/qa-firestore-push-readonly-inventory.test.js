import test from 'node:test';
import assert from 'node:assert/strict';
import {createQaFirestorePushReadonlyInventory}
  from './qa-firestore-push-readonly-inventory.js';
import {captureQaExternalBaseline,verifyQaExternalReadback}
  from './qa-external-readback.js';

const PROJECT='atrio-delete-qa-stage01';
const NUMBER='123456789012',PROD_NUMBER='987654321098';
const A='qa-freeze-alice',B='qa-freeze-bob';
const base='projects/'+PROJECT+'/databases/(default)/documents/';
const root=uid=>base+'users/'+uid+'/pushDevices/';
const device=(uid,id='qa-device-one')=>({
  name:root(uid)+id,
  updateTime:'2026-11-03T22:00:00.000Z',
  fields:{
    qaFingerprint:{stringValue:'qa-fingerprint-123'},
    qaRevision:{stringValue:'qa-rev-1'}
  }
});
function harness(){
  let identity={projectId:PROJECT,projectNumber:NUMBER};
  let docs=[device(A),device(B)],fault=null;
  const calls=[];
  const inspectProjectIdentity=async()=>identity;
  const fetcher=async request=>{
    const url=new URL(request.url);
    calls.push({url,method:request.method,headers:request.headers});
    assert.equal(request.method,'GET');
    assert.equal(url.origin,'https://firestore.googleapis.com');
    assert.deepEqual(url.searchParams.getAll('mask.fieldPaths'),
      ['qaFingerprint','qaRevision']);
    assert.equal(url.searchParams.get('pageSize'),'25');
    if(fault)return fault(url);
    const uid=url.pathname.includes('/users/'+A+'/')?A:B;
    return Response.json({documents:docs.filter(d=>d.name.startsWith(root(uid)))});
  };
  return {
    args:{qaProjectId:PROJECT,productionProjectId:'atrio-catolico',
      qaProjectNumber:NUMBER,productionProjectNumber:PROD_NUMBER,
      accessToken:'qaFakeOAuthTokenOnly123456',fetcher,
      inspectProjectIdentity},
    calls,setIdentity:value=>{identity=value;},
    setDocs:value=>{docs=value;},deleteAlice:()=>{docs=docs.filter(
      x=>!x.name.startsWith(root(A)));},setFault:value=>{fault=value;}
  };
}
const denied=async promise=>assert.rejects(promise,
  e=>e?.message==='qa_firestore_readonly_unverified');

test('read-only Firestore QA inventory uses GET and masks actual FCM tokens',async()=>{
  const h=harness();
  const adapter=await createQaFirestorePushReadonlyInventory(h.args);
  const value=await adapter.readPage({uid:A,type:'device',limit:25});
  assert.deepEqual(value.items,[{
    path:'users/'+A+'/pushDevices/qa-device-one',
    revision:'qa-rev-1',tokenFingerprint:'qa-fingerprint-123'
  }]);
  assert.equal(value.nextCursor,null);
  assert.equal(adapter.crossProjectIamVerified,false);
  assert.equal(adapter.remoteTokenRevocationVerified,false);
  assert.equal(adapter.productionReady,false);
  assert.ok(h.calls.every(x=>x.method==='GET'));
  assert.ok(h.calls.every(x=>x.headers.get('Authorization').startsWith('Bearer ')));
  assert.ok(!h.calls.some(x=>x.url.href.includes('qaFakeOAuthTokenOnly123456')));
  assert.equal('delete' in adapter,false);
  assert.equal('revoke' in adapter,false);
});
test('project identity and production segregation are mandatory before fetch',async()=>{
  const h=harness();
  let calls=0;
  for(const change of [
    {qaProjectId:'atrio-catolico'},
    {qaProjectId:'not-qa-project'},
    {productionProjectId:PROJECT},
    {productionProjectNumber:NUMBER},
    {qaProjectNumber:'abc'},
    {accessToken:'too-short'},
    {fetcher:undefined},
    {inspectProjectIdentity:undefined}
  ]){
    await denied(createQaFirestorePushReadonlyInventory({
      ...h.args,...change,fetcher:change.fetcher===undefined&&
        Object.hasOwn(change,'fetcher')?undefined:async()=>{
          calls++;throw Error('unexpected_network');
        }
    }));
  }
  assert.equal(calls,0);
});
test('project identity must match independent probe and must remain pinned',async()=>{
  const h=harness();
  h.setIdentity({projectId:'other-qa-project',projectNumber:NUMBER});
  await denied(createQaFirestorePushReadonlyInventory(h.args));
  assert.equal(h.calls.length,0);
  h.setIdentity({projectId:PROJECT,projectNumber:NUMBER});
  const a=await createQaFirestorePushReadonlyInventory(h.args);
  h.setIdentity({projectId:PROJECT,projectNumber:'111111111111'});
  await denied(a.readPage({uid:A,type:'device',limit:25}));
  assert.equal(h.calls.length,0);
});
test('real UIDs, unknown types, bad limits and forged continuation tokens are refused',async()=>{
  const h=harness();const a=await createQaFirestorePushReadonlyInventory(h.args);
  for(const scope of [
    {uid:'user-real',type:'device',limit:25},
    {uid:A,type:'token',limit:25},
    {uid:A,type:'device',limit:26},
    {uid:A,type:'device',limit:25,cursor:'../unsafe'},
    {uid:A,type:'device',limit:25,cursor:1234},
    {uid:A,type:'device',limit:25,cursor:'noncanonical==='}
  ])await denied(a.readPage(scope));
  assert.equal(h.calls.length,0);
});
test('Firestore pageToken is safely converted to a bounded opaque URL-safe cursor',async()=>{
  const h=harness();const a=await createQaFirestorePushReadonlyInventory(h.args);
  h.setFault(url=>{
    const token=url.searchParams.get('pageToken');
    if(token===null)return Response.json({documents:[device(A)],
      nextPageToken:'token+/='});
    assert.equal(token,'token+/=');
    return Response.json({documents:[]});
  });
  const initial=await a.readPage({uid:A,type:'device',limit:25});
  assert.match(initial.nextCursor,/^[A-Za-z0-9_-]+$/);
  const next=await a.readPage({uid:A,type:'device',cursor:initial.nextCursor,limit:25});
  assert.deepEqual(next.items,[]);
  assert.equal(next.nextCursor,null);
});
test('unmasked tokens, cross-account documents and invalid synthetic revisions are denied',async()=>{
  for(const corrupted of [
    {...device(A),name:root(B)+'qa-device-one'},
    {...device(A),name:root(A)+'something-else'},
    {...device(A),fields:{...device(A).fields,token:{stringValue:'real-secret'}}},
    {...device(A),fields:{qaFingerprint:{stringValue:'not-fingerprint'},
      qaRevision:{stringValue:'qa-rev-1'}}},
    {...device(A),fields:{...device(A).fields,qaRevision:{stringValue:'real-time'}}},
    {...device(A),updateTime:'invalid'}
  ]){
    const h=harness();const a=await createQaFirestorePushReadonlyInventory(h.args);
    h.setFault(url=>Response.json({documents:[corrupted]}));
    await denied(a.readPage({uid:A,type:'device',limit:25}));
  }
});
test('HTTP outage, HTML, malformed JSON and oversized responses never reveal tokens',async()=>{
  for(const fault of [
    ()=>new Response('down',{status:503}),
    ()=>new Response('<html>forbidden</html>',{status:200,
      headers:{'content-type':'text/html'}}),
    ()=>new Response('{broken',{status:200,
      headers:{'content-type':'application/json'}}),
    ()=>new Response('x'.repeat(66000),{status:200,
      headers:{'content-type':'application/json'}}),
    ()=>{throw Error('qaFakeOAuthTokenOnly123456');}
  ]){
    const h=harness();const a=await createQaFirestorePushReadonlyInventory(h.args);
    h.setFault(fault);
    await denied(a.readPage({uid:A,type:'device',limit:25}));
  }
});
test('incomplete page with nextPageToken never falsely passes',async()=>{
  const h=harness();const a=await createQaFirestorePushReadonlyInventory(h.args);
  h.setFault(()=>Response.json({documents:[],nextPageToken:'later'}));
  await denied(a.readPage({uid:A,type:'device',limit:25}));
});
test('real-format QA Firestore pages feed both passes of the independent readback',async()=>{
  const h=harness();const devices=await createQaFirestorePushReadonlyInventory(h.args);
  const aa={public_id:'atrio-privacy-qa-20261103/'+A+
    '/123e4567-e89b-42d3-a456-426614174001',
    type:'authenticated',asset_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
  const bb={public_id:'atrio-privacy-qa-20261103/'+B+
    '/123e4567-e89b-42d3-a456-426614174002',
    type:'upload',asset_id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'};
  let medias=[aa,bb];
  const cloudinary={readPage:async({uid,type})=>({
    items:medias.filter(x=>x.type===type&&
      x.public_id.startsWith('atrio-privacy-qa-20261103/'+uid+'/')),
    nextCursor:null,complete:true
  })};
  const confirmFrozen=async uid=>({uid,state:'frozen',inFlight:0});
  const baseline=await captureQaExternalBaseline({cloudinary,devices,confirmFrozen});
  h.deleteAlice();medias=[bb];
  const result=await verifyQaExternalReadback({
    cloudinary,devices,confirmFrozen,baseline
  });
  assert.equal(result.independentReadbacks,2);
  assert.equal(result.syntheticDeviceDocumentsAbsent,true);
  assert.equal(result.realFcmRegistrationRevoked,false);
  assert.equal(result.cloudinaryCdnPurgeVerified,false);
});
