#!/usr/bin/env node
/**
 * Auditoria SOMENTE LEITURA da confirmacao obrigatoria de email no Firebase.
 * Endpoints: GET da release Firestore, GET da fonte das regras e GET da politica.
 * Jamais imprime tokens, conteudo de regras, usuarios ou documentos privados.
 *
 * Em ambiente autorizado, forneca ATRIO_READONLY_OAUTH_TOKEN via variavel de
 * ambiente. Nao grave o token em arquivos nem cole em chats.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

export const PROJECT='atrio-catolico';
const FIREBASE_RULES='https://firebaserules.googleapis.com/v1';
const FIRESTORE='https://firestore.googleapis.com/v1';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const POLICY='projects/'+PROJECT+'/databases/(default)/documents/app_config/email_verification';
const VERSION='2026-11-v1';
const sha256=x=>createHash('sha256').update(x,'utf8').digest('hex');
const safeErr=code=>new Error('atrio_preflight_'+code);

async function getJson(url, token, fetcher, optional404=false) {
  if(!url.startsWith(FIREBASE_RULES+'/projects/'+PROJECT+'/') &&
     !url.startsWith(FIRESTORE+'/projects/'+PROJECT+'/'))
    throw safeErr('invalid_url');
  let res;
  try {
    res=await fetcher(url,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(10000)
    });
  }catch{throw safeErr('network_unavailable');}
  if(res.status===404&&optional404)return null;
  if(res.status===401||res.status===403)throw safeErr('permission_denied');
  if(!res.ok)throw safeErr('http_'+res.status);
  let data;
  try {
    const raw=await res.text();
    if(raw.length>400000)throw safeErr('response_too_large');
    data=JSON.parse(raw);
  }catch{throw safeErr('invalid_response');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    throw safeErr('invalid_response');
  return data;
}

export async function inspectProduction({token,expectedRules,fetcher=fetch}) {
  if(typeof token!=='string'||token.length<20||token.length>12000)
    throw safeErr('missing_oauth_token');
  if(typeof expectedRules!=='string'||expectedRules.length<1000)
    throw safeErr('missing_local_rules');

  const release=await getJson(FIREBASE_RULES+'/'+RELEASE,token,fetcher);
  if(release.name!==RELEASE ||
     !/^projects\/atrio-catolico\/rulesets\/[a-zA-Z0-9_-]{1,120}$/.test(release.rulesetName||''))
    throw safeErr('unexpected_rules_release');

  const ruleset=await getJson(FIREBASE_RULES+'/'+release.rulesetName,token,fetcher);
  if(ruleset.name!==release.rulesetName || !Array.isArray(ruleset.source?.files) ||
     !ruleset.source.files.length)
    throw safeErr('invalid_ruleset');
  const deployed=ruleset.source.files.map(file=>file.content||'').join('\n');
  const exactMatch=ruleset.source.files.length===1 &&
    ruleset.source.files[0].content===expectedRules;
  // Um hash divergente nunca pode ser interpretado como implantacao aprovada.
  const hasHelper=/function\s+emailVerificationAllowsCommunityAccess\s*\(/.test(deployed);
  const hasAuthClaim=/request\.auth\.token\.get\(\s*['"]email_verified['"]\s*,\s*false\s*\)\s*==\s*true/.test(deployed);
  const guardedStatements=(deployed.match(/emailVerificationAllowsCommunityAccess\s*\(\s*\)/g)||[]).length;

  const doc=await getJson(FIRESTORE+'/'+POLICY,token,fetcher,true);
  if(doc && doc.name!==POLICY)throw safeErr('unexpected_policy_document');
  const enabled=doc?.fields?.enabled?.booleanValue;
  const version=doc?.fields?.version?.stringValue;
  const policyState=!doc?'MISSING':
    typeof enabled!=='boolean'||typeof version!=='string'?'INVALID':
    enabled===true&&version===VERSION?'ACTIVE':
    enabled===false?'DISABLED':'VERSION_MISMATCH';

  return {
    project:PROJECT,
    rules:{
      release:RELEASE,
      publishedAt:release.updateTime||null,
      exactRepositoryMatch:exactMatch,
      localSha256:sha256(expectedRules),
      deployedSha256:sha256(deployed),
      verificationHelperPresent:hasHelper,
      authClaimPresent:hasAuthClaim,
      guardOccurrences:guardedStatements
    },
    emailPolicy:{state:policyState,updatedAt:doc?.updateTime||null},
    ready:exactMatch&&hasHelper&&hasAuthClaim&&guardedStatements>=20&&policyState==='ACTIVE'
  };
}

function safeOutput(data) {
  console.log(JSON.stringify(data,null,2));
}

if(process.argv[1] && import.meta.url==='file://'+process.argv[1]) {
  try {
    const local=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const result=await inspectProduction({
      token:process.env.ATRIO_READONLY_OAUTH_TOKEN,
      expectedRules:local
    });
    safeOutput(result);
    if(!result.ready)process.exitCode=2;
  }catch(e) {
    const reason=/^atrio_preflight_[a-z0-9_]+$/.test(e?.message||'')?
      e.message:'atrio_preflight_failed_closed';
    console.error(reason);
    process.exitCode=1;
  }
}
