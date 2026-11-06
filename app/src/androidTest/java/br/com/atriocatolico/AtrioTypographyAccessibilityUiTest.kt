package br.com.atriocatolico

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/**
 * Testes isolados e determinísticos: nenhum Firebase nem dados reais.
 * A inspeção visual com fontes grandes permanece obrigatória após o build.
 */
class AtrioTypographyAccessibilityUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun campoDeRespostaContinuaAcessivelComFonteDuzentosPorCento() {
        val post = Post(
            id = "qa-tipografia-detalhe", author = "Participante de teste",
            category = "Vida espiritual", age = "hoje",
            title = "Diálogo na comunidade",
            body = "Uma reflexão sobre a fé para ler com conforto.",
            replies = listOf(Reply("Outra participante",
                "Esta resposta deve ficar legível sem perder as ações.", id = "qa-tipografia-reply"))
        )
        var sent = ""
        compose.setContent {
            val systemDensity = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(systemDensity.density, 2.0f)) {
                AtrioTheme {
                    DetailScreen(
                        post = post, name = "Participante de teste",
                        onLike = {}, onSave = {},
                        onReply = { body, complete -> sent = body; complete(true) }
                    )
                }
            }
        }
        compose.onNodeWithTag("atrio-open-reply-composer").assertIsDisplayed().performClick()
        compose.onNodeWithTag("atrio-reply-input").assertIsDisplayed()
            .performTextInput("Resposta com letras ampliadas")
        compose.onNodeWithTag("atrio-reply-submit").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("Resposta com letras ampliadas", sent) }
    }

    @Test fun navegacaoMantemTodosOsDestinosComFonteCentoESessentaPorCento() {
        compose.setContent {
            val systemDensity = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(systemDensity.density, 1.6f)) {
                AtrioTheme {
                    AtrioBottomBar(selected = Tab.HOME, onSelect = {})
                }
            }
        }
        listOf("home", "communities", "publish", "saved", "profile").forEach { destination ->
            compose.onNodeWithTag("atrio-tab-${destination}").assertExists()
        }
    }
}
