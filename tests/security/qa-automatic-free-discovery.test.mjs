import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverFreeCandidate as discover} from '../../cloudflare/push-worker/scripts/qa-automatic-free-discovery.mjs';
const now=1800000000000,alice='qa-nav-alice',bob='qa-nav-bob';
const path='chats/'+alice+'__'+bob;
const fixture=()=>({enabled:true,projectId:'atrio-catolico-qa-general',databaseId:'(default)',
 activatedAt:now-90000,readTime:now,room:{path,status:'accepted',lastMessageId:'m1',
 lastSenderUid:bob,participants:[alice,bob],requesterUid:alice,recipientUid:bob,unreadRequester:1,unreadRecipient:0},
 message:{path:path+'/messages/m1',uid:bob,kind:'text',createdAt:now-30000,
 createTime:{seconds:(now-30000)/1000,nanoseconds:123456},text:'not forwarded'}});
test('closed by default',()=>assert.equal(discover().reason,'automation_disabled'));
test('one canonical hint with exact creation, original deadline and no content',()=>{
 const x=fixture(),r=discover(x);assert.deepEqual(r,{status:'candidate',event:{type:'created',
 projectId:x.projectId,databaseId:x.databaseId,chatId:alice+'__'+bob,messageId:'m1',
 expectedCreateTime:x.message.createTime},deadline:now+90000});
});
for(const [name,mutate,reason] of [
 ['production',x=>x.projectId='atrio-catolico','invalid_environment'],
 ['database',x=>x.databaseId='other','invalid_environment'],
 ['missing activation',x=>delete x.activatedAt,'invalid_environment'],
 ['wrong room',x=>x.room.path='chats/other','invalid_room'],
 ['pending room',x=>x.room.status='pending','invalid_room'],
 ['duplicate participant',x=>x.room.participants=[alice,alice],'invalid_room'],
 ['already read',x=>x.room.unreadRequester=0,'no_unread_message'],
 ['changed latest',x=>x.room.lastMessageId='m2','invalid_message'],
 ['wrong sender',x=>x.message.uid=alice,'invalid_message'],
 ['deleted',x=>x.message.deletedForAll=false,'invalid_message'],
 ['old before activation',x=>x.activatedAt=now-20000,'outside_activation_window'],
 ['future creation',x=>x.message.createTime.seconds=now/1000+1,'outside_activation_window'],
 ['too late',x=>{x.activatedAt=now-200000;x.message.createdAt=now-111000},'insufficient_original_window']
]){
 test(name,()=>{const x=fixture();mutate(x);assert.equal(discover(x).reason,reason)});
}
