package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class ScopedConversationModerationEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val caseId = "qa_clara_direct_01"

    @Test fun assignedCaseShowsOnlyMinimalEvidenceAndDeniedCaseClearsIt() {
        var response: ScopedCaseResult = allowed("direct", caseId)
        var requests = 0
        val gateway = ScopedCaseGateway { _, _, _ ->
            requests++
            response
        }
        compose.setContent {
            MaterialTheme {
                ScopedConversationModerationPanel("qa-moderador", "qa-moderador", true, gateway)
            }
        }
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("scoped-case-excerpt"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Trecho fictício denunciado").assertExists()
        compose.onNodeWithText("Motivo: Conteúdo impróprio fictício").assertExists()
        compose.onNodeWithText("Histórico da conversa").assertDoesNotExist()
        assertEquals(1, requests)

        // Simula uma atribuição revogada no serviço por caso: resposta uniforme 404.
        response = ScopedCaseResult.Unavailable
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("scoped-case-unavailable"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("scoped-case-evidence").assertDoesNotExist()
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
        assertEquals(2, requests)
    }

    @Test fun newAccountAndLateResponseCannotRecoverPreviousEvidence() {
        var observedUid by mutableStateOf("qa-moderador")
        val pending = CompletableDeferred<ScopedCaseResult>()
        val gateway = ScopedCaseGateway { _, _, _ -> pending.await() }
        compose.setContent {
            MaterialTheme {
                ScopedConversationModerationPanel("qa-moderador", observedUid, true, gateway)
            }
        }
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.runOnUiThread { observedUid = "qa-outra-conta" }
        compose.onNodeWithTag("scoped-case-session-lost").assertExists()
        pending.complete(allowed("direct", caseId))
        compose.waitForIdle()
        compose.onNodeWithTag("scoped-case-evidence").assertDoesNotExist()
        compose.runOnUiThread { observedUid = "qa-moderador" }
        compose.waitForIdle()
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
        compose.onNodeWithTag("scoped-case-open").assertExists()
    }

    @Test fun failureAndExplicitClearNeverRetainEvidence() {
        var response: ScopedCaseResult = allowed("group", caseId)
        val gateway = ScopedCaseGateway { _, _, _ -> response }
        compose.setContent {
            MaterialTheme {
                ScopedConversationModerationPanel("qa-moderador", "qa-moderador", true, gateway)
            }
        }
        compose.onNodeWithTag("scoped-case-group").performClick()
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("scoped-case-evidence"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("scoped-case-clear").performClick()
        compose.onNodeWithTag("scoped-case-evidence").assertDoesNotExist()
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        response = ScopedCaseResult.Error
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("scoped-case-error"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        response = ScopedCaseResult.Closed
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodes(androidx.compose.ui.test.hasTestTag("scoped-case-closed"))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("scoped-case-evidence").assertDoesNotExist()
    }

    @Test fun parserRejectsMismatchedIdsExtraFieldsAndInvalidDates() {
        val valid = """{"status":"available","case":{"caseId":"qa_clara_direct_01","channel":"direct","reason":"Conteúdo impróprio fictício","excerpt":"Trecho fictício denunciado","reportedAt":"2026-11-24T00:00:00.000Z"}}"""
        assertTrue(decodeScopedCaseResponse(valid, "direct", caseId) is ScopedCaseResult.Available)
        assertEquals(ScopedCaseResult.Error,
            decodeScopedCaseResponse(valid, "direct", "outro_caso"))
        assertEquals(ScopedCaseResult.Error,
            decodeScopedCaseResponse(valid.replace("2026-11-24T00:00:00.000Z", "data_invalida"), "direct", caseId))
        assertEquals(ScopedCaseResult.Error,
            decodeScopedCaseResponse(valid.replace("Trecho fictício denunciado", "Trecho fictício denunciado" + "\"" + ",\"history\":\"privado"), "direct", caseId))
    }

    @Test fun withoutQaEndpointTheRealHttpClientFailsClosed() = runBlocking {
        assertEquals(ScopedCaseResult.Closed,
            QaScopedCaseHttpGateway("").open("qa-moderador", "direct", caseId))
    }

    private fun allowed(channel: String, id: String): ScopedCaseResult =
        ScopedCaseResult.Available(
            ScopedCaseEvidence(id, channel, "Conteúdo impróprio fictício",
                "Trecho fictício denunciado", "2026-11-24T00:00:00.000Z")
        )
}
