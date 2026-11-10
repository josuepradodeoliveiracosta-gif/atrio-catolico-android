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
