/**
 * Read-only status report for the Google Play closed testing track.
 *
 * Does not upload AABs, use secrets, query Google Play/Cloudflare/Firebase,
 * change the release manifest, or grant publication authorization.
 */
import {readFileSync,existsSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {assessPrivacyEvidence,REQUIREMENTS} from './play_privacy_gate.mjs';
import {qaCoverageSummary,QA_MUTATION_ROUTES,QA_OPEN_WRITE_GAPS}
  from '../cloudflare/account-deletion-audit/src/qa-worker-coverage-contract.js';

const ROOT=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const PATHS=Object.freeze({
  evidence:'docs/google-play-privacidade-evidencias.json',
  privacyDraft:'docs/google-play-politica-privacidade-minuta-nao-publicar.md',
  safetyReview:'docs/google-play-seguranca-dados-matriz-revisao.md',
  mainManifest:'app/src/main/AndroidManifest.xml',
  playManifest:'app/src/playRelease/AndroidManifest.xml',
  playBuild:'app/build.gradle.kts',
  webConfig:'web/account-deletion/config.js',
  stageConfig:'cloudflare/privacy-freeze-stage/wrangler.toml',
  stageExample:'cloudflare/privacy-freeze-stage/wrangler.staging.example.toml'
});
function noSecrets(text){
  return !/(?:password|token|api_?key|secret)\s*[=:]\s*["'][^"']+["']/i.test(text);
}
function hasOwn(o,k){return Object.prototype.hasOwnProperty.call(o,k)}
export function assessClosedTrack({
  evidence,files={},isActive=null
}={}){
  const privacy=assessPrivacyEvidence(evidence);
  const present=(key)=>hasOwn(files,key)&&typeof files[key]==='string';
  const blocked=[];
  const runtimeCoverage=qaCoverageSummary();
  if(runtimeCoverage.unprotectedWriteEntries>0||
     !runtimeCoverage.frozenAccountsProtectedInProduction)
    blocked.push('worker_mutation_freeze_not_integrated:'+
      runtimeCoverage.unprotectedWriteEntries+'/'+runtimeCoverage.namedWriteEntries);
  if(runtimeCoverage.openGaps>0)
    blocked.push('worker_privileged_write_gaps:'+runtimeCoverage.openGaps);
  if(!privacy.ready)blocked.push('privacy_evidence:'+privacy.pending.join(','));
  if(!present('privacyDraft')||
    !/NÃO PUBLICAR/.test(files.privacyDraft))
    blocked.push('policy_review_draft_missing_or_unsafe');
  if(!present('safetyReview')||
    !/NÃO PREENCHER O FORMULÁRIO COMO DEFINITIVO/.test(files.safetyReview))
    blocked.push('data_safety_review_missing_or_unsafe');
  const mainHasInstallPermission=present('mainManifest')&&
    /<uses-permission\\b[^>]*android:name=["']android\\.permission\\.REQUEST_INSTALL_PACKAGES["']/.test(files.mainManifest);
  const playRemovesInstallPermission=present('playManifest')&&
    /<uses-permission\\b[^>]*android:name=["']android\\.permission\\.REQUEST_INSTALL_PACKAGES["'][^>]*tools:node=["']remove["']/.test(files.playManifest);
  if(!playRemovesInstallPermission)
    blocked.push('play_manifest_permission_overlay_not_verified');
  if(mainHasInstallPermission&&!playRemovesInstallPermission)
    blocked.push('sideload_install_permission_may_reach_play_aab');
  if(!present('playBuild')||!/targetSdk\s*=\s*36/.test(files.playBuild))
    blocked.push('target_sdk_36_not_in_this_branch');
  if(present('webConfig'))blocked.push('web_request_config_active_unverified');
  if(present('stageConfig'))blocked.push('cloudflare_stage_deploy_config_present');
  if(!present('stageExample')||
    !/REPLACE_WITH_NEW_DEDICATED_STAGING_D1_ID/.test(files.stageExample))
    blocked.push('cloudflare_stage_template_missing_or_not_isolated');
  const verification={
    playConsoleVerified:false,
    signedAabVerified:false,
    publicPolicyReachabilityVerified:false,
    publicDeletionReachabilityVerified:false,
    realDeletionExecutorVerified:false,
    productionWorkerFreezeVerified:false,
    remoteCloudflareStageVerified:false
  };
  // Only standalone Play Console and backend evidence can verify these
  // later. The local source alone is never sufficient.
  return Object.freeze({
    channel:'closed-testing',
    releaseAuthorized:privacy.releaseAuthorized,
    eligibleForUpload:false,
    blocked:true,
    sourceRequirements:REQUIREMENTS.length,
    verifiedRequirements:REQUIREMENTS.length-privacy.pending.length,
    outstandingRequirements:privacy.pending,
    permissionReview:Object.freeze({
      otaInstallPermissionInMain:mainHasInstallPermission,
      playManifestRemovesOtaInstallPermission:playRemovesInstallPermission,
      mergedAabManifestAudited:false
    }),
    blockers:Object.freeze(blocked),
    workerMutationCoverage:Object.freeze({
      namedWriteEntries:runtimeCoverage.namedWriteEntries,
      protectedProductionEntries:runtimeCoverage.namedWriteEntries-
        runtimeCoverage.unprotectedWriteEntries,
      unprotectedEntries:runtimeCoverage.unprotectedWriteEntries,
      openWriteGaps:runtimeCoverage.openGaps,
      productionIntegrated:runtimeCoverage.productionIntegrated,
      perService:Object.freeze(['avatar','guardian','push'].map(service=>
        Object.freeze({
          service,
          named:QA_MUTATION_ROUTES.filter(x=>x.service===service).length,
          unprotected:QA_MUTATION_ROUTES.filter(x=>x.service===service&&
            x.state!=='integrated').length
        }))),
      // Detailed gap labels are local code-review references, never proof
      // that a callsite is actually fenced in a deployed Worker.
      reviewGapLabels:Object.freeze([...QA_OPEN_WRITE_GAPS])
    }),
    externalVerification:verification,
    note:'Source review only; signed AAB, Play Console and live services not inspected.'
  });
}
export function inspectCheckedInClosedTrack(root=ROOT){
  const files={};
  for(const [key,relative] of Object.entries(PATHS)){
    const path=resolve(root,relative);
    if(existsSync(path))files[key]=readFileSync(path,'utf8');
  }
  if(!files.evidence)throw Error('play_evidence_manifest_missing');
  const evidence=JSON.parse(files.evidence);
  delete files.evidence;
  return assessClosedTrack({evidence,files});
}
const isEntry=process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url);
if(isEntry){
  try{
    const arg=process.argv[2]||'--audit';
    if(!['--audit','--json','--enforce'].includes(arg)||process.argv.length>3)
      throw Error('modo_invalido');
    const state=inspectCheckedInClosedTrack();
    if(arg==='--json')console.log(JSON.stringify(state,null,2));
    else{
      console.log('Google Play — testes fechados: BLOQUEADO');
      console.log('Requisitos de privacidade:',state.verifiedRequirements+'/'+state.sourceRequirements);
      console.log('Pendências de fonte:',state.blockers.join('; '));
      console.log('Inspeção externa ausente: Play Console, AAB assinado e portal HTTPS.');
    }
    if(arg==='--enforce')process.exitCode=2;
  }catch(err){
    console.error('ERRO DE AUDITORIA: '+err.message);
    process.exitCode=1;
  }
}
