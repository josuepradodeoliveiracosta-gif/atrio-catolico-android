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
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit

class AtrioConversasCompostasEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private val pilot = BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT
    private val aliceEmail = if (pilot) "alice.navegacao@qa.invalid" else "conversas.alice@qa.invalid"
    private val bobEmail = if (pilot) "bob.navegacao@qa.invalid" else "conversas.bob@qa.invalid"
    private val password = "GrupoQa2026!Emulador"
    private var showOnlineApp by mutableStateOf(false)

    private data class Screen(
        val uid: String,
        val peer: PublicMemberTarget? = null,
        val chatId: String? = null,
        val groupPeer: String? = null,
        val groupId: String? = null,
    )

    private var screen by mutableStateOf<Screen?>(null)

    private fun initializeDemo() {
        val expected = if (pilot) "br.com.atriocatolico.qageral.celular" else "br.com.atriocatolico.qageral"
        assertEquals(expected, compose.activity.packageName)
        assertEquals(expected, BuildConfig.APPLICATION_ID)
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
        db = FirebaseFirestore.getInstance(firebase)
        if (pilot) {
            check(!BuildConfig.ATRIO_QA_GERAL_REMOTE && !BuildConfig.ATRIO_QA_GERAL_PUSH)
            check(db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)
        } else {
            auth.useEmulator("127.0.0.1", 9099)
            db.useEmulator("127.0.0.1", 8089)
        }
        auth.signOut()
        compose.setContent {
            AtrioTheme {
                if (showOnlineApp) OnlineAtrioApp(compose.activity)
                else screen?.let { current ->
                    if (current.groupPeer == null && current.groupId == null) {
                        AtrioConversationsScreen(
                            db = db, uid = current.uid, onBack = {},
                            initialPeer = current.peer, initialChatId = current.chatId
                        )
                    } else {
                        AtrioGroupsScreen(db, current.uid, listOfNotNull(current.groupPeer),
                            onBack = {}, initialGroupId = current.groupId)
                    }
                }
            }
        }
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 8, TimeUnit.SECONDS)

    private fun login(email: String, eligible: Boolean = true): String {
        compose.runOnIdle { screen = null; showOnlineApp = false }
        compose.waitForIdle()
        auth.signOut()
        val user = requireNotNull(await(auth.signInWithEmailAndPassword(
            email, password)).user)
        assertEquals(true, await(user.getIdToken(true)).claims["email_verified"])
        if (eligible) {
            val eligibility = await(db.document("users/${user.uid}/chatAgeEligibility/current")
                .get(Source.SERVER))
            assertEquals("eligible", eligibility.getString("status"))
        }
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

    private fun reopen(destination: Screen) {
        compose.runOnIdle { screen = null }
        compose.waitForIdle()
        show(destination)
    }

    // Só existe na instrumentação. O dono é o context privilegiado do Emulator.
    private fun fixtureField(path: String, field: String, type: String, value: Any) {
        check(pilot && db.app.options.projectId == "demo-atrio-v11")
        val documents = "http://127.0.0.1:8089/v1/projects/demo-atrio-v11/databases/(default)/documents"
        val connection = URL("$documents/$path?updateMask.fieldPaths=$field")
            .openConnection() as HttpURLConnection
        try {
            connection.requestMethod = "PATCH"
            connection.instanceFollowRedirects = false
            connection.setRequestProperty("Authorization", "Bearer owner")
            connection.setRequestProperty("Content-Type", "application/json")
            connection.connectTimeout = 5_000
            connection.readTimeout = 5_000
            connection.doOutput = true
            val body = JSONObject().put("fields",
                JSONObject().put(field, JSONObject().put(type, value)))
            connection.outputStream.use { it.write(body.toString().toByteArray()) }
            check(connection.responseCode in 200..299) {
                "Fixture recusada pelo Emulator: HTTP ${connection.responseCode}"
            }
        } finally {
            connection.disconnect()
        }
    }

    private fun enablePilotFromEmulator() {
        for (path in listOf("app_config/conversations", "app_config/chat_groups")) {
            fixtureField(path, "minorPolicyApproved", "booleanValue", true)
            fixtureField(path, "enabled", "booleanValue", true)
        }
    }

    private fun checkDirectRevocation(alice: String, bob: String, chatId: String, history: String) {
        assertEquals(bob, login(bobEmail))
        val destination = Screen(bob, chatId = chatId)
        val firstMessage = await(db.document("chats/$chatId").get(Source.SERVER))
            .getString("initialId")!!
        val entry = db.document("chats/$chatId/messages/$firstMessage")
        val otherApp = FirebaseApp.initializeApp(compose.activity, db.app.options, "pilot-alice")
        try {
            val otherAuth = FirebaseAuth.getInstance(otherApp)
            otherAuth.useEmulator("127.0.0.1", 9099)
            val otherDb = FirebaseFirestore.getInstance(otherApp)
            otherDb.useEmulator("127.0.0.1", 8089)
            assertEquals(alice, await(otherAuth.signInWithEmailAndPassword(aliceEmail, password)).user?.uid)
            val block = otherDb.document("users/$alice/blockedMembers/$bob")
            show(destination)
            waitForText(history)
            await(block.set(mapOf("createdAt" to FieldValue.serverTimestamp())))
            waitForHiddenHistory(history, destination)
            assertDenied(entry.get(Source.SERVER))
            await(block.delete())
            reopen(destination)
            waitForText(history)

            fixtureField("users/$bob/chatAgeEligibility/current", "status", "stringValue", "revoked")
            waitForHiddenHistory(history, destination)
            assertDenied(entry.get(Source.SERVER))
        } finally {
            otherApp.delete()
        }
    }

    private fun waitForHiddenHistory(history: String, destination: Screen) {
        waitForText("Conversa não encontrada ou acesso negado.")
        compose.onNodeWithText(history).assertDoesNotExist()
        reopen(destination)
        waitForText("Conversa não encontrada ou acesso negado.")
        compose.onNodeWithText(history).assertDoesNotExist()
    }

    @After fun cleanSession() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun primeiroContatoRecusaAceiteESaidaProtegemHistorico() {
        initializeDemo()
        val alice = login(aliceEmail)
        val bob = login(bobEmail)
        if (pilot) {
            assertEquals("qa-nav-alice", alice)
            assertEquals("qa-nav-bob", bob)
            compose.runOnIdle { showOnlineApp = true }
            click("atrio-tab-profile")
            waitForTag("atrio-profile-list")
            compose.onNodeWithTag("atrio-profile-list").performScrollToNode(hasText("Conversas"))
            compose.onNodeWithText("Conversas").performClick()
            waitForText("As conversas ainda não foram liberadas.", substring = true)
            compose.onNodeWithTag("atrio-open-groups").assertDoesNotExist()
            enablePilotFromEmulator()
            waitForTag("atrio-open-groups")

            val outsider = login("fora@qa.invalid", eligible = false)
            assertEquals("qa-pilot-fora", outsider)
            show(Screen(outsider, peer = PublicMemberTarget(alice, "Alice QA")))
            waitForText("As conversas ainda não foram liberadas.", substring = true)
            compose.onNodeWithTag("atrio-chat-composer").assertDoesNotExist()
            assertEquals(bob, login(bobEmail))
        }
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

        // Na suite regular, exercitar o envio real pela UI com a transacao
        // falhando sem rede. O app deve reutilizar o mesmo ID ao reenviar,
        // e o servidor deve persistir apenas uma mensagem.
        if (!pilot) {
            val retry = "Reenvio do Android apos reconexao, mensagem unica."
            await(db.disableNetwork())
            try {
                send("atrio-chat-composer", "atrio-chat-send", retry)
                waitForText("Envio não confirmado. Confira a conexão.")
            } finally {
                await(db.enableNetwork())
            }
            compose.waitUntil(30_000) {
                try {
                    compose.onNodeWithTag("atrio-chat-send").assertIsEnabled()
                    true
                } catch (_: AssertionError) {
                    false
                }
            }
            click("atrio-chat-send")
            var serverCount = -1
            var lastPreview = ""
            var pendingWrites = true
            try {
                compose.waitUntil(30_000) {
                    val messages = await(chat.collection("messages").get(Source.SERVER))
                    val saved = messages.documents.filter { it.getString("text") == retry }
                    serverCount = saved.size
                    pendingWrites = saved.any { it.metadata.hasPendingWrites() }
                    lastPreview = await(chat.get(Source.SERVER)).getString("lastPreview").orEmpty()
                    serverCount == 1 && !pendingWrites && lastPreview == retry
                }
            } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
                throw AssertionError(
                    "Reenvio sem confirmação única: count=$serverCount, " +
                        "previewAtualCorresponde=${lastPreview == retry}, " +
                        "pendingWrites=$pendingWrites",
                    failure
                )
            }
            android.util.Log.i("AtrioConversasQA", "reconexao_apos_falha=um_unico_envio_confirmado")
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
        val report = db.document("chat_group_reports/${bob}__${group.id}__${entry.id}")
        if (pilot) {
            click("atrio-group-report-message")
            waitForTag("atrio-group-report-reason")
            compose.onNodeWithTag("atrio-group-report-reason")
                .performTextInput("Relato fictício para o piloto local.")
            compose.onNodeWithText("Enviar denúncia").performClick()
            waitForText("Denúncia registrada para análise.")
            assertEquals(message, await(report.get(Source.SERVER)).getString("reportedText"))

            fixtureField("users/$bob/chatGroupAccess/eligibility", "status", "stringValue", "suspended")
            waitForText("Acesso aos grupos indisponível para esta conta")
            compose.onNodeWithText(message).assertDoesNotExist()
            assertDenied(entry.get(Source.SERVER))
            reopen(Screen(bob, groupId = group.id))
            waitForText("Acesso aos grupos indisponível para esta conta")
            compose.onNodeWithText(message).assertDoesNotExist()
            assertTrue(await(report.get(Source.SERVER)).exists())
            fixtureField("users/$bob/chatGroupAccess/eligibility", "status", "stringValue", "approved")
            reopen(Screen(bob, groupId = group.id))
            waitForText(message)
        }

        click("atrio-group-members")
        click("atrio-group-leave")
        waitForText("Você ainda não participa de grupos.")
        compose.onNodeWithText(message).assertDoesNotExist()
        assertDenied(group.get(Source.SERVER))
        assertDenied(entry.get(Source.SERVER))
        assertDenied(history.get(Source.SERVER))
        if (pilot) {
            reopen(Screen(bob, groupId = group.id))
            waitForText("Este grupo não está disponível para esta conta.")
            compose.onNodeWithTag("atrio-group-thread").assertDoesNotExist()
            compose.onNodeWithText(message).assertDoesNotExist()
            assertDenied(entry.get(Source.SERVER))
            assertTrue(await(report.get(Source.SERVER)).exists())
        }

        assertEquals(alice, login(aliceEmail))
        assertEquals(listOf(alice), await(group.get(Source.SERVER)).get("memberUids"))
        assertEquals(message, await(entry.get(Source.SERVER)).getString("text"))
        if (pilot) {
            assertDenied(report.get(Source.SERVER))
            val moderatorUid = login("moderador.navegacao@qa.invalid", eligible = false)
            assertEquals("qa-nav-moderador", moderatorUid)
            assertEquals(bob, await(report.get(Source.SERVER)).getString("reporterUid"))
            assertDenied(entry.get(Source.SERVER))
            fixtureField("admins/$moderatorUid", "enabled", "booleanValue", false)
            assertDenied(report.get(Source.SERVER))

            login("fora@qa.invalid", eligible = false)
            assertDenied(report.get(Source.SERVER))
            checkDirectRevocation(alice, bob, chatId, first)
            assertTrue(await(report.get(Source.SERVER)).exists())
        }
        android.util.Log.i("AtrioConversasQA",
            "primeiro_contato=confirmado recusa=confirmada aceite=confirmado saida=confirmada " +
                "historico_ex_membro=PERMISSION_DENIED historico_proprietario=preservado")
    }
}
