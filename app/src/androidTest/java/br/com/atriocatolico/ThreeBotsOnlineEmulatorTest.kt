package br.com.atriocatolico

import android.content.Context
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
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

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
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    private fun prepareEmulators() {
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
        val greeting = "Paz e bem, ${expectedName.substringBefore(' ')}!"
        // Distinguir um erro de Auth Emulator de uma falha de notificação:
        // o texto de erro é mostrado somente após o callback de login falhar.
        // Não considerar a autenticação bem-sucedida nem mascarar o erro.
        compose.waitUntil(30000) {
            compose.onAllNodesWithText(greeting, substring = true)
                .fetchSemanticsNodes().isNotEmpty() ||
                compose.onAllNodesWithTag("atrio-auth-error")
                    .fetchSemanticsNodes().isNotEmpty()
        }
        val authUiFailed = compose.onAllNodesWithTag("atrio-auth-error")
            .fetchSemanticsNodes().isNotEmpty()
        assertTrue(
            "Login de bot de QA falhou antes de testar respostas; " +
                "Auth Emulator/UI devem ser diagnosticados separadamente. " +
                "Sessão autenticada=${auth.currentUser != null}",
            !authUiFailed
        )
        awaitScreen(greeting)
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
        prepareEmulators()
        // UUIDs de Auth, perfis e dados são novos a cada execução em ambiente
        // local, onde não há leitura/escrita no projeto oficial.
        val nonce = System.currentTimeMillis()
        val claraEmail = "clara.${nonce}@bots.example.test"
        val miguelEmail = "miguel.${nonce}@bots.example.test"
        val luciaEmail = "lucia.${nonce}@bots.example.test"

        createAccount(claraEmail, "Clara BOT DE TESTE")
        createAccount(miguelEmail, "Miguel BOT DE TESTE")
        createAccount(luciaEmail, "Lúcia BOT DE TESTE")

        compose.setContent { OnlineAtrioApp(compose.activity) }

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
            snapshot.size() == 1 &&
                !snapshot.documents.single().metadata.hasPendingWrites()
        }
        val docs = Tasks.await(query.get(Source.SERVER), 10, TimeUnit.SECONDS)
        assertEquals("A publicação não foi persistida pelo Firebase",1,docs.size())
        assertTrue("A publicação ainda possui gravação local pendente",
            !docs.documents.single().metadata.hasPendingWrites())
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
        compose.onNodeWithTag("atrio-reply-submit")
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        // A escrita deve ser confirmada no servidor, não apenas no cache
        // local da tela. A resposta também precisa pertencer a Miguel.
        val miguelId = requireNotNull(auth.currentUser?.uid)
        var persistedReplyId = ""
        var sawUncommittedReply = false
        // Source.SERVER ainda pode mesclar gravações locais pendentes. Não
        // trocar de conta antes de confirmar a aceitação pelo servidor.
        // Caso contrário, a troca de Auth poderá interromper o batch e
        // aparentar uma resposta salva sem o aviso atômico correspondente.
        try {
            compose.waitUntil(45000) {
                val replies = Tasks.await(db.collection("posts").document(postId)
                    .collection("replies").get(Source.SERVER), 20, TimeUnit.SECONDS)
                val matchingReply = replies.documents.firstOrNull {
                    it.getString("body") == "Resposta de Miguel pelo app Android conectado." &&
                        it.getString("uid") == miguelId
                }
                sawUncommittedReply = sawUncommittedReply ||
                    (matchingReply?.metadata?.hasPendingWrites() == true)
                persistedReplyId = matchingReply?.takeIf {
                    !it.metadata.hasPendingWrites()
                }?.id.orEmpty()
                persistedReplyId.isNotBlank()
            }
        } catch (timeout: androidx.compose.ui.test.ComposeTimeoutException) {
            throw AssertionError(
                "Resposta não confirmada pelo backend antes da troca de sessão; " +
                    "escrita local pendente observada=$sawUncommittedReply", timeout
            )
        }
        // Exigir ACK de todas as escritas pendentes nesta sessão QA.
        Tasks.await(db.waitForPendingWrites(), 20, TimeUnit.SECONDS)
        val committedReply = Tasks.await(db.collection("posts").document(postId)
            .collection("replies").document(persistedReplyId).get(Source.SERVER),
            15, TimeUnit.SECONDS)
        assertTrue("Resposta não existe no servidor após ACK", committedReply.exists())
        assertTrue("Resposta ainda não confirmada no servidor após ACK",
            !committedReply.metadata.hasPendingWrites())
        assertEquals("Resposta gravada com autor diferente do autenticado",
            miguelId, committedReply.getString("uid"))
        // Correlacionar o replyId da leitura confirmada com o operation
        // registrado pelo próprio app em AtrioReplyQA (somente QA emulado).
        // Também detectar duplicação de envio, não aceitar "primeiro match".
        val confirmedReplies = Tasks.await(db.collection("posts").document(postId)
            .collection("replies").get(Source.SERVER), 15, TimeUnit.SECONDS)
        val matchingReplies = confirmedReplies.documents.filter {
            it.getString("body") == "Resposta de Miguel pelo app Android conectado." &&
                it.getString("uid") == miguelId
        }
        assertEquals("O envio deve produzir uma única resposta canônica",
            1, matchingReplies.size)
        assertEquals("A resposta observada difere da resposta confirmada",
            persistedReplyId, matchingReplies.single().id)
        android.util.Log.i("AtrioThreeBotsQA",
            "verifiedReplyId=$persistedReplyId pendingWrites=" +
                matchingReplies.single().metadata.hasPendingWrites())
        assertTrue("A resposta foi publicada fora da conta de Miguel",
            miguelId != claraId)
        // Miguel não pode ler as notificações privadas de Clara. A leitura
        // será feita após reautenticar como destinatária, no final da sessão.
        leave()

        // Verificar o aviso imediatamente após a resposta, antes das ações
        // de Lúcia. A consulta ocorre como Clara (destinatária legítima),
        // sem credenciais administrativas nem acesso a dados de produção.
        enter(claraEmail,"Clara")
        assertEquals("A autora da discussão deve estar autenticada",
            claraId, auth.currentUser?.uid)
        Tasks.await(auth.currentUser!!.getIdToken(false),15,TimeUnit.SECONDS)
        val immediateNoticeRef = db.collection("users").document(claraId)
            .collection("notifications").document(persistedReplyId)
        val immediateNotice = Tasks.await(immediateNoticeRef.get(Source.SERVER),
            15,TimeUnit.SECONDS)
        android.util.Log.i("AtrioThreeBotsQA",
            "verifiedNoticeReplyId=$persistedReplyId exists=" +
                immediateNotice.exists() + " pendingWrites=" +
                immediateNotice.metadata.hasPendingWrites())
        assertTrue("Aviso ausente imediatamente após a resposta persistida",
            immediateNotice.exists())
        assertTrue("Aviso ainda possui gravação local pendente",
            !immediateNotice.metadata.hasPendingWrites())
        assertEquals("Aviso inicial vinculado a outra discussão",
            postId, immediateNotice.getString("postId"))
        assertEquals("Aviso inicial vinculado a outra resposta",
            persistedReplyId, immediateNotice.getString("replyId"))
        assertTrue("O aviso inicial não pode ser emitido pela autora",
            immediateNotice.getString("actorUid") != claraId)
        leave()

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
        leave()

        // Clara retorna e lê seu aviso interno real no Firestore emulado.
        enter(claraEmail,"Clara")
        assertEquals("A sessão de Clara deve ser restaurada corretamente",
            claraId,auth.currentUser?.uid)
        // Espera a sincronização da sessão do Auth + aviso do Firestore.
        // Não considerar um snapshot inicial vazio como prova de falha.
        // Se permanecer vazio, informar também o dono e o autor canônicos,
        // sem expor credenciais nem qualquer conteúdo de usuários reais.
        // O batch da resposta usa replyRef.id como ID CANÔNICO do aviso.
        // Primeiro verificar o documento exato no servidor, depois a lista
        // que a UI consulta. Isso distingue ausência real de recusa de list.
        // Também impede um falso positivo por aviso de resposta anterior.
        Tasks.await(auth.currentUser!!.getIdToken(false),15,TimeUnit.SECONDS)
        val noticeRef=db.collection("users").document(claraId)
            .collection("notifications").document(persistedReplyId)
        val notices=db.collection("users").document(claraId)
            .collection("notifications")
        var noticeDiagnostic="nenhuma consulta concluída"
        val notificationConfirmed=runCatching {
            compose.waitUntil(30000) {
                runCatching {
                    val exact=Tasks.await(noticeRef.get(Source.SERVER),
                        5,TimeUnit.SECONDS)
                    val list=Tasks.await(notices.get(Source.SERVER),
                        5,TimeUnit.SECONDS)
                    noticeDiagnostic="documento=${exact.exists()}, " +
                        "postId=${exact.getString("postId")==postId}, " +
                        "lista=${list.size()}"
                    exact.exists() && exact.getString("postId")==postId &&
                        exact.getString("replyId")==persistedReplyId &&
                        exact.getString("actorUid")!=claraId &&
                        list.documents.count {
                            it.getString("postId")==postId
                        }==1
                }.getOrElse { exception ->
                    noticeDiagnostic="falha servidor: " +
                        exception.javaClass.simpleName+": " +
                        (exception.message ?: "sem mensagem").take(180)
                    false
                }
            }
            true
        }.getOrDefault(false)
        assertTrue(
            "A resposta foi salva, mas o aviso privado não foi confirmado: " +
                noticeDiagnostic,
            notificationConfirmed)
    }
}
