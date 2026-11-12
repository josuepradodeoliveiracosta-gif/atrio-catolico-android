#!/usr/bin/env node
// Plano HISTORICO, SOMENTE OFFLINE. Nao consulta nuvem, nao faz deploy nem rollback.
// Evidencia do operador no Termux, nao medicao feita pela CI.
import {fileURLToPath} from 'node:url';

export const OBSERVED_IAM_QA=Object.freeze({
  project:'atrio-catolico-qa-geral',
  android_package:'br.com.atriocatolico.chatqa',
  status:'QA_IAM_PERMISSION_SNAPSHOT_ONLY',
  rules_sha256:'cd5089e4e5116dbb994013dc5fd5e7e411ec348935b8d06d13acd00173cca15b',
  ruleset_name:'projects/atrio-catolico-qa-geral/rulesets/1d6b6a71-6d95-48cc-98fe-7bd16c71b3bc',
  can_read_rules_in_qa:true,
  may_have_publish_permissions_in_qa:true,
  checked_permissions_count:5,
  granted_permissions_count:5,
  permission_check_method:'POST_testIamPermissions_NO_MUTATION',
  changes_performed:false,
  production_contacted:false,
  permissions_do_not_prove_production_isolation:true,
  ready_for_activation:false
});
const fail=()=>{throw Error('qa_rollback_reference_untrusted_or_modified');};

export function prepareQaRollbackReference(observation=OBSERVED_IAM_QA){
  const expected=OBSERVED_IAM_QA;
  if(!observation || typeof observation!=='object' ||
     Array.isArray(observation) ||
     Object.keys(observation).length!==Object.keys(expected).length ||
     Object.keys(expected).some(key=>!Object.hasOwn(observation,key) ||
       observation[key]!==expected[key]))fail();
  return Object.freeze({
    status:'HISTORICAL_QA_RULESET_REFERENCE_ONLY_NO_GO',
    project:expected.project,
    android_package:expected.android_package,
    release_name:'projects/atrio-catolico-qa-geral/releases/cloud.firestore',
    observed_baseline_ruleset_name:expected.ruleset_name,
    observed_baseline_sha256:expected.rules_sha256,
    evidence_source:'OPERATOR_TERMUX_SCREENSHOT_2026_11_11',
    reference_is_historical:true,
    baseline_may_have_changed_since_observation:true,
    reconstructed_deny_all_is_not_exact_remote_backup:true,
    observed_iam_permissions_count:expected.granted_permissions_count,
    observed_iam_permissions_are_not_deploy_approval:true,
    isolated_production_permissions_not_verified:true,
    rollback_target_existence_now_unverified:true,
    old_ruleset_must_be_retrieved_and_hashed_before_use:true,
    live_release_must_be_rechecked_before_rollout:true,
    rollout_and_rollback_require_separate_approval:true,
    rollback_requires_post_action_readonly_verification:true,
    firebase_rules_propagation_must_be_accounted_for:true,
    precise_rollback_authorization_recorded:false,
    deploy_performed:false,
    rollback_performed:false,
    remote_state_changed:false,
    production_contacted:false,
    ready_for_deploy:false,
    safe_to_activate_qa:false,
    blockers:Object.freeze([
      'Revalidar projeto, release e ruleset remoto QA antes de qualquer publicacao.',
      'Confirmar que o ruleset anterior existe e bate com SHA256 historico.',
      'Registrar identificador imediatamente anterior ao rollout e obter autorizacao especifica.',
      'Acompanhar propagacao e verificar a release realmente publicada apos reversao autorizada.',
      'Fechar issue 200, privacidade, moderacao, retencao, testes e autorizacoes.'
    ])
  });
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)fail();
    console.log(JSON.stringify(prepareQaRollbackReference(),null,2));
  }catch{
    console.error('qa_rollback_reference_untrusted_or_modified');
    process.exitCode=1;
  }
}
