package br.com.atriocatolico

/**
 * Diagnóstico público e seguro do cadastro FCM.
 * Não expor UID, token, endpoint, credenciais ou mensagens de exceção.
 */
internal enum class PushRegistrationProblem {
    SESSION_CHANGED,
    TOKEN_UNAVAILABLE,
    PLAY_SERVICES_UNAVAILABLE,
    TOKEN_SERVICE_UNAVAILABLE,
    TOKEN_CONFIG_OR_AUTH,
    FIRESTORE_PERMISSION_DENIED,
    FIRESTORE_UNAVAILABLE,
    FIRESTORE_WRITE_FAILED,
    TOPIC_SUBSCRIPTION_FAILED
}

internal fun pushRegistrationMessage(problem: PushRegistrationProblem?): String = when (problem) {
    PushRegistrationProblem.SESSION_CHANGED ->
        "Sua sessão mudou durante o cadastro. Entre na conta e tente novamente."
    PushRegistrationProblem.TOKEN_UNAVAILABLE ->
        "Etapa 1/3 — Token FCM: não foi possível obter o token. Verifique a conexão e tente novamente."
    PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE ->
        "Etapa 1/3 — Token FCM: Serviços do Google Play indisponíveis. Verifique se estão ativos e atualizados."
    PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE ->
        "Etapa 1/3 — Token FCM: serviço temporariamente indisponível. Confira a internet e tente novamente."
    PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH ->
        "Etapa 1/3 — Token FCM: falha de configuração ou autenticação do Firebase. É necessário conferir a configuração Android do projeto."
    PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED ->
        "Etapa 2/3 — Firestore: token FCM obtido, mas o cadastro do aparelho foi negado por permissão. Confira as regras publicadas antes de alterá-las."
    PushRegistrationProblem.FIRESTORE_UNAVAILABLE ->
        "Etapa 2/3 — Firestore: token FCM obtido, mas o banco está temporariamente indisponível. Verifique a conexão."
    PushRegistrationProblem.FIRESTORE_WRITE_FAILED ->
        "Etapa 2/3 — Firestore: token FCM obtido, mas não foi possível salvar o aparelho no Firebase."
    PushRegistrationProblem.TOPIC_SUBSCRIPTION_FAILED ->
        "Etapa 3/3 — Comunicados: token FCM obtido e aparelho registrado no Firestore, mas a inscrição nos comunicados falhou. Tente novamente."
    null -> "O cadastro de notificações foi interrompido. Tente novamente."
}
