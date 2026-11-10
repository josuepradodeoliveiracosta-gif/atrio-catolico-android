/**
 * GATE DE IDADE EXCLUSIVO DO CANDIDATO QA OFFLINE; NAO IMPLANTAR.
 * 18 anos = idade minima para chat atualizada em 10/11/2026.
 * Fixture criada via contexto administrativo do emulador: nao comprova idade real.
 * Fluxo de afericao, restricao para menores de 18 e politica #200 seguem pendentes.
 */
export const QA_AGE18_GATE=`
    function qaChatAge18Eligible(uid) {
      // Uma unica leitura evita esgotar o limite de acessos das Rules
      // durante convites de grupo. Prova ausente gera negacao (fail-closed).
      let proof = get(/databases/$(database)/documents/users/$(uid)/chatAgeEligibility/current).data;
      // Contrato minimo do documento: nao aceitar campos de nascimento,
      // documento ou metadados inesperados no gate de acesso ao chat.
      // Isto NAO impede o Admin SDK de escrever; o backend deve validar.
      return proof.keys().hasAll(['status','minimumAge','policyVersion','reviewExpiresAt'])
        && proof.keys().hasOnly(['status','minimumAge','policyVersion','reviewExpiresAt'])
        && proof.get('status','') == 'eligible'
        && proof.get('minimumAge',0) == 18
        && proof.get('policyVersion','') == '2026-11-18plus-qa-v1'
        && proof.get('reviewExpiresAt',request.time) is timestamp
        && proof.get('reviewExpiresAt',request.time) > request.time;
    }
    match /users/{uid}/chatAgeEligibility/current {
      allow get: if me(uid);
      allow list, create, update, delete: if false;
    }
`;

/** Transforma APENAS fragmentos em memoria. Falha fechado se a fonte mudar. */
function insertChecked(source,before,after,scope) {
  if(typeof source!=='string' || source.split(before).length!==2)
    throw Error('qa_age18_'+scope+'_anchor_changed');
  return source.replace(before,after);
}
export function strengthenAge18Contacts(chat,group) {
  let c=insertChecked(chat,
    '        && validId(request.resource.data.recipientUid)\n        && request.resource.data.requesterUid != request.resource.data.recipientUid',
    '        && validId(request.resource.data.recipientUid)\n        && qaChatAge18Eligible(request.resource.data.recipientUid)\n        && request.resource.data.requesterUid != request.resource.data.recipientUid',
    'dm_recipient');
  c=insertChecked(c,
    '          && chatMember(getAfter(/databases/$(database)/documents/chats/$(chatId)).data)\n          && chatNoBlock(',
    '          && chatMember(getAfter(/databases/$(database)/documents/chats/$(chatId)).data)\n          && qaChatAge18Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.requesterUid)\n          && qaChatAge18Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.recipientUid)\n          && chatNoBlock(',
    'dm_message');
  let g=insertChecked(group,
    '      allow create: if atrioGroupsEnabled() && validId(inviteeUid)',
    '      allow create: if atrioGroupsEnabled() && validId(inviteeUid)\n          && qaChatAge18Eligible(inviteeUid)',
    'invite_create');
  g=insertChecked(g,
    '        allow update: if atrioGroupsEnabled()\n          && atrioGroupEligible(request.auth.uid)\n          && request.resource.data.diff(resource.data).affectedKeys()',
    '        allow update: if atrioGroupsEnabled()\n          && atrioGroupEligible(request.auth.uid)\n          && qaChatAge18Eligible(inviteeUid)\n          && request.resource.data.diff(resource.data).affectedKeys()',
    'invite_update');
  return {chat:c,group:g};
}
