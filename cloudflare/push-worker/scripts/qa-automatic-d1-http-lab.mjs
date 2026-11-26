// Private HTTP candidate. Explicit fetch, credential and activation required.
// Never imported by the deployed Worker. One factory per invocation.
import {createMeteredD1Lab} from './qa-automatic-d1-metered-lab.mjs';
import {D1_LAB_ENVELOPE} from './qa-automatic-d1-budget-lab.mjs';
import {AUTO_CHAT} from '../../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const project=identity.projectId,root='projects/'+project+'/databases/'+identity.databaseId+'/documents';
const fs='https://firestore.googleapis.com/v1/'+root;
const oauth='https://oauth2.googleapis.com/token';
const accountEmail='atrio-qa-general-push@'+project+'.iam.gserviceaccount.com';
const auth='https://identitytoolkit.googleapis.com/v1';
const uids=Object.keys(identity.accounts);
const id=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const hex=x=>typeof x==='string'&&/^[a-f0-9]{64}$/.test(x);
const tx=x=>typeof x==='string'&&/^[A-Za-z0-9+/=_-]{1,4096}$/.test(x);
const exact=(x,keys)=>!!x&&typeof x==='object'&&!Array.isArray(x)&&Object.keys(x).length===keys.length&&keys.every(k=>Object.hasOwn(x,k));
const str=x=>exact(x,['stringValue'])&&typeof x.stringValue==='string'?x.stringValue:null;
const enc=new TextEncoder();
const fail=()=>{throw Error('qa_d1_http_unavailable')};
const b64=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
const jwtPart=x=>b64(enc.encode(JSON.stringify(x)));
function allowedDocument(name){
 if(typeof name!=='string'||!name.startsWith(root+'/'))return false;
 const path=name.slice(root.length+1),parts=path.split('/');
 if(['app_config/conversations','serverInboxControl/writeBoundary','serverInboxControl/pagination','chats/'+AUTO_CHAT].includes(path))return true;
 if(parts.length===4&&parts[0]==='chats'&&parts[1]===AUTO_CHAT&&parts[2]==='messages'&&id(parts[3]))return true;
 if(parts.length===2&&['qaPushAutomaticOutbox','qaPushAutomaticRetries'].includes(parts[0])&&hex(parts[1]))return true;
 if(parts.length!==4||parts[0]!=='users'||!uids.includes(parts[1]))return false;
 return (['chatPushAdmission','chatAgeEligibility','chatPushPending'].includes(parts[2])&&parts[3]==='current')||
  (parts[2]==='chatBox'&&parts[3]===AUTO_CHAT)||
  (parts[2]==='blockedMembers'&&uids.includes(parts[3])&&parts[1]!==parts[3])||
  (parts[2]==='chatPushPublicationReceipts'&&hex(parts[3]));
}
const masks=['status','lastMessageId','lastSenderUid','participants','requesterUid','recipientUid','unreadRequester','unreadRecipient','uid','kind','createdAt','deletedForAll'];
function validateRead(req){
 if(req?.method!=='POST'||req.redirect!=='error'||typeof req.url!=='string'||!req.url.startsWith(fs))fail();
 const suffix=req.url.slice(fs.length),b=req.body;
 if(suffix===':beginTransaction'){if(!exact(b,['options'])||!exact(b.options,['readOnly'])||!exact(b.options.readOnly,[]))fail()}
 else if(suffix===':rollback'){if(!exact(b,['transaction'])||!tx(b.transaction))fail()}
 else if(suffix===':batchGet'){
  const transactional=exact(b,['documents','transaction']),discovery=exact(b,['documents','mask']);
  if(!(transactional||discovery)||!Array.isArray(b.documents)||!b.documents.length||b.documents.length>11||
     new Set(b.documents).size!==b.documents.length||!b.documents.every(allowedDocument))fail();
  if(transactional&&!tx(b.transaction))fail();
  if(discovery&& (b.documents.length!==1||!exact(b.mask,['fieldPaths'])||!Array.isArray(b.mask.fieldPaths)||
     !b.mask.fieldPaths.length||b.mask.fieldPaths.length>8||!b.mask.fieldPaths.every(x=>masks.includes(x))))fail();
 }else if(uids.some(u=>suffix==='/users/'+u+':runQuery')){
  if(!exact(b,['structuredQuery','transaction'])||!tx(b.transaction))fail();
  const q=b.structuredQuery;
  if(!exact(q,['select','from','limit'])||q.limit!==5||
     JSON.stringify(q.from)!=='[{"collectionId":"pushDevices"}]'||
     JSON.stringify(q.select)!=='{"fields":[{"fieldPath":"token"},{"fieldPath":"updatedAt"}]}')fail();
 }else fail();
}
async function boundedJson(r){
 if(!r?.body||typeof r.body.getReader!=='function')fail();
 const reader=r.body.getReader(),chunks=[];let bytes=0;
 try{
  while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;
   if(bytes>2*1024*1024){await reader.cancel();fail()}chunks.push(value)}
 }finally{reader.releaseLock()}
 const all=new Uint8Array(bytes);let n=0;
 for(const c of chunks){all.set(c,n);n+=c.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all))}catch{fail()}
}
function account(a){
 return !!a&&uids.includes(a.localId)&&a.email===identity.accounts[a.localId]&&a.emailVerified===true&&
  (a.disabled===false||a.disabled===undefined);
}
export function createD1HttpLab({enabled=false,kind,fetchImpl,serviceAccount,webApiKey}={}){
 if(!['tick','notice'].includes(kind)||typeof fetchImpl!=='function')fail();
 const cap=kind==='tick'?D1_LAB_ENVELOPE.externalPerTick:D1_LAB_ENVELOPE.externalPerNotice;
 let attempts=0,access=null,oauthStarted=false,sent=false;
 function ready(){
  if(enabled!==true||serviceAccount?.project_id!==project||serviceAccount.client_email!==accountEmail||
     typeof serviceAccount.private_key!=='string'||serviceAccount.private_key.length>8192||
     typeof webApiKey!=='string'||!/^[A-Za-z0-9_-]{1,256}$/.test(webApiKey))fail();
 }
 async function request(url,init){
  ready();if(attempts>=cap)fail();attempts++;
  const r=await fetchImpl(url,{...init,redirect:'manual',signal:AbortSignal.timeout(10000)});
  if(!Number.isInteger(r?.status)||r.status<200||r.status>599||(r.status>=300&&r.status<400)||r.type==='opaqueredirect')fail();
  return r;
 }
 async function token(){
  ready();if(access)return access;if(oauthStarted)fail();oauthStarted=true;
  const pem=/^-----BEGIN PRIVATE KEY-----\s+([A-Za-z0-9+/=\s]+)-----END PRIVATE KEY-----\s*$/.exec(serviceAccount.private_key);
  if(!pem)fail();
  const key=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem[1].replace(/\s/g,'')),x=>x.charCodeAt(0)),
   {name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['sign']);
  const now=Math.floor(Date.now()/1000);
  const unsigned=jwtPart({alg:'RS256',typ:'JWT'})+'.'+jwtPart({iss:accountEmail,aud:oauth,iat:now,exp:now+300,
   scope:'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/identitytoolkit https://www.googleapis.com/auth/firebase.messaging'});
  const assertion=unsigned+'.'+b64(new Uint8Array(await crypto.subtle.sign('RSASSA-PKCS1-v1_5',key,enc.encode(unsigned))));
  const r=await request(oauth,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},
   body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion}).toString()});
  if(r.status!==200)fail();
  const b=await boundedJson(r);
  if(typeof b?.access_token!=='string'||!/^[A-Za-z0-9._~-]{1,4096}$/.test(b.access_token)||
     String(b.token_type).toLowerCase()!=='bearer'||!Number.isSafeInteger(b.expires_in)||b.expires_in<60)fail();
  access=b.access_token;return access;
 }
 async function service(url,method,body){
  const t=await token();
  return request(url,{method,headers:{Authorization:'Bearer '+t,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 }
 return Object.freeze({
  async transport(req){
   validateRead(req);
   const r=await service(req.url,'POST',req.body);
   return {status:r.status,body:r.status===200?await boundedJson(r):null};
  },
  async lookupAccounts(requested){
   if(!Array.isArray(requested)||requested.length!==2||new Set(requested).size!==2||!requested.every(u=>uids.includes(u)))fail();
   const r=await service(auth+'/projects/'+project+'/accounts:lookup','POST',{localId:requested});
   if(r.status!==200)fail();
   const b=await boundedJson(r);
   if(!Array.isArray(b?.users)||b.users.length!==2||new Set(b.users.map(a=>a?.localId)).size!==2||!b.users.every(account))fail();
   return Object.fromEntries(b.users.map(a=>[a.localId,{uid:a.localId,email:a.email,emailVerified:true,disabled:false}]));
  },
  async verifyIdentity(req){
   ready();if(kind!=='notice')return null;
   const jwt=/^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/.exec(req.headers.get('Authorization')||'')?.[1];
   if(!jwt||jwt.length>5000)return null;
   let c;
   try{const payload=jwt.split('.')[1];c=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(payload.replaceAll('-','+').replaceAll('_','/')+'='.repeat((4-payload.length%4)%4)),x=>x.charCodeAt(0))))}catch{return null}
   const now=Math.floor(Date.now()/1000);
   if(c?.aud!==project||c.iss!=='https://securetoken.google.com/'+project||!uids.includes(c.sub)||
      !Number.isSafeInteger(c.exp)||c.exp<=now||!Number.isSafeInteger(c.auth_time)||c.auth_time>now)return null;
   // Claims only reject; the exact ID token must be authenticated by Google.
   const r=await request(auth+'/accounts:lookup?key='+encodeURIComponent(webApiKey),{method:'POST',
    headers:{'Content-Type':'application/json'},body:JSON.stringify({idToken:jwt})});
   if(r.status!==200)return null;
   const b=await boundedJson(r),a=b?.users?.[0];
   if(!Array.isArray(b?.users)||b.users.length!==1||!account(a)||a.localId!==c.sub||
      typeof a.validSince!=='string'||!/^\d+$/.test(a.validSince)||Number(a.validSince)>c.auth_time)return null;
   return a.localId;
  },
  async listDevices(uid){
   if(kind!=='tick'||!uids.includes(uid))fail();
   const prefix=root+'/users/'+uid+'/pushDevices/';
   const r=await service(fs+'/users/'+uid+'/pushDevices?pageSize=6','GET');
   if(r.status!==200)fail();
   const b=await boundedJson(r),docs=b?.documents??[];
   if(b.nextPageToken||!Array.isArray(docs)||docs.length>5)fail();
   const seen=new Set();
   return docs.map(d=>{
    if(typeof d?.name!=='string'||!d.name.startsWith(prefix)||!id(d.name.slice(prefix.length))||seen.has(d.name))fail();
    seen.add(d.name);
    const token=str(d.fields?.token),v=d.fields?.updatedAt;
    if(!token||!exact(v,['timestampValue'])||typeof v.timestampValue!=='string'||typeof d.updateTime!=='string')fail();
    const time=Date.parse(v.timestampValue);
    if(!Number.isSafeInteger(time)||!Number.isFinite(Date.parse(d.updateTime)))fail();
    return {token,time,path:d.name.slice(root.length+1),updateTime:d.updateTime};
   }).filter(x=>x.token.length>=20&&x.token.length<=4096&&x.time>Date.now()-60*86400000&&x.time<=Date.now()+60000);
  },
  async sendRefresh(message){
   if(kind!=='tick'||sent||!exact(message,['token','data','android'])||typeof message.token!=='string'||
      message.token.length<20||message.token.length>4096||!exact(message.data,['signal'])||message.data.signal!=='refresh'||
      !exact(message.android,['priority','ttl'])||message.android.priority!=='HIGH'||
      !/^(?:[1-5]\d|60)s$/.test(message.android.ttl))fail();
   sent=true;
   const r=await service('https://fcm.googleapis.com/v1/projects/'+project+'/messages:send','POST',{message});
   return {ok:r.status===200,status:r.status,json:()=>boundedJson(r)};
  },
  usage:()=>({actualExternalAttempts:attempts,oauthAttempted:oauthStarted,fcmAttempted:sent})
 });
}
// Private composition only. No fetch default or route registration.
export function createD1HttpCandidateLab({db,enabled=false,activatedAt,fetchImpl,manualWorker}={}){
 function scoped(kind,env){
  let serviceAccount;
  if(enabled===true){try{serviceAccount=JSON.parse(env?.FIREBASE_SERVICE_ACCOUNT_JSON??'null')}catch{serviceAccount=null}}
  const http=createD1HttpLab({enabled,kind,fetchImpl,serviceAccount,webApiKey:env?.FIREBASE_WEB_API_KEY});
  const flow=createMeteredD1Lab({db,enabled,activatedAt,manualWorker,transport:http.transport,
   lookupAccounts:http.lookupAccounts,verifyIdentity:http.verifyIdentity,listDevices:http.listDevices,sendRefresh:http.sendRefresh});
  return {http,flow};
 }
 return Object.freeze({
  async tick(env){const {http,flow}=scoped('tick',env);return {...await flow.tick(env),httpUsage:http.usage()}},
  async notice(req,env){const {http,flow}=scoped('notice',env);return {...await flow.notice(req,env),httpUsage:http.usage()}}
 });
}
