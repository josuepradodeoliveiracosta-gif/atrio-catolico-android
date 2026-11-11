/**
 * VARIANTE DE LABORATÓRIO: integrar a base versionada do mural ao contrato
 * 18+ por AUTODECLARAÇÃO usado no Chat QA fechado.
 * Apenas Firebase Emulator (demo-atrio-v11); NUNCA fazer deploy.
 * renderParity fixa o blob Git de firestore.rules; qualquer mudança na
 * base exige revisão. Nenhuma lista extra de testadores ou novo cadastro.
 */
import {renderParity} from './compose-parity-rules.mjs';

const deny=()=>{throw Error('qa_closed_parity_anchor_changed');};
function replaceOnce(s,from,to){
 if(typeof s!=='string'||s.split(from).length!==2)deny();
 return s.replace(from,to);
}
const originalCommunity=[
 '    function communityPublicationAllowed() {',
 '      let settings = /databases/$(database)/documents/app_config/community_rules;',
 '      let acceptance = /databases/$(database)/documents/community_consents/$(request.auth.uid);',
 '      return !exists(settings)',
 "        || get(settings).data.get('enabled', false) != true",
 "        || get(settings).data.get('version', '') != '2026-11-v1'",
 '        || (exists(acceptance)',
 "          && get(acceptance).data.version == '2026-11-v1');",
 '    }'
].join('\n');
const closedCommunity=[
 '    function communityPublicationAllowed() {',
 '      // QA: política e consentimento válidos obrigatórios para publicar.',
 '      let settings = /databases/$(database)/documents/app_config/community_rules;',
 '      let acceptance = /databases/$(database)/documents/community_consents/$(request.auth.uid);',
 '      return signedIn() && exists(settings)',
 "        && get(settings).data.get('enabled', false) == true",
 "        && get(settings).data.get('version', '') == '2026-11-v1'",
 '        && exists(acceptance)',
 "        && get(acceptance).data.get('version', '') == '2026-11-v1';",
 '    }'
].join('\n');
const originalEmail=[
 '    function emailVerificationAllowsCommunityAccess() {',
 '      let policy = /databases/$(database)/documents/app_config/email_verification;',
 '      return !exists(policy)',
 "        || get(policy).data.get('enabled', false) != true",
 "        || get(policy).data.get('version', '') != '2026-11-v1'",
 "        || request.auth.token.get('email_verified', false) == true;",
 '    }'
].join('\n');
const closedEmail=[
 '    function emailVerificationAllowsCommunityAccess() {',
 '      // QA: não herdar fallback permissivo do legado sem política publicada.',
 '      let policy = /databases/$(database)/documents/app_config/email_verification;',
 '      return signedIn() && exists(policy)',
 "        && get(policy).data.get('enabled', false) == true",
 "        && get(policy).data.get('version', '') == '2026-11-v1'",
 "        && request.auth.token.get('email_verified', false) == true;",
 '    }'
].join('\n');
const oldAge=[
 '    match /users/{uid}/chatAgeEligibility/current {',
 '      allow get: if me(uid);',
 '      allow list, create, update, delete: if false;',
 '    }'
].join('\n');
const declaredAge=[
 '    match /users/{uid}/chatAgeEligibility/current {',
 '      allow get: if me(uid);',
 '      allow list, update, delete: if false;',
 '      // Declaracao do TITULAR, nao comprovacao de idade.',
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

export function renderClosedQaParity(base,chat,group){
 let s=renderParity(base,chat,group); // revisão hash, colisões, limites e gates
 s=replaceOnce(s,originalCommunity,closedCommunity);
 s=replaceOnce(s,originalEmail,closedEmail);
 s=replaceOnce(s,"proof.get('status','') == 'eligible'",
   "proof.get('status','') == 'declared_18_plus'");
 s=replaceOnce(s,"proof.get('policyVersion','') == '2026-11-18plus-qa-v1'",
   "proof.get('policyVersion','') == '2026-11-selfdecl-qa-v1'");
 s=replaceOnce(s,oldAge,declaredAge);
 if(s.includes('qa_closed_testers')||s.includes('qaClosedBetaTester')||
    !s.includes('match /posts/{postId}')||
    !s.includes('match /chats/{chatId}')||
    !s.includes('match /chat_groups/{groupId}')||
    /allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/.test(s))deny();
 return s;
}
