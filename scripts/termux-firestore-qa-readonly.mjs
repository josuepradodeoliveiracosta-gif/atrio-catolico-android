#!/usr/bin/env node
// Firestore QA geral: duas consultas GET; sem publicacao, secrets ou alteracoes.
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {accessTokenFromExistingFirebaseCli} from './termux-email-production-readonly.mjs';
const PROJECT='atrio-catolico-qa-geral';
const BASE='https://firebaserules.googleapis.com/v1/';
const RELEASE='projects/'+PROJECT+'/releases/cloud.firestore';
const DENY=[
 "rules_version = '2';",
 'service cloud.firestore {',
 'match /databases/{database}/documents {',
 'match /{document=**} {',
 'allow read, write: if false;',
 '}', '}', '}'
].join('\n');
const compact=s=>s.replace(/\/\*[\s\S]*?\*\//g,'')
 .replace(/\/\/[^\r\n]*/g,'').replace(/\s+/g,'');
const fail=name=>{throw Error('qa_rules_readonly_'+name);};
async function get(path,token,fetcher){
 if(!path.startsWith('projects/'+PROJECT+'/')||path.includes('..'))
   fail('wrong_endpoint');
 let response;
 try {
   response=await fetcher(BASE+path,{
     method:'GET',redirect:'error',cache:'no-store',
     headers:{Authorization:'Bearer '+token,Accept:'application/json'},
     signal:AbortSignal.timeout(12000)
   });
 }catch{fail('network_error');}
 if(!response?.ok)fail('read_denied');
 let data;
 try{
   const raw=await response.text();
   if(raw.length>200000)fail('oversize');
   data=JSON.parse(raw);
 }catch{fail('invalid_response');}
 if(!data||typeof data!=='object'||Array.isArray(data))fail('invalid_response');
 return data;
}
export async function inspectQaRules({
 tokenProvider=accessTokenFromExistingFirebaseCli,fetcher=fetch
}={}){
 const token=await tokenProvider();
 if(typeof token!=='string'||token.length<20||token.length>12000)
   fail('missing_login');
 const release=await get(RELEASE,token,fetcher);
 const pattern=new RegExp('^projects/'+PROJECT+'/rulesets/[a-zA-Z0-9_-]{1,120}$');
 if(release.name!==RELEASE||!pattern.test(release.rulesetName||''))
   fail('release_identity_mismatch');
 const ruleset=await get(release.rulesetName,token,fetcher);
 const f=ruleset.source?.files;
 if(ruleset.name!==release.rulesetName||!Array.isArray(f)||f.length!==1||
    typeof f[0]?.content!=='string'||f[0].content.length<70||
    f[0].content.length>160000)
   fail('ruleset_incomplete');
 const rules=f[0].content;
 const closed=compact(rules)===compact(DENY);
 return {
   project:PROJECT,mode:'READ_ONLY_TWO_GET',
   sha256:createHash('sha256').update(rules).digest('hex'),
   firestoreRulesCurrentlyDenyAll:closed,
   safeToEnableChat:false,qaRulesNeedsReview:!closed,
   deployPerformed:false,productionContacted:false
 };
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try{
   if(process.argv.length!==2)fail('invalid_arguments');
   const r=await inspectQaRules();
   console.log(JSON.stringify(r,null,2));
   if(!r.firestoreRulesCurrentlyDenyAll)process.exitCode=2;
 }catch(e){
   console.error(/^qa_rules_readonly_[a-z0-9_]+$/.test(e?.message||'')
     ?e.message:'qa_rules_readonly_failed_closed');
   process.exitCode=1;
 }
}
