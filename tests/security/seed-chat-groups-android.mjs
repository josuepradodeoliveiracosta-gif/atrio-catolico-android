/**
 * Only the local Firebase Emulator Suite. This file MUST NOT be run against
 * production: the fixed loopback hosts and demo project are hardcoded.
 * It provisions two actual Auth-emulator users and a mutually accepted DM,
 * then adds sandbox-only safety gates for end-to-end Android group QA.
 */
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment} from '@firebase/rules-unit-testing';
import {doc,deleteDoc,setDoc,serverTimestamp,Timestamp} from 'firebase/firestore';

const project='demo-atrio-v11';
const authBase='http://127.0.0.1:9099';
const firestoreBase='http://127.0.0.1:8089';
const marker="    match /{document=**} {\n      allow read, write: if false;\n    }";
const rulesBase=readFileSync('firestore.rules','utf8');
const fragmentDm=readFileSync('../../firebase/atrio-conversas-v1.rules.fragment','utf8');
const fragmentGroups=readFileSync('../../firebase/atrio-grupos-v1.rules.fragment','utf8');
if(!rulesBase.includes(marker) || !fragmentDm.includes('function chatEnabled()')
  || !fragmentGroups.includes('function atrioGroupsEnabled()'))
  throw Error('Regras de homologação ausentes: seed recusado.');

for(const base of [authBase,firestoreBase]){
  const url=new URL(base);
  if(url.hostname!=='127.0.0.1') throw Error('Seed remoto proibido.');
  await fetch(base,{signal:AbortSignal.timeout(3000)});
  // O endpoint raiz dos emuladores pode devolver 404 e ainda estar ativo.
}

const password='GrupoQa2026!Emulador';
const accounts=[
  {email:'group.alice@qa.invalid',name:'Clara QA'},
  {email:'group.bob@qa.invalid',name:'Miguel QA'}
];
// A UI de chats e a de grupos são suítes independentes: o segundo seed
// restaura apenas fixtures locais, sem cadastrar contas duplicadas.
async function emulatorAuth(action,account) {
  const response=await fetch(authBase+
    '/identitytoolkit.googleapis.com/v1/accounts:'+action+'?key=local-emulator-test',{
    method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({email:account.email,password,returnSecureToken:true}),
    signal:AbortSignal.timeout(10000)
  });
  return {response,data:await response.json()};
}
for(const account of accounts) {
  let result=await emulatorAuth('signUp',account);
  if(!result.response.ok && result.data?.error?.message==='EMAIL_EXISTS') {
    result=await emulatorAuth('signInWithPassword',account);
  }
  if(!result.response.ok || !result.data.localId)
    throw Error('Falha no login local '+account.email+': '+JSON.stringify(result.data));
  account.uid=result.data.localId;
}
const chatId=[accounts[0].uid,accounts[1].uid].sort().join('__');
const enabledRules=rulesBase.replace(marker,fragmentDm+fragmentGroups+marker);
const env=await initializeTestEnvironment({
  projectId:project,
  firestore:{host:'127.0.0.1',port:8089,rules:enabledRules}
});
try {
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'app_config/conversations'),{
      enabled:true,version:'2026-11-v1',
      minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1',
      editEnabled:false,deleteEnabled:false
    });
    await setDoc(doc(db,'app_config/chat_groups'),{
      enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true
    });
    for(const user of accounts){
      await setDoc(doc(db,'users/'+user.uid+'/chatGroupAccess/eligibility'),{
        status:'approved',policyVersion:'2026-11-group-safety-v1',
        reviewExpiresAt:Timestamp.fromDate(new Date(Date.now()+86_400_000))
      });
      await setDoc(doc(db,'public_profiles/'+user.uid),{
        uid:user.uid,displayName:user.name,createdAt:serverTimestamp()
      });
    }
    // Somente os dois UIDs do Auth emulado. Remove estados transitórios
    // de bloqueio deixados por QA individual, nunca dados de produção.
    await deleteDoc(doc(db,'users/'+accounts[0].uid+
      '/blockedMembers/'+accounts[1].uid));
    await deleteDoc(doc(db,'users/'+accounts[1].uid+
      '/blockedMembers/'+accounts[0].uid));
    await setDoc(doc(db,'chats/'+chatId),{
      participants:[accounts[0].uid,accounts[1].uid],
      requesterUid:accounts[0].uid,recipientUid:accounts[1].uid,
      status:'accepted',initialId:'emulator-fixture',
      lastMessageId:'emulator-fixture',lastPreview:'Olá!',
      lastSenderUid:accounts[0].uid,
      createdAt:serverTimestamp(),updatedAt:serverTimestamp(),
      unreadRequester:0,unreadRecipient:0
    });
    await setDoc(doc(db,'chats/'+chatId+'/messages/emulator-fixture'),{
      uid:accounts[0].uid,kind:'text',text:'Olá!',createdAt:serverTimestamp()
    });
  });
  console.log('OK: 2 usuários Auth emulados, conversa aceita e portões de grupos no laboratório.');
  console.log('Todos os dados são do projeto '+project+', host 127.0.0.1.');
} finally {
  await env.cleanup();
}
