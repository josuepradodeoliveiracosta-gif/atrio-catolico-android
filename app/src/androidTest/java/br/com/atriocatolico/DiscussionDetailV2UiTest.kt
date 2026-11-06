package br.com.atriocatolico

import androidx.compose.runtime.*
import androidx.compose.material3.Text
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/**
 * Cenários sem rede/Firebase/produção: usa somente callbacks simulados.
 * A tela pública continua com os mesmos contratos de resposta e denúncia.
 */
class DiscussionDetailV2UiTest {
    @get:Rule val compose = createComposeRule()

    private val sample = Post(
        id = "discussion-ui-test",
        author = "AlexFelipe",
        category = "Sagradas Escrituras",
        age = "há 4 h",
        title = "Gn 1, 3",
        body = "E Deus disse: Haja luz!",
        remote = true,
        replies = listOf(Reply(
            author = "Miguel", message = "Vamos orar juntos.",
            id = "reply-1", ownerUid = "", createdAtMillis = 0L
        ))
    )

    @Test fun compactComposerAndReplyKeepExistingSubmitContract() {
        var sent by mutableStateOf("")
        compose.setContent {
            AtrioTheme {
                DetailScreen(sample, "Ana", onLike = {}, onSave = {},
                    onReply = { body, done -> sent = body; done(true) })
            }
        }
        compose.onNodeWithTag("atrio-open-reply-composer").assertExists().performClick()
        compose.onNodeWithTag("atrio-reply-input").performTextInput("Uma resposta de teste.")
        compose.onNodeWithTag("atrio-reply-submit").performClick()
        compose.runOnIdle { assertEquals("Uma resposta de teste.", sent) }
        compose.onNodeWithTag("atrio-open-reply-composer").assertExists()

        compose.onNodeWithTag("atrio-detail-replies").performScrollToIndex(1)
        compose.onNodeWithTag("atrio-quote-reply").performClick()
        compose.onNodeWithTag("atrio-reply-input").performTextInput("Paz e bem!")
        compose.onNodeWithTag("atrio-reply-submit").performClick()
        compose.runOnIdle { assertTrue(sent.startsWith("↳ Em resposta a Miguel: Paz e bem!")) }
    }

    @Test fun discussionModerationActionsAreInsideOptionsMenu() {
        var reported by mutableStateOf(false)
        var deleted by mutableStateOf(false)
        compose.setContent {
            AtrioTheme {
                DetailScreen(sample, "Ana", onLike = {}, onSave = {},
                    onReply = { _, done -> done(true) },
                    onReport = { reported = true },
                    onDeleteReply = { deleted = true })
            }
        }
        compose.onNodeWithTag("atrio-discussion-options").performClick()
        compose.onNodeWithText("Denunciar discussão").assertExists().performClick()
        compose.runOnIdle { assertTrue(reported) }
        compose.onNodeWithTag("atrio-detail-replies").performScrollToIndex(1)
        compose.onNodeWithTag("atrio-reply-options-reply-1").assertDoesNotExist()
        compose.runOnIdle { assertFalse(deleted) }
    }

    @Test fun sortAndInlineReactionsStayNearTheirReply() {
        var newestFirst by mutableStateOf(false)
        compose.setContent {
            AtrioTheme {
                DetailScreen(sample, "Ana", onLike = {}, onSave = {},
                    onReply = { _, done -> done(true) },
                    newestFirst = newestFirst, onReplySortChange = { newestFirst = it },
                    reactionsEnabled = true,
                    reactionContent = { _, _, _ ->
                        Text("Reagir", modifier = Modifier.testTag("qa-inline-reaction"))
                    })
            }
        }
        compose.onNodeWithTag("atrio-replies-sort").performClick()
        compose.onNodeWithText("Mais recentes primeiro").performClick()
        compose.runOnIdle { assertTrue(newestFirst) }
        compose.onNodeWithTag("atrio-detail-replies").performScrollToIndex(1)
        val message = compose.onNodeWithText("Vamos orar juntos.").getUnclippedBoundsInRoot()
        val reaction = compose.onNodeWithTag("qa-inline-reaction").getUnclippedBoundsInRoot()
        assertTrue("Reações precisam estar imediatamente abaixo da resposta",
            reaction.top.value - message.bottom.value < 60f)
    }
}
