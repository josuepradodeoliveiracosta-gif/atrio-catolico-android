package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.printToString
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
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
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.util.concurrent.TimeUnit

/**
 * Um cenário de E2E com os três bots como usuários Firebase Auth de verdade,
 * fazendo toques no fluxo ONLINE do mesmo app.
 *
 * Proteção obrigatória: credenciais e projeto demo-atrio-v11, host emulado
 * 10.0.2.2, nenhum Worker URL ou credencial de produção. Os testes só são
 * executados dentro do workflow que inicia Firebase Auth + Firestore Emulator.
 */
class ThreeBotsAuthenticatedAndroidUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore
    private val password = "SenhaQA2026!NaoReal"
    private val session = UUID.randomUUID().toString().take(8)

    @Before fun setup() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        assertTrue("Testes E2E não devem rodar em release", BuildConfig.DEBUG)
        assertTrue("Worker oficial não pode ser configurado no APK E2E",
            BuildConfig.PUSH_RELAY_URL.isBlank())
        val options = FirebaseOptions.Builder()
            .setProjectId("demo-atrio-v11")
            .setApplicationId("1:123456789012:android:0123456789abcdef")
            .setApiKey("qa-emulator-key-not-a-secret")
            .build()
        val apps = FirebaseApp.getApps(context)
        if (apps.isEmpty()) {
            FirebaseApp.initializeApp(context, options)
        }
        assertEquals("O projeto Firebase não é o emulador!",
            "demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        auth = FirebaseAuth.getInstance()
        db = FirebaseFirestore.getInstance()
        auth.useEmulator("10.0.2.2", 9099)
        // Também pode ser executado depois do outro teste conectado;
        // reconfigurar Firestore já iniciado causa IllegalStateException.
        val emulatorHost = "10.0.2.2:8089"
        val host = db.firestoreSettings.host
        if (host != emulatorHost) {
            check(host == "firestore.googleapis.com") {
                "Firestore apontando para host inesperado: $host"
            }
            db.useEmulator("10.0.2.2", 8089)
        }
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    private fun waitFor(tag: String, timeout: Long = 35_000) {
        compose.waitUntil(timeout) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    private fun register(name: String, prefix: String): String {
        waitFor("atrio-auth-toggle")
        compose.onNodeWithTag("atrio-auth-toggle").performClick()
        waitFor("atrio-auth-name")
        compose.onNodeWithTag("atrio-auth-name").performTextInput(name)
        compose.onNodeWithTag("atrio-auth-email")
            .performTextInput("$prefix.$session@qa.invalid")
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().performClick()
        waitFor("atrio-tab-publish", 45_000)
        val uid = auth.currentUser?.uid ?: error("Login Firebase não criou usuário")
        assertTrue("Conta Firebase criada fora do emulador", uid.isNotBlank())

        // A interface pode aparecer antes da última escrita assíncrona do
        // cadastro. Não publicar nem fazer logout até o perfil constar no
        // SERVIDOR do emulador, com a identidade correta.
        compose.waitUntil(35_000) {
            val current = auth.currentUser?.uid
            if (current != uid) return@waitUntil false
            runCatching {
                val profile = Tasks.await(
                    db.collection("profiles").document(uid).get(Source.SERVER),
                    4, TimeUnit.SECONDS)
                profile.exists() && profile.getString("displayName") == name
            }.getOrDefault(false)
        }
        assertEquals("Sessão do bot mudou durante o cadastro",uid,auth.currentUser?.uid)
        return uid
    }

    private fun logoutByTouch() {
        compose.onNodeWithTag("atrio-tab-profile").performClick()
        waitFor("atrio-profile-list")
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-profile-signout"))
        compose.onNodeWithTag("atrio-profile-signout")
            .performClick()
        waitFor("atrio-auth-toggle")
        compose.waitUntil(15_000) { auth.currentUser == null }
    }

    private fun login(prefix: String) {
        waitFor("atrio-auth-email")
        compose.onNodeWithTag("atrio-auth-email")
            .performTextInput("$prefix.$session@qa.invalid")
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().performClick()
        waitFor("atrio-tab-publish", 45_000)
    }

    private fun openDiscussion(postId: String) {
        waitFor("atrio-home-feed")
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-$postId"))
        compose.onNodeWithTag("atrio-post-$postId", useUnmergedTree = true)
            .performClick()
        waitFor("atrio-reply-input")
    }

    private fun sendReply(body: String) {
        compose.onNodeWithTag("atrio-reply-input").performScrollTo()
            .performTextInput(body)
        compose.onNodeWithTag("atrio-reply-submit")
            .performScrollTo().performClick()
    }

    @Test fun claraMiguelLuciaFazemLoginPublicamRespondemERecebemAvisos() {
        compose.setContent { OnlineAtrioApp(compose.activity) }
        val claraUid = register("Clara (BOT DE TESTE)", "clara")
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        waitFor("atrio-publish-title")
        val title = "Teste E2E de Clara $session"
        compose.onNodeWithTag("atrio-publish-title").performTextInput(title)
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Esta discussão pertence a um emulador e valida toques e Firebase Auth.")
        // O teclado virtual pode cobrir o botão abaixo dos campos.
        // Rolagem explícita e verificação de clique antes de ler o Firestore.
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo().assertIsDisplayed().assertIsEnabled().performClick()

        // Primeira prova: o toque e a operação Firestore concluíram.
        // Só depois testamos o retorno ao feed; caso falhe, registramos
        // a árvore de interface para saber exatamente qual tela ficou aberta.
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.collection("posts").whereEqualTo("uid", claraUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).documents
                    .any { it.getString("title") == title }
            }.getOrDefault(false)
        }
        val posts = Tasks.await(db.collection("posts").whereEqualTo("uid", claraUid)
            .get(Source.SERVER), 8, TimeUnit.SECONDS)
        val postId = posts.documents.single { it.getString("title") == title }.id
        // O cadastro já verificou o perfil pelo servidor; e o Firestore
        // recusaria criar este post se authorName não coincidisse com
        // profiles/{uid}. Repetir polls de perfil aqui trava a instrumentação
        // Android em algumas versões do emulador apesar do commit concluído.
        assertEquals("A sessão de Clara mudou durante o envio", claraUid,
            auth.currentUser?.uid)
        assertEquals("Autor do post deve ser Clara (BOT DE TESTE)",
            "Clara (BOT DE TESTE)",
            posts.documents.single { it.id == postId }.getString("authorName"))

        try {
            waitFor("atrio-home-feed", 15_000)
        } catch (cause: Throwable) {
            // Diagnóstico sanitizado: não imprimir a árvore Compose completa,
            // pois ela poderia conter texto digitado e credenciais de login.
            val onboarding = compose.onAllNodesWithTag(
                "atrio-profile-finish",useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
            val userStillSignedIn = auth.currentUser?.uid == claraUid
            android.util.Log.e("AtrioQaNavigation",
                "feed_missing_after_commit; onboarding=$onboarding; " +
                    "signed_in=$userStillSignedIn; profile_checked_during_signup=true")
            throw AssertionError(
                "Discussão e autoria confirmadas no Firestore; " +
                    "o retorno à tela inicial falhou. " +
                    "signed_in=$userStillSignedIn, signup_profile_checked=true",
                cause)
        }

        logoutByTouch()
        val miguelUid = register("Miguel (BOT DE TESTE)", "miguel")
        assertTrue(claraUid != miguelUid)
        openDiscussion(postId)
        sendReply("Miguel respondeu pelo Android autenticado de testes.")
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("posts").document(postId)
                    .collection("replies").whereEqualTo("uid", miguelUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).size() == 1
            }.getOrDefault(false)
        }
        // Regressa ao feed após responder para testar logout pelos controles.
        compose.onNodeWithContentDescription("Voltar")
            .performClick()
        logoutByTouch()

        val luciaUid = register("Lúcia (BOT DE TESTE)", "lucia")
        assertTrue(luciaUid != miguelUid && luciaUid != claraUid)
        openDiscussion(postId)
        sendReply("Lúcia respondeu pelo Android autenticado de testes.")
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("posts").document(postId)
                    .collection("replies").whereEqualTo("uid", luciaUid)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).size() == 1
            }.getOrDefault(false)
        }
        compose.onNodeWithContentDescription("Voltar")
            .performClick()
        logoutByTouch()

        login("clara")
        assertEquals(claraUid, auth.currentUser?.uid)
        compose.waitUntil(30_000) {
            runCatching {
                Tasks.await(db.collection("users").document(claraUid)
                    .collection("notifications").get(Source.SERVER),
                    4, TimeUnit.SECONDS).size() == 2
            }.getOrDefault(false)
        }
        compose.onNodeWithTag("atrio-top-notifications").performClick()
        compose.onNodeWithText("Notificações", substring = true).assertIsDisplayed()
        // A central precisa marcar os DOIS avisos depois de um toque visível,
        // não basta gravar as respostas no Firestore.
        compose.waitUntil(30_000) {
            runCatching {
                compose.onNodeWithText("Marcar todas as carregadas como lidas")
                    .assertIsEnabled()
                true
            }.getOrDefault(false)
        }
        compose.onNodeWithText("Marcar todas as carregadas como lidas")
            .performClick()
        compose.waitUntil(30_000) {
            runCatching {
                val events = Tasks.await(db.collection("users").document(claraUid)
                    .collection("notifications").get(Source.SERVER),
                    4, TimeUnit.SECONDS)
                events.size() == 2 && events.documents.all { it.getBoolean("read") == true }
            }.getOrDefault(false)
        }
    }

    @Test fun claraEditaPerfilESelecionaSeloLeigaPelaTela() {
        compose.setContent { OnlineAtrioApp(compose.activity) }
        val claraUid = register("Clara (BOT DE TESTE)", "profile_clara")

        compose.onNodeWithTag("atrio-tab-profile").performClick()
        waitFor("atrio-profile-list")
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-profile-edit"))
        compose.onNodeWithTag("atrio-profile-edit")
            .assertIsDisplayed().performClick()

        waitFor("atrio-profile-bio")
        compose.onNodeWithTag("atrio-profile-bio")
            .performTextInput("Perfil sintético para teste de apresentação no Átrio.")
        compose.onNodeWithTag("atrio-profile-save")
            .assertIsEnabled().performClick()

        // O toque do botão Salvar precisa gerar alteração durável no servidor.
        compose.waitUntil(35_000) {
            runCatching {
                val doc = Tasks.await(
                    db.collection("profiles").document(claraUid).get(Source.SERVER),
                    4, TimeUnit.SECONDS)
                doc.getString("bio") == "Perfil sintético para teste de apresentação no Átrio."
            }.getOrDefault(false)
        }
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-profile-badges"))
        compose.onNodeWithTag("atrio-profile-badges")
            .assertIsDisplayed().performClick()

        waitFor("atrio-badge-lay-leiga")
        compose.onNodeWithTag("atrio-badge-lay-leiga")
            .assertIsEnabled().performClick()
        compose.waitUntil(35_000) {
            runCatching {
                val badge = Tasks.await(
                    db.collection("badges").document(claraUid).get(Source.SERVER),
                    4, TimeUnit.SECONDS)
                badge.getString("lay") == "leiga"
            }.getOrDefault(false)
        }
    }

    @Test fun luciaDenunciaDiscussaoPelaTelaSemApagarPost() {
        compose.setContent { OnlineAtrioApp(compose.activity) }
        val claraUid = register("Clara (BOT DE TESTE)", "report_clara")
        compose.onNodeWithTag("atrio-tab-publish").performClick()
        waitFor("atrio-publish-title")
        val title = "Teste denúncia E2E $session"
        val originalBody = "Esta é uma discussão fictícia do laboratório de testes."
        compose.onNodeWithTag("atrio-publish-title").performTextInput(title)
        compose.onNodeWithTag("atrio-publish-body").performTextInput(originalBody)
        compose.onNodeWithTag("atrio-publish-submit")
            .performScrollTo().assertIsEnabled().performClick()

        // A discussão deve estar gravada no servidor emulado; conteúdo no
        // formulário não é prova de persistência.
        compose.waitUntil(35_000) {
            runCatching {
                Tasks.await(db.collection("posts").whereEqualTo("title", title)
                    .get(Source.SERVER), 4, TimeUnit.SECONDS).size() == 1
            }.getOrDefault(false)
        }
        val post = Tasks.await(db.collection("posts").whereEqualTo("title", title)
            .get(Source.SERVER), 6, TimeUnit.SECONDS).documents.single()
        assertEquals(claraUid, post.getString("uid"))
        logoutByTouch()

        val luciaUid = register("Lúcia (BOT DE TESTE)", "report_lucia")
        openDiscussion(post.id)
        // Garantir que o botão está no viewport antes de efetuar o toque.
        compose.onNodeWithTag("atrio-detail-report-post")
            .performScrollTo().assertIsDisplayed().performClick()
        waitFor("atrio-report-post-reason")
        compose.onNodeWithTag("atrio-report-post-reason")
            .performTextInput("Simulação autorizada de denúncia, sem conteúdo ofensivo.")
        compose.onNodeWithTag("atrio-report-post-submit")
            .assertIsEnabled().performClick()

        // A mensagem é exibida somente após o Firestore confirmar a escrita.
        compose.waitUntil(35_000) {
            compose.onAllNodesWithText(
                "Denúncia enviada para análise da moderação.", substring = true
            ).fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(luciaUid, auth.currentUser?.uid)
        val unchanged = Tasks.await(db.collection("posts").document(post.id)
            .get(Source.SERVER), 8, TimeUnit.SECONDS)
        assertTrue("Uma denúncia de teste não pode excluir o post", unchanged.exists())
        assertEquals(originalBody, unchanged.getString("body"))
        assertEquals(claraUid, unchanged.getString("uid"))
    }
}
