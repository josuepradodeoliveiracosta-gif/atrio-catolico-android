#!/usr/bin/env node
/**
 * Átrio Católico — comparação das regras Firestore publicadas com a main.
 * Read-only: só realiza duas requisições HTTPS GET e lê firestore.rules local.
 * Não cria, modifica ou substitui arquivos, regras, políticas nem backups.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const PROJECT='atrio-catolico';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const ROOT='https://firebaserules.googleapis.com/v1/';
const sha256=s=>createHash('sha256').update(s,'utf8').digest('hex');
const fail=code=>{throw Error('atrio_rules_diff_'+code);};

async function strictGetJson(url,token,fetcher){
  if(!url.startsWith(ROOT+'projects/'+PROJECT+'/'))fail('invalid_endpoint');
  let res;
  try{
    res=await fetcher(url,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(12000)
    });
  }catch{fail('network_unavailable');}
  if(res.status===401||res.status===403)fail('permission_denied');
  if(!res.ok)fail('http_'+res.status);
  try{
    const raw=await res.text();
    if(raw.length>500000)fail('response_too_large');
    const obj=JSON.parse(raw);
    if(!obj||typeof obj!=='object'||Array.isArray(obj))fail('invalid_json');
    return obj;
  }catch{fail('invalid_json');}
}

/** Consulta somente a release e o ruleset que está realmente publicado. */
export async function fetchPublishedRules({token,fetcher=fetch}){
  if(typeof token!=='string'||token.length<20||token.length>12000)
    fail('missing_oauth');
  const rel=await strictGetJson(ROOT+RELEASE,token,fetcher);
  if(rel.name!==RELEASE ||
    !/^projects\/atrio-catolico\/rulesets\/[a-zA-Z0-9_-]{1,120}$/.test(rel.rulesetName||''))
    fail('unexpected_release');
  const src=await strictGetJson(ROOT+rel.rulesetName,token,fetcher);
  if(src.name!==rel.rulesetName ||
    !Array.isArray(src.source?.files)||src.source.files.length!==1 ||
    typeof src.source.files[0]?.content!=='string' ||
    src.source.files[0].content.length<1000)
    fail('invalid_ruleset_source');
  return {publishedRules:src.source.files[0].content,
    publishedAt:rel.updateTime||null,rulesetName:rel.rulesetName};
}

function safeExcerpt(line){
  let s=String(line).trim();
  if(/private[_\s-]?key|-----BEGIN|password\s*[:=]|token\s*[:=]/i.test(s))
    return '[linha ocultada]';
  s=s.replace(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,'[email ocultado]');
  s=s.replace(/https?:\/\/\S+/g,'[endereço ocultado]');
  // Apenas trechos estruturais; regex gigantes e literais não são exibidos.
  if(!/^(?:allow\s|match\s|function\s|return\s|&&\s|\|\|\s)/.test(s))return null;
  return s.slice(0,124)+(s.length>124?'…':'');
}

function markers(text){
  const found=new Set();
  for(const line of text.split(/\r?\n/)){
    const match=line.match(/^\s*(match\s+[^{}]+|function\s+[a-zA-Z_$][\w$]*)/);
    if(match)found.add(match[1].trim().slice(0,110));
  }
  return found;
}

/**
 * LCS de linhas com limite defensivo de memória. Objetivo é indicar diferenças
 * com seus locais; a inspeção do conteúdo completo permanece no Termux.
 */
