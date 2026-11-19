package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Rodar com Auth/Firestore Emulator e a fixture HTTP da #359 por ADB na porta 8091. */
@RunWith(AndroidJUnit4::class)
class AtrioInboxMessageEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun preservesFirstContactDuring503AndTextDuringLostCommitResponse() {
        val db = FirebaseFirestore.getInstance()
        val auth = FirebaseAuth.getInstance(db.app)
        check(isAtrioManagedInboxQa(db))
        auth.signOut()
        val user = requireNotNull(Tasks.await(auth.signInWithEmailAndPassword(
            "inbox.clara@qa.invalid", "InboxQa355!Emulador"), 10, TimeUnit.SECONDS).user)
        val contact = PublicMemberTarget("qa-inbox-message-contact", "Contato QA")
        val accepted = PublicMemberTarget("qa-inbox-peer-02", "Par QA 02")
        val target = mutableStateOf(contact)
        val contactId = AtrioChatPolicy.id(user.uid, contact.uid)
        val acceptedId = AtrioChatPolicy.id(user.uid, accepted.uid)
        val token = requireNotNull(Tasks.await(user.getIdToken(false), 10, TimeUnit.SECONDS).token)
        val discovery = AtrioInboxDiscovery()
        val messages = AtrioInboxMessageHttp(token = { token })

        fun page(cursor: String? = null): AtrioInboxResult.Page {
            val result = discovery.fetch(user.uid, token, cursor)
            check(result is AtrioInboxResult.Page) { "Esperava uma página autorizada: ${result.javaClass.simpleName}" }
            return result
        }

        fun traverse(first: AtrioInboxResult.Page): List<AtrioInboxEntry> {
            val entries = first.items.toMutableList()
            val cursors = mutableSetOf<String>()
            var next = first.nextCursor
            while (next != null) {
                check(cursors.add(next)) { "A paginação repetiu um cursor." }
                check(cursors.size <= 5) { "A paginação excedeu os dados da fixture." }
                val continuation = page(next)
                entries.addAll(continuation.items)
                next = continuation.nextCursor
            }
            assertEquals(entries.size, entries.map { it.chatId }.toSet().size)
            return entries
        }

        fun waitForText(text: String, substring: Boolean = false) = compose.waitUntil(25_000) {
            compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()
        }
        fun clickSend(text: String) {
            compose.waitUntil(20_000) {
                compose.onAllNodes(hasTestTag("atrio-chat-send") and hasText(text) and isEnabled())
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("atrio-chat-send").performClick()
        }
        fun waitForComposer() = compose.waitUntil(20_000) {
            compose.onAllNodes(hasTestTag("atrio-chat-composer") and isEnabled())
                .fetchSemanticsNodes().isNotEmpty()
        }

        try {
            val beforeContact = page()
            val oldCursor = requireNotNull(beforeContact.nextCursor)
            val beforeIds = traverse(beforeContact).map { it.chatId }.toSet()
            assertFalse(contactId in beforeIds)
            for (text in listOf("a".repeat(1501), "🙂".repeat(751))) {
                for ((chatId, peer) in listOf(contactId to contact.uid, acceptedId to null)) {
                    val intent = AtrioMessageIntent(UUID.randomUUID().toString(), chatId, peer, text, null)
                    val response = runBlocking { messages.submit(intent) }
                    assertEquals(AtrioMessageReply.Rejected("invalid_request"), response)
                }
            }
            compose.setContent {
                AtrioTheme {
                    val blocks = rememberAtrioManagedBlocks(auth, user, db)
                    val drafts = rememberAtrioManagedMessages(auth, user, db)
                    AtrioConversationsScreen(db, user.uid, onBack = {},
                        initialPeer = target.value, managedBlocks = blocks, managedMessages = drafts)
                }
            }
            val first = "Paz e bem, primeiro contato em QA."
            waitForComposer()
            compose.onNodeWithTag("atrio-chat-composer").performTextInput(first)
            clickSend("Solicitar conversa")
            waitForText("Envio pendente", substring = true)
            compose.onNodeWithTag("atrio-chat-composer").assertTextContains(first)
            compose.onNodeWithText("Solicitação enviada.").assertDoesNotExist()
            assertTrue(Tasks.await(db.collection("users").document(user.uid)
                .collection("chatInboxByPeer").document(contact.uid).collection("entries")
                .limit(20).get(Source.SERVER), 10, TimeUnit.SECONDS).isEmpty)

            clickSend("Tentar novamente")
            waitForText("Solicitação enviada.")
            assertEquals("pending", Tasks.await(db.document("chats/$contactId")
                .get(Source.SERVER), 10, TimeUnit.SECONDS).getString("status"))
            val restart = discovery.fetch(user.uid, token, oldCursor)
            assertEquals(AtrioInboxResult.RestartRequired, restart)
            assertEquals(AtrioInboxPaging(), AtrioInboxPaging(listOf(null, oldCursor), beforeContact)
                .receive(restart))
            val beforeSend = page()
            val continuationCursor = requireNotNull(beforeSend.nextCursor)
            val continuationIds = page(continuationCursor).items.map { it.chatId }
            val afterContact = traverse(beforeSend)
            assertEquals(beforeIds + contactId, afterContact.map { it.chatId }.toSet())

            compose.runOnIdle { target.value = accepted }
            waitForComposer()
            val body = "Resposta de QA cuja confirmação atrasou."
            compose.onNodeWithTag("atrio-chat-composer").performTextInput(body)
            clickSend("Enviar")
            waitForText("Envio pendente", substring = true)
            compose.onNodeWithTag("atrio-chat-composer").assertTextContains(body)
            compose.onNodeWithText("Mensagem enviada.").assertDoesNotExist()
            val afterTimeout = Tasks.await(db.document("chats/$acceptedId").get(Source.SERVER),
                10, TimeUnit.SECONDS)
            assertEquals(body, afterTimeout.getString("lastPreview"))

            clickSend("Tentar novamente")
            waitForText("Mensagem enviada.")
            val afterRetry = Tasks.await(db.document("chats/$acceptedId").get(Source.SERVER),
                10, TimeUnit.SECONDS)
            assertFalse(afterRetry.getString("lastMessageId").isNullOrBlank())
            assertEquals(afterTimeout.getString("lastMessageId"), afterRetry.getString("lastMessageId"))
            assertEquals(continuationIds, page(continuationCursor).items.map { it.chatId })
            val afterSend = traverse(page())
            assertEquals(afterContact.map { it.chatId }, afterSend.map { it.chatId })
            assertEquals(body, afterSend.single { it.chatId == acceptedId }.preview)
        } finally {
            auth.signOut()
        }
    }
}
