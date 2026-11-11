// Integração sintética COMPLETA: BASE DE REGRAS PINADA + MURAL + CADASTRO + CHAT.
// Exclusivamente Firebase Emulator demo-atrio-v11; sem Firebase QA real.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
 from '@firebase/rules-unit-testing';
import {doc,setDoc,getDoc,getDocs,collection,serverTimestamp,Timestamp,updateDoc,deleteDoc,query,orderBy,limit}
 from 'firebase/firestore';
import {renderClosedQaParity}
 from '../../firebase/qa-general/closed-qa-parity.mjs';
import {STAGED_QA_DOCS} from '../../firebase/qa-general/admin-config-preflight.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const rules=renderClosedQaParity(
 read('../../firestore.rules'),
 read('../../firebase/atrio-conversas-v1.rules.fragment'),
 read('../../firebase/atrio-grupos-v1.rules.fragment')
);
if(!rules.includes('BEGIN QA PARITY ADDITIVE')||!rules.includes('declared_18_plus'))
 throw Error('qa_closed_parity_rules_missing');
const env=await initializeTestEnvironment({
 projectId:'demo-atrio-v11',
 firestore:{host:'127.0.0.1',port:8089,rules}
});
const uid='qa-closed-parity-alice';
const emailVerified=env.authenticatedContext(uid,{email_verified:true}).firestore();
const emailUnverified=env.authenticatedContext(uid,{email_verified:false}).firestore();
const other=env.authenticatedContext('qa-closed-parity-bob',{email_verified:true}).firestore();
const modUid='qa-closed-parity-moderator';
const moderator=env.authenticatedContext(modUid,{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const own=path=>doc(emailVerified,path);
const stage=async cb=>env.withSecurityRulesDisabled(async ctx=>cb(ctx.firestore()));
const age='users/'+uid+'/chatAgeEligibility/current';
const quota='users/'+uid+'/chatLimits/requests';
const post='posts/qa-integrado-fechado';
const postPayload=()=>({
 uid,authorName:'Adulto QA',title:'Publicação de homologação',
 body:'Publicação sintética feita exclusivamente no emulador',
 category:'Vida espiritual',createdAt:serverTimestamp()
});
const proof=()=>({
 status:'declared_18_plus',minimumAge:18,
 policyVersion:'2026-11-selfdecl-qa-v1',
 reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+30*86400000))
});
try{
 await env.clearFirestore();
 await test('cadastro normal cria perfil/conta e a declaração não é prova de idade',async()=>{
  const account='users/'+uid+'/private/account';
  await assertSucceeds(setDoc(own(account),{
   onboardingStatus:'pending_email',profileVersion:2,
   noticesOptIn:false,communityUpdates:false,updatedAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(own('profiles/'+uid),{
   displayName:'Adulto QA',createdAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(own(age),proof()));
  await assertFails(setDoc(doc(other,age),proof()));
  await assertFails(setDoc(own(age),proof()));
  await assertFails(getDoc(doc(other,account)));
 });
 await test('sem app_config ativado mural bloqueado mesmo com e-mail validado',async()=>{
  await assertFails(getDocs(collection(emailVerified,'posts')));
  await assertFails(setDoc(own(post),postPayload()));
  await assertFails(getDocs(collection(emailUnverified,'posts')));
  await assertFails(getDocs(collection(guest,'posts')));
  await assertFails(getDoc(own(quota)));
 });
 await test('permissões herdadas de leitura sobrevivem ao chat fechado mesmo sem app_config',async()=>{
  // Este teste cataloga acessos legados; não os interpreta como GO do QA.
  // Um GET autorizado pode retornar document.exists() == false.
  await assertSucceeds(getDoc(doc(guest,'app_config/opening_video')));
  await assertFails(getDocs(collection(guest,'app_config')));
  await assertSucceeds(getDoc(doc(emailUnverified,'app_config/founder')));
  await assertSucceeds(getDoc(doc(emailUnverified,'app_config/community_rules')));
  await assertSucceeds(getDoc(doc(emailUnverified,'app_config/email_verification')));
  await assertSucceeds(getDoc(doc(emailUnverified,'badges/qa-closed-parity-bob')));
  await assertSucceeds(getDoc(doc(emailUnverified,'profile_photos/qa-closed-parity-bob')));
  await assertSucceeds(getDoc(doc(emailUnverified,'public_profiles/qa-closed-parity-bob')));
  await assertFails(getDoc(doc(guest,'app_config/founder')));
  await assertFails(getDoc(doc(guest,'badges/qa-closed-parity-bob')));
  await assertFails(getDoc(doc(emailUnverified,'profiles/qa-closed-parity-bob')));
  await assertFails(setDoc(doc(emailUnverified,'admins/'+uid),{enabled:true}));
 });
 await test('denúncia de participante é rota herdada independente do chat e do email verificado',async()=>{
  // A antiga rota user_reports exige autenticação, NÃO token email_verified.
  // A exposição deve ser revisada como decisão operacional antes de deploy QA.
  const report='user_reports/'+uid+'__qa-closed-parity-bob';
  const payload={
    reporterUid:uid,targetUid:'qa-closed-parity-bob',
    reason:'Relato de abuso fictício exclusivamente no emulador',
    createdAt:serverTimestamp()
  };
  await assertSucceeds(setDoc(doc(emailUnverified,report),payload));
  await assertSucceeds(getDoc(doc(emailUnverified,report)));
  await assertFails(getDoc(doc(other,report)));
  await assertFails(getDoc(doc(guest,report)));
  await assertFails(getDocs(collection(emailUnverified,'user_reports')));
  await assertFails(setDoc(doc(emailUnverified,report),payload));
  await assertFails(setDoc(doc(other,'user_reports/qa-closed-parity-bob__'+uid),{
    ...payload,reporterUid:uid,targetUid:uid
  }));
 });
 await test('moderação de denúncia herdada: acesso mínimo, revisão e revogação',async()=>{
  // Usuários e documentos são fictícios, sem qualquer função no Firebase real.
  // A mesma consulta de 30 denúncias recentes é usada no painel Android.
  const report='user_reports/'+uid+'__qa-closed-parity-bob';
  const reportRef=doc(moderator,report);
  const page=query(collection(moderator,'user_reports'),
    orderBy('createdAt','desc'),limit(30));
  await assertFails(getDoc(reportRef)); // ainda não é administrador
  await assertFails(getDocs(page));
  await assertFails(updateDoc(doc(other,report),{
    status:'reviewed',reviewedBy:'qa-closed-parity-bob',
    reviewedAt:serverTimestamp()
  }));
  await assertFails(deleteDoc(doc(emailVerified,report)));
  await assertFails(setDoc(doc(moderator,'admins/'+modUid),{enabled:true}));
  await stage(async db=>{
    await setDoc(doc(db,'admins/'+modUid),{enabled:true});
  });
  await assertSucceeds(getDoc(reportRef));
  await assertSucceeds(getDocs(page));
  await assertFails(getDocs(collection(other,'user_reports')));
  await assertFails(getDoc(doc(other,report)));
  // Um admin não pode apagar a denúncia, nem alterá-la sem decisão válida.
  await assertFails(deleteDoc(reportRef));
  await assertFails(updateDoc(reportRef,{
    status:'discarded',reviewedBy:modUid,reviewedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(reportRef,{
    status:'reviewed',reviewedBy:'qa-closed-parity-bob',
    reviewedAt:serverTimestamp()
  }));
  await assertSucceeds(updateDoc(reportRef,{
    status:'reviewed',reviewedBy:modUid,reviewedAt:serverTimestamp()
  }));
  await assertFails(updateDoc(reportRef,{
    status:'reviewed',reviewedBy:modUid,reviewedAt:serverTimestamp()
  }));
  await stage(async db=>{
    await setDoc(doc(db,'admins/'+modUid),{enabled:false});
  });
  await assertFails(getDoc(reportRef));
  await assertFails(getDocs(page));
  await assertFails(updateDoc(reportRef,{
    status:'reviewed',reviewedBy:modUid,reviewedAt:serverTimestamp()
  }));
  // O autor conserva leitura do próprio protocolo mesmo com revogação admin.
  await assertSucceeds(getDoc(doc(emailVerified,report)));
 });
 await test('apenas no emulador estágio QA preserva mural e protege chat fechado',async()=>{
  await stage(async db=>{
   for(const [path,value] of Object.entries(STAGED_QA_DOCS))
    await setDoc(doc(db,path),value);
  });
  await assertSucceeds(getDocs(collection(emailVerified,'posts')));
  await assertFails(getDocs(collection(emailUnverified,'posts')));
  await assertFails(getDocs(collection(guest,'posts')));
  await assertFails(setDoc(own(post),postPayload())); // sem aceite
  await assertSucceeds(setDoc(own('community_consents/'+uid),{
   version:'2026-11-v1',acceptedAt:serverTimestamp()
  }));
  await assertSucceeds(setDoc(own(post),postPayload()));
  await assertSucceeds(getDoc(own(post)));
  await assertSucceeds(getDocs(collection(emailVerified,'posts')));
  await assertFails(getDoc(doc(emailUnverified,post)));
  await assertFails(getDoc(doc(guest,post)));
  await assertFails(setDoc(doc(other,'posts/qa-forged'),postPayload()));
  await assertFails(setDoc(doc(emailUnverified,'posts/qa-forged2'),postPayload()));
  await assertFails(getDoc(own(quota))); // chat desativado apesar declaração
  await assertFails(getDoc(own('chats/qa-alice__qa-bob')));
  await assertFails(getDoc(own('chat_groups/qa-grupo')));
  await assertFails(setDoc(own('app_config/conversations'),{
   enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
   safetyReviewVersion:'2026-11-safety-v1'
  }));
 });
 await test('ativação de DM sintética nunca habilita conta sem autodeclaração',async()=>{
  await stage(async db=>{
   await setDoc(doc(db,'app_config/conversations'),{
    enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
    safetyReviewVersion:'2026-11-safety-v1'
   });
  });
  await assertSucceeds(getDoc(own(quota)));
  await assertFails(getDoc(doc(other,'users/qa-closed-parity-bob/chatLimits/requests')));
  await assertFails(getDoc(doc(emailUnverified,quota)));
  await stage(async db=>{await setDoc(doc(db,'app_config/conversations'),
   STAGED_QA_DOCS['app_config/conversations']);});
  await assertFails(getDoc(own(quota)));
  await assertSucceeds(getDoc(own(post))); // mural preservado como operação separada
 });
}finally{
 await env.cleanup();
}
console.log('Paridade fechada: cadastro normal, mural e chat sem GO real (EMULATOR).');
