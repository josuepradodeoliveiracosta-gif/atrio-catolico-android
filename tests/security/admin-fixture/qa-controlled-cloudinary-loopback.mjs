/**
 * QA only: strict Cloudinary-shaped HTTP contract on 127.0.0.1, for the
 * controlled deletion executor with Firebase Emulators. NEVER a live
 * Cloudinary adapter; cannot accept HTTPS or a Cloudinary hostname/API key.
 * The in-process server is independently checked on both sides of deletion.
 */
const PROJECT='demo-atrio-v11',OWNER='qa-delete-candidate';
const NEIGHBOR='qa-delete-neighbor';
const PHOTO='atrio-avatares/'+OWNER+'/123e4567-e89b-42d3-a456-426614174001';
const NEIGHBOR_PHOTO='atrio-avatares/'+NEIGHBOR+
  '/123e4567-e89b-42d3-a456-426614174002';
const TYPES=Object.freeze(['upload','authenticated','private']);
const PATH='/qa-controlled-cloudinary';
const fail=reason=>{throw Error('qa_controlled_media_'+reason)};

function environment(){
  if(process.env.GCLOUD_PROJECT!==PROJECT||
     process.env.FIRESTORE_EMULATOR_HOST!=='127.0.0.1:8089'||
     process.env.FIREBASE_AUTH_EMULATOR_HOST!=='127.0.0.1:9099'||
     process.env.FIREBASE_CONFIG||process.env.GOOGLE_APPLICATION_CREDENTIALS||
     process.env.FIREBASE_SERVICE_ACCOUNT_JSON||
     process.env.GOOGLE_CLOUD_PROJECT||process.env.GCLOUD_PROJECT_ID||
     process.env.CLOUDINARY_API_KEY||process.env.CLOUDINARY_API_SECRET||
     process.env.CLOUDINARY_CLOUD_NAME||
     process.env.ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED)
    fail('live_environment_denied');
}
function localOrigin(baseUrl){
  let url;
  try{url=new URL(baseUrl);}catch{fail('invalid_url')}
  if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||
     !/^\d{2,5}$/.test(url.port)||Number(url.port)>65535||
     Number(url.port)<1024||url.pathname!=='/'||url.search||
     url.hash||url.username||url.password)
    fail('only_private_loopback');
  return url.origin;
}
async function jsonResponse(res){
  if(!res||res.status!==200||typeof res.text!=='function')
    fail('unverified_http_status');
  const contentType=res.headers?.get?.('content-type');
  if(typeof contentType!=='string'||
     !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType))
    fail('invalid_content_type');
  const content=await res.text();
  if(typeof content!=='string'||content.length>8192)fail('bad_response_size');
  let result;
  try{result=JSON.parse(content);}catch{fail('invalid_response_json')}
  if(!result||typeof result!=='object'||Array.isArray(result)||
     Object.getPrototypeOf(result)!==Object.prototype)
    fail('invalid_response_object');
  return result;
}
function keys(obj,expected){
  return Object.keys(obj).sort().join(',')===expected.slice().sort().join(',');
}
export function createQaControlledCloudinaryLoopback(baseUrl,fetcher=fetch){
  environment();
  if(typeof fetcher!=='function')fail('untrusted_fetcher');
  const base=localOrigin(baseUrl);
  async function request(method,uri,body){
    environment();
    const result=await fetcher(base+uri,{
      method,redirect:'error',signal:AbortSignal.timeout(5000),
      headers:{Accept:'application/json',...(method==='POST'?
        {'Content-Type':'application/json'}:{})},
      ...(method==='POST'?{body:JSON.stringify(body)}:{})
    });
    return jsonResponse(result);
  }
  async function page(uid,type,cursor){
    if(uid!==OWNER&&uid!==NEIGHBOR)fail('unknown_uid');
    if(!TYPES.includes(type)||
       (cursor!==null&&
        (typeof cursor!=='string'||!/^[a-z0-9_-]{1,64}$/.test(cursor))))
      fail('invalid_page_scope');
    const params=new URLSearchParams({uid,type,limit:'25'});
    if(cursor!==null)params.set('cursor',cursor);
    const value=await request('GET',PATH+'/inventory?'+params);
    if(!keys(value,['items','nextCursor'])||
       !Array.isArray(value.items)||value.items.length>25||
       (value.nextCursor!==null&&
        (typeof value.nextCursor!=='string'||
         !/^[a-z0-9_-]{1,64}$/.test(value.nextCursor))))
      fail('untrusted_inventory');
    const prefix='atrio-avatares/'+uid+'/';
    const seen=new Set();
    for(const item of value.items){
      if(!item||Object.getPrototypeOf(item)!==Object.prototype||
         !keys(item,['public_id','type'])||
         item.type!==type||typeof item.public_id!=='string'||
         !item.public_id.startsWith(prefix)||
         !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
           item.public_id.slice(prefix.length))||
         seen.has(item.public_id))fail('unsafe_or_duplicate_asset');
      seen.add(item.public_id);
    }
    if(value.items.length===0&&value.nextCursor!==null)
      fail('empty_continuation_ambiguous');
    return value;
  }
  async function inventory(uid){
    const found=[],seenAssets=new Set();
    for(const type of TYPES){
      let cursor=null;
      const cursors=new Set();
      for(let n=0;n<8;n++){
        const result=await page(uid,type,cursor);
        for(const item of result.items){
          if(seenAssets.has(item.public_id))fail('duplicate_asset_across_pages');
          seenAssets.add(item.public_id);
          found.push(item);
          if(found.length>50)fail('unbounded_assets');
        }
        if(result.nextCursor===null)break;
        if(cursors.has(result.nextCursor)||n===7)
          fail('pagination_incomplete');
        cursors.add(result.nextCursor);
        cursor=result.nextCursor;
      }
    }
    return found;
  }
  async function neighborUnchanged(){
    const items=await inventory(NEIGHBOR);
    if(items.length!==1||items[0].public_id!==NEIGHBOR_PHOTO||
       items[0].type!=='upload')
      fail('neighbor_asset_missing_or_changed');
  }
  async function ownerInventory(){
    const items=await inventory(OWNER);
    if(items.some(x=>x.public_id!==PHOTO||x.type!=='authenticated'))
      fail('unexpected_owned_media');
    return items;
  }
  return Object.freeze({
    async purge(){
      environment();
      await neighborUnchanged();
      const owned=await ownerInventory();
      if(owned.length===1){
        const x=await request('POST',PATH+'/destroy',{
          public_id:PHOTO,fixtureUid:OWNER,invalidate:true,type:'authenticated'
        });
        if(!keys(x,['public_id','result'])||
           x.public_id!==PHOTO||!['deleted','not_found'].includes(x.result))
          fail('destroy_not_confirmed');
      }
      await this.empty();
      return Object.freeze({state:'qa_loopback_only_media_cleared',
        productionReady:false,remoteCloudinaryVerified:false});
    },
    async empty(){
      environment();
      for(let pass=0;pass<2;pass++){
        if((await ownerInventory()).length!==0)
          fail('owned_media_residual');
        await neighborUnchanged();
      }
      return true;
    }
  });
}
export const QA_CONTROLLED_CLOUDINARY_FIXTURES=Object.freeze({
  ownerUid:OWNER,neighborUid:NEIGHBOR,
  ownerPhoto:PHOTO,neighborPhoto:NEIGHBOR_PHOTO
});
