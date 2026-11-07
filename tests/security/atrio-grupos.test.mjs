/**
 * Átrio Grupos V1 — integração em emulador isolado, NUNCA produção.
 * Políticas dos grupos são adicionadas em memória ao Firestore protegido.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {
  arrayRemove,arrayUnion,collection,collectionGroup,doc,getDoc,getDocs,
  query,serverTimestamp,setDoc,updateDoc,where,writeBatch
} from 'firebase/firestore';

const marker="    match /{document=**} {\n      allow read, write: if false;\n    }";
const core=readFileSync('firestore.rules','utf8');
const individual=readFileSync('../../firebase/atrio-conversas-v1.rules.fragment','utf8');
const groups=readFileSync('../../firebase/atrio-grupos-v1.rules.fragment','utf8');
if (!core.includes(marker) || !groups.includes('match /chat_groups/{groupId}'))
  throw Error('Fragmentos ou marca de integridade ausentes');
const rules=core.replace(marker,individual+groups+marker);
const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const a=env.authenticatedContext('group-a').firestore();
const b=env.authenticatedContext('group-b').firestore();
const c=env.authenticatedContext('group-c').firestore();
const stranger=env.authenticatedContext('group-stranger').firestore();
const anonymous=env.unauthenticatedContext().firestore();
const groupId='grp-study-01';
const group='chat_groups/'+groupId;
const quota='users/group-a/chatGroupLimits/creation';
let passed=0;
async function check(name,fn) {
  await fn();
  passed++;
  console.log('PASS GROUP',name);
}
function baseRoom(id,creator='group-a') {
  return {
    name:'Estudo do Evangelho',category:'study',
    ownerUid:creator,memberUids:[creator],adminUids:[creator],
    status:'active',createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
    lastMessageId:'',lastPreview:'',lastSenderUid:''
  };
}
function createFirst(db,id=groupId) {
  const batch=writeBatch(db);
  batch.set(doc(db,'chat_groups/'+id),baseRoom(id));
  batch.set(doc(db,quota),{
    count:1,windowStart:serverTimestamp(),
    lastGroupId:id,updatedAt:serverTimestamp()
  });
  return batch.commit();
}
function invitation(db,id,invitee,extra={}) {
  return setDoc(doc(db,'chat_groups/'+id+'/atrioGroupInvites/'+invitee),{
    inviteeUid:invitee,inviterUid:'group-a',
    groupName:'Estudo do Evangelho',status:'pending',
    createdAt:serverTimestamp(),updatedAt:serverTimestamp(),...extra
  });
}
function accept(db,id,uid) {
  const batch=writeBatch(db);
  batch.update(doc(db,'chat_groups/'+id+'/atrioGroupInvites/'+uid),{
    status:'accepted',updatedAt:serverTimestamp()
  });
  batch.update(doc(db,'chat_groups/'+id),{
    memberUids:arrayUnion(uid),updatedAt:serverTimestamp()
  });
  return batch.commit();
}
function message(db,id,sender,msgId,text,kind='text',extra={}) {
  const batch=writeBatch(db);
  batch.set(doc(db,'chat_groups/'+id+'/messages/'+msgId),{
    uid:sender,text,kind,createdAt:serverTimestamp(),...extra
  });
  batch.update(doc(db,'chat_groups/'+id),{
    lastMessageId:msgId,lastPreview:text,lastSenderUid:sender,
    updatedAt:serverTimestamp()
  });
  return batch.commit();
}
try {
  await env.clearFirestore();
  await check('grupos começam fechados e ninguém cria',()=>
    assertFails(createFirst(a)));
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
      enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:false
    });
  });
  await check('ativação sem política de menores não autoriza grupos',()=>
    assertFails(createFirst(a)));
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'app_config/chat_groups'),{
      enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
    });
  });
  await check('criador abre grupo privado com quota no mesmo batch',()=>
    assertSucceeds(createFirst(a)));
  await check('criador consegue ler próprio grupo',async()=>{
    assert.equal((await assertSucceeds(getDoc(doc(a,group)))).data().ownerUid,'group-a');
    const rows=await assertSucceeds(getDocs(query(
      collection(a,'chat_groups'),where('memberUids','array-contains','group-a')
    )));
    assert.equal(rows.size,1);
  });
  await check('não participantes e anônimos não leem grupos',async()=>{
    await assertFails(getDoc(doc(stranger,group)));
    await assertFails(getDoc(doc(b,group)));
    await assertFails(getDoc(doc(anonymous,group)));
  });
  await check('ninguém altera quota sem criar novo grupo',()=>
    assertFails(updateDoc(doc(a,quota),{count:0})));
  await check('usuário não recebe administrador por autoedição',()=>
    assertFails(updateDoc(doc(b,group),{
      memberUids:arrayUnion('group-b'),updatedAt:serverTimestamp()
    })));
  await check('não membro não consegue enviar convite',()=>
    assertFails(invitation(stranger,groupId,'group-b',{inviterUid:'group-stranger'})));
  await check('administrador não convida UID desconhecido sem contato aceito',()=>
    assertFails(invitation(a,groupId,'group-c')));
  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),'chats/group-a__group-b'),{
      participants:['group-a','group-b'],
      requesterUid:'group-a',recipientUid:'group-b',status:'accepted',
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    }));
  await env.withSecurityRulesDisabled(async ctx=>
    setDoc(doc(ctx.firestore(),'chats/group-a__group-c'),{
      participants:['group-a','group-c'],
      requesterUid:'group-a',recipientUid:'group-c',status:'accepted',
      createdAt:serverTimestamp(),updatedAt:serverTimestamp()
    }));
  await assertSucceeds(setDoc(doc(c,'users/group-c/blockedMembers/group-a'),{
    createdAt:serverTimestamp()
  }));
  await check('contato aceito que bloqueou administrador não recebe convite',()=>
    assertFails(invitation(a,groupId,'group-c')));
  await check('administrador envia convite privado',()=>
    assertSucceeds(invitation(a,groupId,'group-b')));
  await check('convidado vê o convite mas não o conteúdo do grupo',async()=>{
    const inv=await assertSucceeds(getDoc(doc(b,group+'/atrioGroupInvites/group-b')));
    assert.equal(inv.data().status,'pending');
    await assertFails(getDoc(doc(b,group)));
    await assertFails(getDocs(collection(b,group+'/messages')));
  });
  await check('terceiro não lê convite particular',()=>
    assertFails(getDoc(doc(stranger,group+'/atrioGroupInvites/group-b'))));
  await check('convites recebidos aparecem só ao destinatário',async()=>{
    const rows=await assertSucceeds(getDocs(query(
      collectionGroup(b,'atrioGroupInvites'),where('inviteeUid','==','group-b'))));
    assert.ok(rows.docs.some(x=>x.ref.path===group+'/atrioGroupInvites/group-b'));
  });
  await check('um convite não aceita status sem ingresso no mesmo batch',()=>
    assertFails(updateDoc(doc(b,group+'/atrioGroupInvites/group-b'),{
      status:'accepted',updatedAt:serverTimestamp()
    })));
  await check('um usuário sem convite não ingressa por arrayUnion',()=>
    assertFails(updateDoc(doc(stranger,group),{
      memberUids:arrayUnion('group-stranger'),updatedAt:serverTimestamp()
    })));
  await check('convidado aceita explicitamente com atualização atômica',()=>
    assertSucceeds(accept(b,groupId,'group-b')));
  await check('aceito consegue ver o histórico e a lista do grupo',async()=>{
    const d=await assertSucceeds(getDoc(doc(b,group)));
    assert.ok(d.data().memberUids.includes('group-b'));
    await assertSucceeds(getDocs(collection(b,group+'/messages')));
  });
  await check('destinatário não aceita duas vezes nem acrescenta outra conta',()=>
    assertFails(updateDoc(doc(b,group),{
      memberUids:arrayUnion('group-c'),updatedAt:serverTimestamp()
    })));
  await check('mensagem de texto válida usa batch com prévia coerente',()=>
    assertSucceeds(message(b,groupId,'group-b','msg1','Paz e bem!')));
  await check('o mesmo remetente não dispara mensagens em sequência imediata',()=>
    assertFails(message(b,groupId,'group-b','flood1','Spam repetitivo')));
  await check('participante denuncia uma mensagem específica',async()=>{
    await assertSucceeds(setDoc(doc(a,
      'chat_group_reports/group-a__'+groupId+'__msg1'),{
      groupId,messageId:'msg1',reporterUid:'group-a',
      reason:'Conteúdo para avaliação',
      reportedText:'Paz e bem!',createdAt:serverTimestamp()
    }));
    const d=await assertSucceeds(getDoc(doc(a,
      'chat_group_reports/group-a__'+groupId+'__msg1')));
    assert.equal(d.data().messageId,'msg1');
  });
  await check('terceiros não podem ler denúncias de grupos',async()=>{
    await assertFails(getDoc(doc(stranger,
      'chat_group_reports/group-a__'+groupId+'__msg1')));
    await assertFails(getDoc(doc(b,
      'chat_group_reports/group-a__'+groupId+'__msg1')));
  });
  await check('denúncia de grupo não pode ser duplicada',()=>
    assertFails(setDoc(doc(a,
      'chat_group_reports/group-a__'+groupId+'__msg1'),{
      groupId,messageId:'msg1',reporterUid:'group-a',
      reason:'Outra denúncia',reportedText:'Paz e bem!',
      createdAt:serverTimestamp()
    })));
  await check('denúncia com mensagem adulterada é rejeitada',()=>
    assertFails(setDoc(doc(b,
      'chat_group_reports/group-b__'+groupId+'__msg1'),{
      groupId,messageId:'msg1',reporterUid:'group-b',
      reason:'Motivo válido',reportedText:'Texto forjado',
      createdAt:serverTimestamp()
    })));
  await check('não membro não denuncia grupo de terceiros',()=>
    assertFails(setDoc(doc(stranger,
      'chat_group_reports/group-stranger__'+groupId+'__msg1'),{
      groupId,messageId:'msg1',reporterUid:'group-stranger',
      reason:'Motivo válido',reportedText:'Paz e bem!',
      createdAt:serverTimestamp()
    })));
  await check('não membro não lê mensagens nem as publica',async()=>{
    await assertFails(getDoc(doc(stranger,group+'/messages/msg1')));
    await assertFails(message(stranger,groupId,'group-stranger','msg2','Intrusão'));
  });
  await check('grupo rejeita mensagem com foto disfarçada',()=>
    assertFails(message(b,groupId,'group-b','foto','Foto','image')));
  await check('grupo rejeita campos de anexos',()=>
    assertFails(message(b,groupId,'group-b','file','Arquivo','text',{
      fileUrl:'https://example.invalid/anexo.png'
    })));
  await check('grupo rejeita falsificação de autoria',()=>
    assertFails(message(a,groupId,'group-b','fake','Eu sou outra pessoa')));
  await check('criador não pode ser removido',()=>
    assertFails(updateDoc(doc(b,group),{
      memberUids:arrayRemove('group-a'),
      lastRemovedUid:'group-a',updatedAt:serverTimestamp()
    })));
  await check('não administrador não pode remover colega',()=>
    assertFails(updateDoc(doc(b,group),{
      memberUids:arrayRemove('group-a'),
      lastRemovedUid:'group-a',updatedAt:serverTimestamp()
    })));
  await check('administrador promove participante existente',()=>
    assertSucceeds(updateDoc(doc(a,group),{
      adminUids:arrayUnion('group-b'),
      lastRoleUid:'group-b',updatedAt:serverTimestamp()
    })));
  await check('promovido aparece como administrador sem mudar dono',async()=>{
    const d=(await assertSucceeds(getDoc(doc(b,group)))).data();
    assert.ok(d.adminUids.includes('group-b'));
    assert.equal(d.ownerUid,'group-a');
  });
  await check('promovido não pode retirar dono da administração',()=>
    assertFails(updateDoc(doc(b,group),{
      adminUids:arrayRemove('group-a'),lastRoleUid:'group-a',
      updatedAt:serverTimestamp()
    })));
  await check('criador pode revogar administrador que não é dono',()=>
    assertSucceeds(updateDoc(doc(a,group),{
      adminUids:arrayRemove('group-b'),
      lastRoleUid:'group-b',updatedAt:serverTimestamp()
    })));
  await check('pessoa comum sai do grupo por escolha própria',()=>
    assertSucceeds(updateDoc(doc(b,group),{
      memberUids:arrayRemove('group-b'),
      lastRemovedUid:'group-b',updatedAt:serverTimestamp()
    })));
  await check('quem saiu perde leitura inclusive do histórico',async()=>{
    await assertFails(getDoc(doc(b,group)));
    await assertFails(getDoc(doc(b,group+'/messages/msg1')));
  });
  await check('admin pode reconvidar participante que saiu',()=>
    assertSucceeds(updateDoc(doc(a,group+'/atrioGroupInvites/group-b'),{
      status:'pending',updatedAt:serverTimestamp()
    })));
  await check('reenviando convite ainda exige novo aceite',async()=>{
    await assertFails(getDoc(doc(b,group)));
    await assertSucceeds(accept(b,groupId,'group-b'));
  });
  await check('administrador remove participante não administrador',()=>
    assertSucceeds(updateDoc(doc(a,group),{
      memberUids:arrayRemove('group-b'),
      lastRemovedUid:'group-b',updatedAt:serverTimestamp()
    })));
  await check('usuário removido não envia mais mensagens',()=>
    assertFails(message(b,groupId,'group-b','after-remove','Não deveria chegar')));
  await check('nenhum grupo é criado ignorando a quota do criador',()=>
    assertFails(setDoc(doc(a,'chat_groups/grp-without-quota'),
      baseRoom('grp-without-quota'))));
  const quotaState=(await getDoc(doc(a,quota))).data();
  await check('segundo grupo privado consome quota transacional',async()=>{
    const nextGroup='grp-prayer-02';
    const batch=writeBatch(a);
    batch.set(doc(a,'chat_groups/'+nextGroup),{
      ...baseRoom(nextGroup),name:'Grupo de oração',category:'prayer'
    });
    batch.set(doc(a,quota),{
      count:2,windowStart:quotaState.windowStart,
      lastGroupId:nextGroup,updatedAt:serverTimestamp()
    });
    await assertSucceeds(batch.commit());
  });
  await check('terceiro grupo no mesmo período é negado',async()=>{
    const batch=writeBatch(a);
    batch.set(doc(a,'chat_groups/grp-community-03'),{
      ...baseRoom('grp-community-03'),
      name:'Grupo de comunidade',category:'community'
    });
    batch.set(doc(a,quota),{
      count:3,windowStart:quotaState.windowStart,
      lastGroupId:'grp-community-03',updatedAt:serverTimestamp()
    });
    await assertFails(batch.commit());
  });
  await check('cliente não reinicia a janela de quota arbitrariamente',async()=>{
    const batch=writeBatch(a);
    batch.set(doc(a,'chat_groups/grp-early-reset'),{
      ...baseRoom('grp-early-reset'),name:'Grupo sem limite'
    });
    batch.set(doc(a,quota),{
      count:1,windowStart:serverTimestamp(),
      lastGroupId:'grp-early-reset',updatedAt:serverTimestamp()
    });
    await assertFails(batch.commit());
  });
  await env.withSecurityRulesDisabled(async ctx=>
    updateDoc(doc(ctx.firestore(),group),{
      memberUids:['group-a','f1','f2','f3','f4','f5','f6','f7']
    }));
  await assertSucceeds(updateDoc(doc(a,group+'/atrioGroupInvites/group-b'),{
    status:'pending',updatedAt:serverTimestamp()
  }));
  await check('grupo lotado impede aceite de novo convite',()=>
    assertFails(accept(b,groupId,'group-b')));
  console.log('GROUP SECURITY TESTS:',passed,'OK');
} finally {
  await env.cleanup();
}
