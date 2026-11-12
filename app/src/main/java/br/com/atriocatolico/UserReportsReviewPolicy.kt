package br.com.atriocatolico

/**
 * Confirmação mínima do gesto humano no painel de denúncias.
 * NÃO autoriza o Firestore nem comprova investigação, sanção ou recurso.
 * A autorização e a transição de status permanecem nas Security Rules.
 */
internal object UserReportsReviewPolicy {
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
