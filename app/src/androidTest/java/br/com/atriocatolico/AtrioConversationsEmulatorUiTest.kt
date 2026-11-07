package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
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

    private fun waitForComposerReady() {
        waitForTag("atrio-chat-composer")
        compose.waitUntil(35_000) {
            runCatching {
                compose.onNodeWithTag("atrio-chat-composer").assertIsEnabled()
                true
            }.getOrDefault(false)
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

    @Test fun notificacaoParaChatInexistenteNaoCausaCrash() {
        initializeDemo()
        val user = login("group.alice@qa.invalid")
        compose.setContent {
            AtrioTheme {
                AtrioConversationsScreen(db = db, uid = user,
                    initialChatId = "qa-chat-inexistente", onBack = {})
            }
        }
        waitForTag("atrio-chat-thread")
        // Não consultar public_profiles com ID vazio nem mostrar mensagens
        // de uma conversa que não foi autorizada pelo Firestore.
        waitForText("Conversa não encontrada ou acesso negado.")
        assertTrue("Chat inexistente não tem caixa de mensagens", 
            compose.onAllNodesWithTag("atrio-chat-composer", useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty())
    }

    @Test fun logoutFechaTelaDeChatAntesDeOutraSessao() {
        initializeDemo()
        val uid = login("group.alice@qa.invalid")
        compose.setContent {
            AtrioTheme {
                AtrioConversationsScreen(db = db, uid = uid, onBack = {})
            }
        }
        waitForTag("atrio-chats-screen")
        auth.signOut()
        waitForText("Sessão alterada. Entre novamente.")
        assertTrue("Sessão anterior não deve expor a lista de conversas",
            compose.onAllNodesWithTag("atrio-chats-list", useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty())
        login("group.bob@qa.invalid")
        waitForText("Sessão alterada. Entre novamente.")
        assertTrue("Nova identidade não pode reabrir o chat da conta antiga",
            compose.onAllNodesWithTag("atrio-chats-list", useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty())
    }

    @Test fun enviarResponderTrocarContaEBloquearPeloAndroid() {
        initializeDemo()
        // Auth real do EMULADOR; o seed cria apenas as duas contas de teste.
        val bob = login("group.bob@qa.invalid")
        auth.signOut()
        val alice = login("group.alice@qa.invalid")
        val chatId = listOf(alice, bob).sorted().joinToString("__")

        // A aplicação real encerra a UI autenticada ao sair da conta.
        // Não manter listeners privados da sessão anterior durante login
        // da próxima conta no mesmo FirebaseAuth do emulador.
        var screenUid by mutableStateOf<String?>(alice)
        compose.setContent {
            AtrioTheme {
                screenUid?.let { currentUid ->
                    AtrioConversationsScreen(db = db, uid = currentUid, onBack = {})
                }
            }
        }
        fun switchTo(email: String, expectedUid: String) {
            compose.runOnIdle { screenUid = null }
            compose.waitForIdle() // Dispose listeners e estado da conta anterior.
            auth.signOut()
            assertEquals(expectedUid, login(email))
            // Aguarde a nova identidade estar pronta no servidor antes de
            // remontar listeners Firestore da tela autenticada.
            val verified = Tasks.await(
                db.collection("app_config").document("conversations").get(Source.SERVER),
                10, TimeUnit.SECONDS)
            assertTrue("Política de chat do emulador deve estar ativa", 
                verified.getBoolean("enabled") == true)
            compose.runOnIdle { screenUid = expectedUid }
        }
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForComposerReady()

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
        switchTo("group.bob@qa.invalid", bob)
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForComposerReady()
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

        switchTo("group.alice@qa.invalid", alice)
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForComposerReady()

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

        // Reabilitação voluntária pelo próprio titular do bloqueio.
        switchTo("group.bob@qa.invalid", bob)
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForTag("atrio-chat-block-toggle")
        compose.onNodeWithText("Desbloquear participante").performClick()
        compose.waitUntil(30_000) {
            runCatching {
                !Tasks.await(db.collection("users").document(bob)
                    .collection("blockedMembers").document(alice)
                    .get(Source.SERVER), 5, TimeUnit.SECONDS).exists()
            }.getOrDefault(false)
        }

        switchTo("group.alice@qa.invalid", alice)
        waitForTag("atrio-chat-$chatId")
        compose.onNodeWithTag("atrio-chat-$chatId").performClick()
        waitForComposerReady()
        val resumed = "Mensagem retomada após desbloqueio."
        compose.onNodeWithTag("atrio-chat-composer").performTextInput(resumed)
        compose.onNodeWithTag("atrio-chat-send").performClick()
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.collection("chats").document(chatId)
                    .get(Source.SERVER), 5, TimeUnit.SECONDS)
                    .getString("lastPreview") == resumed
            }.getOrDefault(false)
        }
    }
}
