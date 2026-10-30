// GitHub QA only. WIF IAM GET != Firebase Auth Security Rules proof.
const PROJECT='atrio-catolico-qa-v2';
const DOC='projects/'+PROJECT+'/databases/(default)/documents/posts/qa_post_1';
export async function qaReadiness(env,fetcher=fetch){
 if(env.QA_FIREBASE_PROJECT_ID!==PROJECT||env.QA_APPROVED_PROJECT_ID!==PROJECT)
  throw Error('wrong_qa_project');
 if(typeof env.QA_ACCESS_TOKEN!=='string'||env.QA_ACCESS_TOKEN.length<20)
  throw Error('missing_wif');
 const headers={Authorization:'Bearer '+env.QA_ACCESS_TOKEN,Accept:'application/json'};
 const opts={method:'GET',headers,redirect:'error',signal:AbortSignal.timeout(8000)};
 const result={fixture:'UNAVAILABLE',authConfig:'UNAVAILABLE'};
 try{
  const r=await fetcher('https://firestore.googleapis.com/v1/'+DOC,opts);
  if(r.status===404)result.fixture='MISSING';
  else if(r.status===401||r.status===403)result.fixture='NOT_AUTHORIZED';
  else if(r.ok){
   // Never print or echo Firebase document, token or third-party errors.
   const raw=await r.text();
   if(Buffer.byteLength(raw,'utf8')>8192)result.fixture='INVALID';
   else{
    const data=JSON.parse(raw);
    result.fixture=data?.name===DOC&&data.fields?.qaFixture?.booleanValue===true
      && typeof data.fields?.title?.stringValue==='string'
      && data.fields.title.stringValue.length<=120
      && typeof data.fields?.body?.stringValue==='string'
      && data.fields.body.stringValue.length<=1200?'READY':'INVALID';
   }
  }
 }catch{}
 try{
  const r=await fetcher('https://identitytoolkit.googleapis.com/admin/v2/projects/'+PROJECT+'/config',opts);
  if(r.ok)result.authConfig='VISIBLE_NOT_A_LOGIN_TEST';
  else if(r.status===404)result.authConfig='NOT_FOUND';
  else if(r.status===401||r.status===403)result.authConfig='NOT_AUTHORIZED';
 }catch{}
 return result;
}
if(process.argv[1]&&import.meta.url.endsWith(process.argv[1])){
 try{
  const status=await qaReadiness(process.env);
  console.log('GUARDIAN_QA_FIREBASE_READINESS',JSON.stringify(status));
 }catch{
  console.error('GUARDIAN_QA_FIREBASE_READINESS BLOCKED');
  process.exitCode=1;
 }
}
