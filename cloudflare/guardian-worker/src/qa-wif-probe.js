// QA-only keyless identity proof. OAuth/WIF and IAM must independently authorize requests.
const PROJECT='atrio-catolico-qa-v2';
const REPO='josuepradodeoliveiracosta-gif/atrio-catolico-android';
const BRANCH='refs/heads/feature/guardiao-v2-wif-prova-qa-20261030';
const ACCOUNT='guardian-qa-reader@'+PROJECT+'.iam.gserviceaccount.com';
const FIXTURE='projects/'+PROJECT+'/databases/(default)/documents/posts/qa_post_1';
const ENDPOINT='https://firestore.googleapis.com/v1/'+FIXTURE;
const PROVIDER=/^projects\/[0-9]+\/locations\/global\/workloadIdentityPools\/guardian-github-qa\/providers\/github-qa$/;
const deny=()=>{throw Error('qa_identity_probe_denied')};
export function validateQaWifContext(e={}){
 if(e.GITHUB_REPOSITORY!==REPO||e.GITHUB_REF!==BRANCH||e.GITHUB_EVENT_NAME!=='workflow_dispatch'||
  e.QA_FIREBASE_PROJECT_ID!==PROJECT||e.QA_APPROVED_PROJECT_ID!==PROJECT||e.QA_SERVICE_ACCOUNT!==ACCOUNT||
  !PROVIDER.test(e.QA_WIF_PROVIDER||'')||e.GUARDIAN_V2_TEST_MODE!=='true'||
  e.GUARDIAN_V2_ENABLED!=='false'||e.GUARDIAN_V2_HOLD_ENABLED!=='false'||
  e.GUARDIAN_V2_QA_FIRESTORE_BRIDGE!=='false'||e.GUARDIAN_V2_QA_SHADOW_READS!=='false'||
  e.GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON||e.GOOGLE_APPLICATION_CREDENTIALS)deny();
 return true;
}
// Shared read-only QA response guard: at most 8 KiB, strict UTF-8 and JSON.
export async function readQaBoundedJson(r){
 const length=r.headers?.get('content-length');
 if(length!==null&&length!==undefined&&(!/^\d+$/.test(length)||Number(length)>8192))deny();
 if(!r.body?.getReader)deny();
 const reader=r.body.getReader(),parts=[];let n=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;
  if(!(value instanceof Uint8Array))deny();
  n+=value.byteLength;
  if(n>8192){await reader.cancel();deny()}
  parts.push(value);
 }}finally{reader.releaseLock()}
 const all=new Uint8Array(n);let i=0;
 for(const p of parts){all.set(p,i);i+=p.byteLength}
 try{return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(all))}
 catch{deny()}
}

export async function probeQaWifRead(e,fetcher=fetch){
 validateQaWifContext(e);
 const t=e.QA_ACCESS_TOKEN;
 if(typeof t!=='string'||t.length<20||/\s/.test(t))deny();
 let r;
 try{r=await fetcher(ENDPOINT,{method:'GET',headers:{Authorization:'Bearer '+t,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(6500)})}catch{deny()}
 // A fixture ausente NÃO prova autorização. Nunca produzir sucesso com HTTP 404.
 if(r.status===404)deny();
 if(r.status!==200)deny();
 let d;try{d=await readQaBoundedJson(r)}catch{deny()}
 if(d?.name!==FIXTURE||d?.fields?.qaFixture?.booleanValue!==true)deny();
 return {status:'qa_fixture_authenticated_read'};
}
if(typeof process!=='undefined'&&process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
 probeQaWifRead(process.env).then(x=>console.log('GUARDIAN_QA_WIF_PROBE',x.status))
  .catch(()=>{console.error('GUARDIAN_QA_WIF_PROBE denied');process.exitCode=1});
}
