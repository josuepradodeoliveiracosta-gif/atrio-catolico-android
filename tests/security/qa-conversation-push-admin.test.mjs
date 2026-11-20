// QA exclusivamente no Firestore Emulator. Sem credenciais e sem FCM real.
import assert from 'node:assert/strict';
import test from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createConversationPushAdminService}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-admin.mjs';
import {conversationPushIdentity as identity}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-policy.mjs';

assert.match(process.env.FIRESTORE_EMULATOR_HOST??'',/^127\.0\.0\.1:\d+$/,
  'Firestore Emulator em loopback obrigatório');
assert.equal(process.env.GCLOUD_PROJECT,'demo-atrio-v11',
  'Projeto fictício obrigatório');
const app=initializeApp({projectId:'demo-atrio-v11'},'qa-admin-199');
const db=getFirestore(app);
const service=createConversationPushAdminService({
  db,serverTimestamp:()=>FieldValue.serverTimestamp(),
});
const accounts=Object.keys(identity.accounts);
const wait=()=>new Promise(resolve=>setTimeout(resolve,20));
const deadline=()=>new Date(Date.now()+180000);

try {
  for(const reverse of [false,true]) {
    await test(reverse?'B → A':'A → B',async()=>{
      const [sender,recipient]=reverse?[...accounts].reverse():accounts;
      const prefix=reverse?'reverse':'forward';
      const chatId=sender+'__'+recipient;
      const room=db.doc('chats/'+chatId);
      const message=id=>room.collection('messages').doc(id);
      const admission=uid=>db.doc('users/'+uid+'/chatPushAdmission/current');
      const pending=db.doc('users/'+recipient+'/chatPushPending/current');
      const op=(action,uid,n)=>prefix+'_'+action+'_'+uid+'_'+n;
      const grant=async(uid,n)=>service.admit({
        uid,operationKey:op('grant',uid,n),expiresAt:deadline(),
      });
      const revoke=async(uid,n)=>service.revoke({
        uid,operationKey:op('revoke',uid,n),
      });
      const publish=async id=>service.publish({
        senderUid:sender,recipientUid:recipient,conversationId:chatId,
        messageId:id,expiresAt:deadline(),
      });
      for(const uid of accounts) {
        await admission(uid).delete();
      }
      await pending.delete();
      const firstSender=await grant(sender,'initial');
      const firstRecipient=await grant(recipient,'initial');
      for(const uid of accounts) {
        const row=(await admission(uid).get()).data();
        assert.equal(row.admittedAt.constructor.name,'Timestamp');
        assert.ok(row.admittedAt.toMillis()<=Date.now());
      }
      await wait();
      await room.set({
        participants:[sender,recipient],requesterUid:sender,recipientUid:recipient,
        status:'accepted',lastSenderUid:sender,lastMessageId:'old',
      });
      await message('old').set({
        uid:sender,kind:'text',text:'mensagem fictícia',
        createdAt:FieldValue.serverTimestamp(),
      });
      await publish('old');
      const original=(await pending.get()).data();
      assert.equal(original.senderGeneration,firstSender.generation);
      assert.equal(original.recipientGeneration,firstRecipient.generation);
      for(const uid of [sender,recipient]) {
        const old=(await admission(uid).get()).data();
        await revoke(uid,'one');
        const newGrant=await grant(uid,'renewed');
        assert.notEqual(newGrant.generation,old.generation);
        const snapshot=(await admission(uid).get()).data();
        assert.equal(snapshot.generation,newGrant.generation);
        assert.equal(snapshot.admittedAt.constructor.name,'Timestamp');
        // Repetição de admissão não troca a geração nem revive outra operação.
        const repeat=await service.admit({
          uid,operationKey:op('grant',uid,'renewed'),
          expiresAt:snapshot.expiresAt.toDate(),
        });
        assert.equal(repeat.generation,newGrant.generation);
        assert.equal(repeat.replay,true);
        // Pendência antiga com gerações atuais não pode ser reautorizada.
        await assert.rejects(publish('old'),/notice_not_authorized/);
        await pending.set({
          ...original,
          senderGeneration:(await admission(sender).get()).data().generation,
          recipientGeneration:(await admission(recipient).get()).data().generation,
        });
        await assert.rejects(publish('old'),/notice_not_authorized/);
        assert.ok((await message('old').get()).exists,
          'a mensagem original continua armazenada para leitura manual');
      }
      // Retentativa de uma operação de revogação antiga não pode desfazer readmissão.
      const replayRevoke=await revoke(recipient,'one');
      assert.equal(replayRevoke.replay,true);
      assert.equal((await admission(recipient).get()).data().status,'active');
      await wait();
      await room.update({lastMessageId:'new'});
      await message('new').set({
        uid:sender,kind:'text',text:'nova mensagem fictícia',
        createdAt:FieldValue.serverTimestamp(),
      });
      const newNotice=await publish('new');
      assert.notEqual(newNotice.senderGeneration,firstSender.generation);
      assert.notEqual(newNotice.recipientGeneration,firstRecipient.generation);
      assert.equal((await pending.get()).data().messageId,'new');
      // Concorrência: transações serializam e o estado final define a autorização.
      const concurrent=await Promise.allSettled([
        revoke(sender,'race'),
        grant(sender,'race'),
      ]);
      assert.ok(concurrent.some(x=>x.status==='fulfilled'));
      const final=(await admission(sender).get()).data();
      if(final.status==='revoked')
        await assert.rejects(publish('new'),/notice_not_authorized/);
      else assert.equal(final.status,'active');
    });
  }
} finally {
  await deleteApp(app);
}
