/**
 * Fail-closed HTTP QA entry for three original Workers. Only a fixed offline
 * fixture host and the shared, in-memory SQLite coordinator are admissible.
 *
 * WARNING: This is an intentionally nondeployable harness interface, NOT
 * Firebase authentication, IAM, a Cloudflare service binding, or a live API.
 */
const ROOT='https://qa-only.invalid/__qa/shared-freeze';
const SERVICES=new Set(['avatar','guardian','push']);
const FIXTURE_UIDS=new Set(['qa-freeze-alice','qa-freeze-bob']);
const SECRETS=Object.freeze([
  'FIREBASE_SERVICE_ACCOUNT_JSON','FIREBASE_WEB_API_KEY','PUSH_DB',
  'AVATAR_DB','CLOUDINARY_API_KEY','CLOUDINARY_API_SECRET',
  'CLOUDINARY_CLOUD_NAME','GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON',
  'GUARDIAN_FIREBASE_PROJECT_ID','AI','GOOGLE_APPLICATION_CREDENTIALS'
]);
function deny(){throw Error('qa_shared_worker_denied');}
export function qaSharedMode(env){
  const value=env?.ATRIO_PRIVACY_QA_SHARED_MODE;
  return value!==undefined&&value!==null&&value!==false&&
    value!==''&&value!=='false';
}
export function qaSharedResponse(status,code){
  return new Response(JSON.stringify({status:code}),{
    status,headers:{'content-type':'application/json','cache-control':'no-store'}
  });
}
async function boundedBody(request){
  const length=request.headers.get('content-length');
  if(length!==null && (!/^\d+$/.test(length)||Number(length)>192))deny();
  const reader=request.body?.getReader();
  if(!reader)deny();
  let total=0,raw='';
  const decoder=new TextDecoder('utf-8',{fatal:true});
  try{
    while(true){
      const {done,value}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>192)deny();
      raw+=decoder.decode(value,{stream:true});
    }
    raw+=decoder.decode();
  }finally{reader.releaseLock();}
  try{return JSON.parse(raw);}catch{deny();}
}
function scopeOf(service,body){
  if(!body||typeof body!=='object'||Array.isArray(body))deny();
  const keys=Object.keys(body).sort().join(',');
  const expected=service==='push'?'actorUid,recipientUid':'ownerUid';
  if(keys!==expected)deny();
  if(Object.values(body).some(v=>!FIXTURE_UIDS.has(v)))deny();
  if(service==='push'&&body.actorUid===body.recipientUid)deny();
  return Object.freeze({...body});
}
export async function qaSharedWorkerRequest(request,env,service){
  // Do not evaluate secret getters; simply reject the presence of any
  // production credential/binding keys before reading the body.
  if(!SERVICES.has(service)||!request||!env||
     env.ATRIO_PRIVACY_QA_SHARED_MODE!=='true'||
     env.ATRIO_QA_PRIVACY_FIXTURE!=='demo-atrio-v11'||
     request.method!=='POST'||request.url!==ROOT+'/'+service||
     SECRETS.some(k=>k in env)||
     typeof env.ATRIO_QA_PRIVACY_COORDINATOR?.forService!=='function'||
     typeof env.ATRIO_QA_PRIVACY_FAKE_EFFECT!=='function'||
     typeof env.ATRIO_QA_PRIVACY_FAKE_VERIFY!=='function')deny();
  const scope=scopeOf(service,await boundedBody(request));
  // Worker supplies the service identity; the HTTP caller cannot request
  // another service's permissions or call beginFreeze/finalizeFreeze.
  const actor=env.ATRIO_QA_PRIVACY_COORDINATOR.forService(service);
  if(typeof actor?.execute!=='function')deny();
  return actor.execute(scope,{
    effect:()=>env.ATRIO_QA_PRIVACY_FAKE_EFFECT(service,scope),
    verify:(_,output)=>env.ATRIO_QA_PRIVACY_FAKE_VERIFY(service,scope,output)
  });
}
export const QA_SHARED_WORKER_ENTRY_READINESS=Object.freeze({
  productionIntegrated:false,liveWorkerNetworkAccess:false,
  testOnlyEndpoint:true,realIAM:false
});
