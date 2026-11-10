// Átrio QA: testes Firestore Emulator SEM conexão a Firebase real.
// Privacidade de protocolos e revogação de função administrativa;
// NÃO implementa triagem, SLA, sanção, retenção ou política humana.
import {readFileSync} from 'node:fs';
import {initializeTestEnvironment,assertFails,assertSucceeds}
  from '@firebase/rules-unit-testing';
import {
  doc,collection,getDoc,getDocs,setDoc,updateDoc,deleteDoc,
  serverTimestamp,Timestamp
} from 'firebase/firestore';

const mode=process.argv[2];
if(!['standalone','parity'].includes(mode))
  throw Error('qa_moderation_variant_required');
const rules=readFileSync(mode==='standalone'?
  'qa-general.generated.rules':'qa-parity.generated.rules','utf8');
if(!rules.includes('match /chat_reports/{reportId}') ||
   !rules.includes('match /chat_group_reports/{reportId}') ||
   !rules.includes('qaChatAge18Eligible') ||
   !rules.includes('allow update, delete: if false;'))
  throw Error('qa_moderation_rules_mismatch');

const env=await initializeTestEnvironment({
  projectId:'demo-atrio-v11',
  firestore:{host:'127.0.0.1',port:8089,rules}
});
const alice=env.authenticatedContext('qa-alice',{email_verified:true}).firestore();
const bob=env.authenticatedContext('qa-bob',{email_verified:true}).firestore();
const outsider=env.authenticatedContext('qa-outsider',{email_verified:true}).firestore();
const moderator=env.authenticatedContext('qa-moderator',{email_verified:true}).firestore();
const guest=env.unauthenticatedContext().firestore();
const chat='chats/qa-alice__qa-bob';
const group='chat_groups/qa-private-group';
const chatReport='chat_reports/qa-alice__qa-alice__qa-bob__first';
const groupReport='chat_group_reports/qa-alice__qa-private-group__first';
const agePath=uid=>'users/'+uid+'/chatAgeEligibility/current';
const groupEligibility=uid=>'users/'+uid+'/chatGroupAccess/eligibility';
const future=Timestamp.fromDate(new Date('2035-01-01T00:00:00Z'));
const createdAt=Timestamp.fromDate(new Date('2026-11-01T00:00:00Z'));
const age18={status:'eligible',minimumAge:18,
  policyVersion:'2026-11-18plus-qa-v1',reviewExpiresAt:future};
const groupApproved={status:'approved',
  policyVersion:'2026-11-group-safety-v1',reviewExpiresAt:future};
const groupConfig={enabled:true,version:'2026-11-groups-v1',minorPolicyApproved:true};
const chatConfig={enabled:true,version:'2026-11-v1',
  minorPolicyApproved:true,safetyReviewVersion:'2026-11-safety-v1'};
const text='Mensagem ficticia, somente QA';
let scenarios=0;
const passes=async fn=>{await assertSucceeds(fn());scenarios++;};
const rejects=async fn=>{await assertFails(fn());scenarios++;};
const adminSeed=async fn=>env.withSecurityRulesDisabled(async ctx=>fn(ctx.firestore()));
const chatPayload=(messageId,extra={})=>({
  chatId:'qa-alice__qa-bob',messageId,reporterUid:'qa-alice',
  reason:'Protocolo de teste para moderacao',reportedText:text,
  createdAt:serverTimestamp(),...extra
});
const groupPayload=(messageId,extra={})=>({
  groupId:'qa-private-group',messageId,reporterUid:'qa-alice',
  reason:'Protocolo de teste para moderacao',reportedText:text,
  createdAt:serverTimestamp(),...extra
});
const chatCase=id=>'chat_reports/qa-alice__qa-alice__qa-bob__'+id;
const groupCase=id=>'chat_group_reports/qa-alice__qa-private-group__'+id;

