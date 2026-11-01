import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createQaRequestCaseRegistry} from './qa-request-case-registry.mjs';
const request={uid:'qa-delete-alice',source:'android',
  requestedAt:'2026-10-31T12:00:00.000Z'};
const changed={...request,source:'web'};
const approvers={privacy:'qa-privacy-reviewer',security:'qa-security-reviewer'};
process.env.GCLOUD_PROJECT='demo-atrio-v11';
process.env.FIRESTORE_EMULATOR_HOST='127.0.0.1:8089';
function fixture(fn){
  const dir=mkdtempSync(join(tmpdir(),'atrio-case-registry-'));
  const file=join(dir,'cases.sqlite'),opened=[];
  let now=5000000;
  const open=()=>{const db=new DatabaseSync(file);opened.push(db);
    return createQaRequestCaseRegistry(db,{now:()=>now});};
  try{return fn({open,advance:ms=>{now+=ms;}});}
  finally{for(const db of opened)try{db.close();}catch{}
    rmSync(dir,{recursive:true,force:true});}
}
function both(reg,caseId,r=request){
  for(const [role,reviewer] of Object.entries(approvers))
    reg.approve({caseId,role,reviewer,request:r});
}
test('UUID is issued by QA backend; duplicate delivery and restart keep identity',()=>fixture(({open})=>{
  const reg=open(),id=reg.issue(request).caseId;
  assert.match(id,/^[0-9a-f]{8}-[0-9a-f-]{27,}$/);
  assert.deepEqual(open().issue(request),{caseId:id,idempotent:true,productionReady:false});
  assert.throws(()=>open().issue(changed),/new_request_requires_explicit_revoke/);
}));
test('two persisted fixture decisions needed, never production authorization',()=>fixture(({open})=>{
  const a=open(),caseId=a.issue(request).caseId;
  assert.throws(()=>a.authorize({caseId,request}),/dual_review_required/);
  a.approve({caseId,role:'privacy',reviewer:approvers.privacy,request});
  assert.throws(()=>open().authorize({caseId,request}),/dual_review_required/);
  a.approve({caseId,role:'security',reviewer:approvers.security,request});
  const status=open().authorize({caseId,request});
  assert.equal(status.productionReady,false);
  assert.equal(status.canDeleteProductionAccount,false);
  assert.equal(status.approvedByRealAdministrators,false);
}));
test('case ID and request source/timestamp prevent replay',()=>fixture(({open})=>{
  const a=open(),caseId=a.issue(request).caseId;both(a,caseId);
  assert.throws(()=>a.authorize({caseId,request:changed}),/request_mismatch/);
  assert.throws(()=>a.authorize({caseId,request:{...request,
    requestedAt:'2026-10-31T13:00:00.000Z'}}),/request_mismatch/);
  assert.throws(()=>a.authorize({
    caseId:'00000000-0000-4000-8000-000000000000',request}),/case_not_found/);
}));
test('revoke old decision; new request gets different ID with fresh approvals',()=>fixture(({open})=>{
  const a=open(),id=a.issue(request).caseId;both(a,id);
  assert.equal(a.revoke(id),true);
  assert.equal(a.revoke(id),false);
  assert.throws(()=>a.authorize({caseId:id,request}),/case_revoked/);
  const next=open().issue(changed).caseId;
  assert.notEqual(next,id);
  assert.throws(()=>a.authorize({caseId:next,request:changed}),/dual_review_required/);
  both(a,next,changed);
  assert.equal(a.authorize({caseId:next,request:changed}).productionReady,false);
}));
test('expired approvals fail closed and require manual revocation',()=>fixture(({open,advance})=>{
  const a=open(),id=a.issue(request,{ttlMs:1000}).caseId;both(a,id);
  advance(1001);
  assert.throws(()=>a.authorize({caseId:id,request}),/case_expired/);
  assert.throws(()=>a.issue(request),/case_expired/);
  assert.equal(a.revoke(id),true);
  assert.notEqual(a.issue(request).caseId,id);
}));
test('forged roles/real accounts/credentials cannot pass QA guards',()=>fixture(({open})=>{
  const a=open(),id=a.issue(request).caseId;
  assert.throws(()=>a.approve({caseId:id,role:'security',
    reviewer:approvers.privacy,request}),/reviewer_not_authorized_fixture/);
  assert.throws(()=>a.issue({...request,uid:'real-person'}),/invalid_fixture_request/);
  assert.throws(()=>a.issue({...request,email:'fake@example.test'}),/invalid_fixture_request/);
  assert.throws(()=>a.issue({...request,requestedAt:'bad-time'}),/invalid_requested_at/);
  const old=process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  try{
    process.env.FIREBASE_SERVICE_ACCOUNT_JSON='fixture-secret';
    assert.throws(()=>a.authorize({caseId:id,request}),/fixture_environment_required/);
  }finally{if(old===undefined)delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
    else process.env.FIREBASE_SERVICE_ACCOUNT_JSON=old;}
}));
test('same fixture review can be retried, not reassigned',()=>fixture(({open})=>{
  const a=open(),id=a.issue(request).caseId;
  const item={caseId:id,role:'privacy',reviewer:approvers.privacy,request};
  assert.equal(a.approve(item).idempotent,false);
  assert.equal(a.approve(item).idempotent,true);
  assert.throws(()=>a.approve({...item,reviewer:'wrong'}),/reviewer_not_authorized_fixture/);
}));
