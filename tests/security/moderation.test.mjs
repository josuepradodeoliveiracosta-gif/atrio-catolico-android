import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {initializeTestEnvironment,assertFails,assertSucceeds} from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,updateDoc,deleteDoc,writeBatch,serverTimestamp,Timestamp} from 'firebase/firestore';
const env=await initializeTestEnvironment({projectId:'demo-atrio-v11',firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}});
let passed=0;
async function test(name,fn){await fn();passed++;console.log('PASS',name);}
const admin=env.authenticatedContext('admin').firestore();
const alice=env.authenticatedContext('alice').firestore();
const bob=env.authenticatedContext('bob').firestore();
const anon=env.unauthenticatedContext().firestore();
const review=(status='dismissed',by='admin')=>({status,reviewedBy:by,reviewedAt:serverTimestamp(),reviewNote:'Análise de teste'});
const report=(id='p')=>({postId:id,reporterUid:'bob',reason:'Motivo para revisão',createdAt:serverTimestamp()});
try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'admins/admin'),{enabled:true});
  await setDoc(doc(db,'profiles/alice'),{displayName:'Alice',createdAt:Timestamp.now()});
  await setDoc(doc(db,'profiles/bob'),{displayName:'Bob',createdAt:Timestamp.now()});
  for(const id of ['p','p2','p3'])await setDoc(doc(db,'posts/'+id),{uid:'alice',authorName:'Alice',title:'Título teste',body:'Conteúdo de teste',category:'Liturgia',createdAt:Timestamp.now()});
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
 await test('usuário envia denúncia antiga sem status',()=>assertSucceeds(setDoc(doc(bob,'reports/r'),report())));
 await test('usuário não lê a própria denúncia',()=>assertFails(getDoc(doc(bob,'reports/r'))));
 await test('usuário não lista denúncias',()=>assertFails(getDocs(collection(bob,'reports'))));
 await test('usuário consulta somente seu registro de acesso',()=>assertSucceeds(getDoc(doc(bob,'admins/bob'))));
 await test('usuário não lê acesso de outra conta',()=>assertFails(getDoc(doc(bob,'admins/admin'))));
 await test('usuário não se promove',()=>assertFails(setDoc(doc(bob,'admins/bob'),{enabled:true})));
 await test('administrador não promove contas pelo cliente',()=>assertFails(setDoc(doc(admin,'admins/bob'),{enabled:true})));
 await test('administrador não altera seu acesso pelo cliente',()=>assertFails(updateDoc(doc(admin,'admins/admin'),{enabled:false})));
 await test('administrador consulta denúncias',()=>assertSucceeds(getDocs(collection(admin,'reports'))));
 await test('usuário não exclui publicação alheia',()=>assertFails(deleteDoc(doc(bob,'posts/p'))));
 await test('usuário não encerra denúncia',()=>assertFails(updateDoc(doc(bob,'reports/r'),review('dismissed','bob'))));
 await test('autor mantém edição própria',()=>assertSucceeds(updateDoc(doc(alice,'posts/p'),{body:'Conteúdo revisado pelo autor'})));
 await test('administrador não reescreve texto alheio',()=>assertFails(updateDoc(doc(admin,'posts/p'),{body:'Texto de outra pessoa'})));
 await test('denunciante não insere decisão pronta',()=>assertFails(setDoc(doc(bob,'reports/fake'),{...report(),...review()})));
 await test('administrador não forja identidade do revisor',()=>assertFails(updateDoc(doc(admin,'reports/r'),review('dismissed','bob'))));
 await test('administrador não altera motivo da denúncia',()=>assertFails(updateDoc(doc(admin,'reports/r'),{...review(),reason:'Outro motivo'})));
 await test('decisão exige justificativa válida',()=>assertFails(updateDoc(doc(admin,'reports/r'),{...review(),reviewNote:'x'})));
 await test('remoção exige que publicação deixe de existir',()=>assertFails(updateDoc(doc(admin,'reports/r'),review('removed'))));
 await test('remoção e decisão atômicas autorizadas',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p'));b.update(doc(admin,'reports/r'),review('removed'));await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(admin,'posts/p'))).exists(),false);
  assert.equal((await getDoc(doc(admin,'reports/r'))).data().status,'removed');
 });
 await test('decisão concluída é imutável',()=>assertFails(updateDoc(doc(admin,'reports/r'),review())));
 await test('registro de denúncia não pode ser apagado',()=>assertFails(deleteDoc(doc(admin,'reports/r'))));
 await setDoc(doc(bob,'reports/r2'),report('p2'));
 await test('encerrar sem remoção mantém publicação',async()=>{
  await assertSucceeds(updateDoc(doc(admin,'reports/r2'),review()));assert.equal((await getDoc(doc(alice,'posts/p2'))).exists(),true);
 });
 await test('resposta e aviso da v07 continuam funcionando',async()=>{
  const b=writeBatch(bob);b.set(doc(bob,'posts/p2/replies/answer'),{uid:'bob',authorName:'Bob',body:'Resposta de teste',createdAt:serverTimestamp()});
  b.set(doc(bob,'users/alice/notifications/answer'),{postId:'p2',replyId:'answer',actorUid:'bob',actorName:'Bob',read:false,createdAt:serverTimestamp()});await assertSucceeds(b.commit());
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
 await test('usuário denuncia resposta existente',()=>assertSucceeds(setDoc(doc(bob,'reports/rr'),replyReport())));
 await test('denúncia de resposta é privada',()=>assertFails(getDoc(doc(bob,'reports/rr'))));
 await test('anônimo não denuncia respostas',()=>assertFails(setDoc(doc(anon,'reports/anon'),replyReport())));
 await test('resposta inexistente não pode ser denunciada',()=>assertFails(setDoc(doc(bob,'reports/missing'),replyReport('missing'))));
 await test('resposta de outra discussão não valida alvo',()=>assertFails(setDoc(doc(bob,'reports/wrongparent'),replyReport('a','p3'))));
 await test('nova denúncia exige discussão existente',()=>assertFails(setDoc(doc(bob,'reports/orphan'),replyReport('orphan','missing'))));
 for(const bad of ['',null,42,'nested/id']) {
  await test('replyId inválido recusado: '+JSON.stringify(bad),()=>assertFails(setDoc(doc(bob,'reports/bad'),{...report('p2'),replyId:bad})));
 }
 await test('postId com caminho aninhado recusado',()=>assertFails(setDoc(doc(bob,'reports/badparent'),replyReport('a','p2/replies/a'))));
 await test('identidade do denunciante não pode ser forjada',()=>assertFails(setDoc(doc(bob,'reports/spoof'),{...replyReport(),reporterUid:'alice'})));
 await test('decisão não pode ser inserida na criação',()=>assertFails(setDoc(doc(bob,'reports/ready'),{...replyReport(),...replyReview()})));
 await test('autor da discussão não exclui resposta alheia',()=>assertFails(deleteDoc(doc(alice,'posts/p2/replies/b'))));
 await test('autor da resposta mantém exclusão própria',()=>assertSucceeds(deleteDoc(doc(bob,'posts/p2/replies/c'))));
 await test('administrador consulta resposta para análise',()=>assertSucceeds(getDoc(doc(admin,'posts/p2/replies/a'))));
 await test('administrador não edita resposta',()=>assertFails(updateDoc(doc(admin,'posts/p2/replies/a'),{body:'Alterada'})));
 await test('cliente antigo não encerra denúncia de resposta como publicação',()=>assertFails(updateDoc(doc(admin,'reports/rr'),review())));
 await test('tipo de alvo incorreto não encerra denúncia',()=>assertFails(updateDoc(doc(admin,'reports/rr'),{...review(),reviewTarget:'post'})));
 await test('alvo da resposta é imutável',()=>assertFails(updateDoc(doc(admin,'reports/rr'),{...replyReview(),replyId:'b'})));
 await test('usuário não modera resposta',()=>assertFails(updateDoc(doc(bob,'reports/rr'),{...replyReview(),reviewedBy:'bob'})));
 await test('resposta não pode ser marcada removida sem exclusão',()=>assertFails(updateDoc(doc(admin,'reports/rr'),replyReview('removed'))));
 await test('cliente antigo não apaga discussão pela denúncia de resposta',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2'));b.update(doc(admin,'reports/rr'),review('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2'))).exists(),true);
 });
 await test('remover resposta errada não resolve denúncia',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2/replies/b'));b.update(doc(admin,'reports/rr'),replyReview('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
 });
 await test('remoção da resposta preserva a discussão na mesma operação',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2'));b.delete(doc(admin,'posts/p2/replies/a'));b.update(doc(admin,'reports/rr'),replyReview('removed'));
  await assertFails(b.commit());assert.equal((await getDoc(doc(admin,'posts/p2/replies/a'))).exists(),true);
 });
 await test('remoção correta exclui só a resposta e registra decisão',async()=>{
  const original=(await getDoc(doc(admin,'posts/p2'))).data();
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p2/replies/a'));b.update(doc(admin,'reports/rr'),replyReview('removed'));
  await assertSucceeds(b.commit());
  assert.equal((await getDoc(doc(admin,'posts/p2/replies/a'))).exists(),false);
  assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
  assert.deepEqual((await getDoc(doc(admin,'posts/p2'))).data(),original);
  const decision=(await getDoc(doc(admin,'reports/rr'))).data();assert.equal(decision.status,'removed');assert.equal(decision.reviewTarget,'reply');
 });
 await test('decisão de resposta concluída é imutável',()=>assertFails(updateDoc(doc(admin,'reports/rr'),replyReview())));
 await setDoc(doc(bob,'reports/rr2'),replyReport('b'));
 await test('encerrar denúncia mantém resposta',async()=>{
  await assertSucceeds(updateDoc(doc(admin,'reports/rr2'),replyReview()));assert.equal((await getDoc(doc(admin,'posts/p2/replies/b'))).exists(),true);
 });
 await setDoc(doc(bob,'reports/rr3'),replyReport('d'));
 await deleteDoc(doc(bob,'posts/p2/replies/d'));
 await test('resposta já removida não registra nova remoção',()=>assertFails(updateDoc(doc(admin,'reports/rr3'),replyReview('removed'))));
 await test('denúncia de resposta já removida pode ser encerrada',()=>assertSucceeds(updateDoc(doc(admin,'reports/rr3'),replyReview())));
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'posts/p4'),{uid:'alice',authorName:'Alice',title:'Órfã futura',body:'Publicação de teste',category:'Liturgia',createdAt:Timestamp.now()});
  await setDoc(doc(db,'posts/p4/replies/a'),{uid:'bob',authorName:'Bob',body:'Resposta de teste',createdAt:Timestamp.now()});
 });
 await setDoc(doc(bob,'reports/rr4'),replyReport('a','p4'));
 await deleteDoc(doc(alice,'posts/p4'));
 await test('denúncia existente permite remover resposta de discussão já excluída',async()=>{
  const b=writeBatch(admin);b.delete(doc(admin,'posts/p4/replies/a'));b.update(doc(admin,'reports/rr4'),replyReview('removed'));await assertSucceeds(b.commit());
 });
 await setDoc(doc(bob,'reports/rr5'),replyReport('e'));
 await env.withSecurityRulesDisabled(async c=>updateDoc(doc(c.firestore(),'admins/admin'),{enabled:false}));
 await test('revogação impede consulta de denúncias',()=>assertFails(getDocs(collection(admin,'reports'))));
 await test('revogação impede remoção alheia',()=>assertFails(deleteDoc(doc(admin,'posts/p2'))));
 await test('revogação impede exclusão de resposta alheia',()=>assertFails(deleteDoc(doc(admin,'posts/p2/replies/e'))));
 await test('revogação impede analisar denúncia de resposta',()=>assertFails(updateDoc(doc(admin,'reports/rr5'),replyReview())));
 console.log(`RESULTADO: ${passed} testes aprovados.`);
} finally { await env.cleanup(); }
