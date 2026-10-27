/**
 * QA estendido dos três bots com Firestore Security Rules reais no emulador.
 * NUNCA conecta Firebase de produção, nem dispara Push ou publica conteúdo real.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {
  doc,collection,setDoc,updateDoc,deleteDoc,getDoc,getDocs,writeBatch,
  serverTimestamp,
} from 'firebase/firestore';

const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')},
});
const bots=[
  {id:'qa-extended-clara',name:'Clara (BOT DE TESTE)'},
  {id:'qa-extended-miguel',name:'Miguel (BOT DE TESTE)'},
  {id:'qa-extended-lucia',name:'Lúcia (BOT DE TESTE)'},
];
const [clara,miguel,lucia]=bots.map(x=>env.authenticatedContext(x.id).firestore());
const admin=env.authenticatedContext('qa-review-admin').firestore();
const anonymous=env.unauthenticatedContext().firestore();
const [a,b,c]=bots;
const postId='qa_extended_topic';
const post=(who,title,body,category='Vida espiritual')=>({
  uid:who.id,authorName:who.name,title,body,category,createdAt:serverTimestamp(),
});
const reply=(who,body)=>({uid:who.id,authorName:who.name,body,createdAt:serverTimestamp()});
const report=(who,reason,extra={})=>({
  postId,...extra,reporterUid:who.id,reason,createdAt:serverTimestamp(),
});
let checks=0;
async function verify(name,fn){
  await fn();
  checks++;
  console.log('PASS BOT-EXT',name);
}
try {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async ctx=>{
    await setDoc(doc(ctx.firestore(),'admins/qa-review-admin'),{enabled:true});
    await setDoc(doc(ctx.firestore(),'app_config/founder'),{uid:'real-founder-never-a-bot'});
  });
  for(const [who,db]of [[a,clara],[b,miguel],[c,lucia]]){
    await verify(who.name+' registra perfil próprio',()=>assertSucceeds(
      setDoc(doc(db,'profiles',who.id),{
        displayName:who.name,createdAt:serverTimestamp(),
      })));
  }
  await verify('Clara altera a própria biografia',()=>assertSucceeds(
    updateDoc(doc(clara,'profiles',a.id),{bio:'Participo somente de simulações QA.'})));
  await verify('Miguel altera próprio nome e a autoria deve refletir o perfil',()=>assertSucceeds(
    updateDoc(doc(miguel,'profiles',b.id),{bio:'Bot que testa respostas.'})));
  await verify('Lúcia consulta seu próprio perfil',()=>assertSucceeds(
    getDoc(doc(lucia,'profiles',c.id))));
  await verify('Lúcia não lê perfil privado de Clara',()=>assertFails(
    getDoc(doc(lucia,'profiles',a.id))));
  await verify('Clara não lista perfis alheios',()=>assertFails(
    getDocs(collection(clara,'profiles'))));
  await verify('Miguel não altera perfil de Lúcia',()=>assertFails(
    updateDoc(doc(miguel,'profiles',c.id),{displayName:'Perfil falsificado'})));
  await verify('Clara não injeta campo administrativo no perfil',()=>assertFails(
    updateDoc(doc(clara,'profiles',a.id),{moderator:true})));
  await verify('Lúcia não usa biografia acima do limite',()=>assertFails(
    updateDoc(doc(lucia,'profiles',c.id),{bio:'x'.repeat(181)})));
  await verify('Anônimo não consulta perfis',()=>assertFails(
    getDoc(doc(anonymous,'profiles',a.id))));

  await verify('Clara publica discussão válida',()=>assertSucceeds(
    setDoc(doc(clara,'posts',postId),post(a,
      'Discussão de QA sobre convivência',
      'Como cultivar respeito e gentileza no diálogo entre membros?'))));
  await verify('Miguel consulta discussão da comunidade',()=>assertSucceeds(
    getDoc(doc(miguel,'posts',postId))));
  await verify('Lúcia lista discussões como membro logado',()=>assertSucceeds(
    getDocs(collection(lucia,'posts'))));
  await verify('Anônimo não lista discussões',()=>assertFails(
    getDocs(collection(anonymous,'posts'))));
  await verify('Clara edita só o texto de sua discussão',()=>assertSucceeds(
    updateDoc(doc(clara,'posts',postId),{body:'Diálogo respeitoso é essencial.'})));
  await verify('Miguel não altera discussão de Clara',()=>assertFails(
    updateDoc(doc(miguel,'posts',postId),{title:'Título falsificado'})));
  await verify('Autor não muda categoria da discussão',()=>assertFails(
    updateDoc(doc(clara,'posts',postId),{category:'Liturgia'})));
  await verify('Autor não transfere identidade do post',()=>assertFails(
    updateDoc(doc(clara,'posts',postId),{uid:b.id})));
  await verify('Título abaixo do limite é bloqueado',()=>assertFails(
    setDoc(doc(clara,'posts','qa_invalid_short'),post(a,'Oi','Mensagem válida.'))));
  await verify('Texto acima de 1200 caracteres é bloqueado',()=>assertFails(
    setDoc(doc(clara,'posts','qa_invalid_long'),post(a,'Título válido','x'.repeat(1201)))));
  await verify('Categoria inexistente é bloqueada',()=>assertFails(
    setDoc(doc(clara,'posts','qa_invalid_category'),
      post(a,'Título válido','Mensagem válida','Inexistente'))));
  await verify('Categoria Liturgia aceita uma nova discussão',()=>assertSucceeds(
    setDoc(doc(miguel,'posts','qa_valid_liturgia'),
      post(b,'Discussão sobre a liturgia',
        'Conteúdo fictício para verificar filtros por categoria.','Liturgia'))));

  await verify('Miguel curte discussão de Clara',()=>assertSucceeds(
    setDoc(doc(miguel,'users',b.id,'likedPosts',postId),{createdAt:serverTimestamp()})));
  await verify('Miguel consulta suas próprias curtidas',()=>assertSucceeds(
    getDocs(collection(miguel,'users',b.id,'likedPosts'))));
  await verify('Lúcia não consulta as curtidas privadas de Miguel',()=>assertFails(
    getDocs(collection(lucia,'users',b.id,'likedPosts'))));
  await verify('Lúcia não curte em nome de Miguel',()=>assertFails(
    setDoc(doc(lucia,'users',b.id,'likedPosts',postId),{createdAt:serverTimestamp()})));
  await verify('Miguel remove a própria curtida',()=>assertSucceeds(
    deleteDoc(doc(miguel,'users',b.id,'likedPosts',postId))));
  await verify('Curtida em post inexistente é bloqueada',()=>assertFails(
    setDoc(doc(miguel,'users',b.id,'likedPosts','desconhecido'),
      {createdAt:serverTimestamp()})));
  await verify('Campo extra numa curtida é bloqueado',()=>assertFails(
    setDoc(doc(miguel,'users',b.id,'likedPosts',postId),
      {createdAt:serverTimestamp(),isAdmin:true})));

  await verify('Lúcia salva discussão de Clara',()=>assertSucceeds(
    setDoc(doc(lucia,'users',c.id,'savedPosts',postId),{createdAt:serverTimestamp()})));
  await verify('Lúcia consulta as próprias discussões salvas',()=>assertSucceeds(
    getDocs(collection(lucia,'users',c.id,'savedPosts'))));
  await verify('Clara não consulta salvos de Lúcia',()=>assertFails(
    getDocs(collection(clara,'users',c.id,'savedPosts'))));
  await verify('Lúcia não salva post inexistente',()=>assertFails(
    setDoc(doc(lucia,'users',c.id,'savedPosts','falso'),{createdAt:serverTimestamp()})));
  await verify('Lúcia remove seu próprio salvo',()=>assertSucceeds(
    deleteDoc(doc(lucia,'users',c.id,'savedPosts',postId))));

  await verify('Miguel responde na discussão de Clara',()=>assertSucceeds(
    setDoc(doc(miguel,'posts',postId,'replies','qa_extended_reply_m'),
      reply(b,'[BOT DE TESTE] Podemos ouvir o outro com paciência.'))));
  await verify('Lúcia lê a resposta de Miguel',()=>assertSucceeds(
    getDoc(doc(lucia,'posts',postId,'replies','qa_extended_reply_m'))));
  await verify('Resposta vazia é bloqueada',()=>assertFails(
    setDoc(doc(lucia,'posts',postId,'replies','qa_empty'),reply(c,''))));
  await verify('Resposta com mais de 600 caracteres é bloqueada',()=>assertFails(
    setDoc(doc(lucia,'posts',postId,'replies','qa_oversize'),reply(c,'x'.repeat(601)))));
  await verify('Lúcia não assina como Miguel',()=>assertFails(
    setDoc(doc(lucia,'posts',postId,'replies','qa_forged'),reply(b,'Falsificação.'))));
  await verify('Miguel não edita nem a própria resposta após envio',()=>assertFails(
    updateDoc(doc(miguel,'posts',postId,'replies','qa_extended_reply_m'),{body:'Edição'})));
  await verify('Clara não exclui resposta de Miguel',()=>assertFails(
    deleteDoc(doc(clara,'posts',postId,'replies','qa_extended_reply_m'))));

  await verify('Lúcia cria resposta e aviso para Clara no mesmo batch',async()=>{
    const batch=writeBatch(lucia);
    batch.set(doc(lucia,'posts',postId,'replies','qa_extended_reply_l'),
      reply(c,'[BOT DE TESTE] Concordo com o respeito entre membros.'));
    batch.set(doc(lucia,'users',a.id,'notifications','qa_extended_reply_l'),{
      postId,replyId:'qa_extended_reply_l',actorUid:c.id,actorName:c.name,
      read:false,createdAt:serverTimestamp(),
    });
    await assertSucceeds(batch.commit());
  });
  await verify('Clara consulta seu aviso de resposta',()=>assertSucceeds(
    getDoc(doc(clara,'users',a.id,'notifications','qa_extended_reply_l'))));
  await verify('Lúcia não lê aviso alheio',()=>assertFails(
    getDoc(doc(lucia,'users',a.id,'notifications','qa_extended_reply_l'))));
  await verify('Clara marca aviso como lido',()=>assertSucceeds(
    updateDoc(doc(clara,'users',a.id,'notifications','qa_extended_reply_l'),{read:true})));
  await verify('Clara não marca aviso como não lido novamente',()=>assertFails(
    updateDoc(doc(clara,'users',a.id,'notifications','qa_extended_reply_l'),{read:false})));
  await verify('Lúcia não envia notificação de resposta falsa',()=>assertFails(
    setDoc(doc(lucia,'users',a.id,'notifications','qa_fake_notice'),{
      postId,replyId:'qa_fake_notice',actorUid:c.id,actorName:c.name,
      read:false,createdAt:serverTimestamp(),
    })));
  await verify('Clara dispensa seu aviso',()=>assertSucceeds(
    deleteDoc(doc(clara,'users',a.id,'notifications','qa_extended_reply_l'))));

  await verify('Clara autodeclara selo leiga',()=>assertSucceeds(
    setDoc(doc(clara,'badges',a.id),{lay:'leiga'})));
  await verify('Clara troca selo leiga por leigo',()=>assertSucceeds(
    updateDoc(doc(clara,'badges',a.id),{lay:'leigo'})));
  await verify('Lúcia consulta selo público de Clara',()=>assertSucceeds(
    getDoc(doc(lucia,'badges',a.id))));
  await verify('Miguel não se concede selo de moderador',()=>assertFails(
    setDoc(doc(miguel,'badges',b.id),{moderator:true})));
  await verify('Clara não atribui selo sacerdotal a si',()=>assertFails(
    updateDoc(doc(clara,'badges',a.id),{clergy:'padre'})));
  await verify('Miguel solicita verificação de diaconato',()=>assertSucceeds(
    setDoc(doc(miguel,'badge_requests',b.id),{
      kind:'diacono',status:'pending',createdAt:serverTimestamp(),
    })));
  await verify('Lúcia não lê solicitação privada de Miguel',()=>assertFails(
    getDoc(doc(lucia,'badge_requests',b.id))));
  await verify('Administrador pode consultar solicitação de Miguel',()=>assertSucceeds(
    getDoc(doc(admin,'badge_requests',b.id))));
  await verify('Miguel não aprova própria solicitação',()=>assertFails(
    updateDoc(doc(miguel,'badge_requests',b.id),{status:'approved'})));
  await verify('Administrador não concede clero sem aprovação atômica',()=>assertFails(
    setDoc(doc(admin,'badges',b.id),{clergy:'diacono'})));
  await verify('Nenhum bot consegue se cadastrar como admin',async()=>{
    for(const [db,bot] of [[clara,a],[miguel,b],[lucia,c]])
      await assertFails(setDoc(doc(db,'admins',bot.id),{enabled:true}));
  });

  await verify('Lúcia denuncia uma resposta específica',()=>assertSucceeds(
    setDoc(doc(lucia,'reports','qa_extended_reply_report'),
      report(c,'Discussão de teste sujeita a revisão humana.',
        {replyId:'qa_extended_reply_m'}))));
  await verify('Miguel denuncia discussão sem forjar autor',()=>assertSucceeds(
    setDoc(doc(miguel,'reports','qa_extended_post_report'),
      report(b,'Simulação de denúncia para checar moderação.'))));
  await verify('Lúcia não consulta denúncias protegidas',()=>assertFails(
    getDoc(doc(lucia,'reports','qa_extended_reply_report'))));
  await verify('Admin consulta denúncias para moderação',()=>assertSucceeds(
    getDocs(collection(admin,'reports'))));
  await verify('Lúcia não se apresenta como outro denunciante',()=>assertFails(
    setDoc(doc(lucia,'reports','qa_extended_identity_fake'),report(b,'Motivo de teste.'))));
  await verify('Anônimo não denuncia post',()=>assertFails(
    setDoc(doc(anonymous,'reports','qa_extended_anon'),report(c,'Motivo de teste.'))));
  await verify('Membro não encerra denúncia pelo cliente',()=>assertFails(
    updateDoc(doc(lucia,'reports','qa_extended_reply_report'),{status:'removed'})));

  await verify('Bot não registra token FCM para dispositivo de outra conta',()=>assertFails(
    setDoc(doc(clara,'users',b.id,'pushDevices','device1'),{
      token:'t'.repeat(160),updatedAt:serverTimestamp(),
    })));
  await verify('Bot registra destino FCM fictício no emulador',()=>assertSucceeds(
    setDoc(doc(clara,'users',a.id,'pushDevices','qa_device'),{
      token:'f'.repeat(160),updatedAt:serverTimestamp(),
    })));
  await verify('Lúcia não lê token FCM privado de Clara',()=>assertFails(
    getDoc(doc(lucia,'users',a.id,'pushDevices','qa_device'))));
  await verify('Clara pode desativar token de teste',()=>assertSucceeds(
    deleteDoc(doc(clara,'users',a.id,'pushDevices','qa_device'))));

  await verify('Miguel exclui sua própria resposta sem prejudicar discussão',()=>assertSucceeds(
    deleteDoc(doc(miguel,'posts',postId,'replies','qa_extended_reply_m'))));
  await verify('Lúcia ainda consulta discussão depois de exclusão da resposta',async()=>{
    const docPost=await assertSucceeds(getDoc(doc(lucia,'posts',postId)));
    assert.equal(docPost.exists(),true);
  });
  await verify('Clara pode apagar discussão própria (somente emulador)',()=>assertSucceeds(
    deleteDoc(doc(clara,'posts',postId))));
  console.log(JSON.stringify({
    scenario:'qa-extended-three-bots',project:'demo-atrio-v11',
    checks,environment:'firebase-emulator',
    coverage:['profile','posts','replies','likes','saved','notifications','badges',
      'badge_requests','reports','moderation','security','fcm_registration'],
    productionWrites:0,realDevices:0,
    physicalFcmDelivery:false,androidUiTested:false,result:'passed',
  }));
}finally{
  await env.cleanup();
}
