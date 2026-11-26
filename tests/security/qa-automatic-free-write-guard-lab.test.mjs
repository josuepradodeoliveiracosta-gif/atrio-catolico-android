import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {assertQaPublicationWrites,assertQaTransitionWrite} from '../../cloudflare/push-worker/scripts/qa-automatic-free-write-guard-lab.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const root='projects/'+identity.projectId+'/databases/'+identity.databaseId+'/documents/';
const sender='qa-nav-bob',recipient='qa-nav-alice',chat='qa-nav-alice__qa-nav-bob';
const gen='00000000-0000-4000-8000-000000000001',tx='fixture-token';
const eventKey=createHash('sha256').update(JSON.stringify([identity.roundId,chat,'m1'])).digest('hex');
const str=stringValue=>({stringValue});
const at='2027-01-15T08:00:00.000Z';
const tr=fieldPath=>[{fieldPath,setToServerValue:'REQUEST_TIME'}];
function publication(){
 const creation={seconds:1800000000,nanoseconds:12},expiresAt=new Date(1800000060000);
 const n={senderUid:sender,recipientUid:recipient,conversationId:chat,messageId:'m1',expiresAt,expectedSenderGeneration:gen,expectedRecipientGeneration:gen};
 const shared={roundId:str(identity.roundId),senderGeneration:str(gen),recipientGeneration:str(gen),expiresAt:{timestampValue:expiresAt.toISOString()}};
 const base={...shared,conversationId:str(chat),messageId:str('m1'),senderUid:str(sender)};
 const user=root+'users/'+recipient;
 const make=(name,fields,transform=false)=>({update:{name,fields},currentDocument:{exists:false},...(transform?{updateTransforms:tr('createdAt')}:{})});
 const body={transaction:tx,writes:[
  make(user+'/chatPushPending/current',{...base,kind:str('chat_message'),unread:{booleanValue:true}}),
  make(user+'/chatPushPublicationReceipts/'+eventKey,{...shared,operatorUid:str('qa-auto-emulator-only')},true),
  make(root+'qaPushAutomaticOutbox/'+eventKey,{...base,recipientUid:str(recipient),state:str('pending_transport'),messageCreateTime:{mapValue:{fields:{seconds:{integerValue:String(creation.seconds)},nanoseconds:{integerValue:'12'}}}}},true)]};
 return {body,ctx:{transaction:tx,eventKey,notice:n,creation,pendingVersion:null}};
}
test('exact three writes accepted including version-fenced pending replacement',()=>{
 const f=publication();assert.doesNotThrow(()=>assertQaPublicationWrites(f.body,f.ctx));
 f.ctx.pendingVersion=at;f.body.writes[0].currentDocument={updateTime:at};
 assert.doesNotThrow(()=>assertQaPublicationWrites(f.body,f.ctx));
});
for(const [name,mutate] of [
 ['foreign project',b=>b.writes[0].update.name=b.writes[0].update.name.replace(identity.projectId,'prod')],
 ['chat mutation',b=>b.writes[0].update.name=root+'chats/'+chat],
 ['delete',b=>b.writes[0].delete=root+'chats/'+chat],
 ['extra field',b=>b.writes[0].update.fields.text=str('forbidden')],
 ['recipient swap',b=>b.writes[0].update.name=root+'users/'+sender+'/chatPushPending/current'],
 ['wrong receipt key',b=>b.writes[1].update.name=root+'users/'+recipient+'/chatPushPublicationReceipts/'+'b'.repeat(64)],
 ['receipt overwrite',b=>b.writes[1].currentDocument={exists:true}],
 ['extra transform',b=>b.writes[2].updateTransforms.push({fieldPath:'expiresAt',setToServerValue:'REQUEST_TIME'})],
 ['modified expiry',b=>b.writes[2].update.fields.expiresAt={timestampValue:at}],
 ['changed state',b=>b.writes[2].update.fields.state=str('claimed_lab')],
 ['wrong transaction',b=>b.transaction='other'],
 ['extra write',b=>b.writes.push(b.writes[0])]
])test('publication rejects '+name,()=>{const f=publication();mutate(f.body);assert.throws(()=>assertQaPublicationWrites(f.body,f.ctx),/qa_write_guard_rejected/)});
function transition(claim=true){
 const outcome=claim?'claimed_lab':'unknown';
 const fields={state:str(outcome),...(claim?{claimId:str(gen)}:{})};
 return {body:{transaction:tx,writes:[{update:{name:root+'qaPushAutomaticOutbox/'+eventKey,fields},updateMask:{fieldPaths:Object.keys(fields)},currentDocument:{updateTime:at},updateTransforms:tr(claim?'claimedAt':'finishedAt')}]},
 ctx:{transaction:tx,eventKey,updateTime:at,previousState:claim?'pending_transport':'claimed_lab',claimId:gen,outcome}};
}
test('exact claim and terminal finish accepted',()=>{for(const b of [true,false]){const f=transition(b);assert.doesNotThrow(()=>assertQaTransitionWrite(f.body,f.ctx))}});
for(const [name,mutate] of [
 ['foreign outbox',w=>w.update.name=root+'qaPushAutomaticOutbox/'+'b'.repeat(64)],
 ['extra field',w=>w.update.fields.expiresAt={timestampValue:at}],
 ['extra mask',w=>w.updateMask.fieldPaths.push('expiresAt')],
 ['missing version',w=>delete w.currentDocument],
 ['wrong transform',w=>w.updateTransforms=tr('claimedAt')],
 ['reopen',w=>w.update.fields.state=str('pending_transport')]
])test('finish rejects '+name,()=>{const f=transition(false);mutate(f.body.writes[0]);assert.throws(()=>assertQaTransitionWrite(f.body,f.ctx),/qa_write_guard_rejected/)});
