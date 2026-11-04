import test from 'node:test';
import assert from 'node:assert/strict';
import {createFounderDeletionReadGate,inspectFounderDeletionReadSources}
  from './founder-admin-read-gate.js';

const PROJECT='atrio-catolico',uid='qa-founder';
const identity='a'.repeat(120)+'.'+'b'.repeat(80)+'.'+'c'.repeat(90);
const oauth='synthetic_oauth_backend_0123456789';
const instant=Date.parse('2026-11-03T17:00:00.000Z');
const issued=Math.floor(instant/1000)-120;
const valid={
  uid,sub:uid,aud:PROJECT,
  iss:'https://securetoken.google.com/'+PROJECT,
  iat:issued,auth_time:issued-1,exp:issued+3600
};
function fixture(){
  const state={disabled:false,role:true,founder:uid,frozen:false,
    revoked:false,identity:{...valid},authCalls:0,reads:[],calls:[]};
  const auth={
    app:{options:{projectId:PROJECT}},
    async verifyIdToken(token,checkRevoked){
      state.calls.push('verify');
      assert.equal(token,identity);
      assert.equal(checkRevoked,true);
      state.authCalls++;
      if(state.revoked)throw Error('synthetic revoked');
      return {...state.identity};
    },
    async getUser(subject){
      state.calls.push('user');
      assert.equal(subject,uid);
      return {uid,disabled:state.disabled};
    }
  };
  const db={
    app:{options:{projectId:PROJECT}},
    collection(name){
      return {doc(id){
        return {async get(){
          state.reads.push(name+'/'+id);
          if(name==='admins')
            return {exists:true,data:()=>({enabled:state.role})};
          if(name==='app_config')
            return {exists:true,data:()=>({uid:state.founder})};
          if(name==='account_deletion_freeze')
            return {exists:state.frozen};
          throw Error('unreviewed-admin-path');
        }};
      }};
    }
  };
  const gate=()=>createFounderDeletionReadGate({
    idToken:identity,auth,db,clock:()=>instant
  });
  return {state,auth,db,gate};
}

test('founder identity is verified with revoked-token check and current role',async()=>{
  const f=fixture();
  assert.equal(await f.gate()(),true);
  assert.equal(f.state.authCalls,1);
  assert.deepEqual([...f.state.reads].sort(),[
    'account_deletion_freeze/'+uid,'admins/'+uid,'app_config/founder'
  ].sort());
  assert.ok(f.state.calls.includes('user'));
});

test('revocation, role removal, another founder, freeze and disabled user block access',async()=>{
  for(const change of [
    f=>{f.state.revoked=true;},
    f=>{f.state.role=false;},
    f=>{f.state.founder='qa-different';},
    f=>{f.state.frozen=true;},
    f=>{f.state.disabled=true;}
  ]){
    const f=fixture();change(f);
    await assert.rejects(f.gate()(),/founder_read_gate_/);
  }
});

test('forged, expired, mismatched Firebase identity claims cannot be accepted',async()=>{
  for(const edit of [
    {uid:'qa-other'},
    {sub:'qa-other'},
    {aud:'other-project'},
    {iss:'https://securetoken.google.com/other-project'},
    {exp:issued-1},
    {auth_time:issued+9999},
    {iat:issued+9999}
  ]){
    const f=fixture();Object.assign(f.state.identity,edit);
    await assert.rejects(f.gate()(),/invalid_verified_identity/);
  }
});

test('wrong SDK project or malformed token cannot call remote Firebase',async()=>{
  const f=fixture();
  f.auth.app.options.projectId='wrong-project';
  assert.throws(f.gate,/trusted_admin_sdk_required/);
  assert.throws(()=>createFounderDeletionReadGate({
    idToken:'not.a.real.token',auth:f.auth,db:f.db
  }),/invalid_identity_token/);
  assert.equal(f.state.authCalls,0);
});

test('revalidates founder permissions independently on every attempt',async()=>{
  const f=fixture(),gate=f.gate();
  assert.equal(await gate(),true);
  f.state.role=false;
  await assert.rejects(gate(),/founder_role_or_freeze_denied/);
  assert.equal(f.state.authCalls,2);
});

test('a mid-flight expiration prevents a positive authorization',async()=>{
  const f=fixture();
  let count=0;
  const gate=createFounderDeletionReadGate({
    idToken:identity,auth:f.auth,db:f.db,
    clock:()=>++count===1?instant:(valid.exp+10)*1000
  });
  await assert.rejects(gate(),/expired_during_authorization/);
});

test('composed preflight never reads private Firestore when founder is revoked',async()=>{
  const f=fixture();f.state.revoked=true;
  let calls=0;
  await assert.rejects(inspectFounderDeletionReadSources({
    idToken:identity,auth:f.auth,db:f.db,
    clock:()=>instant,uid:'qa-alice',oauthToken:oauth,
    now:new Date(instant),
    fetcher:async()=>{calls++;throw Error('must-not-fetch');}
  }),/firebase_identity_not_verified/);
  assert.equal(calls,0);
});

test('composed preflight fails on role revocation without destructive calls',async()=>{
  const f=fixture();
  let calls=0;
  const origin='https://firestore.googleapis.com/v1/projects/'+PROJECT+
    '/databases/(default)/documents';
  const fetcher=async(url,options)=>{
    calls++;
    assert.equal(options.method,'GET');
    assert.equal(String(url),origin+'/account_deletion_requests/qa-alice');
    f.state.role=false;
    return Response.json({name:'projects/'+PROJECT+
      '/databases/(default)/documents/account_deletion_requests/qa-alice',
      fields:{status:{stringValue:'requested'},source:{stringValue:'android'},
        requestedAt:{timestampValue:'2026-11-03T16:00:00.000Z'}}});
  };
  await assert.rejects(inspectFounderDeletionReadSources({
    idToken:identity,auth:f.auth,db:f.db,
    clock:()=>instant,uid:'qa-alice',oauthToken:oauth,
    now:new Date(instant),fetcher
  }),/founder_role_or_freeze_denied/);
  assert.equal(calls,1);
});


test('unsigned JWT-like string grants nothing unless Firebase Admin verifies it',async()=>{
  const f=fixture();
  const unsigned='a'.repeat(120)+'.'+'b'.repeat(80)+'.';
  let attempted=0;
  const rejecting={
    ...f.auth,
    async verifyIdToken(value,checkRevoked){
      attempted++;
      assert.equal(value,unsigned);
      assert.equal(checkRevoked,true);
      throw Error('firebase-admin-rejected-untrusted-token');
    }
  };
  const gate=createFounderDeletionReadGate({
    idToken:unsigned,auth:rejecting,db:f.db,clock:()=>instant
  });
  await assert.rejects(gate(),/firebase_identity_not_verified/);
  assert.equal(attempted,1);
  assert.equal(f.state.reads.length,0);
});
