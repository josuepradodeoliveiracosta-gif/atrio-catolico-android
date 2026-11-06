package br.com.atriocatolico

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

/** Confere estados reais do guia v2 sem alterar o Firebase de produção. */
class DesignV2UiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun openingCategoryMaintainsOfficialName() {
        var chosen = ""
        compose.setContent {
            AtrioTheme { CommunityScreen(emptyList()) { chosen = it } }
        }
        compose.onNodeWithTag("atrio-forum-2").performClick()
        compose.runOnIdle { assertEquals("Vida espiritual", chosen) }
        compose.onNodeWithText("Vida Cristã").assertDoesNotExist()
    }

    @Test fun forumCategoryRetainsItsDiscussionCount() {
        val post = Post(
            "count-check", "Maria", "Vida espiritual", "hoje",
            "Uma pergunta sobre a oração", "Vamos conversar sobre oração."
        )
        compose.setContent {
            AtrioTheme { CommunityScreen(listOf(post)) {} }
        }
        compose.onNodeWithText("1 discussão").assertExists()
    }

    @Test fun forumGridShowsTwoColumnsOnStandard360dpScreen() {
        compose.setContent {
            AtrioTheme {
                Box(Modifier.width(360.dp).height(700.dp)) {
                    CommunityScreen(emptyList()) {}
                }
            }
        }
        val first = compose.onNodeWithTag("atrio-forum-0").fetchSemanticsNode().boundsInRoot
        val second = compose.onNodeWithTag("atrio-forum-1").fetchSemanticsNode().boundsInRoot
        assertEquals("Fóruns devem ocupar a mesma linha", first.top, second.top, 1f)
        assertTrue("Segunda coluna deve ficar à direita", second.left > first.left)
    }

    @Test fun searchingWithoutResultsShowsEmptySearchRatherThanNetworkError() {
        var search by mutableStateOf("sem-resultados")
        compose.setContent {
            AtrioTheme {
                HomeScreen(
                    name = "Clara", posts = emptyList(), filter = "Todos",
                    search = search, searchOpen = true, onSearch = { search = it },
                    onFilter = {}, onCreate = {}, onForums = {},
                    onOpen = {}, onLike = {}, onSave = {}
                )
            }
        }
        compose.onNodeWithText("Nenhum resultado encontrado").assertExists()
        compose.onNodeWithText("Limpar busca").performClick()
        compose.onNodeWithText("Nenhuma discussão").assertExists()
    }

    @Test fun failedFeedShowsRetryNotNoDiscussions() {
        var retried = 0
        compose.setContent {
            AtrioTheme {
                HomeScreen(
                    name = "Clara", posts = emptyList(), filter = "Todos",
                    search = "", searchOpen = false, onSearch = {},
                    onFilter = {}, onCreate = {}, onForums = {},
                    onOpen = {}, onLike = {}, onSave = {},
                    loadError = true, onRetry = { retried++ }
                )
            }
        }
        compose.onNodeWithText("Não foi possível carregar as discussões").assertExists()
        compose.onNodeWithText("Tentar novamente").performClick()
        compose.runOnIdle { assertEquals(1, retried) }
    }

    @Test fun savingPendingIsNotAnnouncedAsConfirmed() {
        var post by mutableStateOf(
            Post("qa-design", "Clara", "Vida espiritual", "hoje",
                "Como cultivar a oração diária?", "Quero refletir sobre a oração.",
                saved = true, savePending = true)
        )
        compose.setContent {
            AtrioTheme { DiscussionCard(post, {}, {}, {}) }
        }
        compose.onNodeWithText("Salvando…").assertExists()
        compose.onNodeWithText("Salvo").assertDoesNotExist()
        compose.runOnIdle { post = post.copy(savePending = false) }
        compose.onNodeWithText("Salvo").assertExists()
    }

    @Test fun publishingStateDisablesRepeatedSubmission() {
        compose.setContent {
            AtrioTheme { PublishScreen(publishing = true) { _, _, _ -> } }
        }
        compose.onNodeWithText("Publicando…").assertExists()
        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput("Teste de publicação enquanto aguarda rede")
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Texto suficiente para habilitar o envio normalmente.")
        compose.onNodeWithTag("atrio-publish-submit").assertIsNotEnabled()
    }
}
