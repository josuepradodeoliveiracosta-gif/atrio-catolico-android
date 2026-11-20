package br.com.atriocatolico

import android.content.Context
import android.os.ParcelFileDescriptor
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldValue
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

class Atrio199ClientesEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private var surface by mutableStateOf<Screen?>(null)
    private val alice = "conversas.alice@qa.invalid"
    private val bob = "conversas.bob@qa.invalid"
    private val lucia = "conversas.lucia@qa.invalid"
    private val initial = "Mensagem privada de Alice para Lúcia, somente no emulador."

    private data class Screen(val uid: String, val peer: PublicMemberTarget,
                              val roomId: String, val profile: Boolean = false)
    private data class PairSession(val aliceUid: String, val luciaUid: String,
                                   val room: DocumentReference) {
        fun forAlice() = Screen(aliceUid, PublicMemberTarget(luciaUid, "Lúcia QA"), room.id)
        fun forLucia() = Screen(luciaUid, PublicMemberTarget(aliceUid, "Alice QA"), room.id)
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 12, TimeUnit.SECONDS)

    private fun prepare() {
        check(BuildConfig.DEBUG && BuildConfig.APPLICATION_ID == "br.com.atriocatolico.qageral" &&
            BuildConfig.PUSH_RELAY_URL.isBlank() && !BuildConfig.ATRIO_QA_INBOX_DISCOVERY)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: requireNotNull(FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setProjectId("demo-atrio-v11")
            .setApplicationId("1:123456789012:android:0123456789abcdef")
            .setApiKey("local-emulator-test")
            .build()))
        check(app.options.projectId == "demo-atrio-v11")
        auth = FirebaseAuth.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        db = FirebaseFirestore.getInstance(app)
        db.useEmulator("127.0.0.1", 8089)
        auth.signOut()
    }

    @After fun signOut() {
        if (::auth.isInitialized) auth.signOut()
    }

    private fun login(email: String): String {
        auth.signOut()
        val user = requireNotNull(await(auth.signInWithEmailAndPassword(
            email, "GrupoQa2026!Emulador")).user)
        assertTrue(user.isEmailVerified)
        return user.uid
    }

    private fun waitTag(tag: String) {
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun waitText(text: String, substring: Boolean = false) {
        compose.waitUntil(30_000) {
            compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText(text, substring = substring).assertIsDisplayed()
    }

    private fun click(tag: String) {
        waitTag(tag)
        compose.onNodeWithTag(tag).assertIsDisplayed().performClick()
    }

    private fun show(screen: Screen) {
        compose.runOnIdle { surface = null }
        compose.waitForIdle()
        compose.runOnIdle { surface = screen }
    }

    private fun threadUi() {
        compose.setContent {
            AtrioTheme {
                surface?.let { view ->
                    if (view.profile) PublicMemberProfileScreen(
                        db, view.peer, onBack = {}, onOpenDiscussion = {}, viewerUid = view.uid)
                    else AtrioConversationsScreen(
                        db, view.uid, onBack = {}, initialChatId = view.roomId)
                }
            }
        }
    }

    private fun pairFromSession(role: String): PairSession {
        val uid = login(if (role == "ALICE") alice else lucia)
        val otherPost = if (role == "ALICE") "qa-nav-lucia-profile" else "qa-nav-alice-profile"
        val other = requireNotNull(await(db.document("posts/$otherPost").get(Source.SERVER)).getString("uid"))
        assertTrue(uid != other)
        val aliceUid = if (role == "ALICE") uid else other
        val luciaUid = if (role == "LUCIA") uid else other
        val room = db.collection("chats").document(AtrioChatPolicy.id(aliceUid, luciaUid))
        val data = await(room.get(Source.SERVER))
        assertEquals("accepted", data.getString("status"))
        assertEquals(false, data.metadata.hasPendingWrites())
        return PairSession(aliceUid, luciaUid, room)
    }

    private fun send(text: String) {
        val composer = compose.onNodeWithTag("atrio-chat-composer")
        compose.waitUntil(30_000) {
            try { composer.assertIsEnabled(); true } catch (_: AssertionError) { false }
        }
        composer.performTextInput(text)
        click("atrio-chat-send")
    }

    private fun denied(task: Task<*>) {
        try {
            await(task)
            throw AssertionError("Operação indevida foi permitida pelo Firestore Emulator.")
        } catch (e: ExecutionException) {
            val firestore = e.cause as? FirebaseFirestoreException ?: throw e
            assertEquals(FirebaseFirestoreException.Code.PERMISSION_DENIED, firestore.code)
        }
    }

    private fun messages(room: DocumentReference, body: String) =
        await(room.collection("messages").get(Source.SERVER)).documents.filter {
            it.getString("text") == body && !it.metadata.hasPendingWrites() && !it.metadata.isFromCache
        }

    @Test fun doisClientesLeemEnviamEReabrem() {
        val role = InstrumentationRegistry.getArguments().getString("atrioQaClientRole")
        check(role in setOf("ALICE", "LUCIA"))
        prepare()
        val pair = pairFromSession(requireNotNull(role))
        val view = if (role == "ALICE") pair.forAlice() else pair.forLucia()
        threadUi()
        show(view)
        waitText(initial)
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        Log.i("Atrio199QA", "criterio=04 papel=$role cliente_aberto=true")
        val deadline = SystemClock.elapsedRealtime() + 90_000
        var bothClientsOpen = false
        while (!bothClientsOpen && SystemClock.elapsedRealtime() < deadline) {
            val result = instrumentation.uiAutomation.executeShellCommand(
                "test ! -f /data/local/tmp/atrio-199-both-open || echo ready")
            bothClientsOpen = ParcelFileDescriptor.AutoCloseInputStream(result)
                .bufferedReader().use { it.readText().trim() == "ready" }
            if (!bothClientsOpen) Thread.sleep(250)
        }
        assertTrue("Os dois clientes devem ter a thread aberta antes do envio", bothClientsOpen)

        val fromAlice = "Mensagem ao vivo de Alice no ensaio de dois clientes."
        val fromLucia = "Mensagem ao vivo de Lúcia no ensaio de dois clientes."
        if (role == "ALICE") {
            val previous = requireNotNull(await(pair.room.get(Source.SERVER)).getTimestamp("updatedAt"))
            compose.waitUntil(10_000) { System.currentTimeMillis() - previous.toDate().time >= 3_500L }
            send(fromAlice)
            waitText(fromAlice)
            waitText(fromLucia)
        } else {
            waitText(fromAlice)
            send(fromLucia)
            waitText(fromLucia)
        }
        val first = messages(pair.room, fromAlice).single()
        val second = messages(pair.room, fromLucia).single()
        assertEquals(pair.aliceUid, first.getString("uid"))
        assertEquals(pair.luciaUid, second.getString("uid"))
        show(view)
        waitText(fromAlice)
        waitText(fromLucia)
        assertEquals(first.id, messages(pair.room, fromAlice).single().id)
        assertEquals(second.id, messages(pair.room, fromLucia).single().id)
        Log.i("Atrio199QA", "criterio=04 papel=$role ui_ao_vivo=true reabertura=true " +
            "id_alice=${first.id} id_lucia=${second.id} sem_duplicacao=true")
    }

    @Test fun bloqueioPersisteDepoisDeReconectar() {
        prepare()
        val pair = pairFromSession("ALICE")
        threadUi()
        show(pair.forAlice())
        waitText(initial)
        show(pair.forAlice().copy(profile = true))
        waitText("Bloquear participante")
        click("atrio-member-block")
        waitText("Participante bloqueado.")
        val block = db.document("users/${pair.aliceUid}/blockedMembers/${pair.luciaUid}")
        assertTrue(await(block.get(Source.SERVER)).exists())

        for ((role, view) in listOf("ALICE" to pair.forAlice(), "LUCIA" to pair.forLucia())) {
            if (role == "LUCIA") {
                compose.runOnIdle { surface = null }
                assertEquals(view.uid, login(lucia))
            }
            await(db.disableNetwork())
            try {
                show(view)
                waitText("Conversa não encontrada ou acesso negado.")
                compose.onNodeWithText(initial).assertDoesNotExist()
            } finally {
                await(db.enableNetwork())
            }
            show(view)
            waitText("Conversa não encontrada ou acesso negado.")
            compose.onNodeWithText(initial).assertDoesNotExist()
            compose.onNodeWithTag("atrio-chat-send").assertDoesNotExist()
            denied(pair.room.get(Source.SERVER))
            denied(pair.room.collection("messages").document("qa-privacidade").get(Source.SERVER))
            val msg = pair.room.collection("messages").document()
            val body = "Tentativa fictícia após reconectar com bloqueio."
            val batch = db.batch()
            batch.set(msg, mapOf("uid" to view.uid, "text" to body, "kind" to "text",
                "createdAt" to FieldValue.serverTimestamp()))
            val counter = if (role == "ALICE") "unreadRecipient" else "unreadRequester"
            val nextUnread = if (role == "ALICE") 2 else 1
            batch.update(pair.room, mapOf("lastMessageId" to msg.id, "lastPreview" to body,
                "lastSenderUid" to view.uid, counter to nextUnread,
                "updatedAt" to FieldValue.serverTimestamp()))
            denied(batch.commit())
            Log.i("Atrio199QA", "criterio=05 papel=$role rede_reconectada=true " +
                "thread_reaberta=true ui_sem_historico=true leitura_e_envio=PERMISSION_DENIED")
        }
    }

    @Test fun duasInterrupcoesPreservamRascunhoEIdUnico() {
        prepare()
        val pair = pairFromSession("LUCIA")
        threadUi()
        val view = pair.forLucia()
        show(view)
        waitText(initial)
        val target = "Mensagem única depois de duas interrupções no emulador."
        val composer = compose.onNodeWithTag("atrio-chat-composer")
        compose.waitUntil(30_000) {
            try { composer.assertIsEnabled(); true } catch (_: AssertionError) { false }
        }
        composer.performTextInput(target)
        repeat(2) {
            await(db.disableNetwork())
            try {
                waitText("Conversa não encontrada ou acesso negado.")
                compose.onNodeWithText(initial).assertDoesNotExist()
            } finally {
                await(db.enableNetwork())
            }
            waitText(initial)
            waitText(target)
            compose.waitUntil(30_000) {
                try { compose.onNodeWithTag("atrio-chat-send").assertIsEnabled(); true }
                catch (_: AssertionError) { false }
            }
            assertTrue(messages(pair.room, target).isEmpty())
        }
        click("atrio-chat-send")
        waitText(target)
        compose.waitUntil(30_000) { messages(pair.room, target).size == 1 }
        val id = messages(pair.room, target).single().id
        await(db.disableNetwork())
        await(db.enableNetwork())
        show(view)
        waitText(target)
        assertEquals(id, messages(pair.room, target).single().id)
        assertEquals(id, await(pair.room.get(Source.SERVER)).getString("lastMessageId"))
        Log.i("Atrio199QA", "criterio=07 quedas_sdk=2 rascunho_preservado=true envios_durante_quedas=0 " +
            "depois_da_reconexao=1 id_preservado_ao_reabrir=true sem_pendencia=true")
    }

    @Test fun trocaContaIsolaBadgeCentralConviteEDestino() {
        prepare()
        val aliceUid = login(alice)
        compose.setContent { OnlineAtrioApp(compose.activity) }
        val noticeA = "Lúcia QA primeiro aviso respondeu à discussão"
        val noticeB = "Lúcia QA segundo aviso respondeu à discussão"
        val bell = hasTestTag("atrio-top-notifications")
        fun badge(count: String) = compose.onNode(
            hasText(count) and hasAnyAncestor(bell), useUnmergedTree = true)
        fun waitBadge(count: String) {
            compose.waitUntil(30_000) {
                compose.onAllNodes(hasText(count) and hasAnyAncestor(bell), useUnmergedTree = true)
                    .fetchSemanticsNodes().isNotEmpty()
            }
            badge(count).assertIsDisplayed()
        }
        fun groups() {
            click("atrio-tab-profile")
            waitTag("atrio-profile-list")
            compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
                .performScrollToNode(hasText("Conversas"))
            compose.onNodeWithText("Conversas").assertIsDisplayed().performClick()
            click("atrio-open-groups")
        }

        groups()
        waitTag("atrio-group-accept-qa-199-conta-alice")
        waitText("Convite privado de Alice QA")
        waitBadge("2")
        click("atrio-top-notifications")
        waitText("Sua central de avisos")
        // O primeiro item é o mais novo e abre a discussão exata.
        waitText(noticeA)
        compose.onNodeWithText(noticeA).performClick()
        waitTag("atrio-detail-v2")
        waitText("Destino exato do primeiro aviso de Alice QA")
        waitBadge("1")
        Log.i("Atrio199QA", "criterio=10 sessao=ALICE badge=2_depois_1 aviso_destino_exato=true convite_proprio=true")

        val bobUid = login(bob)
        assertTrue(aliceUid != bobUid)
        waitText("Paz e bem, Bob!")
        badge("1").assertDoesNotExist()
        badge("2").assertDoesNotExist()
        compose.onNodeWithTag("atrio-detail-v2").assertDoesNotExist()
        click("atrio-top-notifications")
        waitText("Nenhum aviso neste filtro.", substring = true)
        compose.onNodeWithText(noticeA).assertDoesNotExist()
        compose.onNodeWithText(noticeB).assertDoesNotExist()
        denied(db.document("users/$aliceUid/notifications/qa-199-notice-b").get(Source.SERVER))
        groups()
        waitText("Você ainda não participa de grupos.")
        compose.onNodeWithTag("atrio-group-accept-qa-199-conta-alice").assertDoesNotExist()
        compose.onNodeWithText("Convite privado de Alice QA").assertDoesNotExist()
        denied(db.document("chat_groups/qa-199-conta-alice/atrioGroupInvites/$aliceUid").get(Source.SERVER))
        denied(db.document("chat_groups/qa-199-conta-alice").get(Source.SERVER))

        assertEquals(aliceUid, login(alice))
        waitBadge("1")
        click("atrio-top-notifications")
        waitText("Sua central de avisos")
        compose.onNodeWithText("Não lidas").performClick()
        waitText(noticeB)
        compose.onNodeWithText(noticeA).assertDoesNotExist()
        groups()
        waitTag("atrio-group-accept-qa-199-conta-alice")
        Log.i("Atrio199QA", "criterio=10 sessao=BOB sem_badge_aviso_convite_destino_alheios=true " +
            "acesso_servidor=PERMISSION_DENIED retorno_alice=badge_aviso_convite_confirmados")
    }
}
