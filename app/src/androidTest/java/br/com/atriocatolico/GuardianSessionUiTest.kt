package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
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
        // O painel não deve compor sequer botões administrativos fora da sessão;
        // somente desativá-los ainda revelaria controles privados desnecessários.
        compose.onNodeWithText("Preparar triagem sem retenção").assertDoesNotExist()
        compose.onNodeWithText("Desligamento de emergência").assertDoesNotExist()
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

    /**
     * Positive Compose-to-Firestore proof of supervised moderation:
     * an authorized admin dismisses a synthetic report WITHOUT deleting
     * its legitimate post. The fixtures use only loopback Emulator REST.
     */
    @Test fun authorizedAdminDismissesReportWithoutDeletingLegitimatePost() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        val uid = user!!.uid
        val postId = "qaContextPost_${uid}"
        val reportId = "qaReporter_post_${postId}"
        val reason = "Revisão de contexto católico em QA"
        val note = "Conteúdo religioso legítimo, denúncia encerrada após análise humana."
        try {
            qaAdminFixture("admins/$uid", """{"enabled":{"booleanValue":true}}""")
            val timestamp = Instant.now().toString()
            qaAdminFixture("posts/$postId", """
                {"uid":{"stringValue":"qaAuthorFicticio"},
                 "authorName":{"stringValue":"Autora fictícia"},
                 "title":{"stringValue":"Diálogo sobre a caridade"},
                 "body":{"stringValue":"O Evangelho convida à paz e ao respeito."},
                 "category":{"stringValue":"Vida espiritual"},
                 "createdAt":{"timestampValue":"$timestamp"}}
                """.trimIndent())
            qaAdminFixture("reports/$reportId", """
                {"createdAt":{"timestampValue":"$timestamp"},
                 "postId":{"stringValue":"$postId"},
                 "reason":{"stringValue":"$reason"},
                 "status":{"stringValue":"pending"},
                 "reporterUid":{"stringValue":"qaReporterFicticio"}}
                """.trimIndent())

            compose.setContent { ModerationScreen(db, uid, onBack = {}) }
            compose.waitUntil(25_000) {
                compose.onAllNodesWithText(reason)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(reason).performClick()
            compose.onNodeWithText("Analisar publicação").assertIsDisplayed()
            compose.onNodeWithText("Justificativa da decisão").performTextInput(note)
            compose.onNodeWithText("Encerrar sem remover").performClick()

            compose.waitUntil(25_000) {
                val result = Tasks.await(
                    db.collection("reports").document(reportId).get(
                        com.google.firebase.firestore.Source.SERVER
                    ), 5, TimeUnit.SECONDS)
                result.getString("status") == "dismissed"
            }
            val decision = Tasks.await(
                db.collection("reports").document(reportId).get(
                    com.google.firebase.firestore.Source.SERVER
                ), 10, TimeUnit.SECONDS)
            assertEquals(note, decision.getString("reviewNote"))
            assertEquals("post", decision.getString("reviewTarget"))
            assertEquals(uid, decision.getString("reviewedBy"))
            val post = Tasks.await(
                db.collection("posts").document(postId).get(
                    com.google.firebase.firestore.Source.SERVER
                ), 10, TimeUnit.SECONDS)
            assertTrue("Uma denúncia improcedente não pode remover o post", post.exists())
            assertEquals("O Evangelho convida à paz e ao respeito.", post.getString("body"))
        } finally {
            // Emulator-only cleanup; do not leave fake reports on the next UI test.
            qaAdminFixture("reports/$reportId", null)
            qaAdminFixture("posts/$postId", null)
            qaAdminFixture("admins/$uid", null)
        }
    }

    /**
     * Positive author-side appeal UI. Retention is an emulator fixture only:
     * no production worker is enabled and no real user content is quarantined.
     */
    @Test fun authorAppealsHeldFixtureOnceThroughAndroidUi() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        val uid = user!!.uid
        val caseId = "qaAppeal_${uid}"
        val reason = "Retenção fictícia para revisão de contexto"
        val explanation = "Minha resposta apenas citava um trecho religioso; solicito análise do contexto."
        try {
            qaAdminFixture("guardiao_quarantine/$caseId", """
                {"ownerUid":{"stringValue":"$uid"},
                 "status":{"stringValue":"held"},
                 "targetType":{"stringValue":"reply"},
                 "reason":{"stringValue":"$reason"}}
                """.trimIndent())

            compose.setContent { GuardiaoAppealsScreen(db, uid) }
            compose.waitUntil(25_000) {
                compose.onAllNodesWithText(reason)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Solicitar revisão").performClick()
            compose.onNodeWithText("Justificativa (10 a 500 caracteres)")
                .performTextInput(explanation)
            compose.onNodeWithText("Enviar contestação").performClick()

            compose.waitUntil(25_000) {
                val result = Tasks.await(
                    db.collection("guardiao_quarantine").document(caseId).get(
                        com.google.firebase.firestore.Source.SERVER
                    ), 5, TimeUnit.SECONDS)
                result.getString("appealText") == explanation
            }
            val case = Tasks.await(
                db.collection("guardiao_quarantine").document(caseId).get(
                    com.google.firebase.firestore.Source.SERVER
                ), 10, TimeUnit.SECONDS)
            assertEquals("held", case.getString("status"))
            assertEquals(explanation, case.getString("appealText"))
            assertTrue("O recurso precisa de registro temporal", case.getTimestamp("appealedAt") != null)
            // A tela não pode aceitar outro recurso sobre o mesmo caso.
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText("Solicitar revisão")
                    .fetchSemanticsNodes().isEmpty()
            }
        } finally {
            qaAdminFixture("guardiao_quarantine/$caseId", null)
        }
    }

    @Test fun logoutImmediatelyHidesPrivateGuardianNotices() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        val uid = user!!.uid
        val noticeId = "qaPrivateNotice"
        val path = "guardian_notices/$uid/items/$noticeId"
        val privateText = "Aviso privado de teste - não exibir após sair"
        try {
            qaAdminFixture(path, """
                {"createdAt":{"timestampValue":"${Instant.now()}"},
                 "title":{"stringValue":"Aviso privado QA"},
                 "body":{"stringValue":"$privateText"}}
                """.trimIndent())
            compose.setContent { GuardianNoticeFeed(db, uid) }
            compose.waitUntil(20_000) {
                compose.onAllNodesWithText(privateText)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(privateText).assertIsDisplayed()
            auth.signOut()
            compose.waitUntil(15_000) {
                compose.onAllNodesWithText("Sessão alterada. Entre novamente.")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(privateText).assertDoesNotExist()
            compose.onNodeWithText("Aviso privado QA").assertDoesNotExist()
        } finally {
            qaAdminFixture(path, null)
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
