// QA exclusivamente no Firestore Emulator. Sem credenciais e sem FCM real.
import assert from 'node:assert/strict';
import test from 'node:test';
import {initializeApp,deleteApp} from 'firebase-admin/app';
import {getFirestore,FieldValue} from 'firebase-admin/firestore';
import {createConversationPushAdminService}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-admin.mjs';
import {createAuthenticatedConversationPushAdmin}
  from '../../firebase/qa-geral-celular/pilot/conversation-push-operator-auth.mjs';
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
  authorize:(principal,capability)=>principal==='admission-operator' ? capability==='manage_admissions' : principal==='notice-publisher' && capability==='publish_notices',
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
      const generation=async uid=>(await admission(uid).get()).data()?.generation??null;
      const grant=async(uid,n,expectedGeneration)=>service.admit({
        uid,operationKey:op('grant',uid,n),expiresAt:deadline(),
        expectedGeneration,principal:'admission-operator',
      });
      const revoke=async(uid,n,expectedGeneration)=>service.revoke({
        uid,operationKey:op('revoke',uid,n),
        expectedGeneration,principal:'admission-operator',
      });
      const publish=async(id,expiresAt=new Date(Date.now()+120000),senderGeneration,recipientGeneration)=>service.publish({
        senderUid:sender,recipientUid:recipient,conversationId:chatId,
        messageId:id,expiresAt,
        expectedSenderGeneration:senderGeneration??null,
        expectedRecipientGeneration:recipientGeneration??null,
        principal:'notice-publisher',
      });
      const publishCurrent=async(id,expiry)=>publish(id,expiry,await generation(sender),await generation(recipient));
      for(const uid of accounts) {
        await admission(uid).delete();
      }
      await pending.delete();
      const firstSender=await grant(sender,'initial',null);
      const firstRecipient=await grant(recipient,'initial',null);
      await assert.rejects(service.admit({uid:sender,operationKey:op('grant',sender,'unauthorized'),expiresAt:deadline(),expectedGeneration:firstSender.generation,principal:'notice-publisher'}),/operator_forbidden/);
      await assert.rejects(service.publish({senderUid:sender,recipientUid:recipient,conversationId:chatId,messageId:'old',expiresAt:deadline(),principal:'admission-operator'}),/operator_forbidden/);
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
      await publishCurrent('old');
      const original=(await pending.get()).data();
      assert.equal(original.senderGeneration,firstSender.generation);
      assert.equal(original.recipientGeneration,firstRecipient.generation);
      for(const uid of [sender,recipient]) {
        const old=(await admission(uid).get()).data();
        await revoke(uid,'one',old.generation);
        const newGrant=await grant(uid,'renewed',old.generation);
        await assert.rejects(grant(uid,'late_'+uid,old.generation),/stale_admission_generation/);
        await assert.rejects(revoke(uid,'late_'+uid,old.generation),/stale_admission_generation/);
        assert.notEqual(newGrant.generation,old.generation);
        const snapshot=(await admission(uid).get()).data();
        assert.equal(snapshot.generation,newGrant.generation);
        assert.equal(snapshot.admittedAt.constructor.name,'Timestamp');
        // Repetição de admissão não troca a geração nem revive outra operação.
        const repeat=await service.admit({
          uid,operationKey:op('grant',uid,'renewed'),
          expiresAt:snapshot.expiresAt.toDate(),
          expectedGeneration:old.generation,principal:'admission-operator',
        });
        assert.equal(repeat.generation,newGrant.generation);
        assert.equal(repeat.replay,true);
        // Pendência antiga com gerações atuais não pode ser reautorizada.
        await assert.rejects(publishCurrent('old'),/notice_not_authorized/);
        await pending.set({
          ...original,
          senderGeneration:(await admission(sender).get()).data().generation,
          recipientGeneration:(await admission(recipient).get()).data().generation,
        });
        await assert.rejects(publish('old'),/notice_not_authorized/);
        assert.ok((await message('old').get()).exists,
          'a mensagem original continua armazenada para leitura manual');
      }
      // Encerrar a pendência adulterada pelo ensaio antes de emitir evento novo.
      await pending.update({unread:false});
      // Retentativa de uma operação de revogação antiga não pode desfazer readmissão.
      const replayRevoke=await revoke(recipient,'one',firstRecipient.generation);
      assert.equal(replayRevoke.replay,true);
      assert.equal((await admission(recipient).get()).data().status,'active');
      await wait();
      await room.update({lastMessageId:'new'});
      await message('new').set({
        uid:sender,kind:'text',text:'nova mensagem fictícia',
        createdAt:FieldValue.serverTimestamp(),
      });
      const newNotice=await publishCurrent('new');
      const firstExpiry=(await pending.get()).data().expiresAt.toMillis();
      await pending.update({unread:false});
      const consumed=(await pending.get()).data();
      const repeated=await publishCurrent('new',new Date(Date.now()+140000));
      assert.equal(repeated.replay,true);
      assert.equal((await pending.get()).data().unread,false);
      assert.equal((await pending.get()).data().expiresAt.toMillis(),firstExpiry);
      assert.equal(consumed.unread,false);
      const duplicate=await Promise.all([publishCurrent('new'),publishCurrent('new')]);
      assert.ok(duplicate.every(x=>x.replay===true));
      assert.equal((await pending.get()).data().unread,false);
      await assert.rejects(publish('new',deadline(),firstSender.generation,firstRecipient.generation),/notice_not_authorized/);
      assert.notEqual(newNotice.senderGeneration,firstSender.generation);
      assert.notEqual(newNotice.recipientGeneration,firstRecipient.generation);
      assert.equal((await pending.get()).data().messageId,'new');
      // Concorrência: transações serializam e o estado final define a autorização.
      const concurrent=await Promise.allSettled([
        revoke(sender,'race',await generation(sender)),
        grant(sender,'race',await generation(sender)),
      ]);
      assert.ok(concurrent.some(x=>x.status==='fulfilled'));
      const final=(await admission(sender).get()).data();
      if(final.status==='revoked')
        await assert.rejects(publishCurrent('new'),/notice_not_authorized/);
      else assert.equal(final.status,'active');
    });
  }

  await test('autenticação do operador e privilégios mínimos no servidor',async()=>{
    const [uid]=accounts;
    const allowedOperators={
      'qa-admissions-operator':['manage_admissions'],
      'qa-notice-publisher':['publish_notices'],
    };
    const tokens={
      admission:{uid:'qa-admissions-operator',aud:'atrio-catolico-qa-general',
        email_verified:true,firebase:{sign_in_provider:'password'},
        atrioQaPushCapabilities:['manage_admissions']},
      publisher:{uid:'qa-notice-publisher',aud:'atrio-catolico-qa-general',
        email_verified:true,firebase:{sign_in_provider:'password'},
        atrioQaPushCapabilities:['publish_notices']},
      wrongProject:{uid:'qa-admissions-operator',aud:'outro-projeto',
        email_verified:true,firebase:{sign_in_provider:'password'},
        atrioQaPushCapabilities:['manage_admissions']},
      missingClaim:{uid:'qa-admissions-operator',aud:'atrio-catolico-qa-general',
        email_verified:true,firebase:{sign_in_provider:'password'},
        atrioQaPushCapabilities:[]},
      notAllowed:{uid:'qa-unknown-operator',aud:'atrio-catolico-qa-general',
        email_verified:true,firebase:{sign_in_provider:'password'},
        atrioQaPushCapabilities:['manage_admissions']},
    };
    const auth={verifyIdToken:async(token,checkRevoked)=>{
      assert.equal(checkRevoked,true);
      if(token==='revoked'||!Object.hasOwn(tokens,token))
        throw new Error('auth/id-token-revoked');
      return tokens[token];
    }};
    const gateway=createAuthenticatedConversationPushAdmin({
      db,auth,serverTimestamp:()=>FieldValue.serverTimestamp(),
      projectId:'atrio-catolico-qa-general',allowedOperators,
    });
    const admissionRef=db.doc('users/'+uid+'/chatPushAdmission/current');
    const current=(await admissionRef.get()).data();
    const request={action:'revoke',payload:{
      uid,operationKey:'qa_auth_revoke_001',
      expectedGeneration:current.generation,
    }};
    for(const authorization of [undefined,'','Bearer revoked','Bearer invalid','Basic admission',
      'Bearer wrongProject']) {
      await assert.rejects(gateway.execute({...request,authorization}),
        /operator_unauthenticated/);
    }
    for(const authorization of ['Bearer publisher','Bearer missingClaim','Bearer notAllowed']) {
      await assert.rejects(gateway.execute({...request,authorization}),
        /operator_forbidden/);
    }
    await assert.rejects(gateway.execute({
      authorization:'Bearer admission',action:'publish',
      payload:{senderUid:uid,recipientUid:accounts[1]},
    }),/operator_forbidden/);
    const done=await gateway.execute({...request,authorization:'Bearer admission'});
    assert.equal(done.replay,false);
    assert.equal((await admissionRef.get()).data().status,'revoked');
    // O editor de avisos ultrapassa a autenticação, mas não pode
    // publicar evento sem as condições canônicas.
    await assert.rejects(gateway.execute({
      authorization:'Bearer publisher',action:'publish',
      payload:{senderUid:uid,recipientUid:accounts[1],
        conversationId:'qa_invalid',messageId:'missing',
        expiresAt:new Date(Date.now()+30000),
        expectedSenderGeneration:current.generation,
        expectedRecipientGeneration:'missing'},
    }),/notice_not_authorized/);
  });
} finally {
  await deleteApp(app);
}
