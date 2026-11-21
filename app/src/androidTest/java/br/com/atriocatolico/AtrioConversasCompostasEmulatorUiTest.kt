package br.com.atriocatolico

import android.content.Context
import android.util.Log
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
import com.google.firebase.firestore.DocumentSnapshot
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

    // Esta conexão só é usada pelas fixtures da instrumentação local.
    private fun emulatorDocument(path: String): HttpURLConnection {
        check(db.app.options.projectId == "demo-atrio-v11")
        check(db.firestoreSettings.host == "127.0.0.1:8089" &&
              !db.firestoreSettings.isSslEnabled)
        val documents = "http://127.0.0.1:8089/v1/projects/demo-atrio-v11/databases/(default)/documents"
        return (URL("$documents/$path").openConnection() as HttpURLConnection).apply {
            instanceFollowRedirects = false
            connectTimeout = 5_000
            readTimeout = 5_000
            setRequestProperty("Authorization", "Bearer owner")
        }
    }

    private fun assertChatNotCreated(chatId: String) {
        val conn = emulatorDocument("chats/$chatId")
        try {
            assertEquals("A solicitação recusada não pode criar o chat", 404, conn.responseCode)
        } finally {
            conn.disconnect()
        }
    }

    // A fixture materializa o índice. O aplicativo continua sujeito às Rules e Source.SERVER.
    private fun materializePeerIndex(owner: String, peer: String, chatId: String,
                                     status: String, preview: String) {
        val fields = JSONObject()
        fun put(name: String, value: String) {
            fields.put(name, JSONObject().put("stringValue", value))
        }
        put("ownerUid", owner); put("peerUid", peer); put("chatId", chatId)
        put("status", status); put("lastPreview", preview)
        fields.put("updatedAt", JSONObject().put(
            "timestampValue", java.time.Instant.now().toString()))
        val conn = emulatorDocument("users/$owner/chatInboxByPeer/$peer/entries/$chatId")
        try {
            conn.requestMethod = "PATCH"
            conn.setRequestProperty("Content-Type", "application/json")
            conn.doOutput = true
            conn.outputStream.use {
                it.write(JSONObject().put("fields", fields).toString().toByteArray())
            }
            check(conn.responseCode in 200..299) {
                "Materialização local recusada: HTTP ${conn.responseCode}"
            }
        } finally { conn.disconnect() }
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
        fun verifyClosedView() {
            compose.waitUntil(30_000) {
                val hidden = compose.onAllNodesWithText(history).fetchSemanticsNodes().isEmpty()
                val denied = compose.onAllNodesWithTag("atrio-peer-inbox-error")
                    .fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("Conversa não encontrada ou acesso negado.")
                        .fetchSemanticsNodes().isNotEmpty() ||
                    compose.onAllNodesWithText("Conversa indisponível para esta conta.")
                        .fetchSemanticsNodes().isNotEmpty()
                hidden && denied
            }
            compose.onNodeWithText(history).assertDoesNotExist()
        }
        verifyClosedView()
        reopen(destination)
        verifyClosedView()
    }

    @After fun cleanSession() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun miguelSolicitaClaraAceitaNoMesmoIdComLuciaRecusada() {
        assertTrue("O focal exige QA Geral local", !pilot && !BuildConfig.ATRIO_QA_GERAL_REMOTE &&
            !BuildConfig.ATRIO_QA_GERAL_PUSH)
        initializeDemo()
        val miguelEmail = "pedido.inverso.miguel@qa.invalid"
        val claraEmail = "pedido.inverso.clara@qa.invalid"
        val luciaEmail = "pedido.inverso.lucia@qa.invalid"
        val clara = login(claraEmail)
        val miguel = login(miguelEmail)
        val claraTarget = PublicMemberTarget(clara, "Clara QA")
        val miguelTarget = PublicMemberTarget(miguel, "Miguel QA")
        val chatId = AtrioChatPolicy.id(miguel, clara)
        val chat = db.document("chats/$chatId")
        val first = "Clara, podemos conversar sobre a leitura?"
        val claraReply = "Miguel, vamos conversar sobre a leitura."
        val miguelReply = "Clara, começo pela primeira passagem."

        assertChatNotCreated(chatId)
        show(Screen(miguel, peer = claraTarget))
        send("atrio-chat-composer", "atrio-chat-send", first)
        waitForText("Solicitação enviada.")
        fun assertChat(checkpoint: String, status: String): DocumentSnapshot {
            fun read(phase: String): DocumentSnapshot {
                val snapshot = await(chat.get(Source.SERVER))
                Log.i("AtrioQaDm0103", "checkpoint=$checkpoint phase=$phase id=${snapshot.id} " +
                    "status=${snapshot.getString("status")} isFromCache=${snapshot.metadata.isFromCache} " +
                    "hasPendingWrites=${snapshot.metadata.hasPendingWrites()}")
                assertEquals("$checkpoint/$phase: leitura do cache", false, snapshot.metadata.isFromCache)
                return snapshot
            }

            val firstRead = read("inicial")
            val confirmed = if (firstRead.metadata.hasPendingWrites()) {
                await(db.waitForPendingWrites())
                read("apos-confirmacao")
            } else {
                firstRead
            }
            assertEquals("$checkpoint: escrita local pendente", false, confirmed.metadata.hasPendingWrites())
            assertEquals(chatId, confirmed.id)
            assertEquals(status, confirmed.getString("status"))
            assertEquals(miguel, confirmed.getString("requesterUid"))
            assertEquals(clara, confirmed.getString("recipientUid"))
            return confirmed
        }
        val pending = assertChat("solicitar", "pending")
        val initialId = requireNotNull(pending.getString("initialId"))
        val initial = chat.collection("messages").document(initialId)
        // Simula unicamente o índice administrativo local, como no outro sentido.
        materializePeerIndex(miguel, clara, chatId, "pending", first)
        materializePeerIndex(clara, miguel, chatId, "pending", first)
        waitForText("Aguardando aceite do destinatário.")
        Log.i("AtrioQaDm0103", "stage=solicitar id=$chatId status=pending requester=Miguel recipient=Clara")

        assertEquals(clara, login(claraEmail))
        show(Screen(clara, peer = miguelTarget, chatId = chatId))
        waitForText(first)
        waitForText("Aceitar")
        compose.onNodeWithTag("atrio-chat-composer").assertDoesNotExist()
        assertChat("abrir", "pending")
        Log.i("AtrioQaDm0103", "stage=abrir id=$chatId status=pending actor=Clara")

        assertEquals(miguel, login(miguelEmail))
        show(Screen(miguel, peer = claraTarget, chatId = chatId))
        waitForText("Aguardando aceite do destinatário.")
        assertChat("aguardar", "pending")
        Log.i("AtrioQaDm0103", "stage=aguardar id=$chatId status=pending actor=Miguel")

        val lucia = login(luciaEmail)
        assertTrue(lucia != clara && lucia != miguel)
        show(Screen(lucia, chatId = chatId))
        waitForText("Conversa indisponível para esta conta.")
        compose.onNodeWithText(first).assertDoesNotExist()
        compose.onNodeWithTag("atrio-chat-composer").assertDoesNotExist()
        assertDenied(chat.get(Source.SERVER))
        assertDenied(initial.get(Source.SERVER))
        Log.i("AtrioQaDm0103", "stage=recusa id=$chatId actor=Lucia chat=PERMISSION_DENIED mensagem=PERMISSION_DENIED")

        assertEquals(clara, login(claraEmail))
        show(Screen(clara, peer = miguelTarget, chatId = chatId))
        waitForText("Aceitar")
        assertChat("antes-do-aceite", "pending")
        compose.onNodeWithText("Aceitar").assertIsEnabled().performClick()
        compose.waitUntil(30_000) { await(chat.get(Source.SERVER)).getString("status") == "accepted" }
        assertChat("aceitar", "accepted")
        Log.i("AtrioQaDm0103", "stage=aceitar id=$chatId status=accepted actor=Clara")
        materializePeerIndex(miguel, clara, chatId, "accepted", first)
        materializePeerIndex(clara, miguel, chatId, "accepted", first)

        fun confirmSent(body: String, sender: String, direction: String): String {
            compose.waitUntil(30_000) {
                val snapshot = await(chat.get(Source.SERVER))
                snapshot.getString("lastPreview") == body &&
                    snapshot.getString("lastSenderUid") == sender &&
                    !snapshot.metadata.isFromCache && !snapshot.metadata.hasPendingWrites()
            }
            val confirmed = assertChat("enviar-$direction", "accepted")
            assertEquals(body, confirmed.getString("lastPreview"))
            assertEquals(sender, confirmed.getString("lastSenderUid"))
            val messageId = requireNotNull(confirmed.getString("lastMessageId"))
            Log.i("AtrioQaDm0103", "stage=enviar id=$chatId messageId=$messageId direction=$direction servidor=confirmado")
            return messageId
        }

        fun confirmReceived(messageId: String, body: String, sender: String, direction: String) {
            val message = await(chat.collection("messages").document(messageId).get(Source.SERVER))
            assertEquals("$direction: leitura do cache", false, message.metadata.isFromCache)
            assertEquals("$direction: escrita local pendente", false, message.metadata.hasPendingWrites())
            assertEquals(body, message.getString("text"))
            assertEquals(sender, message.getString("uid"))
            Log.i("AtrioQaDm0103", "stage=receber id=$chatId messageId=$messageId direction=$direction servidor=confirmado")
            waitForText(body)
            compose.onNodeWithText(body).assertIsDisplayed()
            Log.i("AtrioQaDm0103", "stage=exibir id=$chatId messageId=$messageId direction=$direction tela=exibida")
        }

        send("atrio-chat-composer", "atrio-chat-send", claraReply)
        val claraMessageId = confirmSent(claraReply, clara, "ClaraParaMiguel")
        assertEquals(miguel, login(miguelEmail))
        show(Screen(miguel, peer = claraTarget, chatId = chatId))
        confirmReceived(claraMessageId, claraReply, clara, "ClaraParaMiguel")

        send("atrio-chat-composer", "atrio-chat-send", miguelReply)
        val miguelMessageId = confirmSent(miguelReply, miguel, "MiguelParaClara")
        assertTrue(claraMessageId != miguelMessageId)
        assertEquals(clara, login(claraEmail))
        show(Screen(clara, peer = miguelTarget, chatId = chatId))
        confirmReceived(miguelMessageId, miguelReply, miguel, "MiguelParaClara")
        assertChat("mensagens", "accepted")
        Log.i("AtrioQaDm0103", "stage=mensagens id=$chatId status=accepted ClaraParaMiguel=lida MiguelParaClara=lida")
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
        fun materializeBoth(status: String, preview: String) {
            materializePeerIndex(alice, bob, chatId, status, preview)
            materializePeerIndex(bob, alice, chatId, status, preview)
        }
        val first = "Podemos conversar sobre o grupo de estudo?"

        show(Screen(bob, peer = PublicMemberTarget(alice, "Alice QA")))
        send("atrio-chat-composer", "atrio-chat-send", first)
        waitForText("Pedido não confirmado.", substring = true)
        assertChatNotCreated(chatId)
        // Antes de um chat permitido, o índice por par não revela mensagem.
        assertTrue(await(db.collection("users").document(bob)
            .collection("chatInboxByPeer").document(alice)
            .collection("entries").limit(20).get(Source.SERVER)).isEmpty)

        assertEquals(alice, login(aliceEmail))
        show(Screen(alice, peer = PublicMemberTarget(bob, "Bob QA")))
        send("atrio-chat-composer", "atrio-chat-send", first)
        try {
            waitForText("Solicitação enviada.")
        } catch (failure: androidx.compose.ui.test.ComposeTimeoutException) {
            // Falhar com diagnóstico, NUNCA transformar a recusa em sucesso.
            // O estado da transação fica separável do estado da interface.
            val server = try {
                val got = await(chat.get(Source.SERVER))
                "chat.exists=${got.exists()},chat.status=${got.getString("status")}"
            } catch (error: Exception) {
                "chat.get=${error.javaClass.simpleName}"
            }
            val denied = compose.onAllNodesWithText("Pedido não confirmado.",
                substring = true).fetchSemanticsNodes().isNotEmpty()
            val waiting = compose.onAllNodesWithText("Aguardando confirmação do servidor",
                substring = true).fetchSemanticsNodes().isNotEmpty()
            throw AssertionError(
                "Pedido Alice-Bob sem confirmação de UI: $server, " +
                    "pedidoRecusado=$denied,aguardandoServidor=$waiting",
                failure
            )
        }
        // Confirmar primeiro o estado real da transação. O novo contrato
        // não permite que o cliente descubra a solicitação pela lista global.
        val pending = await(chat.get(Source.SERVER))
        assertEquals("pending", pending.getString("status"))
        assertEquals(alice, pending.getString("requesterUid"))
        // Em produção, o serviço Admin da #359 materializa o índice; apenas
        // nesta instrumentação o teste simula esse evento no Emulator local.
        materializeBoth("pending", first)
        val indexed = await(db.collection("users").document(alice)
            .collection("chatInboxByPeer").document(bob)
            .collection("entries").limit(20).get(Source.SERVER))
        assertEquals(1, indexed.size())
        assertEquals(chatId, indexed.documents.single().getString("chatId"))
        waitForText("Aguardando aceite do destinatário.")
        compose.onNodeWithTag("atrio-chat-composer").assertDoesNotExist()

        assertEquals(bob, login(bobEmail))
        show(Screen(bob, peer = PublicMemberTarget(alice, "Alice QA"), chatId = chatId))
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
        // Bob consegue ler a conversa e o histórico pelo caminho autorizado.
        // A mesma sessão deve receber PERMISSION_DENIED na listagem global.
        assertTrue(await(chat.collection("messages").get(Source.SERVER)).documents
            .any { it.getString("text") == reply })
        assertDenied(db.collection("chats").limit(100).get(Source.SERVER))
        if (!pilot) {
            assertDenied(db.collection("chats").whereArrayContains("participants", bob)
                .limit(100).get(Source.SERVER))
        }

        materializeBoth("accepted", reply)
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
            // A regra de QA limita envios consecutivos do mesmo autor a 3 s.
            // A falha offline não pode ser confundida com a recusa do cooldown:
            // aguardar a janela a partir do timestamp CONFIRMADO pelo servidor,
            // mantendo o mesmo ID de tentativa para a prova de idempotência.
            val previousAt = requireNotNull(await(chat.get(Source.SERVER))
                .getTimestamp("updatedAt")).toDate().time
            compose.waitUntil(10_000) {
                System.currentTimeMillis() - previousAt >= 3_500L
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
        // Source.SERVER ainda pode incluir uma gravação local pendente.
        await(db.waitForPendingWrites())
        val acceptedInvite = await(invite.get(Source.SERVER))
        assertEquals(bob, auth.currentUser?.uid)
        assertEquals("accepted", acceptedInvite.getString("status"))
        assertEquals(false, acceptedInvite.metadata.isFromCache)
        assertEquals(false, acceptedInvite.metadata.hasPendingWrites())
        requireNotNull(acceptedInvite.getTimestamp("updatedAt"))

        val acceptedGroup = await(group.get(Source.SERVER))
        assertTrue((acceptedGroup.get("memberUids") as List<*>).contains(bob))
        assertEquals(false, acceptedGroup.metadata.hasPendingWrites())
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
