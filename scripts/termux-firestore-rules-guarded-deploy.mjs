#!/usr/bin/env node
/**
 * Átrio Católico — atualização controlada de SOMENTE firestore.rules.
 *
 * Por padrão faz SOMENTE inspeção. Para alterar regras use --apply
 * deliberadamente após verificar o resultado em modo inspeção.
 *
 * NÃO cria/reescreve backups, NÃO altera dados do Firestore, NÃO ativa
 * app_config/email_verification, NÃO faz deploy de Workers ou APK.
 *
 * Os dois hashes abaixo são evidência da auditoria read-only da produção
 * feita em 05/11/2026; alterações posteriores impedem automaticamente deploy.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {inspectProduction} from './email-verification-production-preflight.mjs';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

export const EXPECTED={
  project:'atrio-catolico',
  oldRulesSha256:'9c7678a7dfbadecceb30d5f770a25fb81c6f5926fedafc75e303c7e3bb3e6a02',
  newRulesSha256:'4b479daa1d4d8673c3e1e9f70a2f9d752e7df996d414aefa1397ad86661bd76e'
};

const root=fileURLToPath(new URL('../',import.meta.url));
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
const error=reason=>{throw Error('atrio_rules_deploy_'+reason);};

async function readCommunityFlag(token,fetcher){
  const url='https://firestore.googleapis.com/v1/projects/atrio-catolico/databases/(default)/documents/app_config/community_rules';
  let res;
  try{
    res=await fetcher(url,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
  }catch{error('community_policy_unavailable');}
  if(res.status===404)return 'MISSING';
  if(!res.ok)error('community_policy_unavailable');
  let doc;
  try{
    const raw=await res.text();
    if(raw.length>20000)error('community_policy_invalid');
    doc=JSON.parse(raw);
  }catch{error('community_policy_invalid');}
  if(doc?.name!=='projects/atrio-catolico/databases/(default)/documents/app_config/community_rules' ||
     typeof doc.fields!=='object'||!doc.fields)
    error('community_policy_invalid');
  const f=doc.fields;
  if(typeof f.enabled?.booleanValue!=='boolean' ||
    typeof f.version?.stringValue!=='string')
    error('community_policy_invalid');
  if(f.enabled.booleanValue===true && f.version.stringValue==='2026-11-v1')
    return 'ACTIVE';
  return f.enabled.booleanValue===false?'DISABLED':'VERSION_MISMATCH';
}

function ensureState(report,stage,expectedPublished){
  if(report?.project!==EXPECTED.project ||
     report.rules?.localSha256!==EXPECTED.newRulesSha256 ||
     report.rules?.deployedSha256!==expectedPublished ||
     report.emailPolicy?.state!=='MISSING')
    error(stage+'_fingerprint_or_policy_changed');
  if(stage==='before' &&
    (report.rules?.verificationHelperPresent!==false ||
     report.rules?.guardOccurrences!==0 ||
     report.rules?.exactRepositoryMatch!==false))
    error('before_unexpected_rules_shape');
  if(stage==='after' &&
     (report.rules?.exactRepositoryMatch!==true ||
      report.rules?.verificationHelperPresent!==true ||
      report.rules?.authClaimPresent!==true ||
      report.rules?.guardOccurrences<20))
    error('after_rules_not_fully_published');
}

/**
 * Dependências injetáveis mantêm CI 100% offline. A auditoria produtiva
 * efetiva é feita pelo Termux do responsável, nunca pelo GitHub Actions.
 */
export async function guardedRulesUpdate({
  apply=false,
  localRules,
  tokenProvider=accessTokenFromExistingFirebaseCli,
  inspector=inspectProduction,
  fetcher=fetch,
  execute=execFileSync
}={}){
  if(typeof localRules!=='string'||sha256(localRules)!==EXPECTED.newRulesSha256)
    error('local_sha_mismatch');
  const token=await tokenProvider();
  const current=await inspector({token,expectedRules:localRules,fetcher});
  ensureState(current,'before',EXPECTED.oldRulesSha256);
  const communityPolicy=await readCommunityFlag(token,fetcher);
  if(communityPolicy==='ACTIVE')error('community_consent_gate_active');
  const overview={
    project:EXPECTED.project,
    mode:apply?'GUARDED_RULES_DEPLOY':'READ_ONLY_PREFLIGHT',
    rulesBeforeSha256:current.rules.deployedSha256,
    rulesTargetSha256:EXPECTED.newRulesSha256,
    emailPolicy:current.emailPolicy.state,
    communityPolicy,
    backupModified:false,
    emailPolicyActivated:false,
    releaseApproved:false
  };
  if(!apply)return {...overview,canApplyRules:true,deployed:false};
  // Repete a inspeção imediatamente antes do deploy, para reduzir a janela
  // em que alterações simultâneas em produção passariam despercebidas.
  const second=await inspector({token,expectedRules:localRules,fetcher});
  ensureState(second,'before',EXPECTED.oldRulesSha256);
  if(await readCommunityFlag(token,fetcher)!==communityPolicy)
    error('community_policy_changed');
  try {
    execute('firebase',[
      'deploy','--only','firestore:rules',
      '--project',EXPECTED.project,
      '--non-interactive'
    ],{
      cwd:root,stdio:'inherit',timeout:180000,
      env:{...process.env}
    });
  }catch{
    // Mesmo em erro da CLI, talvez a release tenha sido alterada.
    // Nunca declaramos rollback, backup ou sucesso automaticamente.
    error('firebase_cli_failed_check_remote_state');
  }
  const after=await inspector({token,expectedRules:localRules,fetcher});
  ensureState(after,'after',EXPECTED.newRulesSha256);
  if(await readCommunityFlag(token,fetcher)!==communityPolicy)
    error('community_policy_changed_after_deploy');
  return {...overview,canApplyRules:true,deployed:true,
    rulesPublishedSha256:after.rules.deployedSha256,
    emailPolicyStillMissing:true};
}

if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  try{
    const args=process.argv.slice(2);
    if(args.length>1||(args.length===1&&args[0]!=='--apply'))
      error('unknown_args');
    const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const out=await guardedRulesUpdate({apply:args[0]==='--apply',localRules:rules});
    console.log(JSON.stringify(out,null,2));
  }catch(e){
    const message=/^atrio_(rules_deploy|preflight|termux_preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_rules_deploy_failed_closed';
    console.error(message);
    process.exitCode=1;
  }
}
