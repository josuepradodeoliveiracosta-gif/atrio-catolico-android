package br.com.atriocatolico

import androidx.activity.ComponentActivity
import android.content.Context
import androidx.test.core.app.ApplicationProvider
import com.google.firebase.FirebaseOptions
import java.util.concurrent.Executors
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** QA exclusivamente local: painel humano sem Worker nem produção. */
@RunWith(AndroidJUnit4::class)
class GuardianSessionUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("Somente APK Debug QA", BuildConfig.DEBUG)
        assertTrue("Não usar Worker oficial nos testes", BuildConfig.PUSH_RELAY_URL.isBlank())
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId("1:1234567890:android:atrioqa")
                .setApiKey("emulator-not-a-real-key")
                .setProjectId("demo-atrio-v11")
                .build()
        )
        requireNotNull(app)
        assertEquals("demo-atrio-v11", app.options.projectId)
        auth = FirebaseAuth.getInstance(app)
        db = FirebaseFirestore.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        val configured = db.firestoreSettings.host
        if (configured != "127.0.0.1:8089") {
            check(configured == "firestore.googleapis.com") {
                "Firestore apontando para host inesperado: $configured"
            }
            db.useEmulator("127.0.0.1", 8089)
        }
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun signedOutAccountCannotSeeModeration() {
        compose.setContent { ModerationScreen(db, "qaFakeAdmin", onBack = {}) }
        compose.onNodeWithText("Sessão alterada. Entre novamente para acessar a moderação.").assertIsDisplayed()
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }

    @Test fun authenticatedNonAdminCannotReadPrivateQueue() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { ModerationScreen(db, user!!.uid, onBack = {}) }
        compose.waitUntil(20_000) {
            compose.onAllNodesWithText(
                "Acesso administrativo indisponível. Consulte a administração."
            ).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }

    private fun qaAdminFixture(path: String, fields: String?) {
        assertTrue("Fixture somente em debug", BuildConfig.DEBUG)
        assertTrue("Worker oficial proibido em QA", BuildConfig.PUSH_RELAY_URL.isBlank())
        assertEquals("demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        assertEquals("127.0.0.1:8089", db.firestoreSettings.host)
        require(
            Regex("^(admins|reports|posts|guardiao_quarantine)/[A-Za-z0-9_-]{1,128}$")
                .matches(path) ||
            Regex("^guardian_notices/[A-Za-z0-9_-]{1,128}/items/[A-Za-z0-9_-]{1,128}$")
                .matches(path)
        )
        val name = "projects/demo-atrio-v11/databases/(default)/documents/$path"
        val write = if (fields == null) {
            """{"delete":"$name"}"""
        } else {
            """{"update":{"name":"$name","fields":$fields}}"""
        }
        val payload = """{"writes":[$write]}"""
        val pool = Executors.newSingleThreadExecutor()
        try {
            val response = pool.submit<Int> {
                val endpoint =
                    "http://127.0.0.1:8089/v1/projects/demo-atrio-v11/databases/(default)/documents:commit"
                val connection = URL(endpoint).openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 5_000
                    connection.readTimeout = 5_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    // "owner" is recognized ONLY by the local Firestore Emulator.
                    // Production endpoints are impossible: literal 127.0.0.1,
                    // demo project guard, and emulator host assertion above.
                    // Without this header, anonymous REST fixture writes are
                    // correctly denied by the actual Firestore Security Rules.
                    connection.setRequestProperty("Authorization", "Bearer owner")
                    connection.outputStream.use {
                        it.write(payload.toByteArray(Charsets.UTF_8))
                    }
                    connection.responseCode
                } finally {
                    connection.disconnect()
                }
            }.get(12, TimeUnit.SECONDS)
            assertEquals("Fixture REST deve existir somente no Firestore Emulator", 200, response)
        } finally {
            pool.shutdownNow()
        }
    }


    @Test fun authorizedAdminSeesReportButOfflineAndRevokedAdminCannot() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        val uid = user!!.uid
        val reportId = "qaAdminUi_$uid"
        val reason = "Denuncia sintetica exclusiva do painel QA"
        try {
            qaAdminFixture("admins/$uid", """{"enabled":{"booleanValue":true}}""")
            val timestamp = Instant.now().toString()
            qaAdminFixture("reports/$reportId", """
                {"createdAt":{"timestampValue":"$timestamp"},
                 "postId":{"stringValue":"qaPostOnly"},
                 "reason":{"stringValue":"$reason"},
                 "status":{"stringValue":"pending"},
                 "reporterUid":{"stringValue":"qaReporterOnly"}}
                """.trimIndent())
            compose.setContent { ModerationScreen(db, uid, onBack = {}) }
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText(reason)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Pendentes").assertIsDisplayed()
            compose.onNodeWithText(reason).assertIsDisplayed()

            // A previously authorized admin loses UI authorization as soon
            // as the listener reports cached/offline metadata.
            Tasks.await(db.disableNetwork(), 10, TimeUnit.SECONDS)
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText(
                    "Conferindo permissão administrativa no servidor..."
                ).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(reason).assertDoesNotExist()
            compose.onNodeWithText("Pendentes").assertDoesNotExist()
            Tasks.await(db.enableNetwork(), 10, TimeUnit.SECONDS)
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText(reason)
                    .fetchSemanticsNodes().isNotEmpty()
            }

            // Simulate instant revocation by a privileged fixture writer.
            // Firestore rules are still enforced for all Android SDK calls.
            qaAdminFixture("admins/$uid", """{"enabled":{"booleanValue":false}}""")
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText(
                    "Acesso administrativo indisponível. Consulte a administração."
                ).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(reason).assertDoesNotExist()
            compose.onNodeWithText("Pendentes").assertDoesNotExist()
        } finally {
            Tasks.await(db.enableNetwork(), 10, TimeUnit.SECONDS)
            auth.signOut()
            qaAdminFixture("reports/$reportId", null)
            qaAdminFixture("admins/$uid", null)
        }
    }

}
