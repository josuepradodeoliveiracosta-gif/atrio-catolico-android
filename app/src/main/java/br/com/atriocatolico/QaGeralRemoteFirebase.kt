package br.com.atriocatolico

import android.content.Context
import com.google.firebase.FirebaseApp

internal fun qaGeralRemoteFirebaseReady(context: Context): Boolean {
    val options = FirebaseApp.getApps(context)
        .firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }?.options ?: return false
    return BuildConfig.ATRIO_QA_GERAL_REMOTE &&
        BuildConfig.APPLICATION_ID == "br.com.atriocatolico.qageral" &&
        options.projectId == BuildConfig.ATRIO_QA_GERAL_PROJECT_ID &&
        options.applicationId == BuildConfig.ATRIO_QA_GERAL_APP_ID
}
