package br.com.atriocatolico

import android.content.Context
import androidx.compose.ui.test.assertDoesNotExist
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTextClearance
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

    @Test fun luciaConfirmaToqueNoBotaoPublicar() {
        var sent: Triple<String, String, String>? = null
        compose.setContent {
            AtrioTheme {
                PublishScreen { title, body, category ->
                    sent = Triple(title, body, category)
                }
            }
        }
        compose.onNodeWithTag("atrio-publish-submit").assertIsNotEnabled()
        compose.onNodeWithTag("atrio-publish-title")
            .performTextInput("Teste Android da comunidade")
        compose.onNodeWithTag("atrio-publish-body")
            .performTextInput("Discussão fictícia para validar o botão de publicação.")
        compose.onNodeWithTag("atrio-publish-submit").assertIsEnabled().performClick()
        compose.waitForIdle()
        org.junit.Assert.assertEquals(
            "Teste Android da comunidade",
            sent?.first
        )
        org.junit.Assert.assertEquals(
            "Discussão fictícia para validar o botão de publicação.",
            sent?.second
        )
    }

    @Test fun luciaConfirmaToqueEmSalvarEAbaSalvos() {
        prefs.edit().putString("name","Lúcia BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }

        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-1"))
        // Alvo estável por ID do post: nunca tocar no primeiro ícone genérico
        // que a LazyColumn tenha carregado durante uma rolagem.
        compose.onNodeWithTag("atrio-save-1",useUnmergedTree = true).performClick()
        compose.waitForIdle()
        // Diferencia uma falha real do toque de uma falha na renderização
        // de item preguiçoso (LazyColumn).
        compose.runOnIdle {
            val contents = prefs.getString("posts", "[]").orEmpty()
            val posts = org.json.JSONArray(contents)
            val found = (0 until posts.length()).any { index ->
                val post = posts.getJSONObject(index)
                post.optString("id") == "1" && post.optBoolean("saved", false)
            }
            org.junit.Assert.assertTrue(
                "O toque no botão atrio-save-1 não persistiu saved=true. " +
                    "Investigar callback no cartão da discussão.", found
            )
        }
        compose.onNodeWithTag("atrio-tab-saved").performClick()
        compose.onNodeWithText("Publicações salvas").assertIsDisplayed()
        // A LazyColumn pode compor o item sem ele estar na área visível;
        // exigir visibilidade somente depois de rolar até o item correto.
        compose.onNodeWithTag("atrio-saved-list",useUnmergedTree = true)
            .performScrollToNode(hasText("Qual é a diferença entre veneração e adoração?"))
        compose.onNodeWithText("Qual é a diferença entre veneração e adoração?")
            .assertIsDisplayed()
    }

    @Test fun miguelCurteEDescurteDiscussaoTocandoNoIcone() {
        prefs.edit().putString("name", "Miguel BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-1"))

        compose.onNodeWithTag("atrio-like-1", useUnmergedTree = true).performClick()
        compose.runOnIdle {
            val all = org.json.JSONArray(prefs.getString("posts", "[]").orEmpty())
            val post = (0 until all.length()).map { all.getJSONObject(it) }
                .first { it.optString("id") == "1" }
            org.junit.Assert.assertTrue("O botão curtir não alterou o estado", post.optBoolean("liked"))
            org.junit.Assert.assertEquals(87, post.optInt("likes"))
        }

        compose.onNodeWithTag("atrio-like-1", useUnmergedTree = true).performClick()
        compose.runOnIdle {
            val all = org.json.JSONArray(prefs.getString("posts", "[]").orEmpty())
            val post = (0 until all.length()).map { all.getJSONObject(it) }
                .first { it.optString("id") == "1" }
            org.junit.Assert.assertFalse("O botão descurtir não respondeu", post.optBoolean("liked"))
            org.junit.Assert.assertEquals(86, post.optInt("likes"))
        }
    }

    @Test fun claraPesquisaPorTituloUsandoBotaoDeBusca() {
        prefs.edit().putString("name", "Clara BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-top-search").performClick()
        compose.onNodeWithTag("atrio-search-field").performTextInput("Lectio Divina")
        compose.onNodeWithText("Como começar a praticar a Lectio Divina?").assertIsDisplayed()
        compose.onNodeWithTag("atrio-post-1", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun luciaAbreDiscussaoEEnviaRespostaComToques() {
        prefs.edit().putString("name", "Lúcia BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-1"))
        compose.onNodeWithTag("atrio-post-1", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("atrio-reply-submit").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("atrio-reply-input").performScrollTo()
            .performTextInput("Resposta de teste enviada pelo toque no Android.")
        compose.onNodeWithTag("atrio-reply-submit").performScrollTo().assertIsEnabled()
            .performClick()
        compose.runOnIdle {
            val all = org.json.JSONArray(prefs.getString("posts", "[]").orEmpty())
            val post = (0 until all.length()).map { all.getJSONObject(it) }
                .first { it.optString("id") == "1" }
            val replies = post.getJSONArray("replies")
            val found = (0 until replies.length()).any {
                replies.getJSONObject(it).optString("message") ==
                    "Resposta de teste enviada pelo toque no Android."
            }
            org.junit.Assert.assertTrue("O toque não persistiu a resposta no fórum local", found)
        }
    }

    @Test fun miguelEditaNomeNoPerfilPelosBotoes() {
        prefs.edit().putString("name", "Miguel BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-tab-profile").performClick()
        compose.onNodeWithTag("atrio-profile-rename").performClick()
        compose.onNodeWithTag("atrio-profile-name-input").performTextClearance()
        compose.onNodeWithTag("atrio-profile-name-input").performTextInput("Miguel Renovado")
        compose.onNodeWithText("Salvar").assertIsEnabled().performClick()
        compose.onNodeWithText("Miguel Renovado").assertIsDisplayed()
        compose.runOnIdle {
            org.junit.Assert.assertEquals("Miguel Renovado", prefs.getString("name", null))
        }
    }

    @Test fun claraRemoveUmaPublicacaoDosSalvosComToque() {
        prefs.edit().putString("name", "Clara BOT DE TESTE").commit()
        compose.setContent { AtrioDemoApp(prefs) }
        compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-1"))
        compose.onNodeWithTag("atrio-save-1", useUnmergedTree = true).performClick()
        compose.onNodeWithTag("atrio-tab-saved").performClick()
        compose.onNodeWithTag("atrio-saved-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-post-1"))
        compose.onNodeWithTag("atrio-save-1", useUnmergedTree = true).performClick()
        compose.waitForIdle()
        compose.onNodeWithText("Nada salvo ainda").assertIsDisplayed()
    }
}
