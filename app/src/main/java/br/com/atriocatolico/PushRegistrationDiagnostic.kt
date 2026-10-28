package br.com.atriocatolico

/** Mensagens fixas, sem dados pessoais, tokens ou texto de exceções. */
internal enum class PushRegistrationProblem {
    SESSION_CHANGED, TOKEN_UNAVAILABLE, PLAY_SERVICES_UNAVAILABLE,
    TOKEN_SERVICE_UNAVAILABLE, TOKEN_CONFIG_OR_AUTH,
    FIRESTORE_PERMISSION_DENIED, FIRESTORE_UNAVAILABLE, FIRESTORE_WRITE_FAILED
}

internal fun pushRegistrationMessage(issue: PushRegistrationProblem?): String = when (issue) {
    PushRegistrationProblem.SESSION_CHANGED ->
        "Sua sessão mudou. Entre novamente na conta e tente ativar os avisos."
    PushRegistrationProblem.TOKEN_UNAVAILABLE ->
        "Etapa 1/2 — Token FCM: não foi possível obter o token. Confira a conexão e tente novamente."
    PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE ->
        "Etapa 1/2 — Token FCM: Serviços do Google Play indisponíveis. Verifique se estão ativos e atualizados."
    PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE ->
        "Etapa 1/2 — Token FCM: serviço temporariamente indisponível. Confira a internet."
    PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH ->
        "Etapa 1/2 — Token FCM: falha de configuração ou autenticação do Firebase. Confira a configuração Android do projeto."
    PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED ->
        "Etapa 2/2 — Firestore: token FCM obtido, mas o cadastro foi negado por permissão. Confira as regras publicadas."
    PushRegistrationProblem.FIRESTORE_UNAVAILABLE ->
        "Etapa 2/2 — Firestore: token FCM obtido, mas o banco está indisponível. Confira a conexão."
    PushRegistrationProblem.FIRESTORE_WRITE_FAILED ->
        "Etapa 2/2 — Firestore: token FCM obtido, mas não foi possível salvar o cadastro do aparelho."
    null -> "O registro de notificações foi interrompido. Tente novamente."
}
