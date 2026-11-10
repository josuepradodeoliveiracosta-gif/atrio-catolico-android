// Teste APENAS Firebase Emulator: usuarios, configuracoes e grupos ficticios.
// Mesma matriz contra candidato QA isolado e paridade com base versionada.
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {doc,getDoc,getDocs,collectionGroup,query,where,limit,setDoc,Timestamp}
  from 'firebase/firestore';

const mode=process.argv[2];
if(!['standalone','parity'].includes(mode))
  throw Error('qa_invite_audit_variant_required');
const filename=mode==='standalone'
  ? 'qa-general.generated.rules' : 'qa-parity.generated.rules';
const rules=readFileSync(filename,'utf8');
if(!rules.includes('match /{path=**}/atrioGroupInvites/{inviteId}') ||
   !rules.includes('qaChatAge18Eligible(request.auth.uid)') ||
   !rules.includes('match /chat_groups/{groupId}'))
  throw Error('qa_invite_rules_identity_invalid');

const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const bobUnverified=env.authenticatedContext('qa-bob',{email_verified:false}).firestore();
const charlie=env.authenticatedContext('qa-charlie',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const invite='chat_groups/qa-private-group/atrioGroupInvites/qa-bob';
const agePath=uid=>'users/'+uid+'/chatAgeEligibility/current';
const groupAccess=uid=>'users/'+uid+'/chatGroupAccess/eligibility';
const future=Timestamp.fromDate(new Date('2035-01-01T00:00:00Z'));
const past=Timestamp.fromDate(new Date('2001-01-01T00:00:00Z'));
const age18={
  status:'eligible',minimumAge:18,
  policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:future
};
const groupEligible={
  status:'approved',policyVersion:'2026-11-group-safety-v1',
  reviewExpiresAt:future
};
const conversations={
  enabled:true,version:'2026-11-v1',minorPolicyApproved:true,
  safetyReviewVersion:'2026-11-safety-v1'
};
const groups={enabled:true,version:'2026-11-groups-v1',
  minorPolicyApproved:true};
const ownInvites=db=>query(
  collectionGroup(db,'atrioGroupInvites'),
  where('inviteeUid','==','qa-bob'),limit(20)
);
let checks=0;
const granted=async call=>{await assertSucceeds(call());checks++;};
const denied=async call=>{await assertFails(call());checks++;};
const seed=async(path,data)=>env.withSecurityRulesDisabled(async ctx=>{
  await setDoc(doc(ctx.firestore(),path),data);
});

try{
  await env.clearFirestore();
  await denied(()=>getDoc(doc(bob,invite)));
  await denied(()=>getDocs(ownInvites(bob)));

  await env.withSecurityRulesDisabled(async ctx=>{
    const db=ctx.firestore();
    await setDoc(doc(db,'app_config/conversations'),conversations);
    await setDoc(doc(db,'app_config/chat_groups'),groups);
    for(const uid of ['qa-alice','qa-bob','qa-charlie']){
      await setDoc(doc(db,agePath(uid)),age18);
      await setDoc(doc(db,groupAccess(uid)),groupEligible);
    }
    // Charlie e membro comum, Alice e administradora, Bob e convidado.
    await setDoc(doc(db,'chat_groups/qa-private-group'),{
      ownerUid:'qa-alice',memberUids:['qa-alice','qa-charlie'],
      adminUids:['qa-alice'],name:'Grupo ficticio de QA',status:'active'
    });
    await setDoc(doc(db,invite),{
      inviteeUid:'qa-bob',inviterUid:'qa-alice',
      groupName:'Grupo ficticio de QA',
      contactChatId:'qa-alice__qa-bob',status:'pending'
    });
  });
  // Acesso legitimo de destinatario, administrador e query filtrada.
  await granted(()=>getDoc(doc(bob,invite)));
  await granted(()=>getDoc(doc(alice,invite)));
  await granted(()=>getDocs(ownInvites(bob)));

  // Um membro sem papel administrativo nao pode ler convite alheio.
  await denied(()=>getDoc(doc(charlie,invite)));
  await denied(()=>getDoc(doc(guest,invite)));
  await denied(()=>getDoc(doc(bobUnverified,invite)));
  await denied(()=>getDocs(query(
    collectionGroup(bob,'atrioGroupInvites'),limit(20)
  )));
  await denied(()=>getDocs(query(
    collectionGroup(bob,'atrioGroupInvites'),
    where('inviteeUid','==','qa-charlie')
  )));
  await denied(()=>getDocs(query(
    collectionGroup(charlie,'atrioGroupInvites'),
    where('inviteeUid','==','qa-bob')
  )));
  await denied(()=>getDocs(query(
    collectionGroup(bob,'atrioGroupInvites'),
    where('inviteeUid','in',['qa-bob','qa-charlie'])
  )));

  // Revogacao 18+ invalida acesso sem remover o documento.
  await seed(agePath('qa-bob'),{...age18,status:'revoked'});
  await denied(()=>getDoc(doc(bob,invite)));
  await denied(()=>getDocs(ownInvites(bob)));
  await seed(agePath('qa-bob'),age18);
  await granted(()=>getDocs(ownInvites(bob)));

  // Revogacao ou vencimento do gate para grupos.
  await seed(groupAccess('qa-bob'),{...groupEligible,status:'revoked'});
  await denied(()=>getDoc(doc(bob,invite)));
  await denied(()=>getDocs(ownInvites(bob)));
  await seed(groupAccess('qa-bob'),{...groupEligible,reviewExpiresAt:past});
  await denied(()=>getDoc(doc(bob,invite)));
  await seed(groupAccess('qa-bob'),groupEligible);
  await granted(()=>getDoc(doc(bob,invite)));

  // Suspensao administrativa bloqueia leituras e queries preexistentes.
  await seed('app_config/chat_groups',{...groups,enabled:false});
  await denied(()=>getDoc(doc(bob,invite)));
  await denied(()=>getDocs(ownInvites(bob)));
  await seed('app_config/chat_groups',groups);
  await seed('app_config/conversations',{...conversations,enabled:false});
  await denied(()=>getDoc(doc(bob,invite)));
  await denied(()=>getDocs(ownInvites(bob)));
  await seed('app_config/conversations',conversations);
  await granted(()=>getDocs(ownInvites(bob)));

  // Cliente nao le prova alheia ou concede propria maioridade.
  await denied(()=>getDoc(doc(bob,agePath('qa-alice'))));
  await denied(()=>setDoc(doc(bob,agePath('qa-bob')),age18));

  console.log('QA INVITES '+mode+': '+checks+
    ' cenarios positivos e negativos aprovados (somente emulador).');
}finally{
  await env.cleanup();
}
