package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * Cadastro e confirmação reais pela interface Compose, com Firebase Auth e Firestore
 * emulados exclusivamente. Nenhuma conta, e-mail ou credencial de produção.
 *
 * O código de confirmação é lido na API exclusiva do emulador (não envia e-mail real).
 */
class EmailVerificationAndroidUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private val project = "demo-atrio-v11"
    private val base = "http://127.0.0.1:9099"
    private lateinit var auth: FirebaseAuth
    private var seededPolicy = false

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
        if (seededPolicy) {
            mutatePolicyEmulator("DELETE", null)
            seededPolicy = false
        }
    }

    private fun readEmulator(url: String): String {
        val parsed = URL(url)
        require(parsed.protocol == "http" && parsed.port == 9099 &&
            parsed.host in setOf("127.0.0.1", "localhost")) {
            "Tentativa de acessar endereco externo ao Firebase Emulator"
        }
        val connection = parsed.openConnection() as HttpURLConnection
        connection.connectTimeout = 2500
        connection.readTimeout = 2500
        try {
            check(connection.responseCode == 200) {
                "API do emulador retornou HTTP " + connection.responseCode
            }
            return connection.inputStream.bufferedReader().use { it.readText() }
        } finally {
            connection.disconnect()
        }
    }

    private fun mutatePolicyEmulator(method: String, payload: String?): Int {
        val baseUrl = "http://127.0.0.1:8089/v1/projects/$project/databases/(default)/documents"
        val endpoint = if (method == "POST")
            "$baseUrl/app_config?documentId=email_verification"
        else "$baseUrl/app_config/email_verification"
        require(method in setOf("POST", "DELETE") &&
            FirebaseApp.getInstance().options.projectId == project &&
            BuildConfig.DEBUG) { "Politica QA so pode ser alterada no Emulator" }
        val connection = (URL(endpoint).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 4000
            readTimeout = 4000
            setRequestProperty("Authorization", "Bearer owner")
            if (payload != null) {
                setRequestProperty("Content-Type", "application/json")
                doOutput = true
            }
        }
        try {
            if (payload != null) connection.outputStream.use {
                it.write(payload.toByteArray(Charsets.UTF_8))
            }
            val status = connection.responseCode
            check(status in 200..299) {
                "Firestore Emulator recusou alteracao de politica QA: HTTP $status"
            }
            return status
        } finally {
            connection.disconnect()
        }
    }

    private fun verificationLinks(email: String): List<String> {
        val response = JSONObject(readEmulator(
            "$base/emulator/v1/projects/$project/oobCodes"
        )).optJSONArray("oobCodes") ?: return emptyList()
        return (0 until response.length()).mapNotNull { index ->
            val item = response.optJSONObject(index) ?: return@mapNotNull null
            if (item.optString("requestType") == "VERIFY_EMAIL" &&
                item.optString("email") == email
            ) item.optString("oobLink").takeIf { it.isNotBlank() } else null
        }
    }

    private fun waitForTag(tag: String) {
        compose.waitUntil(45000) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    @Test fun cadastroReenvioConfirmacaoEAtualizacaoDoToken() {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val app = FirebaseApp.getInstance()
        assertTrue("QA nunca usa Firebase produtivo",
            app.options.projectId == project && BuildConfig.DEBUG)
        assertTrue("Worker de producao nao deve estar no QA",
            BuildConfig.PUSH_RELAY_URL.isBlank())
        auth = FirebaseAuth.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        auth.signOut()

        val email = "cadastro." + System.nanoTime() + "@qa.invalid"
        val password = "FraseSeguraParaQA2026!"

        compose.setContent { OnlineAtrioApp(compose.activity) }
        waitForTag("atrio-auth-toggle")
        compose.onNodeWithTag("atrio-auth-toggle").performClick()
        waitForTag("atrio-auth-name")
        compose.onNodeWithTag("atrio-auth-name").performTextInput("Maria QA")
        compose.onNodeWithTag("atrio-auth-email").performTextInput(email)
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-confirm").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-rules").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().performClick()

        compose.waitUntil(45000) { auth.currentUser != null }
        assertFalse("Conta nova nao pode iniciar com email verificado",
            auth.currentUser!!.isEmailVerified)
        waitForTag("atrio-tab-profile")

        // Envio automatico na criacao; cada codigo corresponde a esta conta ficticia.
        compose.waitUntil(35000) { verificationLinks(email).isNotEmpty() }
        val previousCount = verificationLinks(email).size

        compose.onNodeWithTag("atrio-tab-profile").performClick()
        waitForTag("atrio-profile-list")
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-auth-resend-verification"))
        compose.onNodeWithTag("atrio-auth-resend-verification").performClick()

        compose.waitUntil(35000) { verificationLinks(email).size > previousCount }
        val verifyLink = verificationLinks(email).last()

        // Simula clicar no link gerado pelo Auth Emulator sem usar a internet.
        val confirmation = readEmulator(verifyLink)
        assertTrue("Emulador recusou link de confirmacao",
            JSONObject(confirmation).has("authEmulator"))
        assertFalse("O SDK deve atualizar o estado apenas apos reload",
            auth.currentUser!!.isEmailVerified)

        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-auth-check-verification"))
        compose.onNodeWithTag("atrio-auth-check-verification").performClick()
        compose.waitUntil(35000) { auth.currentUser?.isEmailVerified == true }

        // Prova de verdade no token, nao apenas um marcador gravado em perfil.
        val token = Tasks.await(auth.currentUser!!.getIdToken(true), 15, TimeUnit.SECONDS)
        assertEquals(true, token.claims["email_verified"])
    }
    @Test fun portalObrigatorioPermiteReenvioESairSemAcessarForum() {
        val app = FirebaseApp.getInstance()
        assertTrue("Teste deve usar apenas Firebase Emulator",
            app.options.projectId == project && BuildConfig.DEBUG)
        assertTrue("Nao conectar ao Worker oficial",
            BuildConfig.PUSH_RELAY_URL.isBlank())

        auth = FirebaseAuth.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        auth.signOut()
        val email = "portal." + System.nanoTime() + "@qa.invalid"
        val result = Tasks.await(
            auth.createUserWithEmailAndPassword(email, "FraseSeguraParaQA2026!"),
            20, TimeUnit.SECONDS
        )
        val user = result.user ?: error("Conta de ensaio ausente")
        assertFalse(user.isEmailVerified)

        compose.setContent {
            AtrioTheme {
                MandatoryEmailVerificationGate(
                    uid = user.uid,
                    onVerified = {},
                    onSignOut = { auth.signOut() }
                )
            }
        }
        waitForTag("atrio-email-verification-gate")
        waitForTag("atrio-email-verification-required-title")
        waitForTag("atrio-auth-resend-verification")
        waitForTag("atrio-auth-check-verification")
        // Uma conta sem verificacao nao encontra navegacao para publicar.
        assertTrue(
            compose.onAllNodesWithTag("atrio-tab-publish", useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty()
        )
        compose.onNodeWithTag("atrio-email-verification-signout").performScrollTo().performClick()
        compose.waitUntil(15000) { auth.currentUser == null }
    }

    @Test fun politicaAdministrativaAtivaBloqueiaEntradaDeContaNaoVerificada() {
        val app = FirebaseApp.getInstance()
        assertTrue("QA deve usar projeto demo e SDK debug",
            app.options.projectId == project && BuildConfig.DEBUG)
        assertTrue("Nao usar Worker de producao",
            BuildConfig.PUSH_RELAY_URL.isBlank())
        auth = FirebaseAuth.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        auth.signOut()

        mutatePolicyEmulator(
            "POST",
            """{"fields":{"enabled":{"booleanValue":true},"version":{"stringValue":"2026-11-v1"}}}"""
        )
        seededPolicy = true

        val email = "obrigatorio." + System.nanoTime() + "@qa.invalid"
        val password = "FraseSeguraParaQA2026!"
        compose.setContent { OnlineAtrioApp(compose.activity) }
        waitForTag("atrio-auth-toggle")
        compose.onNodeWithTag("atrio-auth-toggle").performClick()
        waitForTag("atrio-auth-name")
        compose.onNodeWithTag("atrio-auth-name").performTextInput("Conta QA")
        compose.onNodeWithTag("atrio-auth-email").performTextInput(email)
        compose.onNodeWithTag("atrio-auth-password").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-confirm").performTextInput(password)
        compose.onNodeWithTag("atrio-auth-rules").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().performClick()

        compose.waitUntil(45000) { auth.currentUser != null }
        waitForTag("atrio-email-verification-gate")
        waitForTag("atrio-auth-resend-verification")
        waitForTag("atrio-auth-check-verification")
        assertFalse("Conta recém-criada ainda nao verificou e-mail",
            auth.currentUser!!.isEmailVerified)
        assertTrue("Com politica ativa o forum nao pode aparecer",
            compose.onAllNodesWithTag("atrio-tab-publish", useUnmergedTree = true)
                .fetchSemanticsNodes().isEmpty())

        // Deve ser possivel concluir a verificacao SEM sair do portao.
        compose.waitUntil(35000) { verificationLinks(email).isNotEmpty() }
        val previousCount = verificationLinks(email).size
        compose.onNodeWithTag("atrio-auth-resend-verification")
            .performScrollTo().performClick()
        compose.waitUntil(35000) { verificationLinks(email).size > previousCount }
        val link = verificationLinks(email).last()
        assertTrue("Verificacao somente no Firebase Auth Emulator",
            JSONObject(readEmulator(link)).has("authEmulator"))
        compose.onNodeWithTag("atrio-auth-check-verification")
            .performScrollTo().performClick()
        compose.waitUntil(35000) { auth.currentUser?.isEmailVerified == true }
        // Agora o callback da UI deve liberar a comunidade e nao apenas
        // alterar um campo local sem renovar o token.
        waitForTag("atrio-tab-publish")
        val token = Tasks.await(auth.currentUser!!.getIdToken(true), 15, TimeUnit.SECONDS)
        assertEquals(true, token.claims["email_verified"])
    }

}
