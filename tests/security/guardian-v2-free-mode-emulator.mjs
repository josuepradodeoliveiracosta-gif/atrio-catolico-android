/**
 * Free-only operating mode: real Firestore SDK + Rules Emulator, no secret,
 * service-account, Cloud Functions, Cloud Run or Cloudflare authentication.
 * Explicitly NOT 24/7 autonomous moderation: only human admin review.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocFromCache,getDocFromServer,disableNetwork,enableNetwork,updateDoc,deleteDoc,runTransaction,serverTimestamp}
  from 'firebase/firestore';

const env=await initializeTestEnvironment({
 projectId:'demo-atrio-v11',
 firestore:{host:'127.0.0.1',port:8089,rules:readFileSync('firestore.rules','utf8')}
});
const author=env.authenticatedContext('qaAuthor').firestore();
const reporter=env.authenticatedContext('qaReporter').firestore();
const moderator=env.authenticatedContext('qaAdmin').firestore();
const anon=env.unauthenticatedContext().firestore();
const root='posts/qaFreeTopic';
const replyPath=id=>root+'/replies/'+id;
const reportPath=id=>'reports/qaReporter_reply_qaFreeTopic_'+id;
const makeReply=body=>({uid:'qaAuthor',authorName:'Autora QA',body,
 createdAt:serverTimestamp()});
const makeReport=id=>({postId:'qaFreeTopic',replyId:id,reporterUid:'qaReporter',
 reason:'Verificação humana solicitada',createdAt:serverTimestamp()});
const decision=(status)=>({
 status,reviewedBy:'qaAdmin',reviewedAt:serverTimestamp(),
 reviewNote:'Revisão manual gratuita concluída.',reviewTarget:'reply'
});
let checks=0;
async function check(name,fn){await fn();console.log('GUARDIAN_FREE_MANUAL_PASS',++checks,name);}
try {
 await env.clearFirestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await setDoc(doc(db,'admins/qaAdmin'),{enabled:true});
  await setDoc(doc(db,'guardian_config/policy'),{
   enabled:false,allowHold:false,emergencyStop:true
  });
 });
 await check('perfis sintéticos sob Firestore Rules sem conta de serviço',async()=>{
  await assertSucceeds(setDoc(doc(author,'profiles/qaAuthor'),{
   displayName:'Autora QA',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(reporter,'profiles/qaReporter'),{
   displayName:'Denunciante QA',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(author,root),{
   uid:'qaAuthor',authorName:'Autora QA',title:'Comunidade católica QA',
   body:'Discussão legítima sobre a oração e a caridade.',
   category:'Liturgia',createdAt:serverTimestamp()
  }));
  const settings=await assertSucceeds(getDoc(doc(moderator,'guardian_config/policy')));
  assert.deepEqual([settings.data().enabled,settings.data().allowHold,
    settings.data().emergencyStop],[false,false,true]);
 });
 await check('publicação e denúncia válidas, sem scanner automático',async()=>{
  await assertSucceeds(setDoc(doc(author,replyPath('phish')),
   makeReply('Clique https://exemplo.invalid para informar sua senha')));
  await assertSucceeds(setDoc(doc(reporter,reportPath('phish')),makeReport('phish')));
  await assertFails(setDoc(doc(reporter,reportPath('phish')),makeReport('phish')));
  await assertFails(getDoc(doc(reporter,reportPath('phish'))));
  await assertFails(getDoc(doc(anon,replyPath('phish'))));
  assert.equal((await assertSucceeds(getDoc(doc(moderator,reportPath('phish'))))).exists(),true);
  assert.equal((await getDoc(doc(reporter,replyPath('phish')))).exists(),true);
 });
 await check('usuário não decide, não lê auditoria e não remove resposta alheia',async()=>{
  await assertFails(updateDoc(doc(reporter,reportPath('phish')),
   decision('dismissed')));
  await assertFails(deleteDoc(doc(reporter,replyPath('phish'))));
  await assertFails(setDoc(doc(reporter,'admins/qaReporter'),{enabled:true}));
  await assertFails(getDoc(doc(reporter,'guardian_config/policy')));
  await assertFails(setDoc(doc(reporter,'guardian_cases/guard_fake'),{status:'removed'}));
  await assertFails(setDoc(doc(reporter,'guardian_audit/fake'),{actor:'qaReporter'}));
 });
 await check('admin remove somente resposta denunciada e confirma relatório no mesmo commit',async()=>{
  await assertSucceeds(runTransaction(moderator,async tx=>{
   const report=await tx.get(doc(moderator,reportPath('phish')));
   const target=await tx.get(doc(moderator,replyPath('phish')));
   assert.equal(report.get('status')||'pending','pending');
   assert.equal(report.get('postId'),'qaFreeTopic');
   assert.equal(report.get('replyId'),'phish');
   assert.equal(target.get('uid'),'qaAuthor');
   tx.delete(doc(moderator,replyPath('phish')));
   tx.update(doc(moderator,reportPath('phish')),decision('removed'));
  }));
  assert.equal((await getDoc(doc(reporter,replyPath('phish')))).exists(),false);
  assert.equal((await getDoc(doc(reporter,root))).exists(),true);
  const report=await getDoc(doc(moderator,reportPath('phish')));
  assert.equal(report.get('status'),'removed');
  assert.equal(report.get('reviewedBy'),'qaAdmin');
 });
 await check('admin encerra denúncia contextual sem remover texto religioso',async()=>{
  await assertSucceeds(setDoc(doc(author,replyPath('context')),
   makeReply('O Evangelho nos convida à caridade e à paz.')));
  await assertSucceeds(setDoc(doc(reporter,reportPath('context')),makeReport('context')));
  await assertSucceeds(runTransaction(moderator,async tx=>{
   const report=await tx.get(doc(moderator,reportPath('context')));
   assert.equal(report.get('status')||'pending','pending');
   tx.update(doc(moderator,reportPath('context')),decision('dismissed'));
  }));
  assert.equal((await getDoc(doc(reporter,replyPath('context')))).exists(),true);
  const reviewed=await getDoc(doc(moderator,reportPath('context')));
  assert.equal(reviewed.get('status'),'dismissed');
  await assertFails(updateDoc(doc(moderator,reportPath('context')),decision('removed')));
 });
 await check('falha de decisão humana não exclui publicação nem resolve denúncia',async()=>{
  const postId='qaFreeInvalidDecision';
  const target='posts/'+postId;
  const reportId='reports/qaReporter_post_'+postId;
  await assertSucceeds(setDoc(doc(author,target),{
   uid:'qaAuthor',authorName:'Autora QA',title:'Publicação sob análise',
   body:'Texto legítimo com contexto completo para revisão humana.',
   category:'Liturgia',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(reporter,reportId),{
   postId,reporterUid:'qaReporter',reason:'Revisão de conteúdo de teste',
   createdAt:serverTimestamp()
  }));
  // A operação aparentemente apaga o post, mas o relatório inválido faz
  // TODO o commit falhar sob regras Firestore: não pode existir exclusão parcial.
  await assertFails(runTransaction(moderator,async tx=>{
   const report=await tx.get(doc(moderator,reportId));
   const targetDoc=await tx.get(doc(moderator,target));
   assert.equal(report.get('status')||'pending','pending');
   assert.equal(targetDoc.exists(),true);
   tx.delete(doc(moderator,target));
   tx.update(doc(moderator,reportId),{
    status:'invalid_status',reviewedBy:'qaAdmin',
    reviewedAt:serverTimestamp(),
    reviewNote:'Não deve ser aceito.',reviewTarget:'post'
   });
  }));
  assert.equal((await getDoc(doc(reporter,target))).exists(),true,
   'Falha na decisão não pode excluir publicação');
  const pending=await getDoc(doc(moderator,reportId));
  assert.equal(pending.get('status'),undefined,'Denúncia deve continuar pendente');
  // O tipo da denúncia também é validado pelas regras.
  await assertFails(updateDoc(doc(moderator,reportId),{
   status:'dismissed',reviewedBy:'qaAdmin',
   reviewedAt:serverTimestamp(),reviewNote:'Tipo errado de alvo.',
   reviewTarget:'reply'
  }));
  assert.equal((await getDoc(doc(moderator,reportId))).get('status'),undefined);
 });
 await check('admin remove post denunciado e marca decisão no mesmo commit',async()=>{
  const postId='qaFreeRemovedPost';
  const target='posts/'+postId;
  const reportId='reports/qaReporter_post_'+postId;
  await assertSucceeds(setDoc(doc(author,target),{
   uid:'qaAuthor',authorName:'Autora QA',title:'Discussão fictícia removida',
   body:'Publicação de teste, sob decisão administrativa humana.',
   category:'Liturgia',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(doc(reporter,reportId),{
   postId,reporterUid:'qaReporter',reason:'Solicitação de análise por administrador',
   createdAt:serverTimestamp()
  }));
  await assertSucceeds(runTransaction(moderator,async tx=>{
   const report=await tx.get(doc(moderator,reportId));
   const targetDoc=await tx.get(doc(moderator,target));
   assert.equal(report.get('status')||'pending','pending');
   assert.equal(report.get('postId'),postId);
   assert.equal(targetDoc.get('uid'),'qaAuthor');
   tx.delete(doc(moderator,target));
   tx.update(doc(moderator,reportId),{
    status:'removed',reviewedBy:'qaAdmin',
    reviewedAt:serverTimestamp(),
    reviewNote:'Decisão humana confirmada no QA.',reviewTarget:'post'
   });
  }));
  assert.equal((await getDoc(doc(reporter,target))).exists(),false);
  const reviewed=await getDoc(doc(moderator,reportId));
  assert.equal(reviewed.get('status'),'removed');
  assert.equal(reviewed.get('reviewTarget'),'post');
  await assertFails(updateDoc(doc(moderator,reportId),{
   status:'dismissed',reviewedBy:'qaAdmin',
   reviewedAt:serverTimestamp(),reviewNote:'Decisão repetida indevida.',
   reviewTarget:'post'
  }));
 });
 await check('modo grátis nunca falsifica caso, aviso ou quarentena do servidor',async()=>{
  for(const path of [
    'guardian_cases/guard_fake','guardian_audit/fake',
    'guardiao_quarantine/guard_fake'
  ])assert.equal((await getDoc(doc(moderator,path))).exists(),false,path);
  await assertFails(updateDoc(doc(moderator,'guardian_config/policy'),{
   enabled:true,allowHold:true,emergencyStop:false
  }));
 });
 await check('permissão revogada não se restaura via cache após reconexão',async()=>{
  const cachedAdmin=env.authenticatedContext('qaCacheAdmin').firestore();
  const path=reportPath('context');
  await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'admins/qaCacheAdmin'),{enabled:true});
  });
  // First verify the role and fetch a report while it is authorized; both
  // documents are now present in the client cache.
  const role=await assertSucceeds(getDoc(doc(cachedAdmin,'admins/qaCacheAdmin')));
  assert.equal(role.get('enabled'),true);
  const allowed=await assertSucceeds(getDoc(doc(cachedAdmin,path)));
  assert.equal(allowed.exists(),true);
  await disableNetwork(cachedAdmin);
  try{
   // Revocation is carried out by a separate trusted emulator-only context.
   // It is intentionally invisible to the disconnected cached client.
   await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'admins/qaCacheAdmin'),{enabled:false});
   });
   const stale=await getDocFromCache(doc(cachedAdmin,path));
   assert.equal(stale.exists(),true,
    'O cache local ainda tem o relatório, mas NÃO comprova autorização atual');
  }finally{
   await enableNetwork(cachedAdmin);
  }
  await assertFails(getDocFromServer(doc(cachedAdmin,path)));
  await assertFails(updateDoc(doc(cachedAdmin,path),decision('removed')));
  await env.withSecurityRulesDisabled(async ctx=>{
   const reviewed=await getDoc(doc(ctx.firestore(),path));
   assert.equal(reviewed.get('status'),'dismissed');
  });
 });
 await check('escrita pendente offline não ultrapassa revogação antes de sincronizar',async()=>{
  const offlineDb=env.authenticatedContext('qaOfflineDecisionAdmin').firestore();
  const queuedReplyId='offlineQueued';
  const queuedReportPath=reportPath(queuedReplyId);
  await assertSucceeds(setDoc(doc(author,replyPath(queuedReplyId)),
   makeReply('Resposta de teste aguardando revisão humana.')));
  await assertSucceeds(setDoc(doc(reporter,queuedReportPath),
   makeReport(queuedReplyId)));
  const reportRef=doc(offlineDb,queuedReportPath);
  await env.withSecurityRulesDisabled(async ctx=>{
   await setDoc(doc(ctx.firestore(),'admins/qaOfflineDecisionAdmin'),{enabled:true});
  });
  const initial=await assertSucceeds(getDoc(reportRef));
  assert.equal(initial.get('status'),undefined,'report starts pending');
  await disableNetwork(offlineDb);
  let completed=false;
  try{
   // An offline write is ONLY a local optimistic event; not proof of a
   // committed admin decision. The returned promise resolves after reconnect.
   const offlineWrite=updateDoc(reportRef,{
    status:'dismissed',reviewedBy:'qaOfflineDecisionAdmin',
    reviewedAt:serverTimestamp(),reviewNote:'Decisão humana de teste offline.',
    reviewTarget:'reply'
   }).then(()=>({committed:true}),e=>({committed:false,error:e}));
   // Attach a rejection handler immediately (above) to avoid an
   // unhandled rejection if the emulator responds before awaiting.
   await env.withSecurityRulesDisabled(async ctx=>{
    await updateDoc(doc(ctx.firestore(),'admins/qaOfflineDecisionAdmin'),{enabled:false});
   });
   await enableNetwork(offlineDb);
   const result=await Promise.race([
    offlineWrite,
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('offline_write_reconnect_timeout')),15000))
   ]);
   completed=true;
   assert.equal(result.committed,false,'revoked admin must not commit queued write');
  }finally{
   await enableNetwork(offlineDb);
  }
  assert.equal(completed,true);
  await env.withSecurityRulesDisabled(async ctx=>{
   const after=await getDoc(doc(ctx.firestore(),queuedReportPath));
   assert.equal(after.get('status'),undefined,
    'post-revocation offline admin write must leave report pending');
  });
 });
 await check('admin revogado perde direito de decidir; denúncia fica pendente',async()=>{
  await assertSucceeds(setDoc(doc(author,replyPath('pending')),
   makeReply('Texto legítimo pendente de decisão administrativa.')));
  await assertSucceeds(setDoc(doc(reporter,reportPath('pending')),makeReport('pending')));
  await env.withSecurityRulesDisabled(async ctx=>{
   await updateDoc(doc(ctx.firestore(),'admins/qaAdmin'),{enabled:false});
  });
  await assertFails(updateDoc(doc(moderator,reportPath('pending')),decision('dismissed')));
  await assertFails(getDoc(doc(moderator,reportPath('pending'))));
  await assertFails(deleteDoc(doc(moderator,replyPath('pending'))));
  assert.equal((await getDoc(doc(reporter,replyPath('pending')))).exists(),true);
  await env.withSecurityRulesDisabled(async ctx=>{
   const snap=await getDoc(doc(ctx.firestore(),reportPath('pending')));
   assert.equal(snap.get('status'),undefined);
  });
 });
 console.log('GUARDIAN_FREE_MANUAL_EMULATOR',checks,'PASS');
}finally{await env.cleanup();}
