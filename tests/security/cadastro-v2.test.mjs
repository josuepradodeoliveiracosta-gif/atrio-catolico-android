/**
 * Cadastro V2: regressão de privacidade e privilégios.
 * Somente Firebase Emulator Suite; nunca acessa produção.
 */
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment, assertFails, assertSucceeds} from '@firebase/rules-unit-testing';
import {doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, serverTimestamp} from 'firebase/firestore';

const env = await initializeTestEnvironment({
  projectId: 'demo-atrio-v11',
  firestore: {host:'127.0.0.1', port:8089, rules:readFileSync('firestore.rules','utf8')}
});
const unverified = env.authenticatedContext('alice',{email_verified:false}).firestore();
const verified = env.authenticatedContext('alice',{email_verified:true}).firestore();
const stranger = env.authenticatedContext('bob',{email_verified:true}).firestore();
const anon = env.unauthenticatedContext().firestore();
const accPath = 'users/alice/private/account';
const prefsPath = 'users/alice/private/preferences';
const acc = (status='pending_email') => ({
  onboardingStatus: status, profileVersion: 2,
  noticesOptIn:false, communityUpdates:false,
  updatedAt:serverTimestamp()
});
const prefs = () => ({
  interests:['Oração','Formação'],
  participation:'Padre/Diácono', // É declaração, nunca selo.
  city:'Fortaleza', parish:'Paróquia de teste',
  consentVersion:'cadastro-v2-2026-11',
  consentAt:serverTimestamp(),updatedAt:serverTimestamp()
});
let count=0;
async function check(label,fn){await fn();count++;console.log('PASS CADASTRO V2',label);}
try {
  await env.clearFirestore();
  await check('anônimo não lê dados privados',()=>assertFails(getDoc(doc(anon,accPath))));
  await check('outro membro não lê conta',()=>assertFails(getDoc(doc(stranger,accPath))));
  await check('outro membro não escreve conta',()=>assertFails(setDoc(doc(stranger,accPath),acc())));
  await check('titular cria documento mínimo com privilégios desligados',()=>
    assertSucceeds(setDoc(doc(unverified,accPath),acc())));
  await check('titular lê seus próprios dados',()=>assertSucceeds(getDoc(doc(unverified,accPath))));
  await check('não é permitido adicionar role/admin',()=>assertFails(
    setDoc(doc(unverified,'users/alice/private/other'),{isAdmin:true})
  ));
  await check('conta não pode se dar status concluído sem e-mail verificado',()=>
    assertFails(updateDoc(doc(unverified,accPath),{onboardingStatus:'complete',updatedAt:serverTimestamp()})));
  await check('conta não ativa marketing sem consentimento',()=>
    assertFails(updateDoc(doc(verified,accPath),{communityUpdates:true,updatedAt:serverTimestamp()})));
  await check('conta não altera versão do esquema',()=>
    assertFails(updateDoc(doc(verified,accPath),{profileVersion:999,updatedAt:serverTimestamp()})));
  await check('conta confirmada conclui etapa com token verificado',()=>
    assertSucceeds(updateDoc(doc(verified,accPath),{onboardingStatus:'complete',updatedAt:serverTimestamp()})));
  await check('conta não volta a pending depois de complete',()=>
    assertFails(updateDoc(doc(verified,accPath),{onboardingStatus:'pending_email',updatedAt:serverTimestamp()})));
  await check('cliente não apaga registro privado de conta',()=>
    assertFails(deleteDoc(doc(verified,accPath))));

  await check('terceiro não lê preferências religiosas',()=>
    assertFails(getDoc(doc(stranger,prefsPath))));
  await check('anônimo não lê preferências',()=>
    assertFails(getDoc(doc(anon,prefsPath))));
  await check('não é possível listar preferências de outros usuários',()=>
    assertFails(getDocs(collection(stranger,'users/alice/private'))));
  await check('titular salva preferências privadas',()=>
    assertSucceeds(setDoc(doc(unverified,prefsPath),prefs())));
  await check('preferências de Padre/Diácono não criam selo',async()=>{
    const p=await assertSucceeds(getDoc(doc(verified,prefsPath)));
    assert.equal(p.data().participation,'Padre/Diácono');
    const adminGrant=await assertSucceeds(getDoc(doc(verified,'admins/alice')));
    assert.equal(adminGrant.exists(),false);
  });
  await check('terceiro não altera preferências',()=>
    assertFails(updateDoc(doc(stranger,prefsPath),{city:'Outro lugar'})));
  await check('cliente não injeta marcador de Fundador',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),isFounder:true})));
  await check('cliente não injeta custom claim',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),isAdmin:true})));
  await check('consentimento não pode faltar',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),consentVersion:''})));
  await check('participação arbitrária não é permitida',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),participation:'Fundador'})));
  await check('interesse fora da lista não é permitido',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),interests:['Fé','Acesso privilegiado']})));
  await check('tamanho excessivo de cidade não é permitido',()=>
    assertFails(setDoc(doc(verified,prefsPath),{...prefs(),city:'x'.repeat(81)})));
  await check('titular atualiza suas próprias escolhas',()=>
    assertSucceeds(setDoc(doc(verified,prefsPath),{
      ...prefs(),participation:'Leigo(a)',interests:['Comunidade']
    })));
  await check('terceiro não revoga consentimento de outro',()=>
    assertFails(deleteDoc(doc(stranger,prefsPath))));
  await check('titular pode apagar as preferências e revogar a autorização',()=>
    assertSucceeds(deleteDoc(doc(verified,prefsPath))));
  await check('preferências não permanecem após exclusão',async()=>{
    const p=await assertSucceeds(getDoc(doc(verified,prefsPath)));
    assert.equal(p.exists(),false);
  });
  console.log(`OK: ${count} verificações específicas do Cadastro V2`);
} finally { await env.cleanup(); }
