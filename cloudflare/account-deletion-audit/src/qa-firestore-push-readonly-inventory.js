/**
 * READ-ONLY Firestore REST adapter for QA pushDevice fixture inventory.
 *
 * No Firebase Admin SDK, identity deletion, token revocation or Firestore
 * write method is imported. The API response MUST honor a field mask that
 * excludes FCM tokens. This is not proof of independently reviewed IAM.
 */
const PROJECT=/^atrio-[a-z0-9-]{1,32}-qa-[a-z0-9-]{4,24}$/;
const PROD='atrio-catolico';
const UID=new Set(['qa-freeze-alice','qa-freeze-bob']);
const TOKEN=/^[a-zA-Z0-9_-]{1,256}$/;
const DEVICE=/^qa-device-[a-z0-9-]{1,50}$/;
const REV=/^qa-rev-[0-9]{1,10}$/;
const FINGERPRINT=/^qa-fingerprint-[a-z0-9-]{1,64}$/;
const COUNT=25,LIMIT=65536;
const deny=()=>{throw Error('qa_firestore_readonly_unverified')};
const plain=x=>x!==null&&typeof x==='object'&&!Array.isArray(x)&&
  Object.getPrototypeOf(x)===Object.prototype;
async function parse(response){
  if(response?.status!==200||response?.redirected===true||
     !response.headers?.get('content-type')?.toLowerCase().startsWith('application/json')||
     !response.body)deny();
  const length=response.headers.get('content-length');
  if(length!==null&&(!/^\d{1,6}$/.test(length)||Number(length)>LIMIT))
    deny();
  const reader=response.body.getReader();
  const decoder=new TextDecoder('utf8',{fatal:true});
  let bytes=0,raw='';
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      bytes+=value.byteLength;
      if(bytes>LIMIT)deny();
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  try{
    const obj=JSON.parse(raw);
    if(!plain(obj))deny();
    return obj;
  }catch{deny();}
}
const validateProjectIdentity=(x,projectId,projectNumber)=>
  plain(x)&&Object.keys(x).sort().join(',')==='projectId,projectNumber'&&
  x.projectId===projectId&&x.projectNumber===projectNumber;

export async function createQaFirestorePushReadonlyInventory({
  qaProjectId,productionProjectId,qaProjectNumber,productionProjectNumber,
  accessToken,fetcher,inspectProjectIdentity
}={}){
  if(typeof qaProjectId!=='string'||!PROJECT.test(qaProjectId)||
     productionProjectId!==PROD||qaProjectId===PROD||
     typeof qaProjectNumber!=='string'||!/^\d{6,15}$/.test(qaProjectNumber)||
     typeof productionProjectNumber!=='string'||
     !/^\d{6,15}$/.test(productionProjectNumber)||
     qaProjectNumber===productionProjectNumber||
     typeof accessToken!=='string'||accessToken.length<16||
     accessToken.length>8192||!/^[-._~+/=a-zA-Z0-9]+$/.test(accessToken)||
     typeof fetcher!=='function'||typeof inspectProjectIdentity!=='function')
    deny();

  async function assertIdentity(){
    try{
      const identity=await inspectProjectIdentity();
      if(!validateProjectIdentity(identity,qaProjectId,qaProjectNumber))
        deny();
      return true;
    }catch{deny();}
  }
  await assertIdentity();
  const prefix='projects/'+qaProjectId+'/databases/(default)/documents/';
  const origin='https://firestore.googleapis.com/v1/';
  const bearer='Bearer '+accessToken;
  async function get(url){
    try{
      const request=new Request(url,{method:'GET',redirect:'error',headers:{
        Authorization:bearer,Accept:'application/json'
      }});
      return await parse(await fetcher(request));
    }catch{deny();}
  }
  return Object.freeze({
    async readPage({uid,type,cursor=null,limit}={}){
      if(!UID.has(uid)||type!=='device'||limit!==COUNT||
         (cursor!==null&&(typeof cursor!=='string'||!TOKEN.test(cursor))))
        deny();
      await assertIdentity();
      let rawToken=null;
      if(cursor!==null){
        try{
          rawToken=Buffer.from(cursor,'base64url').toString('utf8');
          if(Buffer.from(rawToken,'utf8').toString('base64url')!==cursor||
             rawToken.length<1||rawToken.length>160)deny();
        }catch{deny();}
      }
      const parent=prefix+'users/'+uid+'/pushDevices';
      const url=new URL(origin+parent);
      url.searchParams.set('pageSize',String(COUNT));
      // Prevent the HTTP service from including FCM registration values.
      url.searchParams.append('mask.fieldPaths','qaFingerprint');
      url.searchParams.append('mask.fieldPaths','qaRevision');
      if(rawToken!==null)url.searchParams.set('pageToken',rawToken);
      const data=await get(url);
      const docs=data.documents===undefined?[]:data.documents;
      if(!Array.isArray(docs)||docs.length>COUNT)deny();
      const items=docs.map(doc=>{
        if(!plain(doc)||typeof doc.name!=='string'||
           !doc.name.startsWith(parent+'/')||
           !DEVICE.test(doc.name.slice((parent+'/').length))||
           !plain(doc.fields)||
           Object.keys(doc.fields).sort().join(',')!=='qaFingerprint,qaRevision'||
           !plain(doc.fields.qaFingerprint)||
           !plain(doc.fields.qaRevision)||
           !FINGERPRINT.test(doc.fields.qaFingerprint.stringValue||'')||
           !REV.test(doc.fields.qaRevision.stringValue||'')||
           typeof doc.updateTime!=='string'||
           !Number.isFinite(Date.parse(doc.updateTime)))
          deny();
        return {path:'users/'+uid+'/pushDevices/'+
          doc.name.slice((parent+'/').length),
          tokenFingerprint:doc.fields.qaFingerprint.stringValue,
          revision:doc.fields.qaRevision.stringValue};
      });
      const remoteNext=data.nextPageToken??null;
      if(remoteNext!==null&&
         (typeof remoteNext!=='string'||remoteNext.length<1||
          remoteNext.length>160||items.length===0))deny();
      const next=remoteNext===null?null:
        Buffer.from(remoteNext,'utf8').toString('base64url');
      if(next!==null&&!TOKEN.test(next))deny();
      return {items,nextCursor:next,complete:true};
    },
    async assertIdentity(){return await assertIdentity();},
    qaOnly:true,readOnly:true,productionReady:false,
    remoteTokenRevocationVerified:false,
    crossProjectIamVerified:false,
    liveAccountDeletionHomologated:false
  });
}
