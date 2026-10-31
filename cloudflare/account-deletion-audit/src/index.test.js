import test from 'node:test';
import assert from 'node:assert/strict';
import {handleRequest} from './index.js';
import {buildAuditPlan,validUid,ACCOUNT_DATA_CLASSES} from './plan.js';

const SECRET = 'A'.repeat(48);
const env = Object.freeze({
  ACCOUNT_DELETION_AUDIT_ENABLED: 'true',
  ACCOUNT_DELETION_AUDIT_SECRET: SECRET
});
const req = (method='POST', token=SECRET, body={uid:'alice_123'}, path='/admin/audit') =>
  new Request('https://privacy-audit.example.test'+path,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(method === 'GET'?{}:{body:JSON.stringify(body)})
  });
const pending = {fields:{status:{stringValue:'requested'}}};
const backend = () => {throw Error('should_not_read_firestore');};

test('fail closed: service disabled denies request before DB read',async()=>{
  const response = await handleRequest(req(), {...env,ACCOUNT_DELETION_AUDIT_ENABLED:'false'},
    {loadRequest:backend});
  assert.equal(response.status,503);
});
test('no credentials yields 401 without DB read',async()=>{
  for(const token of ['x', 'B'.repeat(48), 'A'.repeat(48)+'0']) {
    assert.equal((await handleRequest(req('POST',token),env,{loadRequest:backend})).status,401);
  }
});
test('missing secret cannot authorize any request',async()=>{
  const response = await handleRequest(req(),'ACCOUNT_DELETION_AUDIT_ENABLED' in env
    ?{ACCOUNT_DELETION_AUDIT_ENABLED:'true'}:{}, {loadRequest:backend});
  assert.equal(response.status,401);
});
test('reject invalid UID, extra payload and oversized request without DB read',async()=>{
  for(const body of [{uid:'../alice'},{uid:'alice/../../bob'},{uid:'alice',action:'delete'},
                     {uid:''},{uid:123},{uid:'x'.repeat(129)}]) {
    const response = await handleRequest(req('POST',SECRET,body),env,{loadRequest:backend});
    assert.equal(response.status,400);
  }
  const large = await handleRequest(req('POST',SECRET,{uid:'x'.repeat(550)}),env,
    {loadRequest:backend});
  assert.equal(large.status,413);
});
test('routes other than protected audit have no access',async()=>{
  assert.equal((await handleRequest(req('POST',SECRET,{uid:'alice'},'/delete'),env,
    {loadRequest:backend})).status,404);
  assert.equal((await handleRequest(req('GET',SECRET,undefined,'/admin/audit'),env,
    {loadRequest:backend})).status,404);
  const health=await handleRequest(req('GET',SECRET,undefined,'/health'),env);
  assert.equal(health.status,200);
  assert.equal((await health.json()).deletionEnabled,false);
});
test('authenticated read returns only data categories; never private user fields',async()=>{
  let reads=0;
  const response=await handleRequest(req('POST',SECRET,{uid:'alice_123'}),env,{
    loadRequest: async(_,uid)=>{
      reads++;
      assert.equal(uid,'alice_123');
      return {...pending, fields:{...pending.fields,email:{stringValue:'private@example.test'}}};
    }
  });
  assert.equal(reads,1);
  assert.equal(response.status,200);
  const data=await response.json();
  assert.equal(data.ready,false);
  assert.equal(data.destructiveOperationsEnabled,false);
  assert.equal(data.dataClasses.length,ACCOUNT_DATA_CLASSES.length);
  assert.ok(!JSON.stringify(data).includes('private@example.test'));
});
test('unregistered request cannot be processed',async()=>{
  const response=await handleRequest(req(),env,{loadRequest:async()=>null});
  assert.equal(response.status,200);
  assert.equal((await response.json()).received,false);
});
test('unexpected Firebase response fails closed',async()=>{
  const response=await handleRequest(req(),env,{loadRequest:async()=>{throw Error('token-secret');}});
  assert.equal(response.status,503);
  assert.ok(!(await response.text()).includes('token-secret'));
});
test('plan refuses invalid UID and non-requested statuses',()=>{
  assert.equal(validUid('a_-9'),true);
  assert.equal(validUid('alice/bob'),false);
  assert.throws(()=>buildAuditPlan('bad/uid',pending),/invalid_uid/);
  assert.equal(buildAuditPlan('good', {fields:{status:{stringValue:'completed'}}}).ready,false);
});
