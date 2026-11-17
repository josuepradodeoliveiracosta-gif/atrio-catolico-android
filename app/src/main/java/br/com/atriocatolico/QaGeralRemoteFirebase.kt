package br.com.atriocatolico

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth

internal const val QA_GERAL_PUSH_RELAY_URL = "https://atrio-push-qa-general.atrio-catolico.workers.dev"

internal fun qaGeralCelularFixtureMatches(packageName: String, projectId: String?, appId: String?): Boolean =
    packageName == "br.com.atriocatolico.qageral.celular" &&
        projectId == "atrio-catolico-qa-geral-ficticio" &&
        appId == "1:000000000000:android:0000000000000000000000"

internal fun qaGeralCelularFunctionalMatches(
    packageName: String, projectId: String?, appId: String?, expectedAppId: String
): Boolean = packageName == "br.com.atriocatolico.qageral.celular" &&
    projectId == "atrio-catolico-qa-general" &&
    expectedAppId.isNotEmpty() && appId == expectedAppId

internal fun qaGeralRemoteFirebaseReady(context: Context): Boolean {
    if (!BuildConfig.ATRIO_QA_GERAL_REMOTE) return false
    val options = FirebaseApp.getApps(context)
        .firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.options ?: return false
    return when {
        BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO ->
            qaGeralCelularFixtureMatches(context.packageName, options.projectId, options.applicationId)
        BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL ->
            qaGeralCelularFunctionalMatches(
                context.packageName, options.projectId, options.applicationId, BuildConfig.ATRIO_QA_GERAL_APP_ID
            )
        else -> BuildConfig.APPLICATION_ID == "br.com.atriocatolico.qageral" &&
            options.projectId == BuildConfig.ATRIO_QA_GERAL_PROJECT_ID &&
            options.applicationId == BuildConfig.ATRIO_QA_GERAL_APP_ID
    }
}

internal fun qaGeralPushSessionReady(context: Context, uid: String): Boolean {
    if (!BuildConfig.ATRIO_QA_GERAL_PUSH || BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO ||
        BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL
    ) return false
    if (!qaGeralRemoteFirebaseReady(context)) return false
    val expectedEmail = when (uid) {
        "qa-nav-alice" -> "alice.navegacao@qa.invalid"
        "qa-nav-bob" -> "bob.navegacao@qa.invalid"
        else -> return false
    }
    val user = FirebaseAuth.getInstance().currentUser ?: return false
    return user.uid == uid && user.email == expectedEmail && user.isEmailVerified
}
