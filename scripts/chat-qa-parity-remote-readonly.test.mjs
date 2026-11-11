import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compareQaRemoteSnapshot,checkQaRemoteParityReadOnly}
 from './chat-qa-parity-remote-readonly.mjs';
const read=p=>readFileSync(new URL(p,import.meta.url),'utf8');
const sources={
 base:read('../firestore.rules'),
 chat:read('../firebase/atrio-conversas-v1.rules.fragment'),
 group:read('../firebase/atrio-grupos-v1.rules.fragment')
};
const sample={
 status:'QA_REAL_DENY_ALL_CONFIRMED',
 project:'atrio-catolico-qa-geral',
 android_package:'br.com.atriocatolico.chatqa',
 remote_ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/1',
 rules_sha256:'a'.repeat(64),
 remote_project_and_app_verified:true,
 remote_firestore_rules_verified:true,
 remote_rules_deny_all:true,
 ready_for_activation:false,
 audit_time_local:'2026-11-11T22:00:00.000Z',
 production_contacted:false,changes_performed:false
};

test('GET remoto QA deny-all não implica Rules candidatas implantadas',()=>{
 const report=compareQaRemoteSnapshot(sample,sources);
 assert.equal(report.status,'QA_REMOTE_DENY_ALL_CURRENTLY_OBSERVED');
 assert.equal(report.remote_rules_deny_all,true);
 assert.equal(report.candidate_is_published_in_qa,false);
 assert.equal(report.ready_for_activation,false);
 assert.equal(report.snapshot_is_historical_after_read,true);
 assert.equal(report.comparison_with_production_rules_performed,false);
 assert.equal(report.production_contacted,false);
 assert.equal(report.deploy_performed,false);
 assert.equal(report.remote_rules_sha256,sample.rules_sha256);
 assert.match(report.offline_parity_candidate_sha256,/^[a-f0-9]{64}$/);
 assert.equal(Object.isFrozen(report),true);
});
test('alvo remoto errado, falsa aprovação e mudança para Rules abertas falham fechado',()=>{
 const mutated=[
  {project:'atrio-catolico'},
  {android_package:'br.com.atriocatolico'},
  {status:'QA_REAL_RULES_NOT_DENY_ALL'},
  {remote_rules_deny_all:false},
  {remote_firestore_rules_verified:false},
  {remote_project_and_app_verified:false},
  {remote_ruleset_name:'projects/atrio-catolico/rulesets/1'},
  {rules_sha256:'not-a-hash'},
  {ready_for_activation:true},
  {changes_performed:true},
  {production_contacted:true}
 ];
 for(const patch of mutated){
  assert.throws(()=>compareQaRemoteSnapshot({...sample,...patch},sources),
   /qa_parity_remote_remote_snapshot_invalid/,JSON.stringify(patch));
 }
});
test('alteração das Rules Git fixadas é recusada, sem acessar Firebase',()=>{
 assert.throws(()=>compareQaRemoteSnapshot(sample,{...sources,base:sources.base+'\n//mudou'}),
  /qa_parity_remote_offline_candidate_invalid/);
});
test('auditoria injetada somente de leitura alimenta a comparação, sem nuvem',async()=>{
 let count=0;
 const result=await checkQaRemoteParityReadOnly({auditor:async()=>{
  count++;return structuredClone(sample);
 }});
 assert.equal(count,1);
 assert.equal(result.remote_rules_deny_all,true);
 assert.equal(result.remote_state_changed,false);
});
