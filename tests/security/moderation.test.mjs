import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp,query,where} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const admin=env.authenticatedContext('admin').firestore();
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const anon=env.unauthenticatedContext().firestore();
const review=(status='dismissed',by='admin')=>({status,reviewedBy:by,reviewedAt:serverTimestamp(),reviewNote:'Análise de teste'});
const reportId=(uid,postId,replyId)=>uid+(replyId===undefined?'_post_'+postId:'_reply_'+postId+'_'+replyId);
const rpost=(uid,postId)=>'reports/'+reportId(uid,postId);
const rreply=(uid,postId,replyId)=>'reports/'+reportId(uid,postId,replyId);
const report=(id='p')=>({postId:id,reporterUid:'bob',reason:'Motivo para revisão',createdAt:serverTimestamp()});
try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'admins/admin'),{enabled:true});
  await setDoc(doc(db,'profiles/alice'),{displayName:'Alice',createdAt:Timestamp.now()});
  await setDoc(doc(db,'profiles/bob'),{displayName:'Bob',createdAt:Timestamp.now()});
  for(const id of ['p','p2','p3','p5'])await setDoc(doc(db,'posts/'+id),{uid:'alice',authorName:'Alice',title:'Título teste',body:'Conteúdo de teste',category:'Liturgia',createdAt:Timestamp.now()});
 });
 await env.withSecurityRulesDisabled(async c=>{
  await setDoc(doc(c.firestore(),'app_config/opening_video'),{enabled:true,videoId:'abertura_v1'});
  await setDoc(doc(c.firestore(),'app_config/private'),{secret:'test'});
 });
 await test('abertura permite leitura antes do login',async()=>{
  const d=await assertSucceeds(getDoc(doc(anon,'app_config/opening_video')));assert.equal(d.data().enabled,true);
 });
 await test('usuário autenticado consulta abertura',()=>assertSucceeds(getDoc(doc(bob,'app_config/opening_video'))));
 await test('configuração não permite listar coleção',()=>assertFails(getDocs(collection(anon,'app_config'))));
 await test('outros documentos de configuração não são públicos',()=>assertFails(getDoc(doc(anon,'app_config/private'))));
 await test('anônimo não altera abertura',()=>assertFails(updateDoc(doc(anon,'app_config/opening_video'),{enabled:false})));
 await test('usuário não altera abertura',()=>assertFails(updateDoc(doc(bob,'app_config/opening_video'),{enabled:false})));
 await test('admin do app não altera abertura pelo cliente',()=>assertFails(updateDoc(doc(admin,'app_config/opening_video'),{enabled:false})));
 await test('cliente não apaga configuração',()=>assertFails(deleteDoc(doc(admin,'app_config/opening_video'))));
 await env.withSecurityRulesDisabled(async c=>deleteDoc(doc(c.firestore(),'app_config/opening_video')));
 await test('cliente não cria configuração',()=>assertFails(setDoc(doc(bob,'app_config/opening_video'),{enabled:true})));
 await test('documento ausente pode ser consultado',async()=>{
  const d=await assertSucceeds(getDoc(doc(anon,'app_config/opening_video')));assert.equal(d.exists(),false);
 });
 await env.withSecurityRulesDisabled(async c=>setDoc(doc(c.firestore(),'app_config/opening_video'),{enabled:false}));
 await test('desativação administrativa pode ser lida',async()=>{
  const d=await assertSucceeds(getDoc(doc(anon,'app_config/opening_video')));assert.equal(d.data().enabled,false);
 });
 await test('anônimo não lê denúncias',()=>assertFails(getDocs(collection(anon,'reports'))));
 await test('usuário denuncia usando ID estável da PR #35',()=>assertSucceeds(setDoc(doc(bob,rpost('bob','p')),report())));
 await test('denúncia duplicada na mesma discussão não sobrescreve a original',()=>assertFails(
   setDoc(doc(bob,rpost('bob','p')),report())));
 await test('ID aleatório de APK antigo não pode criar denúncia',()=>assertFails(
   setDoc(doc(bob,'reports/random-legacy'),report('p2'))));
 await test('outro usuário pode denunciar a mesma discussão',()=>assertSucceeds(
   setDoc(doc(alice,rpost('alice','p')),{...report('p'),reporterUid:'alice'})));
 await test('ID com UID de outra conta é rejeitado',()=>assertFails(
   setDoc(doc(bob,rpost('alice','p2')),report('p2'))));
 await test('usuário não lê a própria denúncia',()=>assertFails(getDoc(doc(bob,rpost('bob','p')))));
 await test('usuário não lista denúncias',()=>assertFails(getDocs(collection(bob,'reports'))));
 await test('usuário consulta somente seu registro de acesso',()=>assertSucceeds(getDoc(doc(bob,'admins/bob'))));
 await test('usuário não lê acesso de outra conta',()=>assertFails(getDoc(doc(bob,'admins/admin'))));
 // Selos — leitura individual; ninguém recebe privilégios por atualizar o cliente.
 await test('selos públicos exigem login',()=>assertFails(getDoc(doc(anon,'badges/alice'))));
 await test('selos não podem ser enumerados',()=>assertFails(getDocs(collection(bob,'badges'))));
 await test('usuário cria apenas sua autodeclaração leiga',()=>assertSucceeds(
   setDoc(doc(bob,'badges/bob'),{lay:'leigo'})));
 await test('usuário atualiza Leigo para Leiga',()=>assertSucceeds(
   updateDoc(doc(bob,'badges/bob'),{lay:'leiga'})));
 await test('usuário pode limpar sua autodeclaração',()=>assertSucceeds(
   updateDoc(doc(bob,'badges/bob'),{lay:''})));
 await test('usuário não concede Padre a si próprio',()=>assertFails(
   updateDoc(doc(bob,'badges/bob'),{clergy:'padre'})));
 await test('usuário não concede Moderador a si próprio',()=>assertFails(
   updateDoc(doc(bob,'badges/bob'),{moderator:true})));
 await test('usuário não altera selo alheio',()=>assertFails(
   setDoc(doc(bob,'badges/alice'),{lay:'leigo'})));
 await test('usuário não cria perfil com selo privilegiado',()=>assertFails(
   setDoc(doc(bob,'badges/bob'),{lay:'leigo',clergy:'padre'}, {merge:true})));
 await test('usuário não apaga registro de selos',()=>assertFails(
   deleteDoc(doc(bob,'badges/bob'))));
 await test('admin no aplicativo não concede selo via SDK cliente',()=>assertFails(
   setDoc(doc(admin,'badges/alice'),{moderator:true})));
 await env.withSecurityRulesDisabled(async c=>{
   await setDoc(doc(c.firestore(),'badges/alice'),{clergy:'padre',moderator:true});
   await setDoc(doc(c.firestore(),'app_config/founder'),{uid:'founder'});
 });
 await test('selo de Padre confirmado é legível por membro autenticado',async()=>{
   const data=(await assertSucceeds(getDoc(doc(bob,'badges/alice')))).data();
   assert.equal(data.clergy,'padre');assert.equal(data.moderator,true);
 });
 await test('selo verificado de Padre não pode ser mudado pelo titular',()=>assertFails(
   updateDoc(doc(alice,'badges/alice'),{clergy:'diacono'})));
 await test('preferência leiga não remove selo verificado',async()=>{
   await assertSucceeds(updateDoc(doc(alice,'badges/alice'),{lay:'leiga'}));
   assert.equal((await getDoc(doc(alice,'badges/alice'))).data().clergy,'padre');
 });
 await test('configuração oficial do fundador exige login',()=>assertFails(
   getDoc(doc(anon,'app_config/founder'))));
 await test('conta autenticada consulta identidade do fundador',()=>assertSucceeds(
   getDoc(doc(bob,'app_config/founder'))));
 await test('ninguém se torna fundador escrevendo no cliente',()=>assertFails(
   setDoc(doc(bob,'app_config/founder'),{uid:'bob'})));
 await test('solicitações de selo não podem ser enumeradas',()=>assertFails(
   getDocs(collection(bob,'badge_requests'))));
 await test('titular solicita verificação sacerdotal',()=>assertSucceeds(
   setDoc(doc(bob,'badge_requests/bob'),{
     kind:'padre',status:'pending',createdAt:serverTimestamp()
   })));
 await test('solicitação não é pública',()=>assertFails(
   getDoc(doc(alice,'badge_requests/bob'))));
 await test('usuário não solicita selo na conta alheia',()=>assertFails(
   setDoc(doc(bob,'badge_requests/alice'),{
     kind:'padre',status:'pending',createdAt:serverTimestamp()
   })));
 await test('usuário não solicita selo de moderador',()=>assertFails(
   setDoc(doc(alice,'badge_requests/alice'),{
     kind:'moderador',status:'pending',createdAt:serverTimestamp()
   })));
 await test('usuário não aprova seu próprio pedido',()=>assertFails(
   updateDoc(doc(bob,'badge_requests/bob'),{status:'approved'})));
 await test('administrador no cliente não aprova pedido diretamente',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/bob'),{status:'approved'})));
 await test('pedido pendente não pode ser reescrito',()=>assertFails(
   updateDoc(doc(bob,'badge_requests/bob'),{kind:'diacono'})));
 await test('usuário não remove o pedido para ocultar auditoria',()=>assertFails(
   deleteDoc(doc(bob,'badge_requests/bob'))));
 await env.withSecurityRulesDisabled(async c=>{
   await updateDoc(doc(c.firestore(),'badge_requests/bob'),{status:'rejected'});
 });
 await test('titular pode reapresentar pedido recusado',()=>assertSucceeds(
   updateDoc(doc(bob,'badge_requests/bob'),{
     kind:'diacono',status:'pending',createdAt:serverTimestamp()
   })));
 await test('pedido reapresentado não pode ser autoaprovado',()=>assertFails(
   updateDoc(doc(bob,'badge_requests/bob'),{status:'approved'})));
 // Aprovação de clero: só administrador ativo, por batch atômico.
 await test('anônimo não lista solicitações de selo',()=>assertFails(
   getDocs(collection(anon,'badge_requests'))));
 await test('administrador vê somente pedidos de verificação na fila',async()=>{
   const snap=await assertSucceeds(getDocs(query(collection(admin,'badge_requests'),where('status','==','pending'))));
   assert.ok(snap.docs.some(d=>d.id==='bob'));
 });
 await test('terceiros não leem pedido alheio após reapresentação',()=>assertFails(
   getDoc(doc(alice,'badge_requests/bob'))));
 await test('administrador não concede clero fora de uma aprovação atômica',()=>assertFails(
   updateDoc(doc(admin,'badges/bob'),{clergy:'diacono'})));
 await test('administrador não aprova sem gravar o selo na mesma operação',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/bob'),{
     status:'approved',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Identidade verificada externamente.'
   })));
 await test('administrador não concede clero incorreto',async()=>{
   const batch=writeBatch(admin);
   batch.set(doc(admin,'badges/bob'),{clergy:'padre'},{merge:true});
   batch.update(doc(admin,'badge_requests/bob'),{
     status:'approved',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Verificação efetuada por contato pastoral.'
   });
   await assertFails(batch.commit());
 });
 await test('não se aprova indicando outro revisor',async()=>{
   const batch=writeBatch(admin);
   batch.set(doc(admin,'badges/bob'),{clergy:'diacono'},{merge:true});
   batch.update(doc(admin,'badge_requests/bob'),{
     status:'approved',reviewedBy:'bob',reviewedAt:serverTimestamp(),reviewNote:'Identidade verificada externamente.'
   });
   await assertFails(batch.commit());
 });
 await test('solicitante não consegue aprovar com lote falso',async()=>{
   const batch=writeBatch(bob);
   batch.set(doc(bob,'badges/bob'),{clergy:'diacono'},{merge:true});
   batch.update(doc(bob,'badge_requests/bob'),{
     status:'approved',reviewedBy:'bob',reviewedAt:serverTimestamp(),reviewNote:'Declaração do próprio solicitante.'
   });
   await assertFails(batch.commit());
 });
 await setDoc(doc(admin,'badge_requests/admin'),{
   kind:'padre',status:'pending',createdAt:serverTimestamp()
 });
 await test('administrador não aprova o próprio pedido de selo',async()=>{
   const batch=writeBatch(admin);
   batch.set(doc(admin,'badges/admin'),{clergy:'padre'});
   batch.update(doc(admin,'badge_requests/admin'),{
     status:'approved',reviewedBy:'admin',reviewedAt:serverTimestamp(),
     reviewNote:'Mesmo administrador não pode validar o próprio pedido.'
   });
   await assertFails(batch.commit());
 });
 await test('administrador não rejeita o próprio pedido',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/admin'),{
     status:'rejected',reviewedBy:'admin',reviewedAt:serverTimestamp(),
     reviewNote:'Mesmo administrador não pode julgar o próprio pedido.'
   })));
 await test('administrador aprova e concede Diácono atomicamente',async()=>{
   const batch=writeBatch(admin);
   batch.set(doc(admin,'badges/bob'),{clergy:'diacono'},{merge:true});
   batch.update(doc(admin,'badge_requests/bob'),{
     status:'approved',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Identidade conferida com a paróquia.'
   });
   await assertSucceeds(batch.commit());
   const result=(await getDoc(doc(bob,'badges/bob'))).data();
   assert.equal(result.clergy,'diacono');assert.equal(result.lay,'');
   assert.equal((await getDoc(doc(bob,'badge_requests/bob'))).data().status,'approved');
 });
 await test('decisão aprovada não pode ser sobrescrita',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/bob'),{status:'rejected',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Outra decisão posterior.'})));
 await test('solicitante não remove clero concedido',()=>assertFails(
   updateDoc(doc(bob,'badges/bob'),{clergy:''})));
 await test('admin não lista todos os selos de membros',()=>assertFails(
   getDocs(collection(admin,'badges'))));
 const carol=env.authenticatedContext('carol').firestore();
 await setDoc(doc(carol,'badge_requests/carol'),{kind:'padre',status:'pending',createdAt:serverTimestamp()});
 await test('rejeição exige justificativa suficiente',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/carol'),{
     status:'rejected',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Não'
   })));
 await test('administrador rejeita sem atribuir selo',async()=>{
   await assertSucceeds(updateDoc(doc(admin,'badge_requests/carol'),{
     status:'rejected',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Verificação pastoral não confirmada.'
   }));
   assert.equal((await getDoc(doc(carol,'badge_requests/carol'))).data().status,'rejected');
   assert.equal((await getDoc(doc(carol,'badges/carol'))).exists(),false);
 });
 await test('pedido rejeitado pode ser reapresentado pelo solicitante',()=>assertSucceeds(
   updateDoc(doc(carol,'badge_requests/carol'),{kind:'diacono',status:'pending',createdAt:serverTimestamp()})));
 await test('solicitante não apaga trilha da revisão administrativa',()=>assertFails(
   deleteDoc(doc(carol,'badge_requests/carol'))));
 // FCM: tokens privados apenas para o titular, sem operacoes entre contas.
 await test('token FCM requer autenticacao',()=>assertFails(
   getDoc(doc(anon,'users/bob/pushDevices/android-1'))));
 await test('usuário registra apenas seu próprio destino FCM',()=>assertSucceeds(
   setDoc(doc(bob,'users/bob/pushDevices/android-1'),{
     token:'fcm_demo_token_for_test_123456789',updatedAt:serverTimestamp()
   })));
 await test('usuário pode consultar seu destino FCM',()=>assertSucceeds(
   getDoc(doc(bob,'users/bob/pushDevices/android-1'))));
 await test('usuário pode listar seus próprios dispositivos FCM',()=>assertSucceeds(
   getDocs(collection(bob,'users/bob/pushDevices'))));
 await test('token FCM de outra conta é privado',()=>assertFails(
   getDoc(doc(alice,'users/bob/pushDevices/android-1'))));
 await test('ninguém lista tokens de outros usuários',()=>assertFails(
   getDocs(collection(alice,'users/bob/pushDevices'))));
 await test('nem admin lista token de usuário comum',()=>assertFails(
   getDocs(collection(admin,'users/bob/pushDevices'))));
 await test('usuário não registra token em conta alheia',()=>assertFails(
   setDoc(doc(alice,'users/bob/pushDevices/estranho'),{
     token:'fcm_demo_token_for_test_123456789',updatedAt:serverTimestamp()
   })));
 await test('registro FCM não aceita flags administrativas',()=>assertFails(
   setDoc(doc(bob,'users/bob/pushDevices/android-2'),{
     token:'fcm_demo_token_for_test_123456789',updatedAt:serverTimestamp(),admin:true
   })));
 await test('registro FCM recusa token curto',()=>assertFails(
   setDoc(doc(bob,'users/bob/pushDevices/android-2'),{
     token:'fraco',updatedAt:serverTimestamp()
   })));
 await test('registro FCM recusa data forjada',()=>assertFails(
   setDoc(doc(bob,'users/bob/pushDevices/android-2'),{
     token:'fcm_demo_token_for_test_123456789',updatedAt:Timestamp.now()
   })));
 await test('usuário renova token de seu dispositivo',()=>assertSucceeds(
   updateDoc(doc(bob,'users/bob/pushDevices/android-1'),{
     token:'fcm_demo_token_after_refresh_123456789',updatedAt:serverTimestamp()
   })));
 await test('usuário pode desativar seu destino FCM',()=>assertSucceeds(
   deleteDoc(doc(bob,'users/bob/pushDevices/android-1'))));
 await test('outro usuário não pode excluir token FCM',async()=>{
   await assertSucceeds(setDoc(doc(bob,'users/bob/pushDevices/android-1'),{
     token:'fcm_demo_token_for_test_123456789',updatedAt:serverTimestamp()
   }));
   await assertFails(deleteDoc(doc(alice,'users/bob/pushDevices/android-1')));
 });
 await test('usuário não se promove',()=>assertFails(setDoc(doc(bob,'admins/bob'),{enabled:true})));
 await test('administrador não promove contas pelo cliente',()=>assertFails(setDoc(doc(admin,'admins/bob'),{enabled:true})));
 await test('administrador não altera seu acesso pelo cliente',()=>assertFails(updateDoc(doc(admin,'admins/admin'),{enabled:false})));
 await test('administrador consulta denúncias',()=>assertSucceeds(getDocs(collection(admin,'reports'))));
 await test('usuário não exclui publicação alheia',()=>assertFails(deleteDoc(doc(bob,'posts/p'))));
 await test('usuário não encerra denúncia',()=>assertFails(updateDoc(doc(bob,rpost('bob','p')),review('dismissed','bob'))));
 await test('autor mantém edição própria com relógio do servidor',()=>assertSucceeds(
   updateDoc(doc(alice,'posts/p'),{body:'Conteúdo revisado pelo autor',updatedAt:serverTimestamp()})));
 await test('edição sem updatedAt é bloqueada mesmo em contas de teste',()=>assertFails(
   updateDoc(doc(alice,'posts/p'),{body:'Edição sem rastreamento'})));
 await test('APK novo atualiza o relógio do servidor novamente',()=>assertSucceeds(
   updateDoc(doc(alice,'posts/p'),{body:'Edição do APK novo',updatedAt:serverTimestamp()})));
 await test('autor não pode falsificar horário de edição',()=>assertFails(
   updateDoc(doc(alice,'posts/p'),{body:'Data forjada',updatedAt:Timestamp.fromMillis(Date.now()-3600000)})));
 await test('autor não pode voltar o relógio de uma edição já registrada',()=>assertFails(
   updateDoc(doc(alice,'posts/p'),{updatedAt:Timestamp.fromMillis(Date.now()-86400000)})));
 await test('administrador não reescreve texto alheio',()=>assertFails(updateDoc(doc(admin,'posts/p'),{body:'Texto de outra pessoa'})));
 await test('denunciante não insere decisão pronta',()=>assertFails(setDoc(doc(bob,rpost('bob','p5')),{...report('p5'),...review()})));
 await test('administrador não forja identidade do revisor',()=>assertFails(updateDoc(doc(admin,rpost('bob','p')),review('dismissed','bob'))));
 await test('administrador não altera motivo da denúncia',()=>assertFails(updateDoc(doc(admin,rpost('bob','p')),{...review(),reason:'Outro motivo'})));
 await test('decisão exige justificativa válida',()=>assertFails(updateDoc(doc(admin,rpost('bob','p')),{...review(),reviewNote:'x'})));
 await test('remoção exige que publicação deixe de existir',()=>assertFails(updateDoc(doc(admin,rpost('bob','p')),review('removed'))));
 await test('remoção e decisão atômicas autorizadas',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p'));b.update(doc(admin,rpost('bob','p')),review('removed'));await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(admin,'posts/p'))).exists(),false);
  assert.equal((await getDoc(doc(admin,rpost('bob','p')))).data().status,'removed');
 });
 await test('decisão concluída é imutável',()=>assertFails(updateDoc(doc(admin,rpost('bob','p')),review())));
 await test('registro de denúncia não pode ser apagado',()=>assertFails(deleteDoc(doc(admin,rpost('bob','p')))));
 await setDoc(doc(bob,rpost('bob','p2')),report('p2'));
 await test('encerrar sem remoção mantém publicação',async()=>{
  await assertSucceeds(updateDoc(doc(admin,rpost('bob','p2')),review()));assert.equal((await getDoc(doc(alice,'posts/p2'))).exists(),true);
 });
 await test('resposta e aviso da v07 continuam funcionando',async()=>{
  const b=writeBatch(bob);b.set(doc(bob,'posts/p2/replies/answer'),{uid:'bob',authorName:'Bob',body:'Resposta de teste',createdAt:serverTimestamp()});
  b.set(doc(bob,'users/alice/notifications/answer'),{postId:'p2',replyId:'answer',actorUid:'bob',actorName:'Bob',read:false,createdAt:serverTimestamp()});await assertSucceeds(b.commit());
 });
 // Notification center: reads/deletes never cross account boundaries.
 await test('destinatário consulta seus avisos',()=>assertSucceeds(getDocs(collection(alice,'users/alice/notifications'))));
 await test('remetente não consulta avisos do destinatário',()=>assertFails(getDocs(collection(bob,'users/alice/notifications'))));
 await test('administrador não consulta avisos pessoais alheios',()=>assertFails(getDocs(collection(admin,'users/alice/notifications'))));
 await test('remetente não marca aviso alheio como lido',()=>assertFails(updateDoc(doc(bob,'users/alice/notifications/answer'),{read:true})));
 await test('destinatário marca lote de avisos como lido',async()=>{
  const b=writeBatch(alice);b.update(doc(alice,'users/alice/notifications/answer'),{read:true});await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(alice,'users/alice/notifications/answer'))).data().read,true);
 });
 await test('leitura não permite modificar autoria do aviso',()=>assertFails(updateDoc(doc(alice,'users/alice/notifications/answer'),{actorName:'Falso'})));
 await test('terceiro não dispensa aviso alheio',()=>assertFails(deleteDoc(doc(bob,'users/alice/notifications/answer'))));
 await test('dispensar aviso mantém a resposta',async()=>{
  await assertSucceeds(deleteDoc(doc(alice,'users/alice/notifications/answer')));
  assert.equal((await getDoc(doc(alice,'posts/p2/replies/answer'))).exists(),true);
 });
 await test('administrador não lê biografia privada alheia',()=>assertFails(getDoc(doc(admin,'profiles/alice'))));
 await test('autor ainda exclui sua publicação',()=>assertSucceeds(deleteDoc(doc(alice,'posts/p3'))));

 const replyReport=(id='a',parent='p2')=>({...report(parent),replyId:id});
 const replyReview=(status='dismissed')=>({...review(status),reviewTarget:'reply'});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  for(const id of ['a','b','c','d','e']) await setDoc(doc(db,'posts/p2/replies/'+id),{uid:'bob',authorName:'Bob',body:'Resposta '+id,createdAt:Timestamp.now()});
  await setDoc(doc(db,'posts/missing/replies/orphan'),{uid:'bob',authorName:'Bob',body:'Órfã de teste',createdAt:Timestamp.now()});
 });
 await test('usuário denuncia resposta existente',()=>assertSucceeds(setDoc(doc(bob,rreply('bob','p2','a')),replyReport())));
 await test('denúncia repetida da mesma resposta é bloqueada',()=>assertFails(
   setDoc(doc(bob,rreply('bob','p2','a')),replyReport())));
 await test('denúncia de resposta é privada',()=>assertFails(getDoc(doc(bob,rreply('bob','p2','a')))));
 await test('anônimo não denuncia respostas',()=>assertFails(setDoc(doc(anon,'reports/anon'),replyReport())));
 await test('resposta inexistente não pode ser denunciada',()=>assertFails(setDoc(doc(bob,rreply('bob','p2','missing')),replyReport('missing'))));
 await test('resposta de outra discussão não valida alvo',()=>assertFails(setDoc(doc(bob,rreply('bob','p3','a')),replyReport('a','p3'))));
 await test('nova denúncia exige discussão existente',()=>assertFails(setDoc(doc(bob,rreply('bob','missing','orphan')),replyReport('orphan','missing'))));
 for(const bad of ['',null,42,'nested/id']) {
  await test('replyId inválido recusado: '+JSON.stringify(bad),()=>assertFails(setDoc(doc(bob,'reports/bad'),{...report('p2'),replyId:bad})));
 }
 await test('postId com caminho aninhado recusado',()=>assertFails(setDoc(doc(bob,'reports/badparent'),replyReport('a','p2/replies/a'))));
 await test('identidade do denunciante não pode ser forjada',()=>assertFails(setDoc(doc(bob,rreply('bob','p2','b')),{...replyReport('b'),reporterUid:'alice'})));
 await test('decisão não pode ser inserida na criação',()=>assertFails(setDoc(doc(bob,rreply('bob','p2','c')),{...replyReport('c'),...replyReview()})));
 await test('autor da discussão não exclui resposta alheia',()=>assertFails(deleteDoc(doc(alice,'posts/p2/replies/b'))));
 await test('autor da resposta mantém exclusão própria',()=>assertSucceeds(deleteDoc(doc(bob,'posts/p2/replies/c'))));
 await test('administrador consulta resposta para análise',()=>assertSucceeds(getDoc(doc(admin,'posts/p2/replies/a'))));
 await test('administrador não edita resposta',()=>assertFails(updateDoc(doc(admin,'posts/p2/replies/a'),{body:'Alterada'})));
 await test('cliente antigo não encerra denúncia de resposta como publicação',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','a')),review())));
 await test('tipo de alvo incorreto não encerra denúncia',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','a')),{...review(),reviewTarget:'post'})));
 await test('alvo da resposta é imutável',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','a')),{...replyReview(),replyId:'b'})));
 await test('usuário não modera resposta',()=>assertFails(updateDoc(doc(bob,rreply('bob','p2','a')),{...replyReview(),reviewedBy:'bob'})));
 await test('resposta não pode ser marcada removida sem exclusão',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','a')),replyReview('removed'))));
 await test('cliente antigo não apaga discussão pela denúncia de resposta',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2'));b.update(doc(admin,rreply('bob','p2','a')),review('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2'))).exists(),true);
 });
 await test('remover resposta errada não resolve denúncia',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2/replies/b'));b.update(doc(admin,rreply('bob','p2','a')),replyReview('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
 });
 await test('remoção da resposta preserva a discussão na mesma operação',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2'));b.delete(doc(admin,'posts/p2/replies/a'));b.update(doc(admin,rreply('bob','p2','a')),replyReview('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2/replies/a'))).exists(),true);
 });
 await test('remoção correta exclui só a resposta e registra decisão',async()=>{
  const original=(await getDoc(doc(admin,'posts/p2'))).data();
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2/replies/a'));b.update(doc(admin,rreply('bob','p2','a')),replyReview('removed'));
  await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(admin,'posts/p2/replies/a'))).exists(),false);
  assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
  assert.deepEqual((await getDoc(doc(admin,'posts/p2'))).data(),original);
  const decision=(await getDoc(doc(admin,rreply('bob','p2','a')))).data();assert.equal(decision.status,'removed');assert.equal(decision.reviewTarget,'reply');
 });
 await test('decisão de resposta concluída é imutável',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','a')),replyReview())));
 await setDoc(doc(bob,rreply('bob','p2','b')),replyReport('b'));
 await test('encerrar denúncia mantém resposta',async()=>{
  await assertSucceeds(updateDoc(doc(admin,rreply('bob','p2','b')),replyReview()));assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
 });
 await setDoc(doc(bob,rreply('bob','p2','d')),replyReport('d'));
 await deleteDoc(doc(bob,'posts/p2/replies/d'));
 await test('resposta já removida não registra nova remoção',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','d')),replyReview('removed'))));
 await test('denúncia de resposta já removida pode ser encerrada',()=>assertSucceeds(updateDoc(doc(admin,rreply('bob','p2','d')),replyReview())));
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'posts/p4'),{uid:'alice',authorName:'Alice',title:'Órfã futura',body:'Publicação de teste',category:'Liturgia',createdAt:Timestamp.now()});
  await setDoc(doc(db,'posts/p4/replies/a'),{uid:'bob',authorName:'Bob',body:'Resposta de teste',createdAt:Timestamp.now()});
 });
 await setDoc(doc(bob,rreply('bob','p4','a')),replyReport('a','p4'));
 await deleteDoc(doc(alice,'posts/p4'));
 await test('denúncia existente permite remover resposta de discussão já excluída',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p4/replies/a'));b.update(doc(admin,rreply('bob','p4','a')),replyReview('removed'));await assertSucceeds(b.commit());
 });
 await setDoc(doc(bob,rreply('bob','p2','e')),replyReport('e'));

 // Guardião etapa 3: quarentena privada e direito de contestação do autor.
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'guardiao_quarantine/guard_case1'),{
   ownerUid:'alice',postId:'p2',targetType:'post',status:'held',
   body:'Conteúdo arquivado para revisão',ruleCode:'threat',
   heldAt:Timestamp.now(),
  });
 });
 await test('autor consulta sua quarentena',()=>assertSucceeds(
  getDoc(doc(alice,'guardiao_quarantine/guard_case1'))));
 await test('terceiro não lê quarentena do autor',()=>assertFails(
  getDoc(doc(bob,'guardiao_quarantine/guard_case1'))));
 await test('terceiro não enumera quarentenas',()=>assertFails(
  getDocs(collection(bob,'guardiao_quarantine'))));
 await test('administrador consulta caso para revisão',()=>assertSucceeds(
  getDoc(doc(admin,'guardiao_quarantine/guard_case1'))));
 await test('membro não fabrica registro de quarentena',()=>assertFails(
  setDoc(doc(bob,'guardiao_quarantine/forged'),{ownerUid:'alice',status:'held',postId:'p2'})));
 await test('administrador não cria quarentena no SDK',()=>assertFails(
  setDoc(doc(admin,'guardiao_quarantine/guard_manual'),{ownerUid:'bob',status:'held',postId:'p2'})));
 await test('autor contesta conteúdo retido uma vez',()=>assertSucceeds(
  updateDoc(doc(alice,'guardiao_quarantine/guard_case1'),{
   appealText:'A suposta ameaça era uma citação jornalística.',appealedAt:serverTimestamp(),
  })));
 await test('terceiro não contesta pelo autor',()=>assertFails(
  updateDoc(doc(bob,'guardiao_quarantine/guard_case1'),{
   appealText:'Devolva a publicação, por favor.',appealedAt:serverTimestamp(),
  })));
 await test('recurso não pode ser reescrito',()=>assertFails(
  updateDoc(doc(alice,'guardiao_quarantine/guard_case1'),{
   appealText:'Quero alterar minha primeira contestação.',appealedAt:serverTimestamp(),
  })));
 await test('autor não remove arquivo de moderação',()=>assertFails(
  deleteDoc(doc(alice,'guardiao_quarantine/guard_case1'))));
 await test('administrador não restaura caso por SDK cliente',()=>assertFails(
  updateDoc(doc(admin,'guardiao_quarantine/guard_case1'),{status:'restored'})));
 await env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),'reports/guard_case1'),{
   postId:'p2',reporterUid:'atrio_guardiao',status:'pending',source:'guardiao',
   reason:'Ameaça explícita a revisar',createdAt:Timestamp.now(),
  });
 });
 await test('APK antigo não encerra denúncia com quarentena ainda ativa',()=>assertFails(
  updateDoc(doc(admin,'reports/guard_case1'),review())));
 await test('APK antigo não confirma remoção de caso retido',()=>assertFails(
  updateDoc(doc(admin,'reports/guard_case1'),review('removed'))));
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'admins/admin'),{enabled:false}));
 await test('revogação impede ver a fila de solicitações',()=>assertFails(
   getDocs(query(collection(admin,'badge_requests'),where('status','==','pending')))));
 await test('revogação impede rejeitar pedido de clero',()=>assertFails(
   updateDoc(doc(admin,'badge_requests/carol'),{
     status:'rejected',reviewedBy:'admin',reviewedAt:serverTimestamp(),reviewNote:'Revogado não pode decidir.'
   })));
 await test('revogação impede consulta de denúncias',()=>assertFails(getDocs(collection(admin,'reports'))));
 await test('revogação impede remoção alheia',()=>assertFails(deleteDoc(doc(admin,'posts/p2'))));
 await test('revogação impede exclusão de resposta alheia',()=>assertFails(deleteDoc(doc(admin,'posts/p2/replies/e'))));
 await test('revogação impede analisar denúncia de resposta',()=>assertFails(updateDoc(doc(admin,rreply('bob','p2','e')),replyReview())));
 console.log(`RESULTADO: ${passed} testes aprovados.`);
} finally { await env.cleanup(); }

