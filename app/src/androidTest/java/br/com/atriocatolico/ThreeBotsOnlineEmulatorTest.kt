package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
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
        auth.useEmulator("10.0.2.2", 9099)
        db.useEmulator("10.0.2.2", 8089)
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
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput("Discussão conectada QA ${nonce}")
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Publicação fictícia de QA, criada pela interface online do Átrio.")
        compose.onNodeWithTag("atrio-publish-submit").performClick()
        awaitScreen("Discussão conectada QA ${nonce}")
        val docs = Tasks.await(db.collection("posts")
            .whereEqualTo("title","Discussão conectada QA ${nonce}").get(),
            25, TimeUnit.SECONDS)
        assertEquals(1,docs.size())
        val postId = docs.documents.single().id
        assertEquals("A discussão deve pertencer à conta Clara",claraId,
            docs.documents.single().getString("uid"))
        leave()

        // Miguel entra como OUTRO usuário autenticado e responde.
        enter(miguelEmail,"Miguel")
        compose.onNodeWithTag("atrio-home-feed",useUnmergedTree=true)
            .performScrollToNode(hasTestTag("atrio-post-${postId}"))
        compose.onNodeWithTag("atrio-post-${postId}",useUnmergedTree=true)
            .performClick()
        compose.onNodeWithTag("atrio-reply-input")
            .performTextInput("Resposta de Miguel pelo app Android conectado.")
        compose.onNodeWithTag("atrio-reply-submit").performClick()
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
        compose.onNodeWithTag("atrio-home-feed",useUnmergedTree=true)
            .performScrollToNode(hasTestTag("atrio-post-${postId}"))
        compose.onNodeWithTag("atrio-like-${postId}",useUnmergedTree=true)
            .performClick()
        compose.onNodeWithTag("atrio-save-${postId}",useUnmergedTree=true)
            .performClick()
        val luciaId=requireNotNull(auth.currentUser?.uid)
        val liked=Tasks.await(db.collection("users").document(luciaId)
            .collection("likedPosts").document(postId).get(),25,TimeUnit.SECONDS)
        val saved=Tasks.await(db.collection("users").document(luciaId)
            .collection("savedPosts").document(postId).get(),25,TimeUnit.SECONDS)
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
