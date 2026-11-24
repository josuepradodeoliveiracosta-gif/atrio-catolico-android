package br.com.atriocatolico

import android.content.Context
import android.view.inputmethod.InputMethodManager
import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/**
 * #199: clients de produção do candidato, sem gateway simulado, trust manager
 * injetado ou HostnameVerifier alternativo. A CA efêmera é configurada apenas
 * na variante local do runner, não no código do aplicativo.
 */
class ScopedCaseHttpsE2eAndroidTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val clara = "qa-item13-clara"
    private val miguel = "qa-item13-miguel"
    private val lucia = "qa-item13-lucia"
    private val password = "SomenteEmuladorItem13-2026!"
    private val note = "Justificativa sintetica de homologacao."
    private val reason = "Solicito revisao independente em QA."
    private val origin = BuildConfig.ATRIO_QA_SCOPED_CASE_ORIGIN
    private lateinit var auth: FirebaseAuth
    private lateinit var reader: QaScopedCaseHttpGateway
    private lateinit var flow: QaScopedCaseWorkflowHttpGateway
    private var panelUid by mutableStateOf("")
    private var observedUid by mutableStateOf<String?>(null)
    private var listener: FirebaseAuth.AuthStateListener? = null

    private fun initialize() {
        check(BuildConfig.DEBUG && BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT &&
            !BuildConfig.ATRIO_QA_GERAL_REMOTE && !BuildConfig.ATRIO_QA_GERAL_PUSH)
        assertEquals("br.com.atriocatolico.qageral.celular", compose.activity.packageName)
        assertEquals("br.com.atriocatolico.qageral.celular", BuildConfig.APPLICATION_ID)
        check(BuildConfig.PUSH_RELAY_URL.isBlank())
        assertEquals("https://127.0.0.1:8095", origin)
        val app = FirebaseApp.getInstance()
        assertEquals("demo-atrio-v11", app.options.projectId)
        val db = FirebaseFirestore.getInstance(app)
        check(db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)
        auth = FirebaseAuth.getInstance(app)
        auth.signOut()
        reader = QaScopedCaseHttpGateway(origin)
        flow = QaScopedCaseWorkflowHttpGateway(origin)
        listener = FirebaseAuth.AuthStateListener { observedUid = it.currentUser?.uid }
        auth.addAuthStateListener(requireNotNull(listener))
    }

    @After fun cleanup() {
        if (::auth.isInitialized) {
            listener?.let { auth.removeAuthStateListener(it) }
            auth.signOut()
        }
    }

    private fun login(uid: String) {
        auth.signOut()
        val user = requireNotNull(Tasks.await(auth.signInWithEmailAndPassword(
            uid + "@qa.invalid", password), 15, TimeUnit.SECONDS).user)
        assertEquals(uid, user.uid)
        assertTrue(user.isEmailVerified)
        compose.waitUntil(15_000) { observedUid == uid }
    }

    private fun <T> net(block: suspend () -> T): T = runBlocking { block() }
    private fun id(channel: String, message: String = "m01") =
        clara + "__qa-item13-" + channel + "__" + message
    private fun waitTag(tag: String) = compose.waitUntil(20_000) {
        compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
    }
    private fun waitStage(stage: String) = compose.waitUntil(20_000) {
        compose.onAllNodesWithText(scopedWorkflowStageLabel(stage)).fetchSemanticsNodes().isNotEmpty()
    }
    private fun click(tag: String) {
        waitTag(tag)
        compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed().performClick()
    }
    private fun hideKeyboard() {
        compose.runOnUiThread {
            (compose.activity.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager)
                .hideSoftInputFromWindow(compose.activity.window.decorView.windowToken, 0)
        }
        compose.waitForIdle()
    }
    private fun showCase(uid: String, channel: String, caseId: String, stage: String) {
        compose.runOnIdle { panelUid = uid }
        compose.waitForIdle()
        click("scoped-case-clear")
        click(if (channel == "direct") "scoped-case-direct" else "scoped-case-group")
        compose.onNodeWithTag("scoped-case-id").performScrollTo().performTextInput(caseId)
        hideKeyboard()
        click("scoped-case-open")
        waitStage(stage)
        compose.onNodeWithTag("scoped-case-excerpt").assertExists()
        compose.onAllNodesWithText("Prova sintetica autorizada " + channel).fetchSemanticsNodes()
            .let { assertEquals(1, it.size) }
        compose.onAllNodesWithText("HISTORICO-PRIVADO-NAO-RETORNAR", substring = true)
            .fetchSemanticsNodes().let { assertEquals(0, it.size) }
    }
    private fun proofGone() {
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
        compose.onNodeWithTag("scoped-case-evidence").assertDoesNotExist()
        compose.onNodeWithTag("scoped-workflow-controls").assertDoesNotExist()
    }
    private fun chooseAndConfirm(choice: String) {
        click("scoped-workflow-choice-" + choice)
        compose.onNodeWithTag("scoped-workflow-note").performScrollTo().performTextInput(note)
        hideKeyboard()
        click("scoped-workflow-decide")
        click("scoped-workflow-confirm")
    }

    // O runner executa este método com CA estranha e com SAN incompatível.
    // O host também exige zero requisições HTTP após o handshake negativo.
    @Test fun invalidTlsIsRejectedByBothRealClients() {
        initialize()
        login(miguel)
        assertEquals(ScopedCaseResult.Error, net { reader.open(miguel, "direct", id("direct")) })
        assertEquals(ScopedWorkflowReply.Error, net { flow.state(miguel, "direct", id("direct")) })
    }

    @Test fun realWorkflowDmAndGroupWithAccountSwitchAndRevocation() {
        initialize()
        compose.setContent {
            MaterialTheme {
                if (panelUid.isNotEmpty()) ScopedConversationModerationPanel(
                    panelUid, observedUid, true, reader, flow)
            }
        }
        for (channel in listOf("direct", "group")) {
            val caseId = id(channel)
            val outside = id(channel, "m02")
            login(miguel)
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(miguel, channel, outside) })
            assertEquals(ScopedWorkflowReply.Unavailable, net { flow.state(miguel, channel, outside) })
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.action(miguel, channel, outside, "triage") })
            showCase(miguel, channel, caseId, "open")

            // AuthStateListener real: mantém o painel antigo e troca a sessão real.
            login(lucia)
            waitTag("scoped-case-session-lost")
            proofGone()
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(miguel, channel, caseId) })
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(lucia, channel, caseId) })
            assertEquals(ScopedWorkflowReply.Unavailable, net { flow.state(lucia, channel, caseId) })
            login(clara)
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(clara, channel, caseId) })
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.appeal(clara, channel, caseId, reason) })

            login(miguel)
            showCase(miguel, channel, caseId, "open")
            click("scoped-workflow-triage")
            click("scoped-workflow-confirm")
            waitStage("triaged")
            chooseAndConfirm("action_recommended")
            waitStage("decided")
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.appeal(miguel, channel, caseId, reason) })

            login(lucia)
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.appeal(lucia, channel, caseId, reason) })
            login(clara)
            assertEquals(ScopedWorkflowReply.Stage("appealed"),
                net { flow.appeal(clara, channel, caseId, reason) })
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.appeal(clara, channel, caseId, reason) })

            // A fixture só reatribui DEPOIS da recusa real do decisor,
            // verificando em Firestore que ele ainda estava atribuído.
            login(miguel)
            assertEquals(ScopedWorkflowReply.Unavailable,
                net { flow.action(miguel, channel, caseId, "review_appeal", "revised", note) })
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(miguel, channel, caseId) })

            login(lucia)
            showCase(lucia, channel, caseId, "appealed")
            chooseAndConfirm("revised")
            waitStage("appeal_reviewed")
            // O host revoga a fixture após a revalidação real da revisão.
            click("scoped-case-open")
            waitTag("scoped-case-unavailable")
            proofGone()
            assertEquals(ScopedCaseResult.Unavailable, net { reader.open(lucia, channel, caseId) })
            assertEquals(ScopedWorkflowReply.Unavailable, net { flow.state(lucia, channel, caseId) })
        }
    }
}
