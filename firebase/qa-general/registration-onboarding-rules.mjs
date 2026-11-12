/**
 * Rotas MÍNIMAS do cadastro V2 exclusivamente para Rules QA alternativas.
 * Sem deploy. Não concede funções de administrador, moderador ou clero.
 * Configurações são somente LEITURA; dados privados, somente pelo próprio UID.
 * Nunca expor dados religiosos/paroquiais a terceiros.
 */
export const QA_REGISTRATION_ROUTES = `
    match /app_config/email_verification {
      allow get: if signedIn();
      allow list, create, update, delete: if false;
    }
    match /app_config/community_rules {
      allow get: if signedIn();
      allow list, create, update, delete: if false;
    }
    match /users/{uid}/private/account {
      allow get: if me(uid);
      allow list, delete: if false;
      allow create: if me(uid)
        && request.resource.data.keys().hasAll(['onboardingStatus','profileVersion',
            'noticesOptIn','communityUpdates','updatedAt'])
        && request.resource.data.keys().hasOnly(['onboardingStatus','profileVersion',
            'noticesOptIn','communityUpdates','updatedAt'])
        && request.resource.data.onboardingStatus == 'pending_email'
        && request.resource.data.profileVersion == 2
        && request.resource.data.noticesOptIn == false
        && request.resource.data.communityUpdates == false
        && request.resource.data.updatedAt == request.time;
      allow update: if me(uid) && emailVerificationAllowsCommunityAccess()
        && resource.data.get('onboardingStatus','') == 'pending_email'
        && request.resource.data.keys().hasOnly(['onboardingStatus','profileVersion',
            'noticesOptIn','communityUpdates','updatedAt'])
        && request.resource.data.keys().hasAll(['onboardingStatus','profileVersion',
            'noticesOptIn','communityUpdates','updatedAt'])
        && request.resource.data.diff(resource.data).affectedKeys()
          .hasOnly(['onboardingStatus','updatedAt'])
        && request.resource.data.onboardingStatus == 'complete'
        && request.resource.data.updatedAt == request.time;
    }
    match /profiles/{uid} {
      allow get: if me(uid);
      allow list, delete: if false;
      allow create: if me(uid)
        && request.resource.data.keys().hasAll(['displayName','createdAt'])
        && request.resource.data.keys().hasOnly(['displayName','createdAt'])
        && validText(request.resource.data.displayName,2,35)
        && request.resource.data.createdAt == request.time;
      allow update: if me(uid) && emailVerificationAllowsCommunityAccess()
        && request.resource.data.keys().hasAll(['displayName','createdAt'])
        && request.resource.data.keys().hasOnly(['displayName','createdAt'])
        && validText(request.resource.data.displayName,2,35)
        && request.resource.data.createdAt == request.time;
    }
    match /community_consents/{uid} {
      allow get: if me(uid);
      allow list: if false;
      allow create, update: if me(uid)
        && request.resource.data.keys().hasAll(['version','acceptedAt'])
        && request.resource.data.keys().hasOnly(['version','acceptedAt'])
        && request.resource.data.version == '2026-11-v1'
        && request.resource.data.acceptedAt == request.time;
      allow delete: if me(uid);
    }
    match /users/{uid}/private/preferences {
      allow get, delete: if me(uid);
      allow list: if false;
      // Preferências de fé ficam privadas e exigem aceite separado.
      allow create, update: if me(uid) && emailVerificationAllowsCommunityAccess()
        && request.resource.data.keys().hasAll(['interests','participation','city',
            'parish','consentVersion','consentAt','updatedAt'])
        && request.resource.data.keys().hasOnly(['interests','participation','city',
            'parish','consentVersion','consentAt','updatedAt'])
        && request.resource.data.interests is list
        && request.resource.data.interests.size() <= 4
        && request.resource.data.interests.hasOnly(['Oração','Formação',
            'Comunidade','Notícias católicas'])
        && request.resource.data.participation in
            ['','Leigo(a)','Religioso(a)','Padre/Diácono']
        && validText(request.resource.data.city,0,80)
        && validText(request.resource.data.parish,0,80)
        && request.resource.data.consentVersion == 'cadastro-v2-2026-11'
        && request.resource.data.consentAt == request.time
        && request.resource.data.updatedAt == request.time;
    }
`;
