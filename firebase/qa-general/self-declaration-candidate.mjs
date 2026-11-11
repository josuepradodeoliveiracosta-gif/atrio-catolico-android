#!/usr/bin/env node
// GERADOR ALTERNATIVO DE REGRAS QA, SOMENTE OFFLINE. SEM PUBLICAÇÃO.
// A autodeclaração 18+ não prova idade: experimento exigindo revisão #200.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {render} from './compose-rules.mjs';

const ROOT=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const one=(source,old,next)=>{
 if(typeof source!=='string'||source.split(old).length!==2)
   throw Error('self_decl_qa_source_anchor_changed');
 return source.replace(old,next);
};
export function renderSelfDeclarationRules(chat,group){
 let rules=render(chat,group);
 rules=one(rules,"proof.get('status','') == 'eligible'",
   "proof.get('status','') == 'declared_18_plus'");
 rules=one(rules,"proof.get('policyVersion','') == '2026-11-18plus-qa-v1'",
   "proof.get('policyVersion','') == '2026-11-selfdecl-qa-v1'");
 const before=[
  '    match /users/{uid}/chatAgeEligibility/current {',
  '      allow get: if me(uid);',
  '      allow list, create, update, delete: if false;',
  '    }'
 ].join('\n');
 const after=[
  '    match /users/{uid}/chatAgeEligibility/current {',
  '      allow get: if me(uid);',
  '      allow list, update, delete: if false;',
  '      // QUADRO EXPERIMENTAL: o cliente afirma ter 18+, SEM COMPROVAR.',
  '      // Apenas criação pelo próprio UID; revogação administrativa não é reversível pelo cliente.',
  '      allow create: if me(uid)',
  "        && request.resource.data.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])",
  "        && request.resource.data.keys().hasOnly(['status','minimumAge','policyVersion','reviewExpiresAt'])",
  "        && request.resource.data.status == 'declared_18_plus'",
  '        && request.resource.data.minimumAge == 18',
  "        && request.resource.data.policyVersion == '2026-11-selfdecl-qa-v1'",
  '        && request.resource.data.reviewExpiresAt is timestamp',
  '        && request.resource.data.reviewExpiresAt > request.time',
  "        && request.resource.data.reviewExpiresAt <= request.time + duration.value(366,'d');",
  '    }'
 ].join('\n');
 return one(rules,before,after);
}
export function generate(){
 const chat=fs.readFileSync(path.join(ROOT,'firebase/atrio-conversas-v1.rules.fragment'),'utf8');
 const group=fs.readFileSync(path.join(ROOT,'firebase/atrio-grupos-v1.rules.fragment'),'utf8');
 const out=path.join(ROOT,'tests/security/qa-general.generated.rules');
 if(fs.existsSync(out)&&fs.lstatSync(out).isSymbolicLink())
   throw Error('self_decl_qa_destination_symlink');
 fs.writeFileSync(out,renderSelfDeclarationRules(chat,group),{mode:0o600});
 return out;
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
 try {
   generate();
   console.log('Candidato alternativo de autodeclaracao QA gerado somente em memoria/runner. SEM DEPLOY.');
 } catch(e){
   console.error('self_decl_qa_generation_failed');
   process.exitCode=1;
 }
}
