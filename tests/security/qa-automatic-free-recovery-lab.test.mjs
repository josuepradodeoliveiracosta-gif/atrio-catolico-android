import test from 'node:test';
import assert from 'node:assert/strict';
import {createFreeRecoveryLab} from '../../cloudflare/push-worker/scripts/qa-automatic-free-recovery-lab.mjs';
import {createHash} from 'node:crypto';
const now=1800000000000,chat='qa-nav-alice__qa-nav-bob',project='atrio-catolico-qa-general';
const round='qa-199-push-isolado',eventKey=createHash('sha256').update(JSON.stringify([round,chat,'m1'])).digest('hex');
const name='projects/'+project+'/databases/(default)/documents/qaPushAutomaticOutbox/'+eventKey;
const iso=n=>new Date(n).toISOString(),s=stringValue=>({stringValue}),n=x=>({integerValue:String(x)});
function fixture(){
 const input={enabled:true,activatedAt:now-60000,candidate:{status:'candidate',deadline:now+90000,
  event:{type:'created',projectId:project,databaseId:'(default)',chatId:chat,messageId:'m1',
   expectedCreateTime:{seconds:(now-30000)/1000,nanoseconds:123}}}};
 const f={state:s('pending_transport'),roundId:s(round),conversationId:s(chat),messageId:s('m1'),
  senderUid:s('qa-nav-bob'),recipientUid:s('qa-nav-alice'),
  senderGeneration:s('00000000-0000-4000-8000-000000000001'),recipientGeneration:s('00000000-0000-4000-8000-000000000000'),
  createdAt:{timestampValue:iso(now-1000)},expiresAt:{timestampValue:iso(now+60000)},
  messageCreateTime:{mapValue:{fields:{seconds:n((now-30000)/1000),nanoseconds:n(123)}}}};
 const row={found:{name,fields:f},readTime:iso(now)},calls=[];
 return {input,f,row,calls,transport:async req=>{calls.push(req);return {status:200,body:[row]}},reserveRecovery:async()=>true};
}
test('exact confirmed outbox and one bounded read',async()=>{
 const f=fixture();assert.deepEqual(await createFreeRecoveryLab(f)(f.input),{status:'published_lab',eventKey});
 assert.equal(f.calls.length,1);assert.deepEqual(f.calls[0].body,{documents:[name]});
});
test('only exact missing row permits fresh publication',async()=>{
 const f=fixture();delete f.row.found;f.row.missing=name;
 assert.deepEqual(await createFreeRecoveryLab(f)(f.input),{status:'absent_lab'});
});
for(const [label,mutate] of [
 ['claimed',f=>f.f.state=s('claimed_lab')],['unknown',f=>f.f.state=s('unknown')],
 ['finished',f=>f.f.finishedAt={timestampValue:iso(now)}],['claim marker',f=>f.f.claimId=s('claim')],
 ['expired',f=>f.f.expiresAt={timestampValue:iso(now+9999)}],
 ['deadline extended',f=>f.f.expiresAt={timestampValue:iso(now+91000)}],
 ['creation changed',f=>f.f.messageCreateTime.mapValue.fields.nanoseconds=n(124)],
 ['wrong name',f=>f.row.found.name='wrong'],
 ['pre-activation',f=>f.f.createdAt={timestampValue:iso(now-61000)}]
])test(label+' is not recoverable',async()=>{const f=fixture();mutate(f);assert.equal((await createFreeRecoveryLab(f)(f.input)).status,'ignored')});
test('disabled, invalid environment and budget refusal prevent read',async()=>{
 const f=fixture();assert.equal((await createFreeRecoveryLab(f)({...f.input,enabled:false})).reason,'automation_disabled');
 assert.equal((await createFreeRecoveryLab({...f,reserveRecovery:async()=>false})(f.input)).reason,'recovery_budget_unavailable');
 assert.equal(f.calls.length,0);
});
