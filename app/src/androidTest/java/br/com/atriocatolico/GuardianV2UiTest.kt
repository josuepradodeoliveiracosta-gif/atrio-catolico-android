package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.android.gms.tasks.Tasks
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.net.HttpURLConnection
import java.net.URL
import java.time.Instant
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

/**
 * Exclusivo do Firestore/Auth Emulator: valida UI V2 nova.
 * NÃO repete a suíte V1 GuardianSessionUiTest; não chama Worker ou Firebase real.
 * Cada teste roda com o runner Android instrumentado e projeto demo fixo.
 */
@RunWith(AndroidJUnit4::class)
class GuardianV2UiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private val demo = "demo-atrio-v11"

    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("Somente aplicativo Debug QA", BuildConfig.DEBUG)
        assertTrue("Sem Worker oficial no teste", BuildConfig.PUSH_RELAY_URL.isBlank())
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setApplicationId("1:1234567890:android:guardianv2qa")
            .setApiKey("emulator-not-a-real-key")
            .setProjectId(demo)
            .build())
        requireNotNull(app)
        assertEquals(demo, app.options.projectId)
        auth = FirebaseAuth.getInstance(app)
        db = FirebaseFirestore.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        if (db.firestoreSettings.host != "127.0.0.1:8089") {
            assertEquals("firestore.googleapis.com", db.firestoreSettings.host)
            db.useEmulator("127.0.0.1", 8089)
        }
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    // Emulator-only privileged fixture writer. Never accept arbitrary paths.
    private fun fixture(path: String, fields: String?) {
        assertTrue(BuildConfig.DEBUG && BuildConfig.PUSH_RELAY_URL.isBlank())
        assertEquals(demo, FirebaseApp.getInstance().options.projectId)
        assertEquals("127.0.0.1:8089", db.firestoreSettings.host)
        require(
            Regex("^(admins|guardian_cases)/[A-Za-z0-9_-]{1,128}$").matches(path) ||
            Regex("^guardian_notices/[A-Za-z0-9_-]{1,128}/items/[A-Za-z0-9_-]{1,128}$").matches(path)
        )
        val name = "projects/$demo/databases/(default)/documents/$path"
        val write = if (fields == null) """{"delete":"$name"}"""
            else """{"update":{"name":"$name","fields":$fields}}"""
        val payload = """{"writes":[$write]}"""
        val pool = Executors.newSingleThreadExecutor()
        try {
            val status = pool.submit<Int> {
                val connection = URL(
                    "http://127.0.0.1:8089/v1/projects/$demo/databases/(default)/documents:commit"
                ).openConnection() as HttpURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.connectTimeout = 5_000
                    connection.readTimeout = 5_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Authorization", "Bearer owner")
                    connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                    connection.responseCode
                } finally {
                    connection.disconnect()
                }
            }.get(12, TimeUnit.SECONDS)
            assertEquals("Somente Firestore Emulator local", 200, status)
        } finally {
            pool.shutdownNow()
        }
    }

    private fun login(): String {
        val uid = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user?.uid.orEmpty()
        assertTrue("UID do Auth Emulator obrigatória", uid.isNotBlank())
        return uid
    }

    private fun awaitText(value: String) {
        compose.waitUntil(25_000) {
            compose.onAllNodesWithText(value).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(value).assertIsDisplayed()
    }

    @Test fun adminSeesV2CasesAndRevocationHidesPanel() {
        val uid = login()
        val id = "guard_" + "a".repeat(32)
        val rule = "qa_rule_v2"
        val now = Instant.now().toString()
        try {
            fixture("admins/$uid", """{"enabled":{"booleanValue":true}}""")
            fixture("guardian_cases/$id", """
                {"ownerUid":{"stringValue":"fictitiousOwner"},
                 "status":{"stringValue":"review"},
                 "ruleCode":{"stringValue":"$rule"},
                 "engine":{"stringValue":"v2"},
                 "createdAt":{"timestampValue":"$now"}}
            """.trimIndent())
            compose.setContent { ModerationScreen(db, uid, onBack = {}) }
            awaitText("Átrio Guardião V2 — casos em análise")
            awaitText("Últimos 1 casos · revisão: 1")
            fixture("admins/$uid", """{"enabled":{"booleanValue":false}}""")
            awaitText("Acesso administrativo indisponível. Consulte a administração.")
            compose.onNodeWithText("Últimos 1 casos · revisão: 1").assertDoesNotExist()
        } finally {
            auth.signOut()
            fixture("guardian_cases/$id", null)
            fixture("admins/$uid", null)
        }
    }

    @Test fun ownerSeesV2NoticeAndLogoutRemovesPrivateText() {
        val uid = login()
        val id = "v2_notice_fixture"
        val title = "Aviso reservado do Guardião V2"
        val body = "Conteúdo fictício disponível apenas ao destinatário."
        val now = Instant.now().toString()
        try {
            fixture("guardian_notices/$uid/items/$id", """
                {"title":{"stringValue":"$title"},
                 "body":{"stringValue":"$body"},
                 "createdAt":{"timestampValue":"$now"}}
            """.trimIndent())
            compose.setContent { GuardianNoticeFeed(db, uid) }
            awaitText(title)
            awaitText(body)
            auth.signOut()
            awaitText("Sessão alterada. Entre novamente.")
            compose.onNodeWithText(body).assertDoesNotExist()
            val otherUid = login()
            assertFalse("Troca de conta precisa gerar outra identidade", otherUid == uid)
            awaitText("Sessão alterada. Entre novamente.")
            compose.onNodeWithText(title).assertDoesNotExist()
        } finally {
            auth.signOut()
            fixture("guardian_notices/$uid/items/$id", null)
        }
    }

    @Test fun nonAdminCannotListV2CasesEvenWithExistingCase() {
        val uid = login()
        val id = "guard_" + "b".repeat(32)
        try {
            fixture("guardian_cases/$id", """
                {"ownerUid":{"stringValue":"anotherUser"},
                 "status":{"stringValue":"review"},
                 "ruleCode":{"stringValue":"restricted_fixture"},
                 "createdAt":{"timestampValue":"${Instant.now()}"}}
            """.trimIndent())
            // Rendering this component directly must still respect Firestore Rules.
            compose.setContent { GuardianCaseOverview(db, uid) }
            awaitText("Casos indisponíveis. Verifique a conexão e o acesso administrativo.")
            compose.onNodeWithText("Últimos 1 casos · revisão: 1").assertDoesNotExist()
        } finally {
            auth.signOut()
            fixture("guardian_cases/$id", null)
        }
    }
}
