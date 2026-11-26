import assert from 'node:assert/strict';
import test from 'node:test';
import {planAutomaticNotice,AUTO_CHAT} from '../../firebase/qa-geral-celular/pilot/conversation-push-automatic-plan.mjs';
import {conversationPushIdentity as identity} from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';
const now=1_800_000_000_000;
const alice='qa-nav-alice',bob='qa-nav-bob';
const fixture=()=>{
 const {projectId,databaseId,roundId,ageMode}=identity;
 const accounts={},admissions={},eligibility={};
 for(const [i,uid] of [alice,bob].entries()){
  accounts[uid]={uid,email:identity.accounts[uid],emailVerified:true,disabled:false};
  admissions[uid]={status:'active',email:identity.accounts[uid],roundId,
   generation:'00000000-0000-4000-8000-00000000000'+i,admittedAt:now-5_000,expiresAt:null};
  eligibility[uid]={status:'eligible',minimumAge:18,policyVersion:'2026-11-18plus-qa-v1',
   updatedAt:now-6_000,reviewExpiresAt:now+180_000};
 }
 return {enabled:true,now,event:{type:'created',projectId,databaseId,chatId:AUTO_CHAT,messageId:'m1'},
  snapshot:{projectId,databaseId,chatId:AUTO_CHAT,messageId:'m1',managedBoundary:false,
   config:{enabled:true,qaSimpleDirectEnabled:true,minorPolicyApproved:true,version:'2026-11-v1',
    safetyReviewVersion:'2026-11-safety-v1',pushPilot:{enabled:true,projectId,databaseId,roundId,ageMode,expiresAt:null}},
   room:{participants:[alice,bob],requesterUid:alice,recipientUid:bob,status:'accepted',
    lastSenderUid:bob,lastMessageId:'m1',unreadRequester:1,unreadRecipient:0},
   message:{uid:bob,kind:'text',createdAt:now-1000},
   accounts,admissions,eligibility,blocked:{[alice]:false,[bob]:false},muted:false,
   deviceEligible:true,receipt:null,pending:null}};
};
test('closed by default, no input required',()=>assert.deepEqual(planAutomaticNotice(),{status:'ignored',reason:'automation_disabled'}));
test('canonical Bob to Alice: exact bounded intent; no content or credential',()=>{
 const x=fixture(),r=planAutomaticNotice(x);
 assert.equal(r.status,'candidate');
 assert.deepEqual(r.notice,{senderUid:bob,recipientUid:alice,conversationId:AUTO_CHAT,messageId:'m1',
  expiresAt:new Date(now+119000),expectedSenderGeneration:x.snapshot.admissions[bob].generation,
  expectedRecipientGeneration:x.snapshot.admissions[alice].generation});
});
test('reverse direction derives recipient from canonical author',()=>{
 const x=fixture();x.snapshot.message.uid=alice;x.snapshot.room.lastSenderUid=alice;
 x.snapshot.room.unreadRequester=0;x.snapshot.room.unreadRecipient=1;
 assert.equal(planAutomaticNotice(x).notice.recipientUid,bob);
});
test('expiry is clipped to earliest age/admission/round deadline',()=>{
 const x=fixture();x.snapshot.eligibility[alice].reviewExpiresAt=now+30_000;
 x.snapshot.admissions[bob].expiresAt=now+20_000;
 assert.equal(planAutomaticNotice(x).notice.expiresAt.getTime(),now+20_000);
});
for(const [name,change,reason] of [
 ['wrong project',x=>x.event.projectId='production','invalid_event'],
 ['wrong database',x=>x.event.databaseId='other','invalid_event'],
 ['updates excluded',x=>x.event.type='updated','invalid_event'],
 ['unexpected path',x=>x.event.chatId='another','invalid_event'],
 ['invalid id',x=>x.event.messageId='../x','invalid_event'],
 ['snapshot mismatch',x=>x.snapshot.messageId='m2','invalid_snapshot'],
 ['managed boundary',x=>x.snapshot.managedBoundary=true,'invalid_snapshot'],
 ['direct disabled',x=>x.snapshot.config.qaSimpleDirectEnabled=false,'policy_closed'],
 ['pilot off',x=>x.snapshot.config.pushPilot.enabled=false,'policy_closed'],
 ['missing expiry',x=>delete x.snapshot.config.pushPilot.expiresAt,'policy_closed'],
 ['deleted message',x=>x.snapshot.message.deletedForAll=false,'invalid_or_expired_message'],
 ['expired event',x=>x.snapshot.message.createdAt=now-120000,'invalid_or_expired_message'],
 ['future event',x=>x.snapshot.message.createdAt=now+1,'invalid_or_expired_message'],
 ['superseded event',x=>x.snapshot.room.lastMessageId='m2','not_latest_unread_message'],
 ['not accepted',x=>x.snapshot.room.status='pending','not_latest_unread_message'],
 ['read message',x=>x.snapshot.room.unreadRequester=0,'not_latest_unread_message'],
 ['block sender',x=>x.snapshot.blocked[bob]=true,'recipient_unavailable'],
 ['block recipient',x=>x.snapshot.blocked[alice]=true,'recipient_unavailable'],
 ['unknown block',x=>delete x.snapshot.blocked[alice],'recipient_unavailable'],
 ['muted',x=>x.snapshot.muted=true,'recipient_unavailable'],
 ['no device',x=>x.snapshot.deviceEligible=false,'recipient_unavailable'],
 ['disabled auth',x=>x.snapshot.accounts[bob].disabled=true,'admission_or_age_invalid'],
 ['wrong email',x=>x.snapshot.accounts[alice].email='wrong','admission_or_age_invalid'],
 ['revoked admission',x=>x.snapshot.admissions[bob].status='revoked','admission_or_age_invalid'],
 ['readmitted after message',x=>x.snapshot.admissions[bob].admittedAt=now,'admission_or_age_invalid'],
 ['changed age proof',x=>x.snapshot.eligibility[alice].updatedAt=now-4000,'admission_or_age_invalid'],
 ['age expired',x=>x.snapshot.eligibility[alice].reviewExpiresAt=now,'admission_or_age_invalid'],
 ['too short window',x=>x.snapshot.eligibility[alice].reviewExpiresAt=now+9999,'notice_window_too_short'],
 ['receipt exists',x=>x.snapshot.receipt={},'receipt_exists_or_unknown'],
 ['receipt unknown',x=>delete x.snapshot.receipt,'receipt_exists_or_unknown'],
 ['pending unknown',x=>delete x.snapshot.pending,'invalid_pending']
]){
 test(name,()=>{const x=fixture();change(x);assert.deepEqual(planAutomaticNotice(x),{status:'ignored',reason});});
}
test('active pending: defer, no publication or overwrite',()=>{
 const x=fixture();x.snapshot.pending={unread:true,expiresAt:now+30_000};
 assert.deepEqual(planAutomaticNotice(x),{status:'defer',reason:'active_pending',retryBefore:now+119000});
});
test('expired pending allows new candidate, never reopens old receipt',()=>{
 const x=fixture();x.snapshot.pending={unread:true,expiresAt:now-1};
 assert.equal(planAutomaticNotice(x).status,'candidate');
 x.snapshot.receipt={};assert.equal(planAutomaticNotice(x).status,'ignored');
});
