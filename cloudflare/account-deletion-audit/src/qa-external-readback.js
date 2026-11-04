/**
 * QA-only, read-only post-deletion verifier for two fixed synthetic accounts.
 * No Cloudinary SDK, Firestore Admin SDK, FCM API, destructive method, HTTP
 * client, or external secrets are imported or accepted here.
 *
 * This proves only that the injected inventory endpoints report an owned
 * test fixture removed. It cannot attest derived media/backups, residual
 * caches, legacy FCM topics, upstream provider revocation or all production
 * write paths. Those claims intentionally stay false even if this succeeds.
 */
const SUBJECT='qa-freeze-alice';
const CONTROL='qa-freeze-bob';
const TYPES=Object.freeze(['upload','authenticated','private']);
const PREFIX='atrio-privacy-qa-20261103/';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const ASSET_ID=/^[0-9a-f]{32}$/;
const CURSOR=/^[A-Za-z0-9_-]{1,256}$/;
const PAGE_SIZE=25,MAX_PAGES=20,MAX_ROWS=300;
const fail=()=>{throw Error('qa_external_readback_unverified')};
const strict=(v)=>v&&Object.getPrototypeOf(v)===Object.prototype;
function same(a,b){return a.length===b.length&&a.every((x,i)=>x===b[i]);}
function assetValid(uid,type,item){
  if(!strict(item)||Object.keys(item).sort().join(',')!=='asset_id,public_id,type'||
     item.type!==type||typeof item.public_id!=='string'||
     typeof item.asset_id!=='string'||!ASSET_ID.test(item.asset_id))return false;
  const prefix=PREFIX+uid+'/';
  return item.public_id.startsWith(prefix)&&UUID.test(item.public_id.slice(prefix.length));
}
function deviceValid(uid,item){
  if(!strict(item)||Object.keys(item).sort().join(',')!=='path,revision,tokenFingerprint')return false;
  return typeof item.path==='string'&&
    new RegExp('^users/'+uid+'/pushDevices/qa-device-[a-z0-9-]{1,50}$').test(item.path)&&
    typeof item.tokenFingerprint==='string'&&
    /^qa-fingerprint-[a-z0-9-]{1,64}$/.test(item.tokenFingerprint)&&
    typeof item.revision==='string'&&/^qa-rev-[0-9]{1,10}$/.test(item.revision);
}
async function walk(readPage,valid,key,uid,type){
  const all=[],ids=new Set(),cursors=new Set();let cursor=null;
  for(let page=0;page<MAX_PAGES;page++){
    const value=await readPage({uid,type,cursor,limit:PAGE_SIZE});
    if(!strict(value)||Object.keys(value).sort().join(',')!=='complete,items,nextCursor'||
       value.complete!==true||!Array.isArray(value.items)||
       value.items.length>PAGE_SIZE)fail();
    for(const item of value.items){
      if(!valid(item))fail();
      const id=key(item);
      if(ids.has(id))fail();
      ids.add(id);all.push(item);
      if(all.length>MAX_ROWS)fail();
    }
    if(value.nextCursor===null)return all;
    if(typeof value.nextCursor!=='string'||!CURSOR.test(value.nextCursor)||
       cursors.has(value.nextCursor)||value.items.length===0)fail();
    cursors.add(value.nextCursor);cursor=value.nextCursor;
  }
  fail();
}
async function inventory(uid,{cloudinary,devices}){
  const medias=[];
  for(const type of TYPES){
    const items=await walk(cloudinary.readPage,(x)=>assetValid(uid,type,x),
      x=>x.asset_id,uid,type);
    for(const x of items)medias.push(type+':'+x.public_id+':'+x.asset_id);
  }
  if(new Set(medias.map(x=>x.split(':').at(-1))).size!==medias.length)fail();
  const dev=await walk(devices.readPage,x=>deviceValid(uid,x),
    x=>x.path,uid,'device');
  return Object.freeze({media:medias.sort(),device:dev.map(x=>x.path+':'+x.revision).sort()});
}
async function frozen(confirm,uid){
  const state=await confirm(uid);
  if(!strict(state)||Object.keys(state).sort().join(',')!=='inFlight,state,uid'||
     state.uid!==uid||state.state!=='frozen'||state.inFlight!==0)fail();
}
/**
 * Capture the READ-ONLY initial snapshot of two seeded QA accounts. Never
 * accept a zero-item baseline as a proof of successful deletion.
 */
export async function captureQaExternalBaseline({cloudinary,devices,confirmFrozen}={}){
  if(typeof cloudinary?.readPage!=='function'||
     typeof devices?.readPage!=='function'||
     typeof confirmFrozen!=='function')fail();
  await frozen(confirmFrozen,SUBJECT);
  const target=await inventory(SUBJECT,{cloudinary,devices});
  const control=await inventory(CONTROL,{cloudinary,devices});
  if(!target.media.length||!target.device.length||
     !control.media.length||!control.device.length)fail();
  return Object.freeze({qaOnly:true,
    target:Object.freeze({media:Object.freeze([...target.media]),
      device:Object.freeze([...target.device])}),
    control:Object.freeze({media:Object.freeze([...control.media]),
      device:Object.freeze([...control.device])})
  });
}
/**
 * Compare two fresh readbacks after the caller's separate, explicitly
 * authorized QA fixture step. There is NO write callback and NO mutator.
 * An unsigned baseline or a successful readback is NOT a provider deletion
 * attestation and MUST NEVER permit production account deletion.
 */
export async function verifyQaExternalReadback({cloudinary,devices,confirmFrozen,
  baseline}={}){
  if(typeof cloudinary?.readPage!=='function'||
     typeof devices?.readPage!=='function'||
     typeof confirmFrozen!=='function'||
     !strict(baseline)||baseline.qaOnly!==true||
     !strict(baseline.target)||!strict(baseline.control)||
     !Array.isArray(baseline.target.media)||!Array.isArray(baseline.target.device)||
     !Array.isArray(baseline.control.media)||!Array.isArray(baseline.control.device)||
     !baseline.target.media.length||!baseline.target.device.length||
     !baseline.control.media.length||!baseline.control.device.length)fail();
  for(let i=0;i<2;i++){
    await frozen(confirmFrozen,SUBJECT);
    const target=await inventory(SUBJECT,{cloudinary,devices});
    const control=await inventory(CONTROL,{cloudinary,devices});
    if(target.media.length||target.device.length||
      !same(control.media,baseline.control.media)||
      !same(control.device,baseline.control.device))fail();
  }
  return Object.freeze({
    status:'qa_scoped_readback_only',
    syntheticOriginalsAbsent:true,
    syntheticDeviceDocumentsAbsent:true,
    otherQaAccountPreserved:true,
    independentReadbacks:2,
    cloudinaryBackupsVerified:false,
    cloudinaryDerivedAssetsVerified:false,
    cloudinaryCdnPurgeVerified:false,
    realFcmRegistrationRevoked:false,
    legacyFcmTopicsVerified:false,
    allProductionWritePathsFenced:false,
    liveUserDeletionHomologated:false,
    playReleaseAuthorized:false
  });
}
