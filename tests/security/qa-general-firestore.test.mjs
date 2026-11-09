// Somente Firebase Emulator. Nunca ligar a um projeto real.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,getDoc,setDoc,writeBatch,serverTimestamp,updateDoc} from 'firebase/firestore';

const contents=readFileSync('qa-general.generated.rules','utf8');
if(!contents.includes('match /{document=**}') ||
   !contents.includes('match /chats/{chatId}') ||
   !contents.includes('match /chat_groups/{groupId}'))throw Error('rules_not_qa');
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:contents}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const outsider=env.authenticatedContext('qa-outsider',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const room='chats/qa-alice__qa-bob';
try {
 await env.clearFirestore();
 await assertFails(getDoc(doc(alice,room)));
 await assertFails(getDoc(doc(guest,'public_profiles/qa-alice')));
 await assertFails(getDoc(doc(alice,'posts/qa-post')));
 await assertFails(setDoc(doc(alice,'admins/qa-alice'),{enabled:true}));
 await assertFails(setDoc(doc(alice,'app_config/conversations'),{enabled:true}));
 await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'app_config/conversations'),{
     enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
     safetyReviewVersion:'2026-11-safety-v1'
   });
   await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
     enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:false
   });
 });
 await assertSucceeds(setDoc(doc(bob,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(alice,'users/qa-bob/chatSettings/privacy'),{
   requests:'all',readReceipts:false,showPushPreview:false,
   updatedAt:serverTimestamp()
 }));
 await assertSucceeds(setDoc(doc(bob,'users/qa-bob/blockedMembers/qa-outsider'),{
   createdAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(outsider,'users/qa-bob/blockedMembers/qa-alice'),{
   createdAt:serverTimestamp()
 }));
 await assertFails(setDoc(doc(alice,'chat_groups/g1'),{ownerUid:'qa-alice'}));
 const b=writeBatch(alice);
 b.set(doc(alice,room),{
   participants:['qa-alice','qa-bob'],requesterUid:'qa-alice',
   recipientUid:'qa-bob',status:'pending',initialId:'first',
   lastMessageId:'first',lastPreview:'Paz e bem!',lastSenderUid:'qa-alice',
   createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
   unreadRequester:0,unreadRecipient:1
 });
 b.set(doc(alice,room+'/messages/first'),{
   uid:'qa-alice',text:'Paz e bem!',kind:'text',createdAt:serverTimestamp()
 });
 b.set(doc(alice,'users/qa-alice/chatLimits/requests'),{
   count:1,windowStart:serverTimestamp(),lastChatId:'qa-alice__qa-bob',
   updatedAt:serverTimestamp()
 });
 await assertSucceeds(b.commit());
 await assertSucceeds(getDoc(doc(bob,room)));
 await assertFails(getDoc(doc(outsider,room)));
 await assertSucceeds(updateDoc(doc(bob,room),{status:'accepted',updatedAt:serverTimestamp()}));
 await assertFails(updateDoc(doc(alice,room),{status:'declined'}));
 console.log('QA geral: autenticacao, bloqueio e aceite verificados em emulador.');
}finally{await env.cleanup();}
