/**
 * Read-only review ordering for the 43-source Termux worksheet.
 * IDs are schema identifiers, NEVER user values. No retention decision,
 * reviewer authentication, production call, or deletion authorization.
 */
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {retentionReviewRegistry} from './qa-retention-source-registry.js';
import {auditRetentionWorksheet} from './qa-retention-worksheet.js';

const group=(id,title,priority,question,ids)=>Object.freeze({
  id,title,priority,question,ids:Object.freeze(ids)
});
export const RETENTION_REVIEW_GROUPS=Object.freeze([
  group('identidade_exclusao','Identidade e exclusão',1,
    'Confirmar titularidade, escopo da conta e destino de pedidos, travas e privilégios.',[
    'external:firebase_auth',
    'firestore:/account_deletion_requests/{uid}',
    'firestore:/account_deletion_freeze/{uid}',
    'firestore:/profiles/{uid}',
    'firestore:/admins/{uid}',
    'firestore:/app_config/founder'
  ]),
  group('conteudo_religiao','Conteúdo e dados religiosos',1,
    'Rever visibilidade, dados religiosos sensíveis, participação de terceiros e anonimização.',[
    'firestore:/public_profiles/{uid}',
    'firestore:/badges/{uid}',
    'firestore:/badge_requests/{uid}',
    'firestore:/posts/{postId}',
    'firestore:/replies/{replyId}',
    'firestore:/reactions/{uid}',
    'firestore:/users/{uid}/acceptedTerms/{version}'
  ]),
  group('moderacao_terceiros','Denúncias e moderação',1,
    'Decidir retenção de provas, proteção de denunciantes e direitos dos terceiros envolvidos.',[
    'firestore:/user_reports/{reportId}',
    'firestore:/reports/{reportId}',
    'firestore:/guardian_cases/{caseId}',
    'firestore:/guardian_audit/{auditId}',
    'firestore:/guardiao_quarantine/{caseId}',
    'firestore:/guardian_runtime/{id}',
    'firestore:/guardian_notices/{uid}',
    'firestore:/items/{noticeId}',
    'd1:avatar:avatar_moderation'
  ]),
  group('notificacoes','Notificações e Push',2,
    'Confirmar ciclo de vida dos tokens FCM, eventos identificáveis e métricas potencialmente correlacionáveis.',[
    'firestore:/users/{uid}/pushDevices/{deviceId}',
    'firestore:/users/{recipientUid}/notifications/{notificationId}',
    'd1:push:delivered',
    'd1:push:push_delivery_stats',
    'd1:push:guardiao_ai_budget',
    'external:fcm_devices'
  ]),
  group('fotografias','Fotos e Avatar',2,
    'Reconciliar Firestore, Cloudinary e D1; separar fotos próprias de registros ligados a terceiros.',[
    'firestore:/profile_photos/{uid}',
    'd1:avatar:avatar_pending',
    'd1:avatar:avatar_rate',
    'd1:avatar:avatar_mutex',
    'external:cloudinary_avatar_upload',
    'external:cloudinary_avatar_pending',
    'external:cloudinary_avatar_authenticated'
  ]),
  group('preferencias_configuracao','Preferências e configuração',3,
    'Revisar listas sociais, termos, conteúdos de configuração e referências persistentes a contas.',[
    'firestore:/users/{uid}/blockedMembers/{memberUid}',
    'firestore:/users/{uid}/likedPosts/{postId}',
    'firestore:/users/{uid}/savedPosts/{postId}',
    'firestore:/users/{uid}/followedPosts/{postId}',
    'firestore:/app_config/opening_video',
    'firestore:/app_config/engagement',
    'firestore:/app_config/community_terms',
    'firestore:/guardian_config/{configId}'
  ])
]);

function requireExactSourceCoverage(){
  const known=new Set(retentionReviewRegistry().map(row=>row.id));
  const assigned=RETENTION_REVIEW_GROUPS.flatMap(group=>group.ids);
  if(assigned.length!==known.size||new Set(assigned).size!==known.size||
     assigned.some(id=>!known.has(id)) ||
     RETENTION_REVIEW_GROUPS.some(g=>!g.ids.length||![1,2,3].includes(g.priority)))
    throw Error('qa_retention_review_group_schema_drift');
  return known.size;
}

/**
 * The private worksheet is validated, but no user's answers or IDs
 * are echoed: only schema IDs and counts leave this function.
 */
export function summarizeRetentionReviewPriorities(worksheet){
  const sourceCount=requireExactSourceCoverage();
  auditRetentionWorksheet(worksheet);
  const current=new Map(worksheet.entries.map(row=>[row.id,row]));
  const groups=RETENTION_REVIEW_GROUPS.map(g=>{
    const records=g.ids.map(id=>current.get(id));
    const pending=records.filter(x=>x.status==='pending').length;
    const inReview=records.length-pending;
    return Object.freeze({
      id:g.id,title:g.title,priority:g.priority,
      sources:g.ids.length,pending,inReview,
      nextSource:g.ids.find(id=>current.get(id).status==='pending')||null,
      reviewQuestion:g.question
    });
  });
  const totals=Object.freeze({
    sources:sourceCount,pending:groups.reduce((n,g)=>n+g.pending,0),
    inReview:groups.reduce((n,g)=>n+g.inReview,0)
  });
  return Object.freeze({
    ...totals,
    groups:Object.freeze(groups),
    reviewOnly:true,
    evidenceContentsDisclosed:false,
    retentionApproved:false,
    deletionAuthorized:false,
    playAuthorized:false
  });
}

export function formatRetentionReviewPriorities(result){
  if(!result||result.reviewOnly!==true||
     result.retentionApproved!==false||result.playAuthorized!==false||
     result.evidenceContentsDisclosed!==false||
     !Array.isArray(result.groups))
    throw Error('qa_retention_invalid_priorities_summary');
  const lines=[
    'ÁTRIO CATÓLICO — ORDEM DE REVISÃO PRIVADA',
    'Fontes: '+result.sources+' | Pendentes: '+result.pending+
       ' | Em revisão: '+result.inReview,
    'Nenhum prazo ou decisão foi aprovado.',
    ''
  ];
  for(const g of result.groups){
    lines.push('P'+g.priority+' — '+g.title+': '+
      g.pending+'/'+g.sources+' pendentes');
    if(g.pending>0){
      lines.push('  Próxima fonte: '+g.nextSource);
      lines.push('  Verificar: '+g.reviewQuestion);
    }
  }
  lines.push('','FICHA NÃO HOMOLOGADA. Exclusão e publicação permanecem bloqueadas.');
  return lines.join('\n')+'\n';
}

if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==4 || process.argv[2]!=='--review-plan')
      throw Error('usage: --review-plan /private/worksheet.json');
    const worksheet=JSON.parse(readFileSync(process.argv[3],'utf8'));
    process.stdout.write(formatRetentionReviewPriorities(
      summarizeRetentionReviewPriorities(worksheet)));
  }catch(e){
    // Never echo worksheet contents or local file paths to standard output.
    console.error('Plano de revisão bloqueado: confira a estrutura e os campos da ficha privada.');
    process.exitCode=1;
  }
}
