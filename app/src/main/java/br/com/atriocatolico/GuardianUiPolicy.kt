package br.com.atriocatolico

/**
 * Guardas locais da interface do Guardião. São apenas proteções de UX;
 * Firebase Authentication, Firestore Rules e servidor revalidam a autorização.
 * Nenhum privilégio pode ser concedido por estes métodos.
 */
internal object GuardianUiPolicy {
    fun sameSession(expectedUid: String, currentUid: String?): Boolean =
        expectedUid.isNotBlank() && expectedUid == currentUid

    fun canAppeal(
        expectedUid: String, currentUid: String?, status: String,
        previousAppeal: String, busy: Boolean, note: String
    ): Boolean = sameSession(expectedUid, currentUid) && status == "held" &&
        previousAppeal.isBlank() && !busy && note.trim().length in 10..500

    fun canReview(
        expectedUid: String, currentUid: String?, status: String,
        workerConfigured: Boolean, busy: Boolean, note: String,
        evidenceLoaded: Boolean
    ): Boolean = sameSession(expectedUid, currentUid) && workerConfigured &&
        status == "held" && !busy && note.trim().length in 5..300 && evidenceLoaded
}