export function summarizePublishedVsRepository(publishedRules,repositoryRules){
  if(typeof publishedRules!=='string'||typeof repositoryRules!=='string' ||
    publishedRules.length<1000||repositoryRules.length<1000)
    fail('invalid_source');
  const old=publishedRules.replace(/\r\n/g,'\n').split('\n');
  const current=repositoryRules.replace(/\r\n/g,'\n').split('\n');
  if(old.length>2500||current.length>2500)fail('too_many_lines');
  const cols=current.length+1;
  const dp=new Uint16Array((old.length+1)*cols);
  for(let i=old.length-1;i>=0;i--){
    for(let j=current.length-1;j>=0;j--){
      dp[i*cols+j]=old[i]===current[j]
        ?1+dp[(i+1)*cols+j+1]
        :Math.max(dp[(i+1)*cols+j],dp[i*cols+j+1]);
    }
  }
  let i=0,j=0;
  const hunks=[];
  let changed=null;
  let toRepo=0,onlyPublished=0;
  const flush=()=>{
    if(!changed)return;
    if(hunks.length<16)hunks.push({
      publishedLines:changed.publishedStart+'-'+(changed.publishedEnd||changed.publishedStart),
      repositoryLines:changed.repoStart+'-'+(changed.repoEnd||changed.repoStart),
      publishedOnly:changed.removed,
      repositoryOnly:changed.added,
      publishedExamples:changed.from.slice(0,2),
      repositoryExamples:changed.to.slice(0,2)
    });
    changed=null;
  };
  let totalHunks=0;
  while(i<old.length||j<current.length){
    if(i<old.length&&j<current.length&&old[i]===current[j]){
      flush();i++;j++;continue;
    }
    if(!changed){totalHunks++;changed={
      publishedStart:i+1,repoStart:j+1,removed:0,added:0,
      publishedEnd:null,repoEnd:null,from:[],to:[]
    };}
    if(i<old.length&&(j===current.length ||
      dp[(i+1)*cols+j]>=dp[i*cols+j+1])){
      changed.removed++;onlyPublished++;changed.publishedEnd=i+1;
      const x=safeExcerpt(old[i]);
      if(x&&changed.from.length<2)changed.from.push(x);
      i++;
    }else{
      changed.added++;toRepo++;changed.repoEnd=j+1;
      const x=safeExcerpt(current[j]);
      if(x&&changed.to.length<2)changed.to.push(x);
      j++;
    }
  }
  flush();
  const remoteMarkers=markers(publishedRules);
  const localMarkers=markers(repositoryRules);
  return {
    publishedSha256:sha256(publishedRules),
    repositorySha256:sha256(repositoryRules),
    exactMatch:publishedRules===repositoryRules,
    publishedLines:old.length,repositoryLines:current.length,
    publishedOnlyLines:onlyPublished,repositoryOnlyLines:toRepo,
    differentRegions:totalHunks,
    shownRegions:hunks,
    moreRegionsOmitted:Math.max(0,totalHunks-hunks.length),
    publishedOnlyDeclarations:[...remoteMarkers].filter(m=>!localMarkers.has(m)).slice(0,20),
    repositoryOnlyDeclarations:[...localMarkers].filter(m=>!remoteMarkers.has(m)).slice(0,20),
    publishedContainsEmailGate:/function\s+emailVerificationAllowsCommunityAccess\s*\(/.test(publishedRules),
    repositoryContainsEmailGate:/function\s+emailVerificationAllowsCommunityAccess\s*\(/.test(repositoryRules)
  };
}

export async function compareProductionReadOnly({
  tokenProvider=accessTokenFromExistingFirebaseCli,
  localRules,
  fetcher=fetch
}={}){
  if(typeof localRules!=='string')fail('missing_repository_rules');
  const token=await tokenProvider();
  const published=await fetchPublishedRules({token,fetcher});
  return {
    project:PROJECT,
    mode:'READ_ONLY_NO_DEPLOY_NO_BACKUP',
    publishedAt:published.publishedAt,
    ...summarizePublishedVsRepository(published.publishedRules,localRules),
    deploymentApproved:false,
    releaseApproved:false
  };
}

if(process.argv[1]&&import.meta.url==='file://'+process.argv[1]){
  try{
    const local=await readFile(new URL('../firestore.rules',import.meta.url),'utf8');
    const result=await compareProductionReadOnly({localRules:local});
    console.log(JSON.stringify(result,null,2));
    if(!result.exactMatch)process.exitCode=2;
  }catch(e){
    const reason=/^atrio_(rules_diff|termux_preflight)_[a-z0-9_]+$/.test(e?.message||'')
      ?e.message:'atrio_rules_diff_failed_closed';
    console.error(reason);
    process.exitCode=1;
  }
}
