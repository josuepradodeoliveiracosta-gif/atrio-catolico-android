package br.com.atriocatolico

import android.content.Context
import android.os.SystemClock
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

/**
 * Executa o app ONLINE com o SDK Firebase real, mas conectado
 * EXCLUSIVAMENTE aos emuladores locais (Auth e Firestore).
 *
 * Jamais usa google-services.json, Cloudflare, contas ou dados oficiais.
 * As contas fictícias possuem e-mail/senha somente dentro dos emuladores.
 */
class ThreeBotsOnlineEmulatorTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val project = "demo-atrio-v11"
    @Test fun qaGeralPermiteHttpSomenteAoFirebaseEmulator() {
        assertEquals("Politica testada somente no QA Geral",
            "br.com.atriocatolico.qageral", BuildConfig.APPLICATION_ID)
        val policy = android.security.NetworkSecurityPolicy.getInstance()
        assertTrue("ADB reverse exige HTTP 127.0.0.1",
            policy.isCleartextTrafficPermitted("127.0.0.1"))
        assertTrue("Gateway local exige HTTP 10.0.2.2",
            policy.isCleartextTrafficPermitted("10.0.2.2"))
        assertFalse("HTTP externo deve ser recusado",
            policy.isCleartextTrafficPermitted("example.com"))
        assertFalse("HTTP por IP remoto deve ser recusado",
            policy.isCleartextTrafficPermitted("8.8.8.8"))
    }

    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    private enum class SwitchTiming { AFTER_ACK, FIRST_SERVER_READ, PENDING_OFFLINE }

    private fun prepareEmulators() {
        assertEquals("Bots online somente no APK QA Geral",
            "br.com.atriocatolico.qageral", BuildConfig.APPLICATION_ID)
        val context = ApplicationProvider.getApplicationContext<Context>()
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setApplicationId("1:1234567890:android:atrioqa")
                .setApiKey("emulator-not-a-real-key")
                .setProjectId(project)
                .build()
        )
        requireNotNull(app) { "Firebase emulador não inicializado" }
        // Bloqueio obrigatório contra uso acidental do projeto de produção.
        require(app.options.projectId == project) {
            "Testes online recusados: projeto Firebase não é $project"
        }
        auth = FirebaseAuth.getInstance(app)
        db = FirebaseFirestore.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        // Há outro teste autenticado no MESMO processo de instrumentação.
        // Firestore não permite chamar useEmulator() após inicialização:
        // reutilizar somente quando o host já aponta para o emulador seguro.
        val emulatorHost = "127.0.0.1:8089"
        val configuredHost = db.firestoreSettings.host
        if (configuredHost != emulatorHost) {
            check(configuredHost == "firestore.googleapis.com") {
                "Firestore configurado para host inesperado: $configuredHost"
            }
            db.useEmulator("127.0.0.1", 8089)
        }
        auth.signOut()
    }

    private fun awaitScreen(label: String) {
        compose.waitUntil(30000) {
            compose.onAllNodesWithText(label, substring = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun createAccount(email: String, name: String) {
        val result = Tasks.await(auth.createUserWithEmailAndPassword(email, "QaEmulator2026!"),
            25, TimeUnit.SECONDS)
        val uid = requireNotNull(result.user?.uid)
        Tasks.await(db.collection("profiles").document(uid).set(mapOf(
            "displayName" to name,
            "createdAt" to FieldValue.serverTimestamp(),
        )),25,TimeUnit.SECONDS)
        auth.signOut()
    }

    private fun enter(email: String, expectedName: String) {
        awaitScreen("Entrar na comunidade")
        compose.onNodeWithText("E-mail").performTextInput(email)
        // O login mudou de rotulo; a tag e estavel entre versoes.
        compose.onNodeWithTag("atrio-auth-password")
            .performTextInput("QaEmulator2026!")
        compose.onNodeWithText("Entrar").performClick()
        awaitScreen("Paz e bem, ${expectedName.substringBefore(' ')}!")
    }

    private fun scrollToPost(postId: String) {
        // O cabeçalho de boas-vindas aparece antes do snapshot assíncrono
        // do feed. Procurar uma única vez pode observar a lista ainda vazia.
        compose.waitUntil(30000) {
            try {
                compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
                    .performScrollToNode(hasTestTag("atrio-post-${postId}"))
                true
            } catch (_: AssertionError) {
                false
            }
        }
        compose.onNodeWithTag("atrio-post-${postId}", useUnmergedTree = true)
            .assertIsDisplayed()
    }

    private fun leave() {
        compose.runOnIdle { auth.signOut() }
        awaitScreen("Entrar na comunidade")
    }

    @Test fun claraMiguelLuciaFazemLoginENavegamComFirebaseEmulado() {
        val configuredTiming = InstrumentationRegistry.getArguments().getString("atrioQa201Timing")
        val timing = configuredTiming?.let(SwitchTiming::valueOf) ?: SwitchTiming.AFTER_ACK
        prepareEmulators()
        val startedAt = SystemClock.elapsedRealtime()
        fun trace(event: String, state: String) {
            Log.i("AtrioNoticeQA",
                "modo=$timing etapa=$event ms=${SystemClock.elapsedRealtime() - startedAt} $state")
        }
        // UUIDs de Auth, perfis e dados são novos a cada execução em ambiente
        // local, onde não há leitura/escrita no projeto oficial.
        val nonce = System.currentTimeMillis()
        val claraEmail = "clara.${nonce}@bots.example.test"
        val miguelEmail = "miguel.${nonce}@bots.example.test"
        val luciaEmail = "lucia.${nonce}@bots.example.test"

        createAccount(claraEmail, "Clara BOT DE TESTE")
        createAccount(miguelEmail, "Miguel BOT DE TESTE")
        createAccount(luciaEmail, "Lúcia BOT DE TESTE")

        val batchState = AtomicReference<QaReplyBatchState>()
        compose.setContent {
            OnlineAtrioApp(compose.activity, onQaReplyBatch = {
                batchState.set(it)
                trace("callback_lote", "estado=${it.result} aviso_no_lote=${it.ownerNoticeQueued}")
            })
        }

        // Clara entra pelo formulário real do Átrio e publica tocando na tela.
        enter(claraEmail,"Clara")
        val claraId=requireNotNull(auth.currentUser?.uid)
        // Controle: comprova que a mesma conta pode gravar um POST válido
        // diretamente nas regras Firestore do laboratório. Se falhar, a
        // causa é Auth/regras e NÃO o toque Compose.
        val control = db.collection("posts").document("qa_control_${nonce}")
        Tasks.await(control.set(mapOf(
            "uid" to claraId,
            "authorName" to "Clara BOT DE TESTE",
            "title" to "Controle de escrita Firebase emulado",
            "body" to "Diagnóstico de permissão para publicar sem depender da interface.",
            "category" to "Vida espiritual",
            "createdAt" to FieldValue.serverTimestamp(),
        )),20,TimeUnit.SECONDS)
        val controlDoc = Tasks.await(control.get(Source.SERVER),10,TimeUnit.SECONDS)
        assertTrue("Firebase emulado recusou o post de controle",controlDoc.exists())
        Tasks.await(control.delete(),10,TimeUnit.SECONDS)
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput("Discussão conectada QA ${nonce}")
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Publicação fictícia de QA, criada pela interface online do Átrio.")
        // Um rascunho não deve desaparecer ao visitar outra aba e retornar.
        compose.onNodeWithTag("atrio-tab-communities").performClick()
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        compose.onNodeWithTag("atrio-publish-title")
            .assertTextContains("Discussão conectada QA ${nonce}", substring = true)
        compose.onNodeWithTag("atrio-publish-body")
            .assertTextContains("Publicação fictícia de QA, criada pela interface online do Átrio.",
                substring = true)
        // Os botões ficam abaixo do formulário em uma coluna rolável.
        // Um toque fora do viewport não comprova envio pela interface.
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        // O mesmo texto ainda existe no campo de edição enquanto a gravação
        // assíncrona ocorre. Não confundir isso com confirmação do Firestore.
        // A fonte de verdade do teste é uma leitura do SERVIDOR emulado.
        val title = "Discussão conectada QA ${nonce}"
        val query = db.collection("posts").whereEqualTo("title", title)
        compose.waitUntil(45000) {
            val snapshot = Tasks.await(query.get(Source.SERVER), 5, TimeUnit.SECONDS)
            snapshot.size() == 1
        }
        val docs = Tasks.await(query.get(Source.SERVER), 10, TimeUnit.SECONDS)
        assertEquals("A publicação não foi persistida pelo Firebase",1,docs.size())
        val postId = docs.documents.single().id
        assertEquals("A discussão deve pertencer à conta Clara",claraId,
            docs.documents.single().getString("uid"))
        leave()

        // Miguel entra como OUTRO usuário autenticado e responde.
        enter(miguelEmail,"Miguel")
        scrollToPost(postId)
        compose.onNodeWithTag("atrio-post-${postId}",useUnmergedTree=true)
            .performClick()
        // Abrir a discussão inicia uma leitura assíncrona do documento.
        // A interface fica em carregamento até o snapshot chegar.
        compose.waitUntil(30000) {
            compose.onAllNodesWithTag("atrio-open-reply-composer")
                .fetchSemanticsNodes().size == 1
        }
        compose.onNodeWithTag("atrio-open-reply-composer").performClick()
        compose.onNodeWithTag("atrio-reply-input")
            .assertIsDisplayed()
            .assertIsEnabled()
            .performTextInput("Resposta de Miguel pelo app Android conectado.")
        val miguelId = requireNotNull(auth.currentUser?.uid)
        assertTrue("A resposta foi publicada fora da conta de Miguel", miguelId != claraId)
        val repliesRef = db.collection("posts").document(postId).collection("replies")
        val pauseNetwork = timing == SwitchTiming.PENDING_OFFLINE
        val replyId: String
        if (pauseNetwork) Tasks.await(db.disableNetwork(), 5, TimeUnit.SECONDS)
        try {
            trace("toque_responder", "firestore_pausado=$pauseNetwork")
            compose.onNodeWithTag("atrio-reply-submit")
                .assertIsDisplayed()
                .assertIsEnabled()
                .performClick()

            val source = if (pauseNetwork) Source.CACHE else Source.SERVER
            var observedPending = false
            var observed = "sem_leitura"
            compose.waitUntil(30000) {
                val batch = batchState.get() ?: return@waitUntil false
                if (timing == SwitchTiming.AFTER_ACK) {
                    if (batch.result == "pendente") return@waitUntil false
                    assertEquals("Confirmação do lote de Miguel", "confirmado", batch.result)
                }
                val task = repliesRef.document(batch.replyId).get(source)
                val reply = if (pauseNetwork) runCatching {
                    Tasks.await(task, 5, TimeUnit.SECONDS)
                }.getOrNull() else Tasks.await(task, 5, TimeUnit.SECONDS)
                if (reply == null || !reply.exists() || reply.getString("uid") != miguelId ||
                    reply.getString("body") != "Resposta de Miguel pelo app Android conectado."
                ) return@waitUntil false
                val pending = reply.metadata.hasPendingWrites()
                observedPending = pending
                observed = "fonte=$source resposta_pendente=$pending cache=${reply.metadata.isFromCache}"
                timing != SwitchTiming.AFTER_ACK || !pending
            }
            replyId = requireNotNull(batchState.get()).replyId
            compose.runOnIdle {
                assertEquals("Miguel deve estar ativo até a troca", miguelId, auth.currentUser?.uid)
                val batch = requireNotNull(batchState.get())
                assertEquals(replyId, batch.replyId)
                trace("troca_de_miguel", "lote=${batch.result} aviso_no_lote=${batch.ownerNoticeQueued} " +
                    "sessao_miguel=true mesmo_id=true $observed")
                if (pauseNetwork) {
                    assertEquals("O botão deve ter enfileirado uma gravação pendente",
                        "pendente", batch.result)
                    assertTrue("A leitura local deve mostrar a escrita pendente",
                        observedPending)
                }
                auth.signOut()
            }
            awaitScreen("Entrar na comunidade")
        } finally {
            if (pauseNetwork) {
                Tasks.await(db.enableNetwork(), 5, TimeUnit.SECONDS)
                trace("rede_restaurada", "apos_troca=true")
            }
        }

        // Lúcia autentica sua própria conta, curte e salva a discussão.
        enter(luciaEmail,"Lúcia")
        scrollToPost(postId)
        compose.onNodeWithTag("atrio-like-${postId}",useUnmergedTree=true)
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        compose.onNodeWithTag("atrio-save-${postId}",useUnmergedTree=true)
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        val luciaId=requireNotNull(auth.currentUser?.uid)
        val likesRef = db.collection("users").document(luciaId)
            .collection("likedPosts").document(postId)
        val savesRef = db.collection("users").document(luciaId)
            .collection("savedPosts").document(postId)
        compose.waitUntil(30000) {
            Tasks.await(likesRef.get(Source.SERVER), 5, TimeUnit.SECONDS).exists() &&
                Tasks.await(savesRef.get(Source.SERVER), 5, TimeUnit.SECONDS).exists()
        }
        val liked=Tasks.await(db.collection("users").document(luciaId)
            .collection("likedPosts").document(postId).get(Source.SERVER),25,TimeUnit.SECONDS)
        val saved=Tasks.await(db.collection("users").document(luciaId)
            .collection("savedPosts").document(postId).get(Source.SERVER),25,TimeUnit.SECONDS)
        assertTrue("Lúcia não curtiu o post no Firestore emulado",liked.exists())
        assertTrue("Lúcia não salvou o post no Firestore emulado",saved.exists())
        trace("lucia", "curtida_servidor=true salvamento_servidor=true")
        leave()

        // Clara retorna e lê seu aviso interno real no Firestore emulado.
        enter(claraEmail,"Clara")
        assertEquals("A sessão de Clara deve ser restaurada corretamente",
            claraId,auth.currentUser?.uid)
        val notices = db.collection("users").document(claraId).collection("notifications")
        val originalStartedAt = SystemClock.elapsedRealtime()
        val original = runCatching {
            compose.waitUntil(30000) {
                val result = Tasks.await(notices.get(Source.SERVER), 20, TimeUnit.SECONDS)
                result.documents.any { it.getString("postId") == postId }
            }
            val notice = Tasks.await(notices.get(Source.SERVER), 25, TimeUnit.SECONDS)
            assertEquals("A lista histórica deve conter um aviso para a discussão",
                1, notice.documents.count { it.getString("postId") == postId })
        }
        val originalResult = original.exceptionOrNull()?.let(::diagnosticError) ?: "encontrado"
        val batch = batchState.get()
        trace("consulta_original",
            "resultado=$originalResult duracao_ms=${SystemClock.elapsedRealtime() - originalStartedAt} " +
                "lote=${batch?.result ?: "sem_callback"} aviso_no_lote=${batch?.ownerNoticeQueued} " +
                "mesmo_id=${batch?.replyId == replyId}")

        // Só consultar os outros sinais depois de encerrar a verificação histórica.
        val serverReply = runCatching {
            val reply = Tasks.await(db.collection("posts").document(postId)
                .collection("replies").document(replyId).get(Source.SERVER), 5, TimeUnit.SECONDS)
            when {
                !reply.exists() -> "ausente"
                reply.metadata.hasPendingWrites() -> "pendente"
                reply.metadata.isFromCache -> "cache"
                reply.getString("uid") != miguelId -> "autor_divergente"
                else -> "confirmada"
            }
        }
        val exact = runCatching {
            val notice = Tasks.await(notices.document(replyId).get(Source.SERVER), 5, TimeUnit.SECONDS)
            when {
                !notice.exists() -> "ausente"
                notice.metadata.hasPendingWrites() -> "pendente"
                notice.metadata.isFromCache -> "cache"
                notice.getString("postId") != postId || notice.getString("replyId") != replyId ||
                    notice.getString("actorUid") != miguelId -> "campos_divergentes"
                else -> "confirmado"
            }
        }
        val ordered = runCatching {
            val result = Tasks.await(notices.orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(51).get(Source.SERVER), 5, TimeUnit.SECONDS)
            result.documents.take(50).any { it.id == replyId && !it.metadata.hasPendingWrites() }
        }
        val visible = runCatching {
            compose.onNodeWithTag("atrio-top-notifications").performClick()
            awaitScreen("Sua central de avisos")
            compose.waitUntil(5000) {
                compose.onAllNodesWithText("Miguel BOT DE TESTE respondeu à discussão")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Miguel BOT DE TESTE respondeu à discussão").assertIsDisplayed()
            true
        }
        val finalBatch = batchState.get()
        trace("diagnostico", "lote=${finalBatch?.result ?: "sem_callback"} " +
                "aviso_no_lote=${finalBatch?.ownerNoticeQueued} mesmo_id=${finalBatch?.replyId == replyId} " +
                "resposta_no_servidor=${serverReply.fold({ it }, ::diagnosticError)} " +
                "aviso_exato=${exact.fold({ it }, ::diagnosticError)} " +
                "na_consulta_da_central=${ordered.fold({ it.toString() }, ::diagnosticError)} " +
                "visivel_na_central=${visible.fold({ it.toString() }, ::diagnosticError)}")

        original.getOrThrow()
        // A troca da sessão pode deixar a callback de Miguel sem resposta observada.
        // Comprovar a gravação pelos dois documentos do mesmo ID, no servidor.
        assertTrue("O aviso da autora foi incluído no lote do mesmo ID",
            finalBatch != null && finalBatch.replyId == replyId && finalBatch.ownerNoticeQueued)
        assertEquals("Resposta do mesmo ID confirmada no servidor", "confirmada", serverReply.getOrThrow())
        assertEquals("Estado do aviso pelo ID exato", "confirmado", exact.getOrThrow())
        assertTrue("Mesmo ID na consulta ordenada da central", ordered.getOrThrow())
        visible.getOrThrow()
    }

    private fun diagnosticError(failure: Throwable): String {
        val cause = (failure as? java.util.concurrent.ExecutionException)?.cause ?: failure
        return (cause as? FirebaseFirestoreException)?.code?.name ?: cause.javaClass.simpleName
    }
}
