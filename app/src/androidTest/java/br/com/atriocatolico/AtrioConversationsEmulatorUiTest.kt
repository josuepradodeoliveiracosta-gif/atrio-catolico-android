package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

/**
 * QA real de toques Compose e alternância de duas contas Auth emuladas.
 * Usa somente 127.0.0.1:9099 / 8089 com projeto demo-atrio-v11,
 * previamente preparado por seed-chat-groups-android.mjs.
 * A suite aborta se identificar qualquer configuração de produção.
 */
class AtrioConversationsEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val demoProject = "demo-atrio-v11"
    private val password = "GrupoQa2026!Emulador"
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    private fun initializeDemo() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        val firebase = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(context,
            FirebaseOptions.Builder()
                .setProjectId(demoProject)
                .setApplicationId("1:123456789012:android:0123456789abcdef")
                .setApiKey("local-emulator-test")
                .build())
        requireNotNull(firebase)
        check(BuildConfig.DEBUG && BuildConfig.PUSH_RELAY_URL.isBlank())
        check(firebase.options.projectId == demoProject)
        auth = FirebaseAuth.getInstance(firebase)
        db = FirebaseFirestore.getInstance(firebase)
        auth.useEmulator("127.0.0.1", 9099)
        val host = db.firestoreSettings.host
        if (host != "127.0.0.1:8089") {
            check(host == "firestore.googleapis.com") {
                "Firestore não está no modo isolado: $host"
            }
            db.useEmulator("127.0.0.1", 8089)
        }
        auth.signOut()
    }

    private fun login(email: String): String {
        val result = Tasks.await(auth.signInWithEmailAndPassword(email, password),
            25, TimeUnit.SECONDS)
        val uid = requireNotNull(result.user?.uid)
        Tasks.await(result.user!!.getIdToken(false), 15, TimeUnit.SECONDS)
        return uid
    }

    private fun waitForTag(tag: String, timeoutMs: Long = 35_000) {
        compose.waitUntil(timeoutMs) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForText(text: String, timeoutMs: Long = 35_000) {
        compose.waitUntil(timeoutMs) {
            compose.onAllNodesWithText(text, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    @After fun cleanSession() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun enviarResponderTrocarContaEBloquearPeloAndroid() {
        initializeDemo()
        // Auth real do EMULADOR; o seed cria apenas as duas contas de teste.
        val bob = login("group.bob@qa.invalid")
        auth.signOut()
        val alice = login("group.alice@qa.invalid")
        val chatId = listOf(alice, bob).sorted().joinToString("__")

        var screenUid by mutableStateOf(alice)
        compose.setContent {
            AtrioTheme {
                AtrioConversationsScreen(db = db, uid = screenUid, onBack = {})
            }
        }
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForTag("atrio-chat-composer")

        val aliceText = "Paz e bem! Mensagem privada de homologação."
        compose.onNodeWithTag("atrio-chat-composer").performTextInput(aliceText)
        compose.onNodeWithTag("atrio-chat-send").performClick()
        compose.waitUntil(35_000) {
            runCatching {
                val snapshot = Tasks.await(
                    db.collection("chats").document(chatId).collection("messages")
                        .get(Source.SERVER), 5, TimeUnit.SECONDS)
                snapshot.documents.any {
                    it.getString("uid") == alice && it.getString("text") == aliceText
                }
            }.getOrDefault(false)
        }
        val firstRoom = Tasks.await(
            db.collection("chats").document(chatId).get(Source.SERVER),
            8, TimeUnit.SECONDS)
        assertEquals(alice, firstRoom.getString("lastSenderUid"))
        assertEquals(aliceText, firstRoom.getString("lastPreview"))

        // Troca efetiva de sessão Firebase + recomposição de toda a inbox.
        auth.signOut()
        assertEquals(bob, login("group.bob@qa.invalid"))
        compose.runOnIdle { screenUid = bob }
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForTag("atrio-chat-composer")
        waitForText(aliceText)
        compose.onNodeWithText(aliceText).assertIsDisplayed()

        val bobText = "Amém! Resposta recebida na outra conta."
        compose.onNodeWithTag("atrio-chat-composer").performTextInput(bobText)
        compose.onNodeWithTag("atrio-chat-send").performClick()
        compose.waitUntil(35_000) {
            runCatching {
                val room = Tasks.await(db.collection("chats").document(chatId)
                    .get(Source.SERVER), 5, TimeUnit.SECONDS)
                room.getString("lastPreview") == bobText &&
                    room.getString("lastSenderUid") == bob
            }.getOrDefault(false)
        }
        waitForText(bobText)

        // Bloqueio pelo botão real da UI revoga novos envios no servidor.
        compose.onNodeWithText("Bloquear participante").performClick()
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("users").document(bob)
                    .collection("blockedMembers").document(alice)
                    .get(Source.SERVER), 5, TimeUnit.SECONDS).exists()
            }.getOrDefault(false)
        }

        auth.signOut()
        assertEquals(alice, login("group.alice@qa.invalid"))
        compose.runOnIdle { screenUid = alice }
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForTag("atrio-chat-composer")

        val rejected = "Tentativa proibida após bloqueio."
        compose.onNodeWithTag("atrio-chat-composer").performTextInput(rejected)
        compose.onNodeWithTag("atrio-chat-send").performClick()
        waitForText("Envio não confirmado. Confira a conexão.")
        val messages = Tasks.await(
            db.collection("chats").document(chatId).collection("messages")
                .get(Source.SERVER), 8, TimeUnit.SECONDS)
        assertTrue("Bloqueio deve impedir nova mensagem persistida",
            messages.documents.none { it.getString("text") == rejected })
        assertTrue("Mensagem original não pode desaparecer",
            messages.documents.any { it.getString("text") == aliceText })
        assertTrue("Resposta original não pode desaparecer",
            messages.documents.any { it.getString("text") == bobText })
    }
}
