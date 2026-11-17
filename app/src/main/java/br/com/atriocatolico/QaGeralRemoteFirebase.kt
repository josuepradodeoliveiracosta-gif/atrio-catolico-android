package br.com.atriocatolico

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth

internal const val QA_GERAL_PUSH_RELAY_URL = "https://atrio-push-qa-general.atrio-catolico.workers.dev"

internal fun qaGeralRemoteFirebaseReady(context: Context): Boolean {
    val options = FirebaseApp.getApps(context)
        .firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.options ?: return false
    return BuildConfig.ATRIO_QA_GERAL_REMOTE &&
        BuildConfig.APPLICATION_ID == "br.com.atriocatolico.qageral" &&
        options.projectId == BuildConfig.ATRIO_QA_GERAL_PROJECT_ID &&
        options.applicationId == BuildConfig.ATRIO_QA_GERAL_APP_ID
}

internal fun qaGeralPushSessionReady(context: Context, uid: String): Boolean {
    if (!BuildConfig.ATRIO_QA_GERAL_PUSH || !qaGeralRemoteFirebaseReady(context)) return false
    val expectedEmail = when (uid) {
        "qa-nav-alice" -> "alice.navegacao@qa.invalid"
        "qa-nav-bob" -> "bob.navegacao@qa.invalid"
        else -> return false
    }
    val user = FirebaseAuth.getInstance().currentUser ?: return false
    return user.uid == uid && user.email == expectedEmail && user.isEmailVerified
}
