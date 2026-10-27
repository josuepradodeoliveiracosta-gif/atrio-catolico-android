package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Um cenário de E2E com os três bots como usuários Firebase Auth de verdade,
 * fazendo toques no fluxo ONLINE do mesmo app.
 *
 * Proteção obrigatória: credenciais e projeto demo-atrio-v11, host emulado
 * 10.0.2.2, nenhum Worker URL ou credencial de produção. Os testes só são
 * executados dentro do workflow que inicia Firebase Auth + Firestore Emulator.
 */
class ThreeBotsAuthenticatedAndroidUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private val password = "SenhaQA2026!NaoReal"
    private val session = UUID.randomUUID().toString().take(8)

    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("Testes E2E não devem rodar em release", BuildConfig.DEBUG)
        assertTrue("Worker oficial não pode ser configurado no APK E2E",
            BuildConfig.PUSH_RELAY_URL.isBlank())
        val options = FirebaseOptions.Builder()
            .setProjectId("demo-atrio-v11")
            .setApplicationId("1:123456789012:android:0123456789abcdef")
            .setApiKey("qa-emulator-key-not-a-secret")
            .build()
        val apps = FirebaseApp.getApps(context)
        if (apps.isEmpty()) {
            FirebaseApp.initializeApp(context, options)
        }
        assertEquals("O projeto Firebase não é o emulador!",
            "demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        auth = FirebaseAuth.getInstance()
        db = FirebaseFirestore.getInstance()
        auth.useEmulator("10.0.2.2", 9099)
        db.useEmulator("10.0.2.2", 8089)
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    private fun waitFor(tag: String, timeout: Long = 35_000) {
        compose.waitUntil(timeout) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun register(name: String, prefix: String): String {
        waitFor("atrio-auth-toggle")
        compose.onNodeWithTag("atrio-auth-toggle").performClick()
        waitFor("atrio-auth-name")
        compose.onNodeWithTag("atrio-auth-name").performTextInput(name)
        compose.onNodeWithTag("atrio-auth-email")
            .performTextInput("$prefix.$session@qa.invalid")
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-submit").performClick()
        waitFor("atrio-tab-publish", 45_000)
        val uid = auth.currentUser?.uid ?: error("Login Firebase não criou usuário")
        assertTrue("Conta Firebase criada fora do emulador", uid.isNotBlank())
        return uid
    }

    private fun logoutByTouch() {
        compose.onNodeWithTag("atrio-tab-profile").performClick()
        waitFor("atrio-profile-signout")
        compose.onNodeWithTag("atrio-profile-signout")
            .performScrollTo().performClick()
        waitFor("atrio-auth-toggle")
        compose.waitUntil(15_000) { auth.currentUser == null }
    }

    private fun login(prefix: String) {
        waitFor("atrio-auth-email")
        compose.onNodeWithTag("atrio-auth-email")
            .performTextInput("$prefix.$session@qa.invalid")
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-submit").performClick()
        waitFor("atrio-tab-publish", 45_000)
    }

    private fun openDiscussion(postId: String) {
        waitFor("atrio-home-feed")
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-$postId"))
        compose.onNodeWithTag("atrio-post-$postId", useUnmergedTree = true)
            .performClick()
        waitFor("atrio-reply-input")
    }

    private fun sendReply(body: String) {
        compose.onNodeWithTag("atrio-reply-input").performScrollTo()
            .performTextInput(body)
        compose.onNodeWithTag("atrio-reply-submit")
            .performScrollTo().performClick()
    }

    @Test fun claraMiguelLuciaFazemLoginPublicamRespondemERecebemAvisos() {
        compose.setContent { OnlineAtrioApp(compose.activity) }
        val claraUid = register("Clara (BOT DE TESTE)", "clara")
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        waitFor("atrio-publish-title")
        val title = "Teste E2E de Clara $session"
        compose.onNodeWithTag("atrio-publish-title").performTextInput(title)
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Esta discussão pertence a um emulador e valida toques e Firebase Auth.")
        compose.onNodeWithTag("atrio-publish-submit").performClick()

        // O ID da publicação é gerado pelo aplicativo após o toque.
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.collection("posts").whereEqualTo("uid", claraUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).documents
                    .any { it.getString("title") == title }
            }.getOrDefault(false)
        }
        val posts = Tasks.await(db.collection("posts").whereEqualTo("uid", claraUid)
            .get(Source.SERVER), 8, TimeUnit.SECONDS)
        val postId = posts.documents.single { it.getString("title") == title }.id

        logoutByTouch()
        val miguelUid = register("Miguel (BOT DE TESTE)", "miguel")
        assertTrue(claraUid != miguelUid)
        openDiscussion(postId)
        sendReply("Miguel respondeu pelo Android autenticado de testes.")
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("posts").document(postId)
                    .collection("replies").whereEqualTo("uid", miguelUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).size() == 1
            }.getOrDefault(false)
        }
        // Regressa ao feed após responder para testar logout pelos controles.
        compose.onNodeWithText("Voltar", useUnmergedTree = true)
            .performClick()
        logoutByTouch()

        val luciaUid = register("Lúcia (BOT DE TESTE)", "lucia")
        assertTrue(luciaUid != miguelUid && luciaUid != claraUid)
        openDiscussion(postId)
        sendReply("Lúcia respondeu pelo Android autenticado de testes.")
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("posts").document(postId)
                    .collection("replies").whereEqualTo("uid", luciaUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).size() == 1
            }.getOrDefault(false)
        }
        compose.onNodeWithText("Voltar", useUnmergedTree = true)
            .performClick()
        logoutByTouch()

        login("clara")
        assertEquals(claraUid, auth.currentUser?.uid)
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("users").document(claraUid)
                    .collection("notifications").get(Source.SERVER),
                    4, TimeUnit.SECONDS).size() == 2
            }.getOrDefault(false)
        }
        compose.onNodeWithTag("atrio-top-notifications").performClick()
        compose.onNodeWithText("Notificações", substring = true).assertIsDisplayed()
    }
}
