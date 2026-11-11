#!/usr/bin/env node
/**
 * Planejamento OFFLINE de pré-ativação: não faz chamadas HTTP, não toca
 * Firebase, Cloudflare, GitHub, segredos ou dados de usuários.
 * A referência deny-all é uma política RECONSTRUÍDA, não um backup exato
 * do Ruleset remoto; um rollback real exige aprovação e verificação.
 */
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {renderSelfDeclarationRules} from '../firebase/qa-general/self-declaration-candidate.mjs';

const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
export const AUDITED_SNAPSHOT=Object.freeze({
  project:PROJECT,android_package:PACKAGE,
  status:'QA_REAL_DENY_ALL_CONFIRMED',
  audit_time_local:'2026-11-11T01:16:22.664Z',
  rules_sha256:'cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b',
  remote_project_and_app_verified:true,
  remote_firestore_rules_verified:true,remote_rules_deny_all:true,
  ready_for_activation:false,production_contacted:false,
  changes_performed:false,source:'screenshot_do_operador'
});
const hash=text=>createHash('sha256').update(text,'utf8').digest('hex');
const compact=text=>text.replace(/\/\*[\s\S]*?\*\//g,'')
 .replace(/\/\/[^\r\n]*/g,'').replace(/\s+/g,'');
const DENY_CANONICAL=compact([
 "rules_version = '2';",
 'service cloud.firestore {',
 'match /databases/{database}/documents {',
 'match /{document=**} {',
 'allow read, write: if false;',
 '}', '}', '}'
].join('\n'));
const fail=code=>{throw Error('qa_activation_plan_'+code);};
// Git blob SHA fixa a revisão dos fragmentos usados: alterações exigem
// reavaliação humana e atualização explícita dos valores esperados.
const gitBlobSha=src=>createHash('sha1')
  .update('blob '+Buffer.byteLength(src,'utf8')+String.fromCharCode(0),'utf8')
  .update(src,'utf8').digest('hex');
const EXPECTED_CHAT_BLOB='1a5a37c3e69a4a08839adf9f294e7aa0ea081113';
const EXPECTED_GROUP_BLOB='400b09a061a98bb606e95fa68c6becee2202629b';

export function evaluateOfflinePreparation({chat,group,rollback,evidence=AUDITED_SNAPSHOT}={}){
  if(typeof chat!=='string'||typeof group!=='string'||
     typeof rollback!=='string')fail('source_unavailable');
  if(compact(rollback)!==DENY_CANONICAL)fail('rollback_not_deny_all');
  if(gitBlobSha(chat)!==EXPECTED_CHAT_BLOB)fail('chat_fragment_changed');
  if(gitBlobSha(group)!==EXPECTED_GROUP_BLOB)fail('group_fragment_changed');
  if(!evidence||typeof evidence!=='object'||
     evidence.project!==PROJECT||evidence.android_package!==PACKAGE||
     evidence.status!=='QA_REAL_DENY_ALL_CONFIRMED'||
     evidence.rules_sha256!==AUDITED_SNAPSHOT.rules_sha256||
     evidence.audit_time_local!==AUDITED_SNAPSHOT.audit_time_local||
     evidence.remote_project_and_app_verified!==true||
     evidence.remote_firestore_rules_verified!==true||
     evidence.remote_rules_deny_all!==true||
     evidence.ready_for_activation!==false||
     evidence.production_contacted!==false||
     evidence.changes_performed!==false)fail('snapshot_mismatch');
  let candidate;
  try{candidate=renderSelfDeclarationRules(chat,group);}
  catch{fail('candidate_generation_changed');}
  const required=[
    "rules_version = '2';",
    'function emailVerificationAllowsCommunityAccess()',
    'emailVerificationAllowsCommunityAccess() && qaChatAge18Eligible(request.auth.uid)',
    "proof.get('status','') == 'declared_18_plus'",
    "proof.get('policyVersion','') == '2026-11-selfdecl-qa-v1'",
    "request.resource.data.status == 'declared_18_plus'",
    'qaChatAge18Eligible(request.resource.data.recipientUid)',
    'match /users/{uid}/chatAgeEligibility/current',
    'match /chats/{chatId}',
    'match /chat_groups/{groupId}',
    "eligibility.get('status','') == 'approved'",
    'minorPolicyApproved'
  ];
  if(required.some(entry=>!candidate.includes(entry)) ||
    /allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(candidate)||
    !candidate.includes('match /{document=**} {\n      allow read, write: if false;'))
      fail('candidate_gate_changed');
  return Object.freeze({
    project:PROJECT,android_package:PACKAGE,
    mode:'LOCAL_PLAN_ONLY_NO_DEPLOY',
    audited_baseline_sha256:evidence.rules_sha256,
    audited_baseline_at:evidence.audit_time_local,
    snapshot_not_current_state:true,
    candidate_rules_sha256:hash(candidate),
    rollback_reference_sha256:hash(rollback),
    rollback_reference_is_exact_remote_backup:false,
    rollback_reference_is_deny_all:true,
    candidate_includes_group_rules:true,
    group_access_admin_gate_present:true,
    notifications_worker_compatible:false,
    push_enabled:false,
    groups_approved_for_activation:false,
    production_contacted:false,
    deploy_performed:false,
    ready_for_deploy:false,
    blockers:[
      'aprovar escopo privacidade/moderacao/retencao issue 200',
      'auditar IAM e autorizacao para publicar no projeto QA',
      'capturar identificador exato do Ruleset QA atual e confirmar restauracao',
      'confirmar novamente baseline remoto imediatamente antes de publicar',
      'tratar escrita assincrona da declaracao sem falsa promessa de acesso',
      'manter Worker FCM e grupos desligados ate compatibilidade e aprovacao',
      'obter autorizacao especifica para ativacao QA e plano de reversao'
    ]
  });
}
function prepare(){
 const read=relative=>readFileSync(new URL(relative,import.meta.url),'utf8');
 return evaluateOfflinePreparation({
   chat:read('../firebase/atrio-conversas-v1.rules.fragment'),
   group:read('../firebase/atrio-grupos-v1.rules.fragment'),
   rollback:read('../firebase/qa-general/qa-deny-all-reference.rules')
 });
}
export {prepare as prepareOfflineQaActivation};
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)fail('arguments_denied');
    console.log(JSON.stringify(prepare(),null,2));
  }catch(e){
    console.error(/^qa_activation_plan_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'qa_activation_plan_failed_closed');
    process.exitCode=1;
  }
}
