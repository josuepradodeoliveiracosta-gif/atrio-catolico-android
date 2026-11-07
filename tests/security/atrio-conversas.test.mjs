/**
 * Átrio Conversas: testes isolados no emulador de Firestore.
 * Não usam Firebase, Cloudflare ou contas de produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  serverTimestamp
} from 'firebase/firestore';

// O arquivo raiz está sob fingerprint de produção: jamais alterá-lo para
// testar uma funcionalidade ainda não homologada. Mesclar apenas em memória.
const protectedRules=readFileSync('firestore.rules','utf8');
const extension=readFileSync('../../firebase/atrio-conversas-v1.rules.fragment','utf8');
const marker="    match /{document=**} {\n      allow read, write: if false;\n    }";
if (!protectedRules.includes(marker) || !extension.includes('match /chats/{chatId}'))
  throw Error('Regras protegidas/fragmento de homologação indisponíveis');
const candidateRules=protectedRules.replace(marker,extension+marker);
const env = await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:candidateRules}
});
const alice=env.authenticatedContext('chat-alice').firestore();
const bob=env.authenticatedContext('chat-bob').firestore();
const stranger=env.authenticatedContext('chat-stranger').firestore();
const unauth=env.unauthenticatedContext().firestore();
const chatId='chat-alice__chat-bob';
const room='chats/'+chatId;
const initial=room+'/messages/m1';
let passed=0;
async function check(label,run) {
  await run(); passed++;
  console.log('PASS CHAT',label);
}
const message=(sender,text,kind='text')=>({
  uid:sender,text,kind,createdAt:serverTimestamp()
});
const request=(text,extra={})=>({
  participants:['chat-alice','chat-bob'],requesterUid:'chat-alice',
  recipientUid:'chat-bob',status:'pending',initialId:'m1',
  lastMessageId:'m1',lastPreview:text,createdAt:serverTimestamp(),
  updatedAt:serverTimestamp(),unreadRequester:0,unreadRecipient:1,...extra
});
const sendInitial=(db,text,options={})=>{
  const b=writeBatch(db);
  b.set(doc(db,room),request(text,options));
  b.set(doc(db,initial),message('chat-alice',text));
  return b.commit();
};
const sendNext=(db,sender,id,text,updateOverrides={},kind='text',extra={})=>{
  const b=writeBatch(db);
  b.set(doc(db,room+'/messages/'+id),{...message(sender,text,kind),...extra});
  const base={lastMessageId:id,lastPreview:text,updatedAt:serverTimestamp(),
    ...updateOverrides};
  b.update(doc(db,room),base);
  return b.commit();
};

try {
  await env.clearFirestore();
  await check('desativado por padrão: não existe acesso a chats',()=>
    assertFails(getDoc(doc(alice,room))));
  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),'app_config/conversations'),{
      enabled:true,version:'2026-11-v1'
    }));
  await check('ninguém vê conteúdo de terceiros ou anônimos',async()=>{
    await assertFails(getDoc(doc(stranger,room)));
    await assertFails(getDoc(doc(unauth,room)));
  });
  await check('recusar primeira mensagem sem permissão do destinatário',()=>
    assertFails(sendInitial(alice,'Paz e bem!')));
  await check('terceiro não ativa as preferências de Bob',()=>
    assertFails(setDoc(doc(stranger,'users/chat-bob/chatSettings/privacy'),{
      requests:'all',readReceipts:false,showPushPreview:false,
      updatedAt:serverTimestamp()
    })));
  await check('Bob autoriza solicitações conscientemente',()=>
    assertSucceeds(setDoc(doc(bob,'users/chat-bob/chatSettings/privacy'),{
      requests:'all',readReceipts:false,showPushPreview:false,
      updatedAt:serverTimestamp()
    })));
  await check('solicitação com mídia/atributos extras é rejeitada',()=>
    assertFails(sendInitial(alice,'Paz e bem!',{attachment:'https://exemplo.invalid'})));
  await check('solicitação que inclui link é rejeitada',()=>
    assertFails(sendInitial(alice,'Visite https://example.com')));
  await check('solicitação válida e mensagem inicial são atômicas',()=>
    assertSucceeds(sendInitial(alice,'Paz e bem!')));
  await check('terceiro não lê conversa, mensagens nem lista de terceiros',async()=>{
    await assertFails(getDoc(doc(stranger,room)));
    await assertFails(getDoc(doc(stranger,initial)));
    await assertFails(getDocs(collection(stranger,room+'/messages')));
  });
  await check('participantes conseguem consultar a mensagem inicial',async()=>{
    assert.equal((await assertSucceeds(getDoc(doc(bob,initial)))).data().text,'Paz e bem!');
    await assertSucceeds(getDoc(doc(alice,room)));
  });
  await check('abrir a solicitação não a aceita automaticamente',async()=>{
    assert.equal((await assertSucceeds(getDoc(doc(bob,room)))).data().status,'pending');
    await assertFails(sendNext(alice,'chat-alice','m2','Envia antes do aceite',{
      unreadRecipient:2
    }));
  });
  await check('remetente não pode se autoautorizar',()=>
    assertFails(updateDoc(doc(alice,room),{status:'accepted',updatedAt:serverTimestamp()})));
  await check('estranho não pode aceitar solicitação',()=>
    assertFails(updateDoc(doc(stranger,room),{status:'accepted',updatedAt:serverTimestamp()})));
  await check('somente Bob aceita',()=>
    assertSucceeds(updateDoc(doc(bob,room),{status:'accepted',updatedAt:serverTimestamp()})));
  await check('Alice envia texto aprovado e contador avança',()=>
    assertSucceeds(sendNext(alice,'chat-alice','m2','Como está sua comunidade?',{
      unreadRecipient:2
    })));
  await check('resposta cita apenas mensagem existente na mesma conversa',()=>
    assertSucceeds(sendNext(bob,'chat-bob','m6','Amém, muito bem!',{
      unreadRequester:1
    },'text',{replyToId:'m2'})));
  await check('referência inexistente na resposta é recusada',()=>
    assertFails(sendNext(alice,'chat-alice','m7','Referência falsa',{
      unreadRecipient:3
    },'text',{replyToId:'mensagem-inexistente'})));
  await check('remetente registra sua própria reação de oração',()=>
    assertSucceeds(updateDoc(doc(alice,room+'/messages/m2'),{
      'reactions.chat-alice':'🙏'
    })));
  await check('destinatário vê a reação sem listener separado',async()=>{
    const d=await assertSucceeds(getDoc(doc(bob,room+'/messages/m2')));
    assert.equal(d.data().reactions['chat-alice'],'🙏');
  });
  await check('outro participante escolhe sua própria reação',()=>
    assertSucceeds(updateDoc(doc(bob,room+'/messages/m2'),{
      'reactions.chat-bob':'❤️'
    })));
  await check('emoji não aprovado é negado',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      'reactions.chat-alice':'💣'
    })));
  await check('ninguém pode reagir em nome do outro',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      'reactions.chat-bob':'👍'
    })));
  await check('reações não permitem editar a mensagem original',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      text:'Texto adulterado', 'reactions.chat-alice':'👍'
    })));
  await check('um terceiro não consegue reagir em mensagem alheia',()=>
    assertFails(updateDoc(doc(stranger,room+'/messages/m2'),{
      'reactions.chat-stranger':'🙏'
    })));
  await check('titular pode remover apenas sua própria reação',()=>
    assertSucceeds(updateDoc(doc(bob,room+'/messages/m2'),{
      'reactions.chat-bob':'👍'
    })));
  await env.withSecurityRulesDisabled(async ctx =>
    setDoc(doc(ctx.firestore(),'posts/post-example'),{
      uid:'chat-alice',title:'Oração e comunhão na comunidade',
      body:'Testes em ambiente isolado',category:'Oração'
    }));
  await check('cartão de discussão usa título original e apenas texto',()=>
    assertSucceeds(sendNext(alice,'chat-alice','m8',
      'Discussão: Oração e comunhão na comunidade',{
        unreadRecipient:3
      },'post',{
        postId:'post-example',postTitle:'Oração e comunhão na comunidade'
      })));
  await check('cartão não aceita título falsificado',()=>
    assertFails(sendNext(alice,'chat-alice','m9','Discussão: Título falso',{
      unreadRecipient:4
    },'post',{postId:'post-example',postTitle:'Título falso'})));
  await check('cartão não aceita publicação que não existe',()=>
    assertFails(sendNext(alice,'chat-alice','m10','Discussão: Postagem removida',{
      unreadRecipient:4
    },'post',{postId:'post-apagado',postTitle:'Postagem removida'})));
  await check('mensagem disfarçada de arquivo não passa como cartão textual',()=>
    assertFails(sendNext(alice,'chat-alice','m11','Discussão: Oração e comunhão na comunidade',{
      unreadRecipient:4
    },'post',{
      postId:'post-example',postTitle:'Oração e comunhão na comunidade',
      attachmentUrl:'https://example.test/foto.jpg'
    })));
  await check('envio de tipo mídia é rejeitado no backend',()=>
    assertFails(sendNext(alice,'chat-alice','m3','arquivo', {
      unreadRecipient:3
    },'image')));
  await check('terceiro não falsifica autoria',()=>
    assertFails(sendNext(stranger,'chat-alice','m4','Intrusão!',{
      unreadRecipient:3
    })));
  await check('Bob pode zerar apenas o próprio contador',async()=>{
    await assertSucceeds(updateDoc(doc(bob,room),{unreadRecipient:0}));
    await assertFails(updateDoc(doc(bob,room),{unreadRequester:0}));
  });
  await check('denúncia de terceiros é proibida',async()=>{
    await assertFails(setDoc(doc(stranger,'chat_reports/report1'),{
      chatId,messageId:'m2',reporterUid:'chat-stranger',reason:'Conteúdo inadequado',
      reportedText:'Como está sua comunidade?',createdAt:serverTimestamp()
    }));
  });
  await check('denúncia de texto selecionado é aceita',()=>
    assertSucceeds(setDoc(doc(bob,'chat_reports/report2'),{
      chatId,messageId:'m2',reporterUid:'chat-bob',reason:'Conteúdo inadequado',
      reportedText:'Como está sua comunidade?',createdAt:serverTimestamp()
    })));
  await check('ninguém denuncia texto adulterado',()=>
    assertFails(setDoc(doc(bob,'chat_reports/report3'),{
      chatId,messageId:'m2',reporterUid:'chat-bob',reason:'Conteúdo inadequado',
      reportedText:'texto diferente',createdAt:serverTimestamp()
    })));
  await check('participante não consegue ler denúncias de outro',()=>
    assertFails(getDoc(doc(alice,'chat_reports/report2'))));
  await check('bloqueio impede novas mensagens mesmo entre participantes',async()=>{
    await assertSucceeds(setDoc(doc(bob,'users/chat-bob/blockedMembers/chat-alice'),{
      createdAt:serverTimestamp()
    }));
    await assertFails(sendNext(alice,'chat-alice','m5','Bloqueio ignorado?',{
      unreadRecipient:1
    }));
  });
  await check('participantes não podem remover conversa de modo unilateral',()=>
    assertFails(updateDoc(doc(alice,room),{recipientUid:'chat-stranger'})));
  console.log('CHAT SECURITY TESTS:',passed,'OK');
} finally {await env.cleanup();}
