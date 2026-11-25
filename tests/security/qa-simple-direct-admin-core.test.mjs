import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Timestamp} from 'firebase-admin/firestore';
import {project,operator,baseline,candidate,candidateHash,hash,prepare,classifyRules,assertNoEmulator,
 assertOperator,validAge,validAdmission,closeOperator,withOperator,googleHeaders,operatorUserinfoUrl} from './qa-simple-direct-admin-core.mjs';
test('offline preparation and exact target, no deploy permission',()=>{
 const root=mkdtempSync(join(tmpdir(),'atrio-prep-'));
 try{
  const folder=join(root,'candidate');
  const result=prepare(folder);
  assert.equal(result.deployAuthorized,false);
  assert.equal(hash(readFileSync(join(folder,'candidate.rules'),'utf8')),candidateHash);
  assert.equal(readFileSync(join(folder,'rollback.rules'),'utf8'),baseline.source);
  assert.equal(classifyRules(baseline.rulesetName,baseline.source),'baseline');
  assert.equal(classifyRules('projects/'+project+'/rulesets/new',candidate),'candidate');
  assert.throws(()=>classifyRules('projects/production/rulesets/new',candidate),/wrong_rules_project/);
  assert.throws(()=>classifyRules(baseline.rulesetName,baseline.source+' '),/unreviewed/);
  assert.throws(()=>assertNoEmulator({FIRESTORE_EMULATOR_HOST:'127.0.0.1:8080'}));
 }finally{rmSync(root,{recursive:true,force:true})}
});
test('admission needs current 18+ and strictly later generation timestamp',()=>{
 const now=Date.now(),t=Timestamp.fromMillis(now-1000);
 const proof={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:Timestamp.fromMillis(now+1000)};
 const a={status:'active',email:'alice.navegacao@qa.invalid',roundId:'qa-199-push-isolado',
 generation:'12345678-1234-4abc-8abc-123456789abc',admittedAt:t,expiresAt:null};
 const age={data:()=>proof,updateTime:new Timestamp(t.seconds,t.nanoseconds-1>=0?t.nanoseconds-1:0)};
 const prev=new Timestamp(t.seconds-1,999999999);
 assert.equal(validAge(proof,now),true);
 assert.equal(validAdmission({data:()=>a},{...age,updateTime:prev},'qa-nav-alice',now),true);
 assert.equal(validAdmission({data:()=>a},{...age,updateTime:t},'qa-nav-alice',now),false);
 assert.equal(validAdmission({data:()=>({...a,expiresAt:undefined})},{...age,updateTime:prev},'qa-nav-alice',now),false);
});
test('operator refuses mismatched principal; failed sign-in always closes operator',async()=>{
 const principal={email:'operator@example.invalid',verified_email:true};
 const u={uid:operator,email:principal.email,emailVerified:true,disabled:true,providerData:[],customClaims:{}};
 assert.throws(()=>assertOperator(u,{...principal,email:'wrong@example.invalid'}));
 let revoked=false;
 const auth={getUser:async()=>u,setCustomUserClaims:async(_,claims)=>{u.customClaims=claims??{}},
  updateUser:async(_,changes)=>{u.disabled=changes.disabled},revokeRefreshTokens:async()=>{revoked=true}};
 await assert.rejects(withOperator({auth,db:{},principal,apiKey:'fixture',signIn:async()=>{throw Error('denied')},
  capabilities:['manage_admissions']},()=>{throw Error('must_not_run')}),/denied/);
 assert.equal(u.disabled,true);assert.deepEqual(u.customClaims,{});assert.equal(revoked,true);
});

test('OAuth userinfo omits project quota header; Firebase calls retain it',()=>{
 assert.deepEqual(googleHeaders(operatorUserinfoUrl,'fixture'),{Authorization:'Bearer fixture'});
 for(const url of ['https://firebaserules.googleapis.com/v1/projects/'+project+'/releases/cloud.firestore','https://identitytoolkit.googleapis.com/admin/v2/projects/'+project+'/config','https://firebase.googleapis.com/v1beta1/projects/'+project+'/androidApps']){
  assert.deepEqual(googleHeaders(url,'fixture'),{Authorization:'Bearer fixture','x-goog-user-project':project});
 }
});
