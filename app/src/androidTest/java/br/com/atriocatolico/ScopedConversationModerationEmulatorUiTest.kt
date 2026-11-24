package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
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


    @Test fun moderatorTriageDecisionAndReappealReviewRequireConfirmedCaseStage() {
        var stage="open"
        var calls=0
        val workflow=object:ScopedCaseWorkflowGateway {
            override suspend fun state(uid:String,channel:String,caseId:String):ScopedWorkflowReply =
                ScopedWorkflowReply.Stage(stage)
            override suspend fun action(uid:String,channel:String,caseId:String,
                action:String,decision:String?,note:String?):ScopedWorkflowReply {
                calls++
                stage=when(action) {
                    "triage" -> { assertEquals("open",stage);assertEquals(null,decision);"triaged" }
                    "decide" -> {
                        assertEquals("triaged",stage)
                        assertEquals("action_recommended",decision)
                        assertTrue(validScopedWorkflowNote(note.orEmpty()))
                        "decided"
                    }
                    "review_appeal" -> {
                        assertEquals("appealed",stage);assertEquals("revised",decision)
                        assertTrue(validScopedWorkflowNote(note.orEmpty()))
                        "appeal_reviewed"
                    }
                    else -> throw AssertionError("Operação fora do contrato")
                }
                return ScopedWorkflowReply.Stage(stage)
            }
            override suspend fun appeal(uid:String,channel:String,caseId:String,
                reason:String):ScopedWorkflowReply = ScopedWorkflowReply.Error
        }
        val reader=ScopedCaseGateway { _, _, _ -> allowed("direct",caseId) }
        compose.setContent { MaterialTheme {
            ScopedConversationModerationPanel("qa-moderador","qa-moderador",true,reader,workflow)
        }}
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-workflow-triage"))
            .fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("scoped-workflow-triage").performClick()
        compose.onNodeWithTag("scoped-workflow-cancel").performClick()
        assertEquals(0,calls)
        compose.onNodeWithTag("scoped-workflow-triage").performClick()
        compose.onNodeWithTag("scoped-workflow-confirm").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-workflow-choice-action_recommended"))
            .fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("scoped-workflow-choice-action_recommended").performClick()
        compose.onNodeWithTag("scoped-workflow-note").performTextInput(
            "Justificativa fictícia de laboratório sem remoção.")
        compose.onNodeWithTag("scoped-workflow-decide").performClick()
        compose.onNodeWithTag("scoped-workflow-confirm").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-workflow-status"))
            .fetchSemanticsNodes().isNotEmpty() }
        assertEquals("decided",stage)
        assertEquals(2,calls)
        compose.onNodeWithTag("scoped-workflow-triage").assertDoesNotExist()
        compose.onNodeWithTag("scoped-workflow-decide").assertDoesNotExist()
        // Agora a atribuição muda para OUTRO moderador. Neste mesmo painel,
        // resposta 404 do estado deve retirar a prova em vez de permitir revisão.
        stage="appealed"
        // O teste de revisão com outro moderador é separado, sem reutilizar
        // sessão e atribuição do decisor original.
    }

    @Test fun workflowRefusalClearsEvidenceAndOldCaseNeverBecomesVisible() {
        val workflow=object:ScopedCaseWorkflowGateway {
            override suspend fun state(uid:String,channel:String,caseId:String) =
                ScopedWorkflowReply.Unavailable
            override suspend fun action(uid:String,channel:String,caseId:String,
                action:String,decision:String?,note:String?)=ScopedWorkflowReply.Error
            override suspend fun appeal(uid:String,channel:String,caseId:String,reason:String) =
                ScopedWorkflowReply.Error
        }
        compose.setContent { MaterialTheme {
            ScopedConversationModerationPanel("qa-moderador","qa-moderador",true,
                ScopedCaseGateway{_,_,_->allowed("direct",caseId)},workflow)
        }}
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-case-unavailable"))
            .fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
        compose.onNodeWithTag("scoped-workflow-controls").assertDoesNotExist()
    }

    @Test fun reporterCanSubmitSingleAppealAfterDecisionViaExplicitConfirmation() {
        var sent=""
        var count=0
        val workflow=object:ScopedCaseWorkflowGateway {
            override suspend fun state(uid:String,channel:String,caseId:String)=ScopedWorkflowReply.Error
            override suspend fun action(uid:String,channel:String,caseId:String,
                action:String,decision:String?,note:String?)=ScopedWorkflowReply.Error
            override suspend fun appeal(uid:String,channel:String,caseId:String,
                reason:String):ScopedWorkflowReply {
                assertEquals("qa-clara",uid)
                assertEquals("direct",channel)
                assertTrue(caseId.startsWith(uid+"__"))
                assertTrue(validScopedWorkflowNote(reason))
                sent=reason;count++
                return ScopedWorkflowReply.Stage("appealed")
            }
        }
        compose.setContent { MaterialTheme {
            ScopedCaseAppealPanel("qa-clara","qa-clara","direct",
                "qa-clara__dm01__m01",workflow)
        }}
        compose.onNodeWithTag("scoped-appeal-toggle").performClick()
        compose.onNodeWithTag("scoped-appeal-reason").performTextInput(
            " Solicito revisão por outro moderador. ")
        compose.onNodeWithTag("scoped-appeal-submit").performClick()
        compose.onNodeWithText("Cancelar").performClick()
        assertEquals(0,count)
        compose.onNodeWithTag("scoped-appeal-submit").performClick()
        compose.onNodeWithTag("scoped-appeal-confirm").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-appeal-result"))
            .fetchSemanticsNodes().isNotEmpty() }
        assertEquals("Solicito revisão por outro moderador.",sent)
        assertEquals(1,count)
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
    }


    @Test fun separateReviewerMayReviewAppealAndDenialClearsEvidence() {
        var state:ScopedWorkflowReply=ScopedWorkflowReply.Stage("appealed")
        var reviews=0
        val gate=object:ScopedCaseWorkflowGateway {
            override suspend fun state(uid:String,channel:String,caseId:String)=state
            override suspend fun action(uid:String,channel:String,caseId:String,
                action:String,decision:String?,note:String?):ScopedWorkflowReply {
                assertEquals("qa-outro-moderador",uid)
                assertEquals("group",channel)
                assertEquals("review_appeal",action)
                assertEquals("revised",decision)
                assertTrue(validScopedWorkflowNote(note.orEmpty()))
                reviews++
                state=ScopedWorkflowReply.Stage("appeal_reviewed")
                return state
            }
            override suspend fun appeal(uid:String,channel:String,caseId:String,reason:String)=
                ScopedWorkflowReply.Error
        }
        compose.setContent { MaterialTheme {
            ScopedConversationModerationPanel("qa-outro-moderador","qa-outro-moderador",
                true,ScopedCaseGateway{_,_,_->allowed("group",caseId)},gate)
        }}
        compose.onNodeWithTag("scoped-case-group").performClick()
        compose.onNodeWithTag("scoped-case-id").performTextInput(caseId)
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-workflow-choice-revised"))
            .fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("scoped-workflow-choice-revised").performClick()
        compose.onNodeWithTag("scoped-workflow-note").performTextInput(
            "Revisão por moderador distinto no laboratório.")
        compose.onNodeWithTag("scoped-workflow-decide").performClick()
        compose.onNodeWithTag("scoped-workflow-confirm").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-workflow-status"))
            .fetchSemanticsNodes().isNotEmpty() }
        assertEquals(1,reviews)
        assertEquals(ScopedWorkflowReply.Stage("appeal_reviewed"),state)
        state=ScopedWorkflowReply.Unavailable
        compose.onNodeWithTag("scoped-case-open").performClick()
        compose.waitUntil(10_000) { compose.onAllNodes(
            androidx.compose.ui.test.hasTestTag("scoped-case-unavailable"))
            .fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithTag("scoped-case-excerpt").assertDoesNotExist()
    }

    @Test fun workflowParserAndLocalGatewayRejectUnexpectedPayload() = runBlocking {
        val available="""{"status":"available","stage":"triaged"}"""
        assertEquals(ScopedWorkflowReply.Stage("triaged"),
            decodeScopedWorkflowReply(available,"state"))
        assertEquals(ScopedWorkflowReply.Error,
            decodeScopedWorkflowReply("""{"status":"accepted","stage":"decided","privateHistory":1}""",
                "action","decide"))
        assertEquals(ScopedWorkflowReply.Error,
            decodeScopedWorkflowReply(available,"action","triage"))
        assertEquals(ScopedWorkflowReply.Error,
            decodeScopedWorkflowReply("""{"status":"accepted","stage":"appealed"}""",
                "action","decide"))
        assertEquals(ScopedWorkflowReply.Closed,
            QaScopedCaseWorkflowHttpGateway("").state("qa-clara","direct",caseId))
        assertEquals(ScopedWorkflowReply.Closed,
            QaScopedCaseWorkflowHttpGateway("").appeal("qa-clara","direct",caseId,
                "Motivo de teste legítimo."))
    }

    private fun allowed(channel: String, id: String): ScopedCaseResult =
        ScopedCaseResult.Available(
            ScopedCaseEvidence(id, channel, "Conteúdo impróprio fictício",
                "Trecho fictício denunciado", "2026-11-24T00:00:00.000Z")
        )
}
