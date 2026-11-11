/**
 * CANDIDATO EXPERIMENTAL DE ADMISSÃO AO QA FECHADO — SOMENTE OFFLINE.
 *
 * A declaração 18+ não é prova de idade; a lista de testadores tampouco.
 * Esta variante NÃO é o gerador principal nem é implantada por esta PR.
 * Um futuro operador autorizado teria de criar membros via servidor/Admin SDK,
 * com autorização e revisão, sem UIDs ou dados privados neste repositório.
 */
import {renderSelfDeclarationRules} from './self-declaration-candidate.mjs';

const fail=()=>{throw Error('qa_closed_beta_rule_anchor_changed');};
function replaceOnce(source,oldText,newText){
 if(typeof source!=='string'||source.split(oldText).length!==2)fail();
 return source.replace(oldText,newText);
}
const betaFunction=[
 '    // Listagem FECHADA de testadores sintéticos: nunca administrada pelo cliente.',
 '    function qaClosedBetaTester(uid) {',
 '      let entry = /databases/$(database)/documents/qa_closed_testers/$(uid);',
 '      return validId(uid) && exists(entry)',
 "        && get(entry).data.keys().hasAll(['enabled','policyVersion','reviewExpiresAt'])",
 "        && get(entry).data.keys().hasOnly(['enabled','policyVersion','reviewExpiresAt'])",
 "        && get(entry).data.get('enabled',false) == true",
 "        && get(entry).data.get('policyVersion','') == '2026-11-closed-beta-qa-v1'",
 "        && get(entry).data.get('reviewExpiresAt',request.time) is timestamp",
 "        && get(entry).data.get('reviewExpiresAt',request.time) > request.time;",
 '    }',
 '    match /qa_closed_testers/{uid} {',
 '      allow get, list, create, update, delete: if false;',
 '    }'
].join('\n');

export function renderClosedBetaSelfDeclarationRules(chat,group){
 // Esta variante deve recusar fontes renomeadas, não apenas duplicar
 // trechos num Ruleset possivelmente incompatível. Conferir ANTES de
 // renderizar: preserve exatamente as funções de ativação em ambos.
 if(typeof chat!=='string'||typeof group!=='string'||
    chat.split('    function chatEnabled() {').length!==2 ||
    group.split('    function atrioGroupsEnabled() {').length!==2)fail();
 let rules=renderSelfDeclarationRules(chat,group);
 rules=replaceOnce(
   rules,
   '    function qaChatAge18Eligible(uid) {',
   betaFunction+'\n    function qaChatAge18Eligible(uid) {'
 );
 rules=replaceOnce(
   rules,
   "      return proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])",
   "      return qaClosedBetaTester(uid)\n        && proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])"
 );
 if(!rules.includes('qaClosedBetaTester(request.auth.uid)') &&
    !rules.includes('qaChatAge18Eligible(request.auth.uid)'))fail();
 if(/allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(rules))fail();
 return rules;
}
