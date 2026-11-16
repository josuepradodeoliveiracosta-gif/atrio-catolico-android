#!/usr/bin/env node
/**
 * CANDIDATO SOMENTE OFFLINE de paridade entre a base versionada e o QA.
 * Nunca chama Firebase, não coleta credenciais, não lê dados nem faz deploy.
 * A versão publicada na produção EXIGE comparação remota READ-ONLY separada.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {QA_AGE18_GATE,strengthenAge18Contacts} from './age18-gate.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const BASE_BLOB_SHA='526b8a1e7ff09aca79a4a539ee1681a6c0a76f77';
const TAIL=[
  '    match /{document=**} {',
  '      allow read, write: if false;',
  '    }',
  '  }',
  '}',
  ''
].join('\n');
const fnNames=s=>[...s.matchAll(/^\s*function\s+([A-Za-z_]\w*)\s*\(/gm)]
  .map(m=>m[1]);
const matchPaths=s=>[...s.matchAll(/^\s*match\s+(.+?)\s+\{\s*$/gm)]
  .map(m=>m[1].trim());
const gitBlob=s=>createHash('sha1')
  .update('blob '+Buffer.byteLength(s,'utf8')+'\0'+s,'utf8').digest('hex');
const refuse=message=>{throw Error('qa_parity_'+message);};

export function renderParity(base,chat,group) {
  if([base,chat,group].some(s=>typeof s!=='string') ||
     base.length<1000 || base.length>180000 ||
     chat.length<1000 || group.length<1000 ||
     chat.length>70000 || group.length>70000)
    refuse('invalid_source');
  // A base versionada é exatamente o blob revisado, não a branch mutável.
  if(gitBlob(base)!==BASE_BLOB_SHA)refuse('baseline_unreviewed');
  if(!base.startsWith("rules_version = '2';\nservice cloud.firestore {\n") ||
     !base.endsWith(TAIL) || base.split(TAIL).length!==2)
    refuse('baseline_structure_changed');

  for(const source of [chat,group]) {
    if(source.includes('rules_version') || source.includes('service cloud.firestore') ||
       /allow\s+[^:;\n]+:\s*if\s+true\s*;/.test(source))
      refuse('fragment_unexpected_grant');
  }
  if(!chat.includes('match /chats/{chatId}') ||
     !chat.includes('minorPolicyApproved') ||
     !chat.includes('safetyReviewVersion') ||
     !group.includes('match /chat_groups/{groupId}') ||
     !group.includes('atrioGroupEligible') ||
     !group.includes('minorPolicyApproved'))
    refuse('required_gate_missing');

  const anchor='return signedIn() && exists(config)';
  if(chat.split(anchor).length!==2)refuse('chat_gate_changed');
  const {chat:chatWithContactGate,group:groupWithContactGate}=strengthenAge18Contacts(chat,group);
  const strictChat=chatWithContactGate.replace(anchor,
    "return signedIn() && request.auth.token.get('email_verified',false) == true && qaChatAge18Eligible(request.auth.uid) && exists(config)");

  const existingFns=new Set(fnNames(base));
  if(existingFns.has('qaChatAge18Eligible') ||
     matchPaths(base).includes('/users/{uid}/chatAgeEligibility/current'))
    refuse('age18_collision');
  const fragmentFns=[...fnNames(strictChat),...fnNames(groupWithContactGate)];
  if(fragmentFns.some(name=>existingFns.has(name)) ||
     new Set(fragmentFns).size!==fragmentFns.length)
    refuse('function_collision');

  // Firestore sobrepõe permissões de matches. Evitar colisões nas rotas
  // de ativação e nas raízes de conversas/grupos antes da compilação.
  const existingPaths=new Set(matchPaths(base));
  const critical=[
    '/app_config/conversations','/app_config/chat_groups',
    '/chats/{chatId}','/chat_groups/{groupId}',
    '/chat_reports/{reportId}','/chat_group_reports/{reportId}'
  ];
  if(critical.some(p=>existingPaths.has(p)) ||
     critical.some(p=>![...matchPaths(strictChat),...matchPaths(groupWithContactGate)].includes(p)))
    refuse('match_collision_or_missing');

  const added=[
    '    // BEGIN QA PARITY ADDITIVE: SOMENTE FIREBASE EMULATOR, SEM DEPLOY',
    QA_AGE18_GATE.trimEnd(),strictChat.trimEnd(),groupWithContactGate.trimEnd(),
    '    // END QA PARITY ADDITIVE: politicas ainda pendentes (#200)',
    ''
  ].join('\n');
  const candidate=base.slice(0,-TAIL.length)+added+TAIL;
  if(Buffer.byteLength(candidate,'utf8')>240000)refuse('rules_size_limit');
  return candidate;
}

export function generateParity(){
  const base=fs.readFileSync(path.join(ROOT,'firestore.rules'),'utf8');
  const chat=fs.readFileSync(path.join(ROOT,'firebase/atrio-conversas-v1.rules.fragment'),'utf8');
  const group=fs.readFileSync(path.join(ROOT,'firebase/atrio-grupos-v1.rules.fragment'),'utf8');
  const output=path.join(ROOT,'tests/security/qa-parity.generated.rules');
  if(fs.existsSync(output)&&fs.lstatSync(output).isSymbolicLink())
    refuse('destination_symlink');
  const content=renderParity(base,chat,group);
  fs.writeFileSync(output,content,{encoding:'utf8',mode:0o600});
  return {output,baseBlobSha:BASE_BLOB_SHA};
}

if(process.argv[1]===fileURLToPath(import.meta.url)){
  try{
    generateParity();
    console.log('Paridade QA: base versionada fixada + fragmentos em memória; SOMENTE EMULADOR; SEM DEPLOY.');
  }catch(error){
    console.error('Paridade QA: geração NEGADA:',error.message);
    process.exitCode=1;
  }
}
