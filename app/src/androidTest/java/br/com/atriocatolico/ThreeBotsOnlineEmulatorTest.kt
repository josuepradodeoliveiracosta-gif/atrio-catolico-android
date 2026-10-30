package br.com.atriocatolico

import android.content.Context
import android.view.KeyEvent
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.compose.ui.test.performTextReplacement
import androidx.test.core.app.ApplicationProvider
import androidx.test.platform.app.InstrumentationRegistry
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
        compose.onNodeWithText("Senha (mínimo 6 caracteres)")
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
        val title = "Discussão conectada QA ${nonce}"
        val links = "https://um.example.test https://dois.example.test " +
            "https://tres.example.test https://quatro.example.test"
        val draftBody = "Publicação fictícia de QA, criada pela interface online do Átrio.\n$links"
        val query = db.collection("posts").whereEqualTo("title", title)
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput(title)
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput(draftBody)
        // Os botões ficam abaixo do formulário em uma coluna rolável.
        // Um toque fora do viewport não comprova envio pela interface.
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        // Abrir o aviso não publica nem apaga o texto que será revisado.
        compose.onNodeWithTag("atrio-guardian-revise").assertIsDisplayed()
        assertEquals(0, Tasks.await(query.get(Source.SERVER), 10, TimeUnit.SECONDS).size())
        compose.onNodeWithTag("atrio-guardian-revise").performClick()
        compose.onNodeWithTag("atrio-guardian-continue").assertDoesNotExist()
        compose.onNodeWithTag("atrio-publish-title").assertTextContains(title)
        compose.onNodeWithTag("atrio-publish-body").assertTextContains(draftBody)
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo().assertIsEnabled().performClick()
        // Voltar tem o mesmo efeito seguro de revisar, sem consumir o rascunho.
        compose.onNodeWithTag("atrio-guardian-revise").assertIsDisplayed()
        InstrumentationRegistry.getInstrumentation().sendKeyDownUpSync(KeyEvent.KEYCODE_BACK)
        compose.onNodeWithTag("atrio-guardian-continue").assertDoesNotExist()
        compose.onNodeWithTag("atrio-publish-title").assertTextContains(title)
        compose.onNodeWithTag("atrio-publish-body").assertTextContains(draftBody)
        assertEquals(0, Tasks.await(query.get(Source.SERVER), 10, TimeUnit.SECONDS).size())
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo().assertIsEnabled().performClick()
        compose.onNodeWithTag("atrio-guardian-continue")
            .assertIsDisplayed().performClick()
        // O mesmo texto ainda existe no campo de edição enquanto a gravação
        // assíncrona ocorre. Não confundir isso com confirmação do Firestore.
        // A fonte de verdade do teste é uma leitura do SERVIDOR emulado.
        compose.waitUntil(45000) {
            val snapshot = Tasks.await(query.get(Source.SERVER), 5, TimeUnit.SECONDS)
            snapshot.size() == 1
        }
        val docs = Tasks.await(query.get(Source.SERVER), 10, TimeUnit.SECONDS)
        assertEquals("A publicação não foi persistida pelo Firebase",1,docs.size())
        val postId = docs.documents.single().id
        assertEquals("A discussão deve pertencer à conta Clara",claraId,
            docs.documents.single().getString("uid"))
        assertEquals("O texto confirmado deve chegar intacto ao servidor emulado",
            draftBody, docs.documents.single().getString("body"))
        compose.waitUntil(30000) {
            compose.onAllNodesWithTag("atrio-publish-title").fetchSemanticsNodes().isEmpty()
        }
        // O sucesso sai do formulário: a próxima publicação começa vazia.
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        for (tag in listOf("atrio-publish-title", "atrio-publish-body")) {
            compose.onNodeWithTag(tag).assert(SemanticsMatcher.expectValue(
                SemanticsProperties.EditableText, AnnotatedString("")))
        }
        leave()

        // Miguel entra como OUTRO usuário autenticado e responde.
        enter(miguelEmail,"Miguel")
        scrollToPost(postId)
        compose.onNodeWithTag("atrio-post-${postId}",useUnmergedTree=true)
            .performClick()
        // Abrir a discussão inicia uma leitura assíncrona do documento.
        // A interface fica em carregamento até o snapshot chegar.
        compose.waitUntil(30000) {
            compose.onAllNodesWithTag("atrio-reply-input")
                .fetchSemanticsNodes().size == 1
        }
        compose.onNodeWithTag("atrio-reply-input")
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performTextInput("Resposta de Miguel pelo app Android conectado.\n$links")
        compose.onNodeWithTag("atrio-reply-submit")
            .performScrollTo()
            .assertIsDisplayed()
            .assertIsEnabled()
            .performClick()
        compose.onNodeWithTag("atrio-guardian-revise").assertIsDisplayed()
        assertEquals(0, Tasks.await(db.collection("posts").document(postId)
            .collection("replies").get(Source.SERVER), 10, TimeUnit.SECONDS).size())
        compose.onNodeWithTag("atrio-guardian-revise").performClick()
        // Cancelar devolve o controle ao formulário da resposta, sem perder texto.
        compose.onNodeWithTag("atrio-reply-input")
            .assertTextContains("Resposta de Miguel pelo app Android conectado.\n$links")
            .performScrollTo()
            .performTextReplacement("Resposta de Miguel pelo app Android conectado.")
        compose.onNodeWithTag("atrio-reply-submit")
            .performScrollTo().assertIsEnabled().performClick()
        // A escrita deve ser confirmada no servidor, não apenas no cache
        // local da tela. A resposta também precisa pertencer a Miguel.
        compose.waitUntil(30000) {
            val replies=Tasks.await(db.collection("posts").document(postId)
                .collection("replies").get(Source.SERVER),20,TimeUnit.SECONDS)
            replies.documents.any {
                it.getString("body")=="Resposta de Miguel pelo app Android conectado." &&
                    it.getString("uid")==auth.currentUser?.uid
            }
        }
        assertTrue("A resposta foi publicada fora da conta de Miguel",
            auth.currentUser?.uid!=claraId)
        // Miguel não pode ler as notificações privadas de Clara. A leitura
        // será feita após reautenticar como destinatária, no final da sessão.
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
        compose.waitUntil(30000) {
            val result=Tasks.await(db.collection("users").document(claraId)
                .collection("notifications").get(Source.SERVER),20,TimeUnit.SECONDS)
            result.documents.any { it.getString("postId")==postId }
        }
        val notice=Tasks.await(db.collection("users").document(claraId)
            .collection("notifications").get(Source.SERVER),25,TimeUnit.SECONDS)
        assertEquals(
            "Miguel publicou a resposta, mas a notificação de Clara não foi persistida.",
            1,notice.documents.count { it.getString("postId")==postId })
    }
}

