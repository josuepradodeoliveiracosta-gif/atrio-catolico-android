package br.com.atriocatolico

import android.content.Context
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onFirst
import androidx.compose.ui.test.onAllNodesWithContentDescription
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
        compose.onNodeWithText("Entrar na comunidade  →").assertIsNotEnabled()
        compose.onNodeWithText("Seu nome").performTextInput("Clara BOT DE TESTE")
        compose.onNodeWithText("Entrar na comunidade  →").assertIsEnabled().performClick()
        compose.onNodeWithText("Paz e bem, Clara!",substring=true).assertIsDisplayed()
    }

    @Test fun miguelNavegaPelasAbasEDescobreForuns() {
        prefs.edit().putString("name","Miguel BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }

        compose.onNodeWithText("Fóruns",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Fóruns da comunidade").assertIsDisplayed()

        compose.onNodeWithText("Publicar",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Nova discussão").assertIsDisplayed()
        compose.onNodeWithText("Publicar discussão").assertIsNotEnabled()

        compose.onNodeWithText("Salvos",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Publicações salvas").assertIsDisplayed()

        compose.onNodeWithText("Perfil",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Membro da comunidade Átrio").assertIsDisplayed()
    }

    @Test fun luciaPublicaESalvaDiscussaoNaDemonstracao() {
        prefs.edit().putString("name","Lúcia BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithText("Publicar",useUnmergedTree=true).performClick()

        compose.onNodeWithText("Título da publicação")
            .performTextInput("Teste Android da comunidade")
        compose.onNodeWithText("Sua reflexão ou pergunta")
            .performTextInput("Discussão fictícia criada em um emulador Android.")
        compose.onNodeWithText("Publicar discussão").assertIsEnabled().performClick()
        compose.onNodeWithText("Teste Android da comunidade").assertIsDisplayed()

        compose.onAllNodesWithContentDescription("Salvar").onFirst().performClick()
        compose.onNodeWithText("Salvos",useUnmergedTree=true).performClick()
        compose.onNodeWithText("Teste Android da comunidade").assertIsDisplayed()
    }
}