try{
  await env.clearFirestore();
  // Ausência de documentos não é autorização nem positiva falsa.
  await rejects(()=>getDoc(doc(alice,chat)));
  await rejects(()=>getDoc(doc(moderator,chatReport)));

  await adminSeed(async db=>{
    await setDoc(doc(db,'app_config/conversations'),chatConfig);
    await setDoc(doc(db,'app_config/chat_groups'),groupConfig);
    for(const uid of ['qa-alice','qa-bob','qa-moderator','qa-outsider']){
      await setDoc(doc(db,agePath(uid)),age18);
    }
    await setDoc(doc(db,groupEligibility('qa-alice')),groupApproved);
    await setDoc(doc(db,chat),{
      participants:['qa-alice','qa-bob'],requesterUid:'qa-alice',
      recipientUid:'qa-bob',status:'accepted'
    });
    await setDoc(doc(db,group),{
      ownerUid:'qa-alice',memberUids:['qa-alice'],
      adminUids:['qa-alice'],status:'active'
    });
    for(const id of ['first','second','third']){
      await setDoc(doc(db,chat+'/messages/'+id),{
        uid:'qa-alice',kind:'text',text,createdAt
      });
      await setDoc(doc(db,group+'/messages/'+id),{
        uid:'qa-alice',kind:'text',text,createdAt
      });
    }
    await setDoc(doc(db,chatReport),{
      chatId:'qa-alice__qa-bob',messageId:'first',
      reporterUid:'qa-alice',reason:'Denuncia QA criada por fixture',
      reportedText:text,createdAt
    });
    await setDoc(doc(db,groupReport),{
      groupId:'qa-private-group',messageId:'first',
      reporterUid:'qa-alice',reason:'Denuncia QA criada por fixture',
      reportedText:text,createdAt
    });
    await setDoc(doc(db,'admins/qa-moderator'),{enabled:true});
  });

  // Cada pessoa enxerga SOMENTE o próprio protocolo. Integrantes do
  // mesmo chat não herdam leitura do protocolo que outro criou.
  await passes(()=>getDoc(doc(alice,chatReport)));
  await passes(()=>getDoc(doc(alice,groupReport)));
  for(const db of [bob,outsider,guest]){
    await rejects(()=>getDoc(doc(db,chatReport)));
    await rejects(()=>getDoc(doc(db,groupReport)));
  }
  await rejects(()=>getDocs(collection(alice,'chat_reports')));
  await rejects(()=>getDocs(collection(alice,'chat_group_reports')));
  await rejects(()=>getDocs(collection(bob,'chat_reports')));
  await rejects(()=>getDocs(collection(bob,'chat_group_reports')));

  // A função de moderador concede acesso aos PROTOCOLOS, não a
  // mensagens ou à caixa de entrada do usuário, mesmo com admin ativo.
  await passes(()=>getDoc(doc(moderator,chatReport)));
  await passes(()=>getDoc(doc(moderator,groupReport)));
  await passes(()=>getDocs(collection(moderator,'chat_reports')));
  await passes(()=>getDocs(collection(moderator,'chat_group_reports')));
  await rejects(()=>getDoc(doc(moderator,chat)));
  await rejects(()=>getDoc(doc(moderator,chat+'/messages/first')));
  await rejects(()=>getDoc(doc(moderator,group)));
  await rejects(()=>getDoc(doc(moderator,group+'/messages/first')));
  await rejects(()=>setDoc(doc(moderator,'admins/qa-moderator'),{enabled:true}));
  await rejects(()=>setDoc(doc(outsider,'admins/qa-outsider'),{enabled:true}));

  // Remover a função revoga IMEDIATAMENTE get/list dos protocolos.
  await adminSeed(db=>setDoc(doc(db,'admins/qa-moderator'),{enabled:false}));
  await rejects(()=>getDoc(doc(moderator,chatReport)));
  await rejects(()=>getDoc(doc(moderator,groupReport)));
  await rejects(()=>getDocs(collection(moderator,'chat_reports')));
  await rejects(()=>getDocs(collection(moderator,'chat_group_reports')));
  // Revogar o moderador não apaga a denúncia do titular.
  await passes(()=>getDoc(doc(alice,chatReport)));
  await passes(()=>getDoc(doc(alice,groupReport)));
  await adminSeed(db=>setDoc(doc(db,'admins/qa-moderator'),{enabled:true}));
  await passes(()=>getDoc(doc(moderator,chatReport)));
  await passes(()=>getDoc(doc(moderator,groupReport)));

  // Criar protocolos legítimos confirma que os testes negativos não
  // estão passando só porque o ambiente rejeita todas as operações.
  await passes(()=>setDoc(doc(alice,chatCase('second')),chatPayload('second')));
  await passes(()=>setDoc(doc(alice,groupCase('second')),groupPayload('second')));
  // Documento criado é imutável pelo cliente e por moderador.
  await rejects(()=>updateDoc(doc(alice,chatCase('second')),{reason:'Alterado'}));
  await rejects(()=>deleteDoc(doc(alice,groupCase('second'))));
  await rejects(()=>updateDoc(doc(moderator,groupCase('second')),{reason:'Alterado'}));
  await rejects(()=>deleteDoc(doc(moderator,chatCase('second'))));

  // Campos extras, autor falso, texto inexistente e identidade de
  // mensagem trocada jamais podem criar uma denúncia forjada.
  await rejects(()=>setDoc(doc(alice,chatCase('third')),
    chatPayload('third',{reportedText:'Conteudo adulterado'})));
  await rejects(()=>setDoc(doc(alice,groupCase('third')),
    groupPayload('third',{reportedText:'Conteudo adulterado'})));
  await rejects(()=>setDoc(doc(alice,chatCase('third')),
    chatPayload('third',{internalModeratorNotes:'campo proibido'})));
  await rejects(()=>setDoc(doc(alice,groupCase('third')),
    groupPayload('third',{legalHold:false})));
  await rejects(()=>setDoc(doc(bob,chatCase('third')),chatPayload('third')));
  await rejects(()=>setDoc(doc(outsider,groupCase('third')),groupPayload('third')));

  // Revogar elegibilidade 18+ fecha novas denúncias, mas conserva
  // os protocolos antigos para titular e moderador habilitado.
  await adminSeed(db=>setDoc(doc(db,agePath('qa-alice')),
    {...age18,status:'revoked'}));
  await rejects(()=>setDoc(doc(alice,chatCase('third')),chatPayload('third')));
  await rejects(()=>setDoc(doc(alice,groupCase('third')),groupPayload('third')));
  await passes(()=>getDoc(doc(alice,chatReport)));
  await passes(()=>getDoc(doc(alice,groupReport)));
  await passes(()=>getDoc(doc(moderator,chatReport)));
  await adminSeed(db=>setDoc(doc(db,agePath('qa-alice')),age18));

  // Desativar chat e grupos deve preservar a leitura dos protocolos
  // mas NÃO aceitar novas denúncias durante contenção.
  await adminSeed(db=>setDoc(doc(db,'app_config/conversations'),
    {...chatConfig,enabled:false}));
  await rejects(()=>setDoc(doc(alice,chatCase('third')),chatPayload('third')));
  await rejects(()=>setDoc(doc(alice,groupCase('third')),groupPayload('third')));
  await passes(()=>getDoc(doc(alice,chatReport)));
  await passes(()=>getDoc(doc(moderator,groupReport)));
  await adminSeed(db=>setDoc(doc(db,'app_config/conversations'),chatConfig));
  await passes(()=>setDoc(doc(alice,chatCase('third')),chatPayload('third')));
  await passes(()=>setDoc(doc(alice,groupCase('third')),groupPayload('third')));

  console.log('QA MODERATION '+mode+': '+scenarios+
    ' verificacoes de autorizacao, revogacao, antifraude e preservacao aprovadas.');
}finally{
  await env.cleanup();
}
