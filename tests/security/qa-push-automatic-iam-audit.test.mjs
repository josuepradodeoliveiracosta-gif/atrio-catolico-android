import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQaIdentity} from './qa-push-automatic-iam-audit-lib.mjs';
const project='atrio-catolico-qa-general',email='fixture-push@'+project+'.iam.gserviceaccount.com';
const principal='serviceAccount:'+email;
test('wrong identity makes no request',async()=>{
 await assert.rejects(auditQaIdentity({email:'fixture-push@production.iam.gserviceaccount.com',request:()=>{throw Error('unexpected')}}),/invalid_qa_identity/);
});
test('direct grants attributed only to exact principal; 403 remains unavailable',async()=>{
 const seen=[];
 const result=await auditQaIdentity({email,request:async req=>{
  seen.push(req);
  if(req.url.endsWith('/projects/'+project))return {status:200,body:{projectId:project}};
  if(req.url.endsWith('/billingInfo'))return {status:200,body:{billingEnabled:false}};
  if(req.url.endsWith('/projects/'+project+':getIamPolicy'))return {status:200,body:{bindings:[
   {role:'roles/datastore.viewer',members:[principal]},
   {role:'roles/editor',members:['serviceAccount:other@example.com']},
   {role:'roles/firebaseauth.viewer',members:[principal],condition:{expression:'fixture'}},
   {role:'roles/owner',members:['group:fixture@example.com']}] }};
  if(req.url.endsWith('/roles/datastore.viewer'))return {status:200,body:{includedPermissions:['datastore.entities.get']}};
  return {status:403};
 }});
 assert.equal(result.checks.billing.billingEnabled,false);
 assert.equal(result.checks.account.status,'unavailable');
 assert.equal(result.checks.account.http,403);
 assert.deepEqual(result.grants.map(g=>g.role),['roles/datastore.viewer','roles/firebaseauth.viewer']);
 assert.equal(result.checks.projectIam.groupBindings,1);
 assert.equal(result.roleDefinitionsComplete,false);
 assert.equal(result.effectivePermissionsVerified,false);
 assert.ok(seen.every(r=>r.method==='GET'||(r.method==='POST'&&r.url.endsWith(':getIamPolicy'))));
 assert.ok(!JSON.stringify(result).includes(email));
});
test('folder policy denial cannot prove inherited permissions',async()=>{
 const result=await auditQaIdentity({email,request:async r=>r.url.endsWith('/projects/'+project)?
  {status:200,body:{projectId:project,parent:{type:'folder',id:'123'}}}:{status:403}});
 assert.equal(result.ancestorTraversalComplete,false);
 assert.equal(result.checks.folderIam0.http,403);
});
test('project identity mismatch stops all other reads',async()=>{
 let calls=0;const r=await auditQaIdentity({email,request:async()=>{calls++;return {status:200,body:{projectId:'prod'}}}});
 assert.equal(calls,1);assert.equal(r.gate,'blocked_project_identity');
});
