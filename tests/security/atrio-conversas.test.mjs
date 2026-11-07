/**
 * Átrio Conversas: testes isolados no emulador de Firestore.
 * Não usam Firebase, Cloudflare ou contas de produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  collection, deleteDoc, deleteField, doc, getDoc, getDocs, setDoc, updateDoc, writeBatch,
  serverTimestamp, Timestamp
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
const quotaRef='users/chat-alice/chatLimits/requests';
const sendInitial=(db,text,options={})=>{
  const b=writeBatch(db);
  b.set(doc(db,room),request(text,options));
  b.set(doc(db,initial),message('chat-alice',text));
  b.set(doc(db,quotaRef),{
    count:1,windowStart:serverTimestamp(),updatedAt:serverTimestamp(),
    lastChatId:chatId
  });
  return b.commit();
};
const sendNewContact=async(peer,override={})=>{
  const other=env.authenticatedContext(peer).firestore();
  await setDoc(doc(other,'users/'+peer+'/chatSettings/privacy'),{
    requests:'all',readReceipts:false,showPushPreview:false,
    updatedAt:serverTimestamp()
  });
  const quota=(await getDoc(doc(alice,quotaRef))).data();
  const id=['chat-alice',peer].sort().join('__');
  const path='chats/'+id;
  const b=writeBatch(alice);
  b.set(doc(alice,path),{
    participants:['chat-alice',peer],requesterUid:'chat-alice',
    recipientUid:peer,status:'pending',initialId:'first',
    lastMessageId:'first',lastPreview:'Paz e bem!',createdAt:serverTimestamp(),
    updatedAt:serverTimestamp(),unreadRequester:0,unreadRecipient:1
  });
  b.set(doc(alice,path+'/messages/first'),message('chat-alice','Paz e bem!'));
  b.set(doc(alice,quotaRef),{
    count:quota.count+1,windowStart:quota.windowStart,
    lastChatId:id,updatedAt:serverTimestamp(),...override
  });
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
  await check('limite exige atualização atômica do contador em cada pedido',()=>
    assertFails(writeBatch(alice).set(doc(alice,'chats/chat-alice__chat-victim'),{
      participants:['chat-alice','chat-victim'],
      requesterUid:'chat-alice',recipientUid:'chat-victim',
      status:'pending',initialId:'first',lastMessageId:'first',
      lastPreview:'Paz e bem!',createdAt:serverTimestamp(),
      updatedAt:serverTimestamp(),unreadRequester:0,unreadRecipient:1
    }).set(doc(alice,'chats/chat-alice__chat-victim/messages/first'),
      message('chat-alice','Paz e bem!')).commit()));
  await check('não permite adulterar o próprio limite sem novo contato',()=>
    assertFails(updateDoc(doc(alice,quotaRef),{count:0})));
  await check('novas solicitações válidas incrementam o contador',async()=>{
    for (const peer of ['chat-c1','chat-c2','chat-c3','chat-c4'])
      await assertSucceeds(sendNewContact(peer));
    const now=(await getDoc(doc(alice,quotaRef))).data();
    assert.equal(now.count,5);
  });
  await check('sexta solicitação na mesma janela de 24 horas é recusada',()=>
    assertFails(sendNewContact('chat-c5')));
  await check('não é possível redefinir a janela antes de 24 horas',()=>
    assertFails(sendNewContact('chat-c6',{
      count:1,windowStart:serverTimestamp()
    })));
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
    await assertFails(setDoc(doc(stranger,'chat_reports/chat-stranger__'+chatId+'__m2'),{
      chatId,messageId:'m2',reporterUid:'chat-stranger',reason:'Conteúdo inadequado',
      reportedText:'Como está sua comunidade?',createdAt:serverTimestamp()
    }));
  });
  await check('denúncia de texto selecionado é aceita',()=>
    assertSucceeds(setDoc(doc(bob,'chat_reports/chat-bob__'+chatId+'__m2'),{
      chatId,messageId:'m2',reporterUid:'chat-bob',reason:'Conteúdo inadequado',
      reportedText:'Como está sua comunidade?',createdAt:serverTimestamp()
    })));
  await check('uma denúncia do mesmo usuário e mensagem não se duplica',()=>
    assertFails(setDoc(doc(bob,'chat_reports/chat-bob__'+chatId+'__m2'),{
      chatId,messageId:'m2',reporterUid:'chat-bob',
      reason:'Tentativa repetida',reportedText:'Como está sua comunidade?',
      createdAt:serverTimestamp()
    })));
  await check('ninguém denuncia texto adulterado',()=>
    assertFails(setDoc(doc(alice,'chat_reports/chat-alice__'+chatId+'__m2'),{
      chatId,messageId:'m2',reporterUid:'chat-alice',reason:'Conteúdo inadequado',
      reportedText:'texto diferente',createdAt:serverTimestamp()
    })));
  await check('participante pode ocultar mensagem apenas na própria caixa',()=>
    assertSucceeds(setDoc(doc(bob,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m2'),{
      hidden:true,createdAt:serverTimestamp()
    })));
  await check('ocultação pessoal não apaga o texto nem altera a conversa',async()=>{
    const original=await getDoc(doc(alice,room+'/messages/m2'));
    assert.equal(original.data().text,'Como está sua comunidade?');
    const hidden=await getDoc(doc(bob,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m2'));
    assert.equal(hidden.data().hidden,true);
  });
  await check('um terceiro não pode ocultar mensagem para outra pessoa',()=>
    assertFails(setDoc(doc(stranger,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m3'),{
      hidden:true,createdAt:serverTimestamp()
    })));
  await check('terceiros não podem visualizar listas privadas de ocultação',()=>
    assertFails(getDocs(collection(stranger,
      'users/chat-bob/chatHidden/'+chatId+'/messages'))));
  await check('participante pode restaurar somente a própria ocultação',async()=>{
    await assertSucceeds(deleteDoc(doc(bob,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m2')));
    const original=await assertSucceeds(getDoc(doc(bob,room+'/messages/m2')));
    assert.equal(original.data().text,'Como está sua comunidade?');
  });
  await check('terceiro não pode restaurar ocultação de outro',async()=>{
    await assertSucceeds(setDoc(doc(bob,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m2'),{
      hidden:true,createdAt:serverTimestamp()
    }));
    await assertFails(deleteDoc(doc(stranger,
      'users/chat-bob/chatHidden/'+chatId+'/messages/m2')));
  });
  await check('ninguém lê o contador de novos contatos de outra pessoa',()=>
    assertFails(getDoc(doc(stranger,quotaRef))));
  await check('ocultação não aceita campos extras nem mudança no texto',()=>
    assertFails(setDoc(doc(alice,
      'users/chat-alice/chatHidden/'+chatId+'/messages/m2'),{
      hidden:true,text:'adulterado',createdAt:serverTimestamp()
    })));
  await check('ocultação só pode referenciar mensagem existente',()=>
    assertFails(setDoc(doc(alice,
      'users/chat-alice/chatHidden/'+chatId+'/messages/fake'),{
      hidden:true,createdAt:serverTimestamp()
    })));
  await check('participante não consegue ler denúncias de outro',()=>
    assertFails(getDoc(doc(alice,'chat_reports/chat-bob__'+chatId+'__m2'))));
  await check('edição sem política administrativa permanece negada',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      editedText:'Texto novo',editedAt:serverTimestamp()
    })));
  await check('retirada pública sem política administrativa permanece negada',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      text:'[Mensagem removida]',deletedForAll:true,deletedAt:serverTimestamp()
    })));
  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),'app_config/conversations'),{
      enabled:true,version:'2026-11-v1',
      editEnabled:true,editWindowMinutes:60,
      deleteEnabled:true,deleteWindowMinutes:60
    }));
  await check('edição exige o autor da mensagem',()=>
    assertFails(updateDoc(doc(bob,room+'/messages/m2'),{
      editedText:'Impersonando autor',editedAt:serverTimestamp()
    })));
  await check('autor pode editar texto dentro da janela autorizada',()=>
    assertSucceeds(updateDoc(doc(alice,room+'/messages/m2'),{
      editedText:'Como está a sua comunidade hoje?',editedAt:serverTimestamp()
    })));
  await check('editar preserva texto original para auditoria',async()=>{
    const d=(await getDoc(doc(alice,room+'/messages/m2'))).data();
    assert.equal(d.text,'Como está sua comunidade?');
    assert.equal(d.editedText,'Como está a sua comunidade hoje?');
  });
  await check('denunciar uma edição exige corresponder ao texto real',()=>
    assertSucceeds(setDoc(doc(alice,'chat_reports/chat-alice__'+chatId+'__m2'),{
      chatId,messageId:'m2',reporterUid:'chat-alice',reason:'Conteúdo inadequado',
      reportedText:'Como está a sua comunidade hoje?',createdAt:serverTimestamp()
    })));
  await check('não é permitido editar outras propriedades da mensagem',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m2'),{
      uid:'chat-bob',editedText:'Adulteração',editedAt:serverTimestamp()
    })));
  await check('não é permitido editar cartão de discussão',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m8'),{
      editedText:'Adulteração',editedAt:serverTimestamp()
    })));
  await check('envio de nova última mensagem para editar',()=>
    assertSucceeds(sendNext(alice,'chat-alice','m12','Mensagem mais recente',{
      unreadRecipient:1
    })));
  await check('edição da última mensagem atualiza prévia atomicamente',async()=>{
    const batch=writeBatch(alice);
    batch.update(doc(alice,room+'/messages/m12'),{
      editedText:'Mensagem atualizada',editedAt:serverTimestamp()
    });
    batch.update(doc(alice,room),{lastPreview:'Mensagem atualizada'});
    await assertSucceeds(batch.commit());
    const d=await getDoc(doc(bob,room));
    assert.equal(d.data().lastPreview,'Mensagem atualizada');
  });
  await check('edição da última mensagem sem atualizar prévia falha',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/m12'),{
      editedText:'Prévia incoerente',editedAt:serverTimestamp()
    })));
  await check('remover última mensagem atualiza prévia sem revelar texto',async()=>{
    const batch=writeBatch(alice);
    batch.update(doc(alice,room+'/messages/m12'),{
      text:'[Mensagem removida]',editedText:deleteField(),
      reactions:deleteField(),deletedForAll:true,deletedAt:serverTimestamp()
    });
    batch.update(doc(alice,room),{lastPreview:'[Mensagem removida]'});
    await assertSucceeds(batch.commit());
    const d=(await getDoc(doc(bob,room+'/messages/m12'))).data();
    assert.equal(d.text,'[Mensagem removida]');
    assert.equal(d.editedText,undefined);
    const parent=(await getDoc(doc(bob,room))).data();
    assert.equal(parent.lastPreview,'[Mensagem removida]');
  });
  await check('remoção pública não permite repetir nem reagir depois',async()=>{
    await assertFails(updateDoc(doc(alice,room+'/messages/m12'),{
      deletedAt:serverTimestamp()
    }));
    await assertFails(updateDoc(doc(bob,room+'/messages/m12'),{
      'reactions.chat-bob':'🙏'
    }));
  });
  await check('autor remove uma mensagem editada sem preservar edição',async()=>{
    await assertSucceeds(updateDoc(doc(alice,room+'/messages/m2'),{
      text:'[Mensagem removida]',editedText:deleteField(),
      reactions:deleteField(),deletedForAll:true,deletedAt:serverTimestamp()
    }));
    const msg=(await getDoc(doc(bob,room+'/messages/m2'))).data();
    assert.equal(msg.text,'[Mensagem removida]');
    assert.equal(msg.editedText,undefined);
    assert.equal(msg.reactions,undefined);
  });
  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),room+'/messages/very-old'),{
      uid:'chat-alice',kind:'text',text:'Texto de ontem',
      createdAt:Timestamp.fromMillis(Date.now()-86_400_000)
    }));
  await check('janela de edição não permite editar mensagem antiga',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/very-old'),{
      editedText:'Tarde demais',editedAt:serverTimestamp()
    })));
  await check('janela de retirada não permite apagar mensagem antiga',()=>
    assertFails(updateDoc(doc(alice,room+'/messages/very-old'),{
      text:'[Mensagem removida]',deletedForAll:true,deletedAt:serverTimestamp()
    })));
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
