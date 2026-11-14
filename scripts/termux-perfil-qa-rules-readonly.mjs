#!/usr/bin/env node
/**
 * Auditoria exclusivamente GET da release Firestore do Perfil QA pelo Termux.
 * Nunca consulta produção/QA Geral e jamais publica Rules.
 */
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';

const PROJECT='atrio-catolico-qa-perfil';
const BASE='https://firebaserules.googleapis.com/v1/';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const DENY=`rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}`;
const hash=s=>createHash('sha256').update(s,'utf8').digest('hex');
const compact=s=>s.replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/\/\/[^\r\n]*/g,'').replace(/\s+/g,'');
const fail=code=>{throw Error('perfil_qa_rules_readonly_'+code);};

async function fetchOnlyQa(path,token,fetcher){
  if(!path.startsWith('projects/'+PROJECT+'/')||path.includes('..'))
    fail('invalid_endpoint');
  let response;
  try{
    response=await fetcher(BASE+path,{
      method:'GET',redirect:'error',cache:'no-store',
      headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      signal:AbortSignal.timeout(12000),
    });
  }catch{fail('network_unavailable');}
  if(!response?.ok)fail('read_denied');
  let data;
  try{
    const raw=await response.text();
    if(raw.length>200000)fail('oversize');
    data=JSON.parse(raw);
  }catch{fail('invalid_json');}
  if(!data||typeof data!=='object'||Array.isArray(data))
    fail('invalid_json');
  return data;
}

export async function inspectPerfilQaRules({
  tokenProvider=accessTokenFromExistingFirebaseCli,
  fetcher=fetch,
  candidateRules,
}={}){
  if(typeof candidateRules!=='string'||candidateRules.length<200)
    fail('candidate_missing');
  const token=await tokenProvider();
  if(typeof token!=='string'||token.length<20||token.length>12000)
    fail('missing_login');
  const release=await fetchOnlyQa(RELEASE,token,fetcher);
  const validRuleset=new RegExp('^projects/'+PROJECT+'/rulesets/[a-zA-Z0-9_-]{1,120}$');
  if(release.name!==RELEASE||!validRuleset.test(release.rulesetName||''))
    fail('release_identity_mismatch');
  const ruleset=await fetchOnlyQa(release.rulesetName,token,fetcher);
  const files=ruleset.source?.files;
  if(ruleset.name!==release.rulesetName||!Array.isArray(files)
    ||files.length!==1||typeof files[0]?.content!=='string'
    ||files[0].content.length<70||files[0].content.length>160000)
    fail('ruleset_incomplete');
  const published=files[0].content;
  return {
    project:PROJECT,database:'(default)',mode:'GET_ONLY_NO_DEPLOY',
    publishedSha256:hash(published),
    candidateSha256:hash(candidateRules),
    publishedDenyAll:compact(published)===compact(DENY),
    matchesCandidate:published===candidateRules,
    deployPerformed:false,productionContacted:false,
  };
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    if(process.argv.length!==2)fail('unexpected_arguments');
    const candidate=await readFile(
      new URL('../firebase/qa-perfil/firestore.rules',import.meta.url),'utf8');
    const summary=await inspectPerfilQaRules({candidateRules:candidate});
    console.log(JSON.stringify(summary,null,2));
    // A release continua intencionalmente fechada antes de autorizacao.
    if(!summary.publishedDenyAll)process.exitCode=2;
  }catch(error){
    console.error(/^perfil_qa_rules_readonly_[a-z0-9_]+$/.test(error?.message||'')
      ?error.message:'perfil_qa_rules_readonly_failed_closed');
    process.exitCode=1;
  }
}
