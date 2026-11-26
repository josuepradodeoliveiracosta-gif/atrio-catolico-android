import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,verify} from 'node:crypto';
import {probeQaIdentityLab} from '../../cloudflare/push-worker/scripts/qa-automatic-d1-identity-probe-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-identity.mjs';
const project=identity.projectId,email='atrio-qa-general-push@'+project+'.iam.gserviceaccount.com';
const root='https://firestore.googleapis.com/v1/projects/'+project+'/databases/'+identity.databaseId+'/documents';
const oauth='https://oauth2.googleapis.com/token',auth='https://identitytoolkit.googleapis.com/v1/projects/'+project+'/accounts:lookup';
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const service={project_id:project,client_email:email,private_key:privateKey.export({type:'pkcs8',format:'pem'})};
const env={QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify(service),QA_FIREBASE_WEB_API_KEY:'fixture'};
function fixture({failAt=null,redirectAt=null,invalidAccount=false,malformedBegin=false}={}){
 const calls=[];
 const fetchImpl=async(url,init)=>{
  calls.push(url);assert.equal(init.method,'POST');assert.equal(init.redirect,'manual');
  if(url===redirectAt)return new Response(null,{status:302,headers:{location:'https://other.invalid'}});
  if(url===failAt)return Response.json({error:'SENSITIVE_PROVIDER_ERROR'},{status:403});
  if(url===oauth){
   const [h,p,s]=new URLSearchParams(init.body).get('assertion').split('.');
   assert.ok(verify('RSA-SHA256',Buffer.from(h+'.'+p),publicKey,Buffer.from(s,'base64url')));
   assert.equal(JSON.parse(Buffer.from(p,'base64url')).iss,email);
   return Response.json({access_token:'fixture-secret-access',token_type:'Bearer',expires_in:3600});
  }
  assert.equal(init.headers.Authorization,'Bearer fixture-secret-access');
  if(url===root+':beginTransaction'){
   assert.deepEqual(JSON.parse(init.body),{options:{readOnly:{}}});
   return Response.json({transaction:malformedBegin?'invalid!':'fixture-transaction'});
  }
  if(url===root+':rollback'){
   assert.deepEqual(JSON.parse(init.body),{transaction:'fixture-transaction'});
   return Response.json({});
  }
  if(url===auth){
   assert.deepEqual(JSON.parse(init.body),{localId:Object.keys(identity.accounts)});
   return Response.json({users:Object.entries(identity.accounts).map(([localId,email])=>({localId,email,emailVerified:!invalidAccount,disabled:false}))});
  }
  assert.fail('unexpected destination');
 };
 return {calls,fetchImpl};
}
test('private probe verifies signed OAuth and fixed read-only requests, redacts all data',async()=>{
 const f=fixture(),r=await probeQaIdentityLab({enabled:true,env,fetchImpl:f.fetchImpl});
 assert.deepEqual(f.calls,[oauth,root+':beginTransaction',root+':rollback',auth]);
 assert.deepEqual(r,{status:'probe_passed',projectMatches:true,accountMatches:true,oauthAccepted:true,
  readOnlyTransactionOpened:true,readOnlyTransactionClosed:true,qaAccountsVerified:true,
  externalAttempts:4,firestoreWrites:0,fcmAttempts:0,activationAuthorized:false});
 const serialized=JSON.stringify(r);
 for(const secret of [email,'fixture-secret-access','fixture-transaction','PRIVATE KEY','qa-nav-alice','qa-nav-bob'])assert.ok(!serialized.includes(secret));
});
test('probe is disabled by default and rejects mismatched identity before I/O',async()=>{
 for(const args of [{env},{enabled:true,env:{...env,QA_FIREBASE_SERVICE_ACCOUNT_JSON:'invalid'}},
  {enabled:true,env:{...env,QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({...service,project_id:'wrong'})}},
  {enabled:true,env:{...env,QA_FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({...service,client_email:'other@invalid'})}}]){
  const f=fixture(),r=await probeQaIdentityLab({...args,fetchImpl:f.fetchImpl});
  assert.equal(r.status,'blocked');assert.equal(f.calls.length,0);
 }
});
test('probe stops on OAuth, transaction, rollback or Auth failure and never leaks responses',async()=>{
 for(const [opts,count] of [[{failAt:oauth},1],[{redirectAt:root+':beginTransaction'},2],[{malformedBegin:true},2],
  [{failAt:root+':rollback'},3],[{failAt:auth},4],[{invalidAccount:true},4]]){
  const f=fixture(opts),r=await probeQaIdentityLab({enabled:true,env,fetchImpl:f.fetchImpl});
  assert.equal(r.status,'blocked');assert.equal(r.externalAttempts,count);assert.equal(f.calls.length,count);
  assert.equal(r.activationAuthorized,false);assert.equal(r.fcmAttempts,0);assert.equal(r.firestoreWrites,0);
  assert.ok(!JSON.stringify(r).includes('SENSITIVE_PROVIDER_ERROR'));
 }
});
