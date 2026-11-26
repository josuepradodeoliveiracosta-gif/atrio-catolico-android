import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createFreePublicationLab,FREE_PUBLICATION_RESERVATION,FREE_PUBLICATION_DAILY_ATTEMPTS} from '../../cloudflare/push-worker/scripts/qa-automatic-free-publication-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const now=1800000000000,alice='qa-nav-alice',bob='qa-nav-bob',chat=alice+'__'+bob;
const {projectId,databaseId,roundId,ageMode}=identity;
const creation={seconds:(now-1000)/1000,nanoseconds:123};
const gen=i=>'00000000-0000-4000-8000-00000000000'+i;
function fixture(){
 const accounts={},admissions={},eligibility={};
 for(const [i,uid] of [alice,bob].entries()){
  accounts[uid]={uid,email:identity.accounts[uid],emailVerified:true,disabled:false};
  admissions[uid]={status:'active',email:identity.accounts[uid],roundId,generation:gen(i),admittedAt:now-3000,expiresAt:null};
  eligibility[uid]={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',updatedAt:now-4000,reviewExpiresAt:now+300000};
 }
 const candidate={status:'candidate',deadline:now+90000,event:{type:'created',projectId,databaseId,
  chatId:chat,messageId:'m1',expectedCreateTime:creation}};
 const state={transaction:'fixture-token',creation:{...creation},now,outbox:null,retry:null,pendingVersion:null,
  snapshot:{projectId,databaseId,chatId:chat,messageId:'m1',managedBoundary:false,
   config:{enabled:true,qaSimpleDirectEnabled:true,minorPolicyApproved:true,version:'2026-11-v1',
   safetyReviewVersion:'2026-11-safety-v1',pushPilot:{enabled:true,projectId,databaseId,roundId,ageMode,expiresAt:null}},
   room:{status:'accepted',lastMessageId:'m1',lastSenderUid:bob,participants:[alice,bob],
    requesterUid:alice,recipientUid:bob,unreadRequester:1,unreadRecipient:0},
   message:{uid:bob,kind:'text',createdAt:now-1000},accounts,admissions,eligibility,
   blocked:{[alice]:false,[bob]:false},muted:false,deviceEligible:true,receipt:null,pending:null}};
 const requests=[],reservations=[];
 const transport=async req=>{
  requests.push(req);
  if(req.url.endsWith(':beginTransaction'))return {status:200,body:{transaction:'fixture-token'}};
  if(req.url.endsWith(':commit'))return {status:200,body:{writeResults:[{},{},{}],commitTime:new Date(now).toISOString()}};
  return {status:200,body:{}};
 };
 const readSnapshot=async args=>{assert.equal(args.transaction,state.transaction);return state};
 const reserveBudget=async x=>{reservations.push(x);return true};
 return {state,candidate,requests,reservations,transport,readSnapshot,reserveBudget};
}
const publish=(f,overrides={},input={})=>createFreePublicationLab({...f,...overrides})({enabled:true,candidate:f.candidate,...input});
test('disabled or invalid candidate makes no budget or network call',async()=>{
 const f=fixture();assert.equal((await publish(f,{}, {enabled:false})).reason,'automation_disabled');
 f.candidate.event.projectId='production';
 assert.equal((await publish(f)).reason,'invalid_candidate');
 assert.equal(f.requests.length,0);assert.equal(f.reservations.length,0);
});
test('budget denied or unavailable makes no network call',async()=>{
 const f=fixture();assert.equal((await publish(f,{reserveBudget:async()=>false})).reason,'budget_unavailable');
 assert.equal(f.requests.length,0);
});
test('one commit uses exact transaction and three compatible writes, no message content',async()=>{
 const f=fixture(),result=await publish(f);
 const key=createHash('sha256').update(JSON.stringify([roundId,chat,'m1'])).digest('hex');
 assert.deepEqual(result,{status:'published_lab',eventKey:key});
 assert.deepEqual(f.reservations,[FREE_PUBLICATION_RESERVATION]);
 assert.equal(FREE_PUBLICATION_DAILY_ATTEMPTS,100);
 const req=f.requests[1];assert.equal(req.body.transaction,'fixture-token');
 assert.equal(req.body.writes.length,3);assert.equal(f.requests.length,2);
 assert.ok(req.url.endsWith(':commit'));assert.equal(req.redirect,'error');
 const [pending,receipt,outbox]=req.body.writes;
 const root='projects/'+projectId+'/databases/'+databaseId+'/documents/';
 assert.equal(pending.update.name,root+'users/'+alice+'/chatPushPending/current');
 assert.equal(receipt.update.name,root+'users/'+alice+'/chatPushPublicationReceipts/'+key);
 assert.equal(outbox.update.name,root+'qaPushAutomaticOutbox/'+key);
 for(const w of req.body.writes){
  assert.deepEqual(w.currentDocument,{exists:false});
  assert.equal(w.update.fields.expiresAt.timestampValue,new Date(f.candidate.deadline).toISOString());
  assert.equal(Object.hasOwn(w.update.fields,'text'),false);
 }
 assert.equal(outbox.update.fields.messageCreateTime.mapValue.fields.nanoseconds.integerValue,'123');
 assert.deepEqual(receipt.updateTransforms,[{fieldPath:'createdAt',setToServerValue:'REQUEST_TIME'}]);
});
test('existing expired pending uses exact updateTime precondition',async()=>{
 const f=fixture();f.state.snapshot.pending={unread:true,expiresAt:now-1};
 f.state.pendingVersion=new Date(now-500).toISOString();
 assert.equal((await publish(f)).status,'published_lab');
 assert.deepEqual(f.requests[1].body.writes[0].currentDocument,{updateTime:f.state.pendingVersion});
});
for(const [name,mutate] of [
 ['recreated',f=>f.state.creation.nanoseconds++],
 ['outbox exists',f=>f.state.outbox={}],
 ['retry exists',f=>f.state.retry={}],
 ['receipt exists',f=>f.state.snapshot.receipt={}],
 ['blocked',f=>f.state.snapshot.blocked[bob]=true],
 ['read',f=>f.state.snapshot.room.unreadRequester=0],
 ['wrong transaction',f=>f.state.transaction='different'],
 ['deadline expired',f=>f.state.now=f.candidate.deadline],
 ['active pending',f=>{f.state.snapshot.pending={unread:true,expiresAt:now+30000};f.state.pendingVersion=new Date(now-500).toISOString()}]
]){
 test(name+' rolls back, never commits',async()=>{
  const f=fixture();mutate(f);
  const result=await publish(f,{readSnapshot:async()=>f.state});
  assert.notEqual(result.status,'published_lab');
  assert.equal(f.requests.length,2);assert.ok(f.requests[1].url.endsWith(':rollback'));
 });
}
test('ambiguous commit is not retried or rolled back',async()=>{
 const f=fixture(),transport=async req=>{
  if(req.url.endsWith(':commit')){f.requests.push(req);throw Error('connection lost')}
  return f.transport(req);
 };
 assert.equal((await publish(f,{transport})).status,'publication_unknown_lab');
 assert.equal(f.requests.length,2);
});
