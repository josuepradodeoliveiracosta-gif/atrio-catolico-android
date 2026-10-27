package br.com.atriocatolico

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onAllNodesWithContentDescription
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextInput
import androidx.test.core.app.ApplicationProvider
import org.junit.Before
import org.junit.Rule
import org.junit.Test

/**
 * Clara / Miguel / Lúcia testam a interface DEMONSTRAÇÃO local de forma
 * isolada. Não abre Firebase de produção, não usa credenciais e não faz Push.
 *
 * Estes testes realmente interagem com o Compose no emulador Android;
 * testes autenticados da comunidade oficial têm escopo separado.
 */
class ThreeBotsAndroidUiTest {
    @get:Rule val compose = createComposeRule()
    private lateinit var prefs: android.content.SharedPreferences

    @Before fun reset() {
        val ctx = ApplicationProvider.getApplicationContext<Context>()
        prefs = ctx.getSharedPreferences("atrio-ui-bot-emulator",Context.MODE_PRIVATE)
        prefs.edit().clear().commit()
    }

    @Test fun claraPodeEntrarNaDemonstracao() {
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithText("Vamos começar?").assertIsDisplayed()
        compose.onNodeWithTag("atrio-welcome-enter").assertIsNotEnabled()
        compose.onNodeWithTag("atrio-welcome-name").performTextInput("Clara BOT DE TESTE")
        compose.onNodeWithTag("atrio-welcome-enter").assertIsEnabled().performClick()
        compose.onNodeWithText("Paz e bem, Clara!",substring=true).assertIsDisplayed()
    }

    @Test fun miguelNavegaPelasAbasEDescobreForuns() {
        prefs.edit().putString("name","Miguel BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }

        compose.onNodeWithTag("atrio-tab-communities").performClick()
        compose.onNodeWithText("Fóruns da comunidade").assertIsDisplayed()

        compose.onNodeWithTag("atrio-tab-publish").performClick()
        compose.onNodeWithText("Nova discussão").assertIsDisplayed()
        compose.onNodeWithTag("atrio-publish-submit").assertIsNotEnabled()

        compose.onNodeWithTag("atrio-tab-saved").performClick()
        compose.onNodeWithText("Publicações salvas").assertIsDisplayed()

        compose.onNodeWithTag("atrio-tab-profile").performClick()
        compose.onNodeWithText("Membro da comunidade Átrio").assertIsDisplayed()
    }

    @Test fun luciaPublicaESalvaDiscussaoNaDemonstracao() {
        prefs.edit().putString("name","Lúcia BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-tab-publish").performClick()

        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput("Teste Android da comunidade")
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Discussão fictícia criada em um emulador Android.")
        compose.onNodeWithTag("atrio-publish-submit").assertIsEnabled().performClick()
        compose.waitForIdle()
        // Confirme primeiro a gravação da publicação, sem depender da posição
        // inicial do feed ou de qualquer animação de navegação.
        org.junit.Assert.assertTrue(
            "Discussão não foi persistida na demonstração",
            prefs.getString("posts", "").orEmpty().contains("Teste Android da comunidade")
        )
        // Uma navegação real por toque valida a leitura da publicação.
        compose.onNodeWithTag("atrio-tab-home").performClick()
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasText("Teste Android da comunidade"))
        compose.onNodeWithText("Teste Android da comunidade").assertIsDisplayed()

        compose.onAllNodesWithContentDescription("Salvar").onFirst().performClick()
        compose.onNodeWithTag("atrio-tab-saved").performClick()
        compose.onNodeWithText("Teste Android da comunidade").assertIsDisplayed()
    }
}
