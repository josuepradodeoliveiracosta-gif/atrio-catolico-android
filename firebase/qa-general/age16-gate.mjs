/**
 * GATE DE IDADE EXCLUSIVO DO CANDIDATO QA OFFLINE; NAO IMPLANTAR.
 * 16 anos = idade minima para chat decidida pelo fundador.
 * Fixture criada via contexto administrativo do emulador: nao comprova idade real.
 * Fluxo de afericao, tratamento 16-17 e politica #200 seguem pendentes.
 */
export const QA_AGE16_GATE=`
    function qaChatAge16Eligible(uid) {
      let proof = /databases/$(database)/documents/users/$(uid)/chatAgeEligibility/current;
      return exists(proof)
        && get(proof).data.get('status','') == 'eligible'
        && get(proof).data.get('minimumAge',0) == 16
        && get(proof).data.get('policyVersion','') == '2026-11-16plus-qa-v1'
        && get(proof).data.get('reviewExpiresAt',request.time) is timestamp
        && get(proof).data.get('reviewExpiresAt',request.time) > request.time;
    }
    match /users/{uid}/chatAgeEligibility/current {
      allow get: if me(uid);
      allow list, create, update, delete: if false;
    }
`;

/** Transforma APENAS fragmentos em memoria. Falha fechado se a fonte mudar. */
function insertChecked(source,before,after,scope) {
  if(typeof source!=='string' || source.split(before).length!==2)
    throw Error('qa_age16_'+scope+'_anchor_changed');
  return source.replace(before,after);
}
export function strengthenAge16Contacts(chat,group) {
  let c=insertChecked(chat,
    '        && validId(request.resource.data.recipientUid)\n        && request.resource.data.requesterUid != request.resource.data.recipientUid',
    '        && validId(request.resource.data.recipientUid)\n        && qaChatAge16Eligible(request.resource.data.recipientUid)\n        && request.resource.data.requesterUid != request.resource.data.recipientUid',
    'dm_recipient');
  c=insertChecked(c,
    '          && chatMember(getAfter(/databases/$(database)/documents/chats/$(chatId)).data)\n          && chatNoBlock(',
    '          && chatMember(getAfter(/databases/$(database)/documents/chats/$(chatId)).data)\n          && qaChatAge16Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.requesterUid)\n          && qaChatAge16Eligible(getAfter(/databases/$(database)/documents/chats/$(chatId)).data.recipientUid)\n          && chatNoBlock(',
    'dm_message');
  let g=insertChecked(group,
    '      allow create: if atrioGroupsEnabled() && validId(inviteeUid)',
    '      allow create: if atrioGroupsEnabled() && validId(inviteeUid)\n          && qaChatAge16Eligible(inviteeUid)',
    'invite_create');
  g=insertChecked(g,
    '        allow update: if atrioGroupsEnabled()\n          && atrioGroupEligible(request.auth.uid)\n          && request.resource.data.diff(resource.data).affectedKeys()',
    '        allow update: if atrioGroupsEnabled()\n          && atrioGroupEligible(request.auth.uid)\n          && qaChatAge16Eligible(inviteeUid)\n          && request.resource.data.diff(resource.data).affectedKeys()',
    'invite_update');
  return {chat:c,group:g};
}
