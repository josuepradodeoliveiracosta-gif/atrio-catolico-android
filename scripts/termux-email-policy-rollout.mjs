#!/usr/bin/env node
/**
 * Átrio Católico — ativação controlada da confirmação obrigatória de e-mail.
 *
 * SEM argumentos: apenas leitura de regras e estado da política.
 * --activate: cria a política SOMENTE se ela não existir (HTTP POST create).
 * --disable: rollback emergencial SOMENTE com updateTime como precondição.
 *
 * Nada toca GitHub, Workers, APK, Firebase Rules, contas, backups ou arquivos.
 * Tokens OAuth ficam em memória e não são registrados em logs.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
import {inspectProduction} from './email-verification-production-preflight.mjs';

export const EXPECTED={
  project:'atrio-catolico',
  rulesSha:'4b479daa1d4d8673c3e1e9f70a2f9d752e7df996d414aefa1397ad86661bd76e',
  version:'2026-11-v1',
  document:'projects/atrio-catolico/databases/(default)/documents/app_config/email_verification'
};
const API='https://firestore.googleapis.com/v1/';
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=code=>{throw Error('atrio_email_rollout_'+code);};

function assertRules(report,localRules){
  if(report?.project!==EXPECTED.project || sha256(localRules)!==EXPECTED.rulesSha)
    fail('project_or_local_rules_changed');
  if(report.rules?.localSha256!==EXPECTED.rulesSha ||
    report.rules?.deployedSha256!==EXPECTED.rulesSha ||
    report.rules?.exactRepositoryMatch!==true ||
    report.rules?.verificationHelperPresent!==true ||
    report.rules?.authClaimPresent!==true ||
    report.rules?.guardOccurrences<20)
    fail('production_rules_not_approved');
}

async function policyWrite({method,url,token,body,fetcher}){
  if(!url.startsWith(API+'projects/atrio-catolico/databases/(default)/documents/app_config'))
    fail('invalid_write_url');
  let response;
  try {
    response=await fetcher(url,{
      method,redirect:'error',cache:'no-store',
      headers:{
        Authorization:'Bearer '+token,
        Accept:'application/json',
        'Content-Type':'application/json'
      },
      body:JSON.stringify(body),signal:AbortSignal.timeout(12000)
    });
  }catch{fail('write_network_uncertain_check_before_retry');}
  // 409/412 indicam concorrência; nunca forçar update ou repetir no escuro.
  if(response.status===409||response.status===412)
    fail('write_precondition_failed');
  if(!response.ok)fail('write_http_'+response.status);
  let result;
  try{
    const raw=await response.text();
    if(raw.length>12000)fail('response_too_large');
    result=JSON.parse(raw);
  }catch{fail('invalid_write_response');}
  if(result?.name!==EXPECTED.document ||
     typeof result.updateTime!=='string' ||
     result.fields?.enabled?.booleanValue!==body.fields.enabled.booleanValue ||
     result.fields?.version?.stringValue!==EXPECTED.version)
    fail('unexpected_document_after_write');
  return result.updateTime;
}

export async function guardedEmailPolicyRollout({
  mode='check',localRules,
  tokenProvider=accessTokenFromExistingFirebaseCli,
  inspector=inspectProduction,fetcher=fetch
}={}){
  if(!['check','activate','disable'].includes(mode))fail('invalid_mode');
  if(typeof localRules!=='string'||sha256(localRules)!==EXPECTED.rulesSha)
    fail('local_rules_not_approved');
  const token=await tokenProvider();
  const inspect=()=>inspector({token,expectedRules:localRules,fetcher});
  const first=await inspect();
  assertRules(first,localRules);
  const initial=first.emailPolicy?.state;
  if(!['MISSING','ACTIVE','DISABLED'].includes(initial))
    fail('unexpected_email_policy_state');
  const base={
    project:EXPECTED.project,
    rulesMatch:true,
    emailPolicyBefore:initial,
    mode:mode.toUpperCase(),
    backupModified:false,
    releaseApproved:false
  };
  if(mode==='check'){
    return {...base,canActivate:initial==='MISSING',
      canDisable:initial==='ACTIVE',modified:false,
      needsRealAccountQa:initial==='ACTIVE'};
  }
  if(mode==='activate'&&initial!=='MISSING')
    fail('policy_not_missing');
  if(mode==='disable'&&(initial!=='ACTIVE'||!first.emailPolicy?.updatedAt))
    fail('policy_not_active_or_missing_update_time');

  // Checagem de concorrência imediatamente antes da escrita.
  const second=await inspect();
  assertRules(second,localRules);
  if(second.emailPolicy?.state!==initial)
    fail('policy_changed_before_write');
  if(mode==='disable'&&second.emailPolicy?.updatedAt!==first.emailPolicy.updatedAt)
    fail('policy_changed_before_write');

  const body={
    fields:{
      enabled:{booleanValue:mode==='activate'},
      version:{stringValue:EXPECTED.version}
    }
  };
  const url=mode==='activate'
    ?API+'projects/atrio-catolico/databases/(default)/documents/app_config?documentId=email_verification'
    :API+EXPECTED.document+'?updateMask.fieldPaths=enabled'+
      '&currentDocument.updateTime='+encodeURIComponent(first.emailPolicy.updatedAt);
  const writtenAt=await policyWrite({
    method:mode==='activate'?'POST':'PATCH',url,body,token,fetcher
  });
  const after=await inspect();
  assertRules(after,localRules);
  if(after.emailPolicy?.state!==(mode==='activate'?'ACTIVE':'DISABLED') ||
     after.emailPolicy?.updatedAt!==writtenAt ||
     Boolean(after.ready)!==(mode==='activate'))
    fail('post_write_audit_mismatch');
  return {...base,emailPolicyAfter:after.emailPolicy.state,
    modified:true,needsRealAccountQa:mode==='activate',
    rollbackCommand:mode==='activate'
      ?'node scripts/termux-email-policy-rollout.mjs --disable --confirm=ATRIO_EMAIL_POLICY_2026-11-v1'
      :null};
}

if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  try{
    const args=process.argv.slice(2);
    const mode=args.length===0?'check':
      args.length===2&&args[0]==='--activate'&&args[1]==='--confirm=ATRIO_EMAIL_POLICY_2026-11-v1'
        ?'activate':
      args.length===2&&args[0]==='--disable'&&args[1]==='--confirm=ATRIO_EMAIL_POLICY_2026-11-v1'
        ?'disable':null;
    if(!mode)fail('invalid_arguments');
    const rules=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const result=await guardedEmailPolicyRollout({mode,localRules:rules});
    console.log(JSON.stringify(result,null,2));
  }catch(e){
    const message=/^atrio_(email_rollout|termux_preflight|preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_email_rollout_failed_closed';
    console.error(message);
    process.exitCode=1;
  }
}
