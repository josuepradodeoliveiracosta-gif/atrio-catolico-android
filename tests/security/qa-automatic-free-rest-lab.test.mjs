import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreeRestDiscoveryLab as createDiscovery} from '../../cloudflare/push-worker/scripts/qa-automatic-free-rest-lab.mjs';
const createFreeRestDiscoveryLab=opts=>createDiscovery({reserveDiscovery:async()=>true,...opts});
const project='atrio-catolico-qa-general',now=1800000000000;
const root='projects/'+project+'/databases/(default)/documents/';
const room='chats/qa-nav-alice__qa-nav-bob',alice='qa-nav-alice',bob='qa-nav-bob';
const str=stringValue=>({stringValue}),num=n=>({integerValue:String(n)});
const iso=n=>new Date(n).toISOString();
function fixture(){
 const docs=[{name:root+room,fields:{status:str('accepted'),lastMessageId:str('m1'),lastSenderUid:str(bob),
  requesterUid:str(alice),recipientUid:str(bob),unreadRequester:num(1),unreadRecipient:num(0),
  participants:{arrayValue:{values:[str(alice),str(bob)]}}}},
  {name:root+room+'/messages/m1',createTime:iso(now-30000).replace('.000Z','.123456789Z'),
   fields:{uid:str(bob),kind:str('text'),createdAt:{timestampValue:iso(now-30000)}}}];
 const requests=[];
 const transport=async req=>{
  requests.push(req);const doc=docs[requests.length-1];
  return {status:200,body:[{found:doc,readTime:iso(now)}]};
 };
 return {docs,requests,transport,input:{enabled:true,projectId:project,activatedAt:now-90000}};
}
test('closed and wrong project make no calls',async()=>{
 const f=fixture(),tick=createFreeRestDiscoveryLab(f);
 assert.equal((await tick()).reads,0);
 assert.equal((await tick({...f.input,projectId:'production'})).reads,0);
 assert.equal(f.requests.length,0);
});
test('two fixed masked reads, exact nanoseconds, no content or writes',async()=>{
 const f=fixture(),r=await createFreeRestDiscoveryLab(f)(f.input);
 assert.equal(r.status,'candidate');assert.equal(r.reads,2);
 assert.equal(r.event.expectedCreateTime.nanoseconds,123456789);
 assert.equal(r.deadline,now+90000);
 for(const req of f.requests){
  assert.equal(req.url,'https://firestore.googleapis.com/v1/projects/'+project+'/databases/(default)/documents:batchGet');
  assert.equal(req.method,'POST');assert.equal(req.redirect,'error');
  assert.equal(req.body.documents.length,1);
  assert.equal(req.body.mask.fieldPaths.includes('text'),false);
 }
 assert.equal(f.requests[1].body.documents[0],root+room+'/messages/m1');
});
test('read message and malicious path stop after one read',async()=>{
 for(const mutate of [d=>d.fields.unreadRequester=num(0),d=>d.fields.lastMessageId=str('../wrong')]){
  const f=fixture();mutate(f.docs[0]);const r=await createFreeRestDiscoveryLab(f)(f.input);
  assert.equal(r.status,'ignored');assert.equal(r.reads,1);
 }
});
test('wrong project document, missing readTime, and quota failure close without retry',async()=>{
 for(const response of [{status:429},{status:200,body:[{found:{name:'wrong'},readTime:iso(now)}]},
  {status:200,body:[{found:{name:root+room,fields:{}}}]}]){
  let n=0;const f=fixture(),tick=createFreeRestDiscoveryLab({transport:async()=>{n++;return response}});
  assert.equal((await tick(f.input)).status,'ignored');assert.equal(n,1);
 }
});
test('deleted field and recreated path metadata are not ignored',async()=>{
 const f=fixture();f.docs[1].fields.deletedForAll={booleanValue:false};
 assert.equal((await createFreeRestDiscoveryLab(f)(f.input)).reason,'invalid_message');
});
test('missing room uses one read',async()=>{
 const f=fixture(),tick=createFreeRestDiscoveryLab({transport:async()=>({status:200,body:[{missing:root+room,readTime:iso(now)}]})});
 assert.deepEqual(await tick(f.input),{status:'ignored',reason:'room_missing',reads:1});
});

test('budget refusal prevents all discovery reads',async()=>{const f=fixture();const tick=createDiscovery({...f,reserveDiscovery:async()=>false});assert.equal((await tick(f.input)).reason,'budget_unavailable');assert.equal(f.requests.length,0)});
