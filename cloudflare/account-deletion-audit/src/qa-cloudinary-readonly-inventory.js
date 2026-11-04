/**
 * READ-ONLY Cloudinary Admin API adapter for an explicitly separate QA
 * product environment. NEVER used for production, upload or destroy.
 *
 * A matching cloud_name is NOT proof of IAM least privilege, independent
 * account ownership, CDN invalidation, derived assets or backups.
 *
 * All remote requests require an explicitly supplied fetcher and credentials.
 * Nothing discovers or imports the Cloudinary credentials of deployed Workers.
 */
const QA_CLOUD=/^qa-atrio-privacy-[a-z0-9-]{4,32}$/;
const UID=new Set(['qa-freeze-alice','qa-freeze-bob']);
const TYPES=new Set(['upload','authenticated','private']);
const ASSET_ID=/^[a-f0-9]{32}$/;
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const CURSOR=/^[a-zA-Z0-9_-]{1,256}$/;
const PREFIX='atrio-privacy-qa-20261103/';
const PAGE=25,MAX_RESPONSE=65536;
function deny(){throw Error('qa_cloudinary_readonly_unverified')}
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
async function readJson(response){
  if(response?.status!==200||response?.redirected===true||
     !response.headers?.get('content-type')?.toLowerCase()
       .startsWith('application/json')||!response.body)deny();
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^[0-9]{1,6}$/.test(length)||
    Number(length)>MAX_RESPONSE))deny();
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf-8',{fatal:true});
  let data='',size=0;
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      size+=value.byteLength;
      if(size>MAX_RESPONSE)deny();
      data+=decoder.decode(value,{stream:true});
    }
    data+=decoder.decode();
  }finally{reader.releaseLock();}
  try{
    const decoded=JSON.parse(data);
    if(!plain(decoded))deny();
    return decoded;
  }catch{deny();}
}
/**
 * The operator must independently identify the real production cloud and
 * provide a *different* QA cloud. This static comparison does NOT prove the
 * configured production identity is genuine; deployment signoff is separate.
 */
export async function createQaCloudinaryReadonlyInventory({
  cloudName,productionCloudName,apiKey,apiSecret,fetcher
}={}){
  if(typeof cloudName!=='string'||!QA_CLOUD.test(cloudName)||
     typeof productionCloudName!=='string'||
     !/^[a-z0-9_-]{3,128}$/.test(productionCloudName)||
     productionCloudName===cloudName||
     typeof apiKey!=='string'||!/^[-_a-zA-Z0-9]{4,80}$/.test(apiKey)||
     typeof apiSecret!=='string'||apiSecret.length<16||
     apiSecret.length>240||!/^[\x21-\x7e]+$/.test(apiSecret)||
     typeof fetcher!=='function')deny();

  // Never place credentials into a URL, returned result, exception or log.
  const credential='Basic '+Buffer.from(apiKey+':'+apiSecret,'utf8')
    .toString('base64');
  const base='https://api.cloudinary.com/v1_1/'+cloudName+'/';
  async function get(relative,query=null){
    const url=new URL(base+relative);
    if(query)for(const [key,val] of Object.entries(query))
      url.searchParams.set(key,val);
    try{
      const response=await fetcher(new Request(url,{
        method:'GET',redirect:'error',
        headers:{Authorization:credential,Accept:'application/json'}
      }));
      return await readJson(response);
    }catch{deny();}
  }
  let pinnedCreation=null;
  async function assertIdentity(){
    const data=await get('config');
    if(data.cloud_name!==cloudName||
       typeof data.created_at!=='string'||
       !/^20\d\d-\d\d-\d\dT/.test(data.created_at)||
       !Number.isFinite(Date.parse(data.created_at)))deny();
    if(pinnedCreation!==null&&data.created_at!==pinnedCreation)deny();
    pinnedCreation=data.created_at;
    return true;
  }
  await assertIdentity();

  return Object.freeze({
    async readPage({uid,type,cursor=null,limit}={}){
      if(!UID.has(uid)||!TYPES.has(type)||limit!==PAGE||
         (cursor!==null&&(typeof cursor!=='string'||!CURSOR.test(cursor))))deny();
      await assertIdentity(); // detect target swaps and invalidated keys
      const query={prefix:PREFIX+uid+'/',max_results:String(PAGE)};
      if(cursor!==null)query.next_cursor=cursor;
      const data=await get('resources/image/'+type,query);
      if(!Array.isArray(data.resources)||
         data.resources.length>PAGE)deny();
      const items=data.resources.map(item=>{
        if(!plain(item)||item.type!==type||
           (item.resource_type!==undefined&&item.resource_type!=='image')||
           typeof item.public_id!=='string'||
           !item.public_id.startsWith(PREFIX+uid+'/')||
           !UUID.test(item.public_id.slice((PREFIX+uid+'/').length))||
           typeof item.asset_id!=='string'||!ASSET_ID.test(item.asset_id))
          deny();
        return {type,public_id:item.public_id,asset_id:item.asset_id};
      });
      const next=data.next_cursor===undefined?null:data.next_cursor;
      if(next!==null&&(typeof next!=='string'||!CURSOR.test(next)||items.length===0))deny();
      return {items,nextCursor:next,complete:true};
    },
    async assertIdentity(){return await assertIdentity();},
    qaOnly:true,readOnly:true,remoteDeletionVerified:false,
    independentlyIsolatedAccountVerified:false,
    backupsVerified:false,derivedAssetsVerified:false,
    cdnPurgeVerified:false,productionReady:false
  });
}
