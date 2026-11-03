import test from 'node:test';
import assert from 'node:assert/strict';
import {createPrivateDeletionReadRuntime}
  from './private-read-runtime.js';

const project='atrio-catolico';
const base='https://firestore.googleapis.com/v1/projects/'+project+
  '/databases/(default)/documents';
const root='projects/'+project+'/databases/(default)/documents';
const instant=Date.parse('2026-11-03T17:00:00.000Z');
const claimsTime=Math.floor(instant/1000);
const uid='qa-founder',target='qa-target';
const bearer='a'.repeat(110)+'.'+'b'.repeat(100)+'.'+'c'.repeat(100);
const token='qa-google-access-credential-1234567890';
const metadata='http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/email';
const account='atrio-privacy-reader@'+project+'.iam.gserviceaccount.com';
const env=()=>({
  K_SERVICE:'atrio-privacy-review-internal',
  K_REVISION:'atrio-privacy-review-internal-00001-xyz',
  GOOGLE_CLOUD_PROJECT:project
});
function fixture(){
  const state={role:true,revoked:false,principal:account,
    oauth:token,expires:3500,authChecks:0,metaCalls:0,
    oauthCalls:0,firestore:[],login:null};
  const app={options:{
    projectId:project,credential:{async getAccessToken(){
      state.oauthCalls++;
      return {access_token:state.oauth,expires_in:state.expires};
    }}
  }};
  const auth={app,
    async verifyIdToken(value,withRevocation){
      state.authChecks++;assert.equal(value,bearer);
      assert.equal(withRevocation,true);
      if(state.revoked)throw Error('qa-revoked');
      return {uid,sub:uid,aud:project,iss:'https://securetoken.google.com/'+project,
        iat:claimsTime-120,auth_time:claimsTime-130,exp:claimsTime+3500};
    },
    async getUser(user){
      assert.equal(user,uid);
      return {uid,disabled:false};
    }
  };
  const db={app,collection(name){
    return {doc(id){return {async get(){
      if(name==='admins'&&id===uid)
        return {exists:true,data:()=>({enabled:state.role})};
      if(name==='app_config'&&id==='founder')
        return {exists:true,data:()=>({uid})};
      if(name==='account_deletion_freeze'&&id===uid)
        return {exists:false};
      throw Error('qa_wrong_admin_document');
    }};}};
  }};
  const metadataFetch=async(url,opts)=>{
    state.metaCalls++;
    assert.equal(url,metadata);
    assert.equal(opts.method,'GET');
    assert.equal(opts.redirect,'error');
    assert.equal(opts.headers['Metadata-Flavor'],'Google');
    return new Response(state.principal,{
      headers:{'Metadata-Flavor':'Google','Content-Length':String(state.principal.length)}
    });
  };
  const httpFetch=async(url,opts)=>{
    const address=String(url);
    state.firestore.push({url:address,method:opts.method});
    assert.equal(opts.headers.Authorization,'Bearer '+token);
    if(opts.method==='GET'&&address===base+'/account_deletion_requests/'+target)
      return Response.json({
        name:root+'/account_deletion_requests/'+target,
        fields:{
          requestedAt:{timestampValue:'2026-11-03T16:00:00.000Z'},
          source:{stringValue:'android'},status:{stringValue:'requested'}
        }
      });
    if(opts.method==='GET'&&address.startsWith(base+'/'))
      return new Response('',{status:404});
    if(opts.method==='POST'&&address.endsWith(':listCollectionIds'))
      return Response.json({collectionIds:[]});
    if(opts.method==='POST'&&address===base+':runQuery')
      return Response.json([{readTime:'2026-11-03T16:00:00.000Z'}]);
    throw Error('qa_unexpected_endpoint');
  };
  const start=()=>createPrivateDeletionReadRuntime({
    env:env(),app,auth,db,httpFetch,metadataFetch,clock:()=>instant
  });
  return {state,app,auth,db,httpFetch,metadataFetch,start};
}
test('private backend composes founder authentication and Firestore-only reads',async()=>{
  const f=fixture();
  const result=await f.start().inspect({uid:target,idToken:bearer});
  assert.equal(result.status,'read_only_review_required');
  assert.equal(result.privateBackendCodePrepared,true);
  assert.equal(result.runtimeServiceAccountNameMatched,true);
  assert.equal(result.accountRequestReadFromFirestore,true);
  assert.equal(result.accountDeletionAuthorized,false);
  assert.equal(result.googlePlayReleaseAuthorized,false);
  assert.equal(result.cloudRunInvokerIamReviewed,false);
  assert.equal(result.readOnlyIamRolesIndependentlyVerified,false);
  assert.equal(f.state.oauthCalls,1);
  assert.equal(f.state.metaCalls,1);
  assert.ok(f.state.authChecks>f.state.firestore.length);
  assert.ok(f.state.firestore.every(c=>c.method==='GET'||
    (c.method==='POST'&&(c.url.endsWith(':runQuery')||
    c.url.endsWith(':listCollectionIds')))));
  assert.doesNotMatch(JSON.stringify(result),
    /qa-target|qa-founder|qa-google-access|atrio-privacy-reader@/);
});
test('no credential acquisition or data read for revoked founder',async()=>{
  const f=fixture();f.state.revoked=true;
  await assert.rejects(f.start().inspect({uid:target,idToken:bearer}),
    /founder_read_gate_firebase_identity_not_verified/);
  assert.equal(f.state.oauthCalls,0);
  assert.equal(f.state.firestore.length,0);
});
test('wrong Cloud Run account identity rejects before Auth and OAuth',async()=>{
  const f=fixture();f.state.principal='default@atrio-catolico.iam.gserviceaccount.com';
  await assert.rejects(f.start().inspect({uid:target,idToken:bearer}),
    /private_read_runtime_runtime_identity_mismatch/);
  assert.equal(f.state.authChecks,0);
  assert.equal(f.state.oauthCalls,0);
  assert.equal(f.state.firestore.length,0);
});
test('operator role revoked while reading leaves no usable result',async()=>{
  const f=fixture();
  const origin=f.httpFetch;
  f.httpFetch=async(...args)=>{
    const result=await origin(...args);
    if(f.state.firestore.length===1)f.state.role=false;
    return result;
  };
  const reader=createPrivateDeletionReadRuntime({
    env:env(),app:f.app,auth:f.auth,db:f.db,
    httpFetch:f.httpFetch,metadataFetch:f.metadataFetch,
    clock:()=>instant
  });
  await assert.rejects(reader.inspect({uid:target,idToken:bearer}),
    /founder_read_gate_founder_role_or_freeze_denied/);
  assert.equal(f.state.firestore.length,1);
});
test('wrong SDK app, wrong environment, key file or emulator denies initialization',()=>{
  const f=fixture();
  const cases=[
    {...env(),K_SERVICE:'other'},
    {...env(),K_REVISION:''},
    {...env(),GOOGLE_CLOUD_PROJECT:'other'},
    {...env(),GOOGLE_APPLICATION_CREDENTIALS:'/tmp/key'},
    {...env(),FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9099'},
    {...env(),FIRESTORE_EMULATOR_HOST:'127.0.0.1:8089'},
    {...env(),ATRIO_ACCOUNT_DELETION_EXECUTION_ENABLED:'false'}
  ];
  for(const wrong of cases){
    assert.throws(()=>createPrivateDeletionReadRuntime({
      env:wrong,app:f.app,auth:f.auth,db:f.db
    }),/untrusted_cloud_run_environment/);
  }
  assert.throws(()=>createPrivateDeletionReadRuntime({
    env:env(),app:{options:f.app.options},auth:f.auth,db:f.db
  }),/admin_app_binding_required/);
});
test('malformed private requests are rejected before metadata or Auth',async()=>{
  const f=fixture(),reader=f.start();
  for(const input of [null,{}, {uid:'../other',idToken:bearer},
    {uid:target,idToken:bearer,allowDelete:true}]){
    await assert.rejects(reader.inspect(input),/invalid_private_request/);
  }
  assert.equal(f.state.metaCalls,0);
});
test('token provider failure or expiring OAuth fails closed',async()=>{
  for(const expires of [null,0,35]){
    const f=fixture();f.state.expires=expires;
    await assert.rejects(f.start().inspect({uid:target,idToken:bearer}),
      /backend_oauth_invalid/);
    assert.equal(f.state.firestore.length,0);
  }
});
