package br.com.atriocatolico

import com.google.firebase.firestore.FirebaseFirestore
import java.net.URL

/** No user-controlled URL, no production fallback, and no remote use outside the QA candidate. */
internal fun atrioInboxBaseFor(
    enabled: Boolean, remote: Boolean, functionalRound: Boolean,
    projectId: String?, host: String, ssl: Boolean, origin: String
): URL? {
    if (!enabled) return null
    val base = if (!remote) {
        if (projectId != "demo-atrio-v11" || host != "127.0.0.1:8089" || ssl) return null
        "http://127.0.0.1:8091"
    } else {
        if (!functionalRound || projectId != "atrio-catolico-qa-general" ||
            host != "firestore.googleapis.com" || !ssl || origin != QA_GERAL_PUSH_RELAY_URL) return null
        QA_GERAL_PUSH_RELAY_URL
    }
    return URL("$base/v1/qa/conversations/")
}

internal fun atrioManagedInboxBase(db: FirebaseFirestore): URL? {
    val remote = BuildConfig.ATRIO_QA_GERAL_REMOTE
    val settings = db.firestoreSettings
    val options = db.app.options
    val round = BuildConfig.DEBUG && BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL &&
        BuildConfig.ATRIO_QA_GERAL_CELULAR_RODADA && !BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO &&
        !BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB && !BuildConfig.ATRIO_QA_GERAL_PUSH &&
        qaGeralCelularRoundMatches(BuildConfig.APPLICATION_ID, options.projectId,
            options.applicationId, settings.host, settings.isSslEnabled)
    return atrioInboxBaseFor(BuildConfig.ATRIO_QA_INBOX_DISCOVERY, remote, round,
        options.projectId, settings.host, settings.isSslEnabled,
        BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_ORIGIN)
}
