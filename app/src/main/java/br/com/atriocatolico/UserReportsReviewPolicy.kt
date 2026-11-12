package br.com.atriocatolico

/**
 * Confirmação mínima do gesto humano no painel de denúncias.
 * NÃO autoriza o Firestore nem comprova investigação, sanção ou recurso.
 * A autorização e a transição de status permanecem nas Security Rules.
 */
internal object UserReportsReviewPolicy {
    /**
     * Um callback de rede nao pode alterar uma tela descartada, uma sessao
     * substituida nem uma pagina ja atualizada. Nao concede acesso no servidor.
     */
    fun acceptsAsyncResult(
        expectedUid: String,
        activeUid: String?,
        sameAuthenticatedUser: Boolean,
        panelAttached: Boolean,
        samePageGeneration: Boolean
    ): Boolean = expectedUid.isNotBlank() &&
        activeUid == expectedUid && sameAuthenticatedUser &&
        panelAttached && samePageGeneration

    fun canRegisterReview(
        activeUid: String?,
        adminUid: String,
        reportId: String,
        reportStatus: String?,
        visibleAndPending: Boolean,
        explicitlyConfirmed: Boolean,
        busy: Boolean
    ): Boolean =
        adminUid.isNotBlank() &&
        activeUid == adminUid &&
        reportId.isNotBlank() &&
        reportStatus == "pending" &&
        visibleAndPending &&
        explicitlyConfirmed &&
        !busy
}
