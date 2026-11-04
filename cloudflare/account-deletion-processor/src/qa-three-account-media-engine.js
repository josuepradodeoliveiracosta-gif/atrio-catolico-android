/**
 * Three-account, media-only QA adapter for the account deletion engine.
 *
 * No image bytes, Firebase credentials, Cloudinary SDK, HTTP or D1 binding.
 * The caller MUST supply a synthetic conditional store with independently
 * verified QA ownership. Only accepts three disposable accounts, precisely
 * one initial photo per account, and refuses partial inventories.
 *
 * Production Cloudinary deletion, derived files, backups and CDN remain
 * UNVERIFIED. A store with wider privileges MUST NOT be injected.
 */
const PROJECT='demo-atrio-v11';
export const QA_PHOTO_ACCOUNTS=Object.freeze([
  'qa-delete-candidate','qa-delete-neighbor','qa-delete-observer'
]);
const PREFIX='atrio-privacy-qa-20261103/';
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ASSET=/^[a-f0-9]{32}$/;
const SHA=/^[a-f0-9]{64}$/;
const TYPES=new Set(['upload','authenticated','private']);
const CASE=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const deny=reason=>{throw Error('qa_three_media_denied:'+reason);};
const plain=v=>v!==null&&typeof v==='object'&&
  !Array.isArray(v)&&Object.getPrototypeOf(v)===Object.prototype;
const names=(v,expected)=>plain(v)&&
  Object.keys(v).sort().join(',')===expected.slice().sort().join(',');
function assetOK(uid,a){
  if(!names(a,['assetId','publicId','sha256','type'])||
     !ASSET.test(a.assetId)||!SHA.test(a.sha256)||
     !TYPES.has(a.type)||typeof a.publicId!=='string')return false;
  const prefix=PREFIX+uid+'/';
  return a.publicId.startsWith(prefix)&&
    UUID.test(a.publicId.slice(prefix.length));
}
function copyAsset(a){
  return Object.freeze({assetId:a.assetId,publicId:a.publicId,
    sha256:a.sha256,type:a.type});
}
function same(a,b){
  return a.assetId===b.assetId&&a.publicId===b.publicId&&
    a.sha256===b.sha256&&a.type===b.type;
}
function validateCtx(ctx){
  if(!names(ctx,['uid','caseId','epoch'])||
     !QA_PHOTO_ACCOUNTS.includes(ctx.uid)||
     !CASE.test(ctx.caseId)||
     !Number.isSafeInteger(ctx.epoch)||ctx.epoch<1)
    deny('invalid_disposable_case');
}
function manifestOf(manifest){
  if(!names(manifest,QA_PHOTO_ACCOUNTS))deny('incomplete_qa_manifest');
  const entries=new Map(),used=new Set();
  for(const uid of QA_PHOTO_ACCOUNTS){
    const entry=manifest[uid];
    if(!assetOK(uid,entry)||used.has(entry.assetId))
      deny('invalid_or_shared_asset');
    used.add(entry.assetId);
    entries.set(uid,copyAsset(entry));
  }
  return entries;
}

export function createQaThreeAccountMediaEngine({
  projectId,manifest,store,assertAuthorized,assertFrozen,assertLease
}={}){
  if(projectId!==PROJECT)deny('not_disposable_project');
  const expected=manifestOf(manifest);
  if(typeof store?.list!=='function'||
     typeof store?.deleteConditional!=='function'||
     typeof assertAuthorized!=='function'||
     typeof assertFrozen!=='function'||
     typeof assertLease!=='function')
    deny('missing_proof_or_store');

  async function authorized(ctx){
    validateCtx(ctx);
    // Permission is checked immediately before every I/O step. The store
    // must ALSO apply UID ownership + hash CAS at its own mutation boundary.
    if(await assertAuthorized(ctx)!==true)deny('approval_revoked');
    if(await assertFrozen(ctx)!==true)deny('freeze_not_attested');
    if(await assertLease(ctx)!==true)deny('stale_lease');
  }
  async function inventory(uid,ctx){
    await authorized(ctx);
    const r=await store.list(Object.freeze({uid}));
    if(!names(r,['complete','items','nextCursor'])||
       r.complete!==true||r.nextCursor!==null||
       !Array.isArray(r.items)||r.items.length>1)
      deny('incomplete_or_ambiguous_inventory');
    const seen=new Set();
    return r.items.map(a=>{
      if(!assetOK(uid,a)||!same(a,expected.get(uid))||
         seen.has(a.assetId))deny('unexpected_or_foreign_asset');
      seen.add(a.assetId);
      return copyAsset(a);
    });
  }
  async function controls(ctx){
    for(const uid of QA_PHOTO_ACCOUNTS){
      if(uid===ctx.uid)continue;
      const found=await inventory(uid,ctx);
      if(found.length!==1||!same(found[0],expected.get(uid)))
        deny('control_photo_missing_or_changed');
    }
  }
  async function readback(ctx){
    let first=null;
    for(let pass=0;pass<2;pass++){
      await authorized(ctx);
      const absent=(await inventory(ctx.uid,ctx)).length===0;
      await controls(ctx);
      if(first!==null&&first!==absent)
        deny('inconsistent_independent_readbacks');
      first=absent;
    }
    return first;
  }
  return Object.freeze({
    async purge(ctx){
      validateCtx(ctx);
      await authorized(ctx);
      await controls(ctx);
      const owned=await inventory(ctx.uid,ctx);
      if(owned.length===1){
        await authorized(ctx);
        await controls(ctx);
        const changed=await inventory(ctx.uid,ctx);
        if(changed.length!==1||!same(owned[0],changed[0]))
          deny('photo_changed_before_delete');
        await authorized(ctx);
        const result=await store.deleteConditional(Object.freeze({
          uid:ctx.uid,caseId:ctx.caseId,epoch:ctx.epoch,
          assetId:owned[0].assetId,publicId:owned[0].publicId,
          sha256:owned[0].sha256
        }));
        if(!names(result,['status','assetId','uid'])||
           result.status!=='deleted'||result.uid!==ctx.uid||
           result.assetId!==owned[0].assetId)
          deny('unconfirmed_conditional_delete');
      }
      if(await readback(ctx)!==true)deny('target_photo_still_present');
      return Object.freeze({
        status:'qa_three_account_photo_absent',
        productionReady:false,remoteCloudinaryDeleted:false,
        backupsVerified:false,derivedAssetsVerified:false,
        nonTargetAccountsPreserved:true
      });
    },
    async empty(ctx){
      validateCtx(ctx);
      return readback(ctx);
    },
    qaOnly:true,remoteProviderConnected:false,productionReady:false
  });
}
