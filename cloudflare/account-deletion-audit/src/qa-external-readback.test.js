import test from 'node:test';
import assert from 'node:assert/strict';
import {captureQaExternalBaseline,verifyQaExternalReadback} from './qa-external-readback.js';
const ALICE='qa-freeze-alice',BOB='qa-freeze-bob';
const aa={type:'authenticated',public_id:'atrio-privacy-qa-20261103/'+ALICE+'/123e4567-e89b-42d3-a456-426614174001',asset_id:'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'};
const bb={type:'upload',public_id:'atrio-privacy-qa-20261103/'+BOB+'/123e4567-e89b-42d3-a456-426614174002',asset_id:'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'};
const device=uid=>({path:'users/'+uid+'/pushDevices/qa-device-one',tokenFingerprint:'qa-fingerprint-1234',revision:'qa-rev-1'});
function fixture({before=[aa,bb],deviceBefore=[device(ALICE),device(BOB)]}={}){
  let assets=[...before],devices=[...deviceBefore],frozen=true;
  const cloudinary={readPage:async({uid,type,cursor})=>{
    if(cursor!==null)throw Error('unexpected_cursor');
    return {items:assets.filter(x=>x.type===type&&x.public_id.startsWith('atrio-privacy-qa-20261103/'+uid+'/')),nextCursor:null,complete:true};
  }};
  const deviceAdapter={readPage:async({uid,cursor})=>{
    if(cursor!==null)throw Error('unexpected_cursor');
    return {items:devices.filter(x=>x.path.startsWith('users/'+uid+'/')),nextCursor:null,complete:true};
  }};
  let cleanup=async uid=>{assets=assets.filter(x=>!x.public_id.startsWith('atrio-privacy-qa-20261103/'+uid+'/'));
    devices=devices.filter(x=>!x.path.startsWith('users/'+uid+'/'));};
  return {cloudinary,devices:deviceAdapter,
    confirmFrozen:async uid=>({uid,state:frozen?'frozen':'active',inFlight:0}),
    performSyntheticFixtureCleanup:async uid=>cleanup(uid),
    setAssets:x=>{assets=x},setDevices:x=>{devices=x},
    setFrozen:x=>{frozen=x},setCleanup:x=>{cleanup=x}};
}
const check=async options=>{
  const baseline=await captureQaExternalBaseline(options);
  await options.performSyntheticFixtureCleanup(ALICE); // Hermetic test fixture ONLY
  return verifyQaExternalReadback({...options,baseline});
};
const denied=async x=>assert.rejects(check(x),/qa_external_readback_unverified/);
test('complete QA readbacks require prior evidence and preserve another account',async()=>{
  const result=await check(fixture());
  assert.equal(result.status,'qa_scoped_readback_only');
  assert.equal(result.independentReadbacks,2);
  assert.equal(result.syntheticOriginalsAbsent,true);
  assert.equal(result.syntheticDeviceDocumentsAbsent,true);
  assert.equal(result.cloudinaryDerivedAssetsVerified,false);
  assert.equal(result.cloudinaryBackupsVerified,false);
  assert.equal(result.realFcmRegistrationRevoked,false);
  assert.equal(result.legacyFcmTopicsVerified,false);
  assert.equal(result.playReleaseAuthorized,false);
});
test('no baseline asset or device must NEVER be presented as deletion',async()=>{
  await denied(fixture({before:[bb]}));
  await denied(fixture({deviceBefore:[device(BOB)]}));
});
test('deletion failure leaves residual asset and denies completion',async()=>{
  const x=fixture();x.setCleanup(async()=>{});await denied(x);
});
test('partial media-only removal fails device readback',async()=>{
  const x=fixture();x.setCleanup(async()=>x.setAssets([bb]));await denied(x);
});
test('partial device-only removal fails media readback',async()=>{
  const x=fixture();x.setCleanup(async()=>x.setDevices([device(BOB)]));await denied(x);
});
test('cannot delete or modify neighboring account',async()=>{
  const x=fixture();x.setCleanup(async()=>{x.setAssets([]);x.setDevices([])});await denied(x);
});
test('cross-account, invalid namespace, unknown types and malformed metadata deny',async()=>{
  for(const evil of [
    {...aa,public_id:'atrio-avatares/'+ALICE+'/123e4567-e89b-42d3-a456-426614174001'},
    {...aa,type:'fetch'}, {...aa,asset_id:'bad'}, {...aa,extra:true},
    {...aa,public_id:'atrio-privacy-qa-20261103/'+BOB+'/123e4567-e89b-42d3-a456-426614174001'}
  ]){
    const x=fixture({before:[evil,bb]});
    await denied(x);
  }
});
test('invalid device path, revision and token fingerprint deny',async()=>{
  for(const corrupted of [
    {...device(ALICE),path:'users/'+BOB+'/pushDevices/qa-device-b'},
    {...device(ALICE),revision:'2026-11-03T21:00:00Z'},
    {...device(ALICE),tokenFingerprint:'actual_sensitive_fcm_token'},
    {...device(ALICE),extra:'unexpected'}
  ])await denied(fixture({deviceBefore:[corrupted,device(BOB)]}));
});
test('freeze missing, in-flight permission or unknown confirmation refuses all readbacks',async()=>{
  const x=fixture();x.setFrozen(false);await denied(x);
  const y=fixture();y.confirmFrozen=async uid=>({uid,state:'frozen',inFlight:1});await denied(y);
  const z=fixture();z.confirmFrozen=async()=>undefined;await denied(z);
});
test('pagination cursor repetition or inconclusive pages fails closed',async()=>{
  for(const kind of ['replay','missingComplete','unknown','emptyNext']){
    const x=fixture();
    x.cloudinary.readPage=async({uid,type,cursor})=>{
      if(type!=='authenticated'||uid!==ALICE)return {items:uid===BOB&&type==='upload'?[bb]:[],nextCursor:null,complete:true};
      if(kind==='missingComplete')return {items:[aa],nextCursor:null};
      if(kind==='unknown')return {items:[aa],nextCursor:'???',complete:true};
      if(kind==='emptyNext')return {items:[],nextCursor:'loop',complete:true};
      return {items:[aa],nextCursor:'loop',complete:true};
    };
    await denied(x);
  }
});
test('independent second readback detects resurrected media or device',async()=>{
  for(const which of ['media','device']){
    const x=fixture();let reads=0;
    const original=x.cloudinary.readPage.bind(x.cloudinary);
    const devOrig=x.devices.readPage.bind(x.devices);
    x.cloudinary.readPage=async query=>{
      const page=await original(query);
      if(which==='media'&&query.uid===ALICE&&query.type==='authenticated'&&++reads===3)
        return {items:[aa],nextCursor:null,complete:true};
      return page;
    };
    x.devices.readPage=async query=>{
      const page=await devOrig(query);
      if(which==='device'&&query.uid===ALICE&&++reads===3)
        return {items:[device(ALICE)],nextCursor:null,complete:true};
      return page;
    };
    await denied(x);
  }
});
test('read-only adapters cannot give a release authorization even with no residuals',async()=>{
  const x=fixture();const outcome=await check(x);
  assert.equal(outcome.liveUserDeletionHomologated,false);
  assert.equal(outcome.allProductionWritePathsFenced,false);
  assert.equal(outcome.playReleaseAuthorized,false);
});
test('verifier has no external delete callback or provider credentials',async()=>{
  const x=fixture();
  const baseline=await captureQaExternalBaseline(x);
  await x.performSyntheticFixtureCleanup(ALICE);
  x.cloudinary.deleteAsset=()=>{throw Error('unexpected_real_cloudinary_mutation')};
  x.devices.removeToken=()=>{throw Error('unexpected_fcm_token_mutation')};
  const result=await verifyQaExternalReadback({...x,baseline});
  assert.equal(result.independentReadbacks,2);
  assert.equal(result.cloudinaryBackupsVerified,false);
});
test('multi-page valid QA inventory can complete but unknown rows fail',async()=>{
  const aa2={...aa,public_id:'atrio-privacy-qa-20261103/'+ALICE+'/123e4567-e89b-42d3-a456-426614174003',asset_id:'cccccccccccccccccccccccccccccccc'};
  const x=fixture({before:[aa,aa2,bb]});
  const orig=x.cloudinary.readPage;
  x.cloudinary.readPage=async(args)=>{
    if(args.type==='authenticated'&&args.uid===ALICE&&args.cursor==='page-two')
      return {items:[aa2],nextCursor:null,complete:true};
    const v=await orig(args);
    if(args.type==='authenticated'&&args.uid===ALICE&&v.items.length===2)
      return {items:[aa],nextCursor:'page-two',complete:true};
    return v;
  };
  const baseline=await captureQaExternalBaseline(x);
  assert.equal(baseline.target.media.length,2);
  await x.performSyntheticFixtureCleanup(ALICE);
  const result=await verifyQaExternalReadback({...x,baseline});
  assert.equal(result.syntheticOriginalsAbsent,true);
});
