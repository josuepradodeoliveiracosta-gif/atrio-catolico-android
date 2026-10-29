package br.com.atriocatolico

import android.os.Bundle
import androidx.test.runner.AndroidJUnitRunner
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Somente testes instrumentados:
 * inicializa um projeto Firebase DEMO e conecta o APK ao Auth e Firestore
 * emulados por ADB reverse, nunca à comunidade oficial. Credenciais são fictícias.
 */
class QaAndroidTestRunner : AndroidJUnitRunner() {
    override fun onCreate(arguments: Bundle?) {
        val context = targetContext
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId("1:1234567890:android:qa123456")
                .setApiKey("fake-api-key-for-local-emulator-only")
                .setProjectId("demo-atrio-v11")
                .build()
        )
        require(app != null && app.options.projectId == "demo-atrio-v11") {
            "QA Android recusado: projeto Firebase não é o emulador de teste."
        }
        FirebaseAuth.getInstance(app).useEmulator("127.0.0.1", 9099)
        FirebaseFirestore.getInstance(app).useEmulator("127.0.0.1", 8089)
        super.onCreate(arguments)
    }
}
