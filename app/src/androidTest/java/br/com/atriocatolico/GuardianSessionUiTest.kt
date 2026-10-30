package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
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
import java.util.concurrent.Executors
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant

/** Exclusivo de emulador: projeto demo e Firebase Auth de teste. */
@RunWith(AndroidJUnit4::class)
class GuardianSessionUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    @Before fun setup() {
        assertTrue(BuildConfig.DEBUG)
        assertTrue(BuildConfig.GUARDIAN_WORKER_URL.isBlank())
        assertEquals("demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        auth = FirebaseAuth.getInstance()
        db = FirebaseFirestore.getInstance()
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun signedOutAuthorCannotOpenAppeal() {
        compose.setContent { GuardiaoAppealsScreen(db, "qaFakeOwner") }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Solicitar revisão").assertDoesNotExist()
        compose.onNodeWithText("Enviar contestação").assertDoesNotExist()
    }

    @Test fun logoutClosesAppealsWithoutWaitingForFirestore() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { GuardiaoAppealsScreen(db, user!!.uid) }
        auth.signOut()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Sessão alterada. Entre novamente.")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Enviar contestação").assertDoesNotExist()
    }

    @Test fun signedOutAdminCannotActivateGuardianOrReview() {
        compose.setContent { GuardianPanel(db, "qaFakeAdmin") }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Preparar triagem sem retenção").assertIsNotEnabled()
        compose.onNodeWithText("Desligamento de emergência").assertIsNotEnabled()
        compose.onNodeWithText("Registrar decisão").assertDoesNotExist()
    }

    @Test fun signedOutModerationHidesPrivateQueue() {
        compose.setContent { ModerationScreen(db, "qaFakeAdmin", onBack = {}) }
        compose.onNodeWithText("Sessão alterada. Entre novamente para acessar a moderação.")
            .assertIsDisplayed()
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }

    @Test fun authenticatedNonAdminCannotReadReportsOrOperateModeration() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { ModerationScreen(db, user!!.uid, onBack = {}) }
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText(
                "Acesso administrativo indisponível. Consulte a administração."
            ).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
        compose.onNodeWithText("Preparar triagem sem retenção").assertDoesNotExist()
    }

    @Test fun offlineModerationNeverAcceptsUnverifiedAdminStatus() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        // Even an authenticated account cannot use a locally cached
        // administrative status as authorization while Firestore is offline.
        Tasks.await(db.disableNetwork(), 10, TimeUnit.SECONDS)
        try {
            compose.setContent { ModerationScreen(db, user!!.uid, onBack = {}) }
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText(
                    "Conferindo permissão administrativa no servidor..."
                ).fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithText(
                    "Acesso administrativo indisponível. Consulte a administração."
                ).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Pendentes").assertDoesNotExist()
            compose.onNodeWithText("Analisadas").assertDoesNotExist()
            compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
            compose.onNodeWithText("Preparar triagem sem retenção").assertDoesNotExist()
        } finally {
            // Restore the local emulator connection even on test failure, so
            // subsequent suites cannot accidentally inherit an offline DB.
            Tasks.await(db.enableNetwork(), 10, TimeUnit.SECONDS)
        }
        // Without an admin grant, server reconnection must not unlock UI.
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText(
                "Acesso administrativo indisponível. Consulte a administração."
            ).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
    }

    /**
     * E2E server-side fixtures are created only over the loopback REST API of
     * Firebase Emulator. The guard rejects any real Firebase project/host,
     * even if a developer tries to execute this test outside its QA runner.
     * REST fixtures bypass client Security Rules ONLY inside the DEMO emulator;
     * the actual Compose screen still uses the authenticated Firebase SDK.
     */
    private fun qaAdminFixture(path: String, fields: String?) {
        assertTrue("Fixture somente em debug", BuildConfig.DEBUG)
        assertTrue("Worker oficial proibido em QA", BuildConfig.GUARDIAN_WORKER_URL.isBlank())
        assertEquals("demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        assertEquals("127.0.0.1:8089", db.firestoreSettings.host)
        require(Regex("^(admins|reports)/[A-Za-z0-9_-]{1,128}$").matches(path))
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

    @Test fun logoutClearsModerationQueueAndButtonsImmediately() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { ModerationScreen(db, user!!.uid, onBack = {}) }
        auth.signOut()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Sessão alterada. Entre novamente para acessar a moderação.")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Sessão alterada. Entre novamente para acessar a moderação.")
            .assertIsDisplayed()
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }
}
