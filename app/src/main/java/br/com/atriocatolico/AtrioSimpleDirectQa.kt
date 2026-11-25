package br.com.atriocatolico

import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore

/** QA físico: endereço fixo de um par fictício, sem consulta global ou cache. */
internal object AtrioSimpleDirectQa {
    const val CHAT_ID = "qa-nav-alice__qa-nav-bob"
    fun peer(uid: String): String? = when (uid) {
        "qa-nav-alice" -> "qa-nav-bob"
        "qa-nav-bob" -> "qa-nav-alice"
        else -> null
    }
    fun verified(uid: String, email: String?, verified: Boolean): Boolean =
        verified && when (uid) {
            "qa-nav-alice" -> email == "alice.navegacao@qa.invalid"
            "qa-nav-bob" -> email == "bob.navegacao@qa.invalid"
            else -> false
        }
}

internal fun atrioSimpleDirectIdentity(db: FirebaseFirestore, user: FirebaseUser): Boolean {
    val options = db.app.options
    val settings = db.firestoreSettings
    return BuildConfig.DEBUG && BuildConfig.ATRIO_QA_GERAL_REMOTE &&
        BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL && BuildConfig.ATRIO_QA_GERAL_CELULAR_RODADA &&
        !BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO && !BuildConfig.ATRIO_QA_INBOX_DISCOVERY &&
        !BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB && !BuildConfig.ATRIO_QA_GERAL_PUSH &&
        qaGeralCelularRoundMatches(BuildConfig.APPLICATION_ID, options.projectId,
            options.applicationId, settings.host, settings.isSslEnabled) &&
        AtrioSimpleDirectQa.verified(user.uid, user.email, user.isEmailVerified)
}
