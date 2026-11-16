package br.com.atriocatolico

import android.content.Context
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
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

class AtrioConversasCompostasEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private val aliceEmail = "conversas.alice@qa.invalid"
    private val bobEmail = "conversas.bob@qa.invalid"

    private data class Screen(
        val uid: String,
        val peer: PublicMemberTarget? = null,
        val chatId: String? = null,
        val groupPeer: String? = null,
    )

    private var screen by mutableStateOf<Screen?>(null)

    private fun initializeDemo() {
        assertEquals("br.com.atriocatolico.qageral", BuildConfig.APPLICATION_ID)
        check(BuildConfig.DEBUG && BuildConfig.PUSH_RELAY_URL.isBlank())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val project = "demo-atrio-v11"
        val firebase = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: requireNotNull(FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setProjectId(project)
            .setApplicationId("1:123456789012:android:0123456789abcdef")
            .setApiKey("local-emulator-test")
            .build()))
        check(firebase.options.projectId == project)
        auth = FirebaseAuth.getInstance(firebase)
        auth.useEmulator("127.0.0.1", 9099)
        db = FirebaseFirestore.getInstance(firebase)
        db.useEmulator("127.0.0.1", 8089)
        auth.signOut()
        compose.setContent {
            AtrioTheme {
                screen?.let { current ->
                    if (current.groupPeer == null) {
                        AtrioConversationsScreen(
                            db = db, uid = current.uid, onBack = {},
                            initialPeer = current.peer, initialChatId = current.chatId
                        )
                    } else {
                        AtrioGroupsScreen(db, current.uid, listOf(current.groupPeer), onBack = {})
                    }
                }
            }
        }
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 8, TimeUnit.SECONDS)

    private fun login(email: String): String {
        compose.runOnIdle { screen = null }
        compose.waitForIdle()
        auth.signOut()
        val user = requireNotNull(await(auth.signInWithEmailAndPassword(
            email, "GrupoQa2026!Emulador")).user)
        assertEquals(true, await(user.getIdToken(true)).claims["email_verified"])
        val eligibility = await(db.document("users/${user.uid}/chatAgeEligibility/current")
            .get(Source.SERVER))
        assertEquals("eligible", eligibility.getString("status"))
        return user.uid
    }

    private fun show(destination: Screen) = compose.runOnIdle { screen = destination }

    private fun waitForText(text: String, substring: Boolean = false) {
        compose.waitUntil(30_000) {
            compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitForTag(tag: String) {
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun click(tag: String) {
        waitForTag(tag)
        compose.onNodeWithTag(tag).assertIsDisplayed().performClick()
    }

    private fun send(composer: String, button: String, text: String) {
        compose.waitUntil(30_000) {
            try {
                compose.onNodeWithTag(composer).assertIsEnabled()
                true
            } catch (_: AssertionError) {
                false
            }
        }
        compose.onNodeWithTag(composer).performTextInput(text)
        click(button)
    }

    private fun assertDenied(task: Task<*>) {
        try {
            await(task)
            throw AssertionError("O Firestore Emulator deve negar a leitura.")
        } catch (failure: ExecutionException) {
            val firestore = failure.cause as? FirebaseFirestoreException ?: throw failure
            assertEquals(FirebaseFirestoreException.Code.PERMISSION_DENIED, firestore.code)
        }
    }

    @After fun cleanSession() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun primeiroContatoRecusaAceiteESaidaProtegemHistorico() {
        initializeDemo()
        val alice = login(aliceEmail)
        val bob = login(bobEmail)
        val chatId = AtrioChatPolicy.id(alice, bob)
        val chat = db.document("chats/$chatId")
        val first = "Podemos conversar sobre o grupo de estudo?"

        show(Screen(bob, peer = PublicMemberTarget(alice, "Alice QA")))
        send("atrio-chat-composer", "atrio-chat-send", first)
        waitForText("Pedido não confirmado.", substring = true)
        assertTrue(await(db.collection("chats").whereArrayContains("participants", bob).limit(100)
            .get(Source.SERVER)).isEmpty)

        assertEquals(alice, login(aliceEmail))
        show(Screen(alice, peer = PublicMemberTarget(bob, "Bob QA")))
        send("atrio-chat-composer", "atrio-chat-send", first)
        waitForText("Solicitação enviada.")
        waitForText("Aguardando aceite do destinatário.")
        val pending = await(chat.get(Source.SERVER))
        assertEquals("pending", pending.getString("status"))
        assertEquals(alice, pending.getString("requesterUid"))
        compose.onNodeWithTag("atrio-chat-composer").assertDoesNotExist()

        assertEquals(bob, login(bobEmail))
        show(Screen(bob, chatId = chatId))
        waitForText(first)
        waitForText("Aceitar")
        compose.onNodeWithText("Aceitar").performClick()
        val reply = "Aceitei a conversa de estudo."
        send("atrio-chat-composer", "atrio-chat-send", reply)
        compose.waitUntil(30_000) {
            val document = await(chat.get(Source.SERVER))
            document.getString("status") == "accepted" &&
                document.getString("lastPreview") == reply && !document.metadata.hasPendingWrites()
        }

        assertEquals(alice, login(aliceEmail))
        show(Screen(alice, groupPeer = bob))
        click("atrio-group-create-open")
        waitForTag("atrio-group-title")
        compose.onNodeWithTag("atrio-group-title").performTextInput("Grupo de estudo QA")
        click("atrio-group-create")
        waitForTag("atrio-group-thread")
        val group = await(db.collection("chat_groups").whereArrayContains("memberUids", alice).limit(50)
            .get(Source.SERVER)).documents.single().reference
        val history = group.collection("messages")
        val message = "Histórico fictício anterior ao ingresso."
        send("atrio-group-composer", "atrio-group-send", message)
        compose.waitUntil(30_000) {
            await(history.get(Source.SERVER)).documents.any {
                it.getString("text") == message && !it.metadata.hasPendingWrites()
            }
        }
        val entry = await(history.get(Source.SERVER)).documents.single().reference
        val invite = group.collection("atrioGroupInvites").document(bob)
        fun sendInvite() {
            click("atrio-group-members")
            click("atrio-group-invite-open")
            click("atrio-group-invite-$bob")
            waitForText("Convite enviado. A entrada exige aceite.")
            assertEquals("pending", await(invite.get(Source.SERVER)).getString("status"))
        }
        sendInvite()

        assertEquals(bob, login(bobEmail))
        show(Screen(bob, groupPeer = alice))
        waitForTag("atrio-group-accept-${group.id}")
        assertDenied(entry.get(Source.SERVER))
        waitForText("Recusar")
        compose.onNodeWithText("Recusar").performClick()
        waitForText("Convite recusado.")
        assertEquals("declined", await(invite.get(Source.SERVER)).getString("status"))
        assertDenied(group.get(Source.SERVER))
        assertDenied(entry.get(Source.SERVER))

        assertEquals(alice, login(aliceEmail))
        show(Screen(alice, groupPeer = bob))
        click("atrio-group-${group.id}")
        sendInvite()

        assertEquals(bob, login(bobEmail))
        show(Screen(bob, groupPeer = alice))
        click("atrio-group-accept-${group.id}")
        waitForText(message)
        compose.onNodeWithText(message).assertIsDisplayed()
        assertEquals("accepted", await(invite.get(Source.SERVER)).getString("status"))
        assertTrue((await(group.get(Source.SERVER)).get("memberUids") as List<*>).contains(bob))
        assertEquals(message, await(entry.get(Source.SERVER)).getString("text"))

        click("atrio-group-members")
        click("atrio-group-leave")
        waitForText("Você ainda não participa de grupos.")
        compose.onNodeWithText(message).assertDoesNotExist()
        assertDenied(group.get(Source.SERVER))
        assertDenied(entry.get(Source.SERVER))
        assertDenied(history.get(Source.SERVER))

        assertEquals(alice, login(aliceEmail))
        assertEquals(listOf(alice), await(group.get(Source.SERVER)).get("memberUids"))
        assertEquals(message, await(entry.get(Source.SERVER)).getString("text"))
        android.util.Log.i("AtrioConversasQA",
            "primeiro_contato=confirmado recusa=confirmada aceite=confirmado saida=confirmada " +
                "historico_ex_membro=PERMISSION_DENIED historico_proprietario=preservado")
    }
}
