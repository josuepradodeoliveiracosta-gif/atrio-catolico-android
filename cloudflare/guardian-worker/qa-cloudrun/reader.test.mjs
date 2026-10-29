import {test} from 'node:test';
import assert from 'node:assert/strict';
import {allowCloudRunQa,metadata,runCloudRunQa,QA_READER_SERVICE_ACCOUNT} from './reader.mjs';
import {createQaHandler} from './server.mjs';

const enabled={
 GUARDIAN_QA_CLOUD_RUN_ENABLED:'true',
 GUARDIAN_QA_CLOUD_RUN_PROJECT:'atrio-catolico-qa-v2',
 GUARDIAN_QA_CLOUD_RUN_ALLOWED_PROJECT:'atrio-catolico-qa-v2',
 GUARDIAN_V2_ENABLED:'false',GUARDIAN_V2_HOLD_ENABLED:'false',
 GUARDIAN_V2_TEST_MODE:'true'
};
const prefix='projects/atrio-catolico-qa-v2/databases/(default)/documents/';
const qaDoc=(path,body)=>({name:prefix+path,fields:{
 qaFixture:{booleanValue:true},body:{stringValue:body}
}});
test('QA Cloud Run disabled until every flag and project match',()=>{
 assert.equal(allowCloudRunQa(enabled),true);
 for(const [key,value] of Object.entries({
  GUARDIAN_QA_CLOUD_RUN_ENABLED:'false',
  GUARDIAN_QA_CLOUD_RUN_PROJECT:'atrio-catolico',
  GUARDIAN_QA_CLOUD_RUN_ALLOWED_PROJECT:'another',
  GUARDIAN_V2_ENABLED:'true',
  GUARDIAN_V2_HOLD_ENABLED:'true',
  GUARDIAN_V2_TEST_MODE:'false',
  GUARDIAN_FIREBASE_SERVICE_ACCOUNT_JSON:'{"private_key":"fake"}',
  GUARDIAN_QA_ACCESS_TOKEN:'token'
 }))assert.equal(allowCloudRunQa({...enabled,[key]:value}),false,key);
});
test('disabled reader never fetches tokens or data',async()=>{
 let called=false;
 const result=await runCloudRunQa({...enabled,GUARDIAN_QA_CLOUD_RUN_ENABLED:'false'},{
  obtainToken(){called=true;throw Error('must not call');}
 });
 assert.deepEqual(result,{status:'disabled'});
 assert.equal(called,false);
});
test('metadata token from attached reader identity only',async()=>{
 const requests=[];
 const fetcher=async(url,opts)=>{
  requests.push({url,opts});
  if(url.endsWith('/email'))return new Response(QA_READER_SERVICE_ACCOUNT,{status:200});
  return new Response(JSON.stringify({access_token:'a'.repeat(26),token_type:'Bearer',expires_in:300}),{status:200});
 };
 const out=await metadata(fetcher);
 assert.equal(out,'a'.repeat(26));
 assert.equal(requests.length,2);
 assert.ok(requests.every(x=>x.url.startsWith('http://metadata.google.internal/')));
 assert.ok(requests.every(x=>x.opts.headers['Metadata-Flavor']==='Google'));
});
test('metadata refuses any other Google service account',async()=>{
 let calls=0;
 const f=async()=>++calls===1?
 new Response('service-account-for-production@atrio-catolico.iam.gserviceaccount.com',{status:200}):
 new Response(JSON.stringify({access_token:'a'.repeat(26),token_type:'Bearer',expires_in:300}),{status:200});
 await assert.rejects(metadata(f),/wrong_service_identity/);
});
test('metadata refuses missing or short-lived access token',async()=>{
 let calls=0;
 const f=async()=>++calls===1?
  new Response(QA_READER_SERVICE_ACCOUNT,{status:200}):
  new Response(JSON.stringify({access_token:'a'.repeat(26),token_type:'Bearer',expires_in:20}),{status:200});
 await assert.rejects(metadata(f),/identity_token_unavailable/);
});
test('QA service does at most 3 read-only queries, no writes',async()=>{
 const scanArgs=[];let writes=0;
 const reader={
  async scanQa(group,minutes,max){
   scanArgs.push([group,minutes,max]);
   if(group==='posts')return [qaDoc('posts/qa-post','Qual é a Eucaristia?')];
   if(group==='replies')return [qaDoc('posts/qa-post/replies/qa-phish','Clique https://exemplo.invalid e informe sua senha')];
   return [{name:prefix+'reports/qa-report',fields:{qaFixture:{booleanValue:true}}}];
  },
  async commit(){writes++},
  async create(){writes++},
  async update(){writes++}
 };
 const r=await runCloudRunQa(enabled,{reader,obtainToken:async()=> 'a'.repeat(26)});
 assert.equal(r.status,'shadow_read_only');
 assert.equal(r.counts.clear,1);
 assert.equal(r.counts.hold_candidate,1);
 assert.equal(r.counts.reports,1);
 assert.deepEqual(scanArgs,[['posts',20,15],['replies',20,15],['reports',20,15]]);
 assert.equal(writes,0);
 assert.ok(!JSON.stringify(r).includes('senha'));
});
test('Firestore read error returns unavailable, not success',async()=>{
 const r=await runCloudRunQa(enabled,{
  obtainToken:async()=> 'a'.repeat(26),
  reader:{async scanQa(){throw Error('private firebase data must not appear')}}
 });
 assert.deepEqual(r,{status:'unavailable'});
 assert.ok(!JSON.stringify(r).includes('private'));
});
test('missing synthetic data fails closed',async()=>{
 const r=await runCloudRunQa(enabled,{
  obtainToken:async()=> 'a'.repeat(26),
  reader:{async scanQa(){return []}}
 });
 assert.deepEqual(r,{status:'unavailable'});
});
const request=async(method,url,env,body,read=async()=>({status:'shadow_read_only',counts:{clear:1}}))=>{
 const req={method,url,headers:body?{'content-length':String(body.length)}:{}};
 const res={status:0,payload:'',writeHead(status){this.status=status},end(data){this.payload=data}};
 await createQaHandler(env,read)(req,res);
 return {status:res.status,result:JSON.parse(res.payload)};
};
test('HTTP refuses read when guard disabled',async()=>{
 const a=await request('POST','/run',{...enabled,GUARDIAN_QA_CLOUD_RUN_ENABLED:'false'});
 assert.equal(a.status,503);
});
test('HTTP rejects data in body and any other path or method',async()=>{
 assert.equal((await request('GET','/run',enabled)).status,404);
 assert.equal((await request('POST','/other',enabled)).status,404);
 assert.equal((await request('POST','/run',enabled,'{"project":"atrio-catolico"}')).status,400);
});
test('HTTP reports aggregates without text or input-specific data',async()=>{
 const a=await request('POST','/run',enabled);
 assert.equal(a.status,200);
 assert.deepEqual(a.result,{status:'shadow_read_only',counts:{clear:1}});
});
test('HTTP fails safe if the reader returns unavailable',async()=>{
 const a=await request('POST','/run',enabled,undefined,async()=>({status:'unavailable'}));
 assert.equal(a.status,503);
});
