/**
 * Três bots de QA. Exclusivos do EMULADOR Firebase: nenhum perfil,
 * conta Auth, publicação ou notificação é criada em produção.
 * Cada contexto usa regras reais do projeto (não mocks de autorização).
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc,collection,setDoc,getDoc,getDocs,updateDoc,deleteDoc,
  writeBatch,serverTimestamp,Timestamp,
} from 'firebase/firestore';
import {classifyGuardiao} from '../../cloudflare/push-worker/src/index.js';

const bots=Object.freeze([
  {uid:'qa-bot-clara',name:'Clara (BOT DE TESTE)',purpose:'discussões'},
  {uid:'qa-bot-miguel',name:'Miguel (BOT DE TESTE)',purpose:'respostas'},
  {uid:'qa-bot-lucia',name:'Lúcia (BOT DE TESTE)',purpose:'denúncias e segurança'},
]);
const reportId=(uid,postId,replyId)=>uid+(replyId===undefined?'_post_'+postId:'_reply_'+postId+'_'+replyId);
const projectId='demo-atrio-v11';
const env=await initializeTestEnvironment({
  projectId,firestore:{host:'127.0.0.1',port:8089,
    rules:readFileSync('firestore.rules','utf8')},
});
const [clara,miguel,lucia]=bots.map(x=>env.authenticatedContext(x.uid).firestore());
const postId='qa_trio_discussao';
const replyA='qa_miguel_responde';
const replyB='qa_lucia_responde';
const publish=(uid,authorName,title,body)=>({
  uid,authorName,title,body,category:'Vida espiritual',
  createdAt:serverTimestamp(),
});
const answer=(uid,authorName,body)=>({
  uid,authorName,body,createdAt:serverTimestamp(),
});
let passed=0;
async function check(description,run) {
  await run();
  passed++;
  console.log('PASS BOT-QA',description);
}
try {
  await env.clearFirestore();
  // O cadastro simula o fluxo do app, com cada usuário autenticado
  // escrevendo seu próprio perfil; NÃO há API de administração aqui.
  for(let i=0;i<bots.length;i++){
    const user=[clara,miguel,lucia][i];
    const bot=bots[i];
    await check(bot.name+' cria seu próprio perfil',()=>assertSucceeds(
      setDoc(doc(user,'profiles',bot.uid),{
        displayName:bot.name,createdAt:serverTimestamp(),
      })));
  }

  await check('Clara publica discussão válida como membro comum',()=>assertSucceeds(
    setDoc(doc(clara,'posts',postId),publish(bots[0].uid,bots[0].name,
      '[SIMULAÇÃO] Encontro de oração',
      'Que tal partilhar sugestões de acolhimento e espiritualidade na nossa comunidade?'))));

  await check('Miguel responde e notifica a autora no mesmo batch',async()=>{
    const batch=writeBatch(miguel);
    batch.set(doc(miguel,'posts',postId,'replies',replyA),
      answer(bots[1].uid,bots[1].name,'[BOT DE TESTE] Podemos organizar uma conversa sobre oração e acolhimento.'));
    batch.set(doc(miguel,'users',bots[0].uid,'notifications',replyA),{
      postId,replyId:replyA,actorUid:bots[1].uid,
      actorName:bots[1].name,read:false,createdAt:serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
  await check('Lúcia responde e notifica a autora no mesmo batch',async()=>{
    const batch=writeBatch(lucia);
    batch.set(doc(lucia,'posts',postId,'replies',replyB),
      answer(bots[2].uid,bots[2].name,
        '[BOT DE TESTE] Concordo: respeito e paciência são fundamentais.'));
    batch.set(doc(lucia,'users',bots[0].uid,'notifications',replyB),{
      postId,replyId:replyB,actorUid:bots[2].uid,
      actorName:bots[2].name,read:false,createdAt:serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
  await check('Clara vê duas notificações internas separadas',async()=>{
    const notices=await assertSucceeds(getDocs(
      collection(clara,'users',bots[0].uid,'notifications')));
    assert.equal(notices.size,2);
    assert.deepEqual(notices.docs.map(x=>x.id).sort(),[replyA,replyB].sort());
  });
  await check('Miguel não consegue ler notificações de Clara',()=>assertFails(
    getDocs(collection(miguel,'users',bots[0].uid,'notifications'))));
  await check('Lúcia não consegue ler notificações de Miguel',()=>assertFails(
    getDocs(collection(lucia,'users',bots[1].uid,'notifications'))));
  await check('Clara pode marcar seu aviso como lido',()=>assertSucceeds(
    updateDoc(doc(clara,'users',bots[0].uid,'notifications',replyA),{read:true})));
  await check('Miguel não altera status de notificação da autora',()=>assertFails(
    updateDoc(doc(miguel,'users',bots[0].uid,'notifications',replyB),{read:true})));

  await check('Miguel não forja uma resposta assinada por Lúcia',()=>assertFails(
    setDoc(doc(miguel,'posts',postId,'replies','tentativa_identidade_falsa'),
      answer(bots[2].uid,bots[2].name,'Tentativa de falsificação de autoria.'))));
  await check('Lúcia não altera resposta de Miguel',()=>assertFails(
    updateDoc(doc(lucia,'posts',postId,'replies',replyA),
      {body:'Mensagem alterada indevidamente.'})));
  await check('Clara não pode excluir resposta de outro membro',()=>assertFails(
    deleteDoc(doc(clara,'posts',postId,'replies',replyB))));
  await check('Miguel não pode modificar discussão de Clara',()=>assertFails(
    updateDoc(doc(miguel,'posts',postId),{body:'Conteúdo indevidamente alterado.'})));

  await check('Lúcia registra uma denúncia normal autenticada',()=>assertSucceeds(
    setDoc(doc(lucia,'reports',reportId(bots[2].uid,postId)),{
      postId,reporterUid:bots[2].uid,
      reason:'Teste de denúncia encaminhada para análise humana',
      createdAt:serverTimestamp(),
    })));
  await check('Lúcia não consegue denunciar duas vezes a mesma discussão',()=>assertFails(
    setDoc(doc(lucia,'reports',reportId(bots[2].uid,postId)),{
      postId,reporterUid:bots[2].uid,
      reason:'Segunda denúncia não deve substituir a primeira',
      createdAt:serverTimestamp(),
    })));
  await check('Lúcia não usa identificador aleatório para denunciar novamente',()=>assertFails(
    setDoc(doc(lucia,'reports','qa_random_legacy'),{
      postId,reporterUid:bots[2].uid,reason:'Tentativa com identificador antigo',
      createdAt:serverTimestamp(),
    })));
  await check('Lúcia não lê a denúncia privada após enviar',()=>assertFails(
    getDoc(doc(lucia,'reports',reportId(bots[2].uid,postId)))));
  await check('Miguel não forja denúncia em nome de outra conta',()=>assertFails(
    setDoc(doc(miguel,'reports',reportId(bots[1].uid,postId)),{
      postId,reporterUid:bots[0].uid,reason:'Motivo fictício',
      createdAt:serverTimestamp(),
    })));
  await check('Bots não obtêm privilégios administrativos',async()=>{
    for(const [user,bot] of [[clara,bots[0]],[miguel,bots[1]],[lucia,bots[2]]]){
      await assertFails(setDoc(doc(user,'admins',bot.uid),{enabled:true}));
      await assertFails(setDoc(doc(user,'badges',bot.uid),{moderator:true}));
      await assertFails(getDocs(collection(user,'reports')));
    }
  });

  await check('Guardião reconhece CPF de teste e não classifica oração comum',async()=>{
    assert.equal(classifyGuardiao('Confira o CPF fictício 123.456.789-00')?.code,'privacy');
    assert.equal(classifyGuardiao('Vamos rezar pela paz e acolher nossos irmãos.'),null);
  });

  await check('Resultado não apaga conteúdo, respostas nem denúncia',async()=>{
    assert.ok((await getDoc(doc(miguel,'posts',postId))).exists());
    assert.ok((await getDoc(doc(lucia,'posts',postId,'replies',replyA))).exists());
    assert.ok((await getDoc(doc(clara,'posts',postId,'replies',replyB))).exists());
    const notice=await getDoc(doc(clara,'users',bots[0].uid,'notifications',replyB));
    assert.equal(notice.data()?.actorUid,bots[2].uid);
    // O backend de Guardião cria relatórios administrativos, mas não
    // remove conteúdo automaticamente com GUARDIAO_AUTOHIDE_ENABLED=false.
  });

  console.log(JSON.stringify({
    scenario:'qa-three-bots-firestore-emulator',project:projectId,
    simulatedAccounts:bots.map(x=>({uid:x.uid,purpose:x.purpose})),
    checks:passed,environment:'emulator-only',realAccountsCreated:0,
    productionWrites:0,physicalFCMDeliveryTested:false,result:'passed',
  }));
} finally {
  await env.cleanup();
}
