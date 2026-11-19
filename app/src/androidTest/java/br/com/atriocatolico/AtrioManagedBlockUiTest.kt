package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import kotlinx.coroutines.CompletableDeferred
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

class AtrioManagedBlockUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun maintenanceKeepsConversationHiddenAndBlockUnconfirmedUntilRetryCommits() {
        val pendingReply = CompletableDeferred<AtrioBlockReply>()
        val requests = mutableListOf<AtrioBlockIntent>()
        val blocks = AtrioManagedBlocks({ true }, object : AtrioManagedBlockService {
            override suspend fun read(peerUid: String) = AtrioBlockState(false, "\"initial\"")
            override suspend fun submit(intent: AtrioBlockIntent): AtrioBlockReply {
                requests += intent
                return if (requests.size == 1) pendingReply.await()
                else AtrioBlockReply.Committed(AtrioBlockState(true, "\"v-confirmed\""))
            }
        })
        val action = "atrio-chat-block-toggle"
        val feedback = "atrio-managed-block-feedback"
        compose.setContent {
            Column {
                if ("miguel" !in blocks.hiddenPeers())
                    Text("Conversa de Miguel", Modifier.testTag("conversation"))
                AtrioManagedBlockControl(blocks, "miguel", tag = action)
            }
        }

        compose.onNodeWithTag(action).performClick()
        compose.onNodeWithTag(feedback).assertTextContains("Aguardando confirmação do servidor.")
        compose.onNodeWithTag("conversation").assertDoesNotExist()
        compose.onNodeWithText("Participante bloqueado.").assertDoesNotExist()
        compose.runOnIdle { pendingReply.complete(AtrioBlockReply.Pending) }
        compose.onNodeWithTag(feedback).assertTextContains("Bloqueio pendente", substring = true)
        compose.onNodeWithText("Participante bloqueado.").assertDoesNotExist()

        compose.onNodeWithTag(action).performClick()
        compose.onNodeWithTag(feedback).assertTextContains("Participante bloqueado.")
        compose.onNodeWithTag(action).assertTextContains("Desbloquear participante")
        compose.runOnIdle { assertEquals(requests[0], requests[1]) }
    }
}
