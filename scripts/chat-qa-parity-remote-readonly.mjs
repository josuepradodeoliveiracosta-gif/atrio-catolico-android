#!/usr/bin/env node
/**
 * COMPARAÇÃO REMOTA SOMENTE QA — quatro GETs autenticados existentes.
 * Não consulta produção, não grava, não revela credenciais nem aplica Rules.
 * O hash da base Git NÃO comprova paridade com as Rules de produção.
 * Deve ser invocado manualmente no Termux quando houver revisão autorizada.
 */
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {auditQaRealReadOnly}
 from './termux-firebase-qa-audit-readonly.mjs';
import {renderClosedQaParity}
 from '../firebase/qa-general/closed-qa-parity.mjs';
const PROJECT='atrio-catolico-qa-geral';
const PACKAGE='br.com.atriocatolico.chatqa';
const fail=code=>{throw Error('qa_parity_remote_'+code);};
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');

export function compareQaRemoteSnapshot(audit,{base,chat,group}){
 if(!audit||typeof audit!=='object'||
    audit.project!==PROJECT||audit.android_package!==PACKAGE||
    audit.status!=='QA_REAL_DENY_ALL_CONFIRMED'||
    audit.remote_project_and_app_verified!==true||
    audit.remote_firestore_rules_verified!==true||
    audit.remote_rules_deny_all!==true||
    audit.ready_for_activation!==false||
    audit.production_contacted!==false||
    audit.changes_performed!==false||
    !/^projects\/atrio-catolico-qa-geral\/rulesets\/[A-Za-z0-9_-]{1,120}$/.test(audit.remote_ruleset_name||'')||
    !/^[a-f0-9]{64}$/.test(audit.rules_sha256||'')||
    typeof audit.audit_time_local!=='string'||
    Number.isNaN(Date.parse(audit.audit_time_local)))fail('remote_snapshot_invalid');
 let candidate;
 try{candidate=renderClosedQaParity(base,chat,group);}
 catch{fail('offline_candidate_invalid');}
 const candidateHash=sha256(candidate);
 if(candidateHash===audit.rules_sha256)fail('candidate_must_not_equal_denyall');
 return Object.freeze({
  status:'QA_REMOTE_DENY_ALL_CURRENTLY_OBSERVED',
  project:PROJECT,android_package:PACKAGE,
  remote_ruleset_name:audit.remote_ruleset_name,
  remote_rules_sha256:audit.rules_sha256,
  offline_parity_candidate_sha256:candidateHash,
  candidate_is_published_in_qa:false,
  remote_rules_deny_all:true,
  operator_read_time:audit.audit_time_local,
  snapshot_is_historical_after_read:true,
  comparison_with_production_rules_performed:false,
  four_qa_gets_only:true,
  remote_state_changed:false,
  production_contacted:false,
  deploy_performed:false,
  ready_for_activation:false
 });
}

export async function checkQaRemoteParityReadOnly({auditor=auditQaRealReadOnly}={}){
 const audit=await auditor();
 return compareQaRemoteSnapshot(audit,{
  base:read('../firestore.rules'),
  chat:read('../firebase/atrio-conversas-v1.rules.fragment'),
  group:read('../firebase/atrio-grupos-v1.rules.fragment')
 });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==2)fail('arguments_denied');
  console.log(JSON.stringify(await checkQaRemoteParityReadOnly(),null,2));
 }catch(error){
  console.error(/^qa_parity_remote_[a-z0-9_]+$/.test(error?.message||'')
   ? error.message : 'qa_parity_remote_stopped_failed_closed');
  process.exitCode=1;
 }
}
