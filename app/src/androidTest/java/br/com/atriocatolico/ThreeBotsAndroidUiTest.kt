package br.com.atriocatolico

import android.content.Context
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.unit.Density
import androidx.compose.ui.platform.UriHandler
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
import kotlinx.coroutines.CompletableDeferred
import java.io.IOException
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
        org.junit.Assert.assertEquals("Bots somente no APK QA Geral",
            "br.com.atriocatolico.qageral", BuildConfig.APPLICATION_ID)
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
        compose.onNodeWithText(", Clara!",substring=true).assertIsDisplayed()
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

    @Test fun miguelAbreLojaFiltraCategoriaEVoltaAoInicioComFonteAmpliada() {
        prefs.edit().putString("name", "Miguel BOT DE TESTE").commit()
        compose.setContent {
            CompositionLocalProvider(LocalDensity provides Density(LocalDensity.current.density, 1.5f)) {
                AtrioDemoApp(prefs)
            }
        }

        val home = compose.onNodeWithTag("atrio-home-feed")
        val shopEntry = "atrio-qa-shop-open"
        home.performScrollToNode(hasTestTag(shopEntry))
        compose.onNodeWithTag(shopEntry).performClick()

        val catalog = compose.onNodeWithTag("atrio-qa-shop-catalog")
        catalog.assertIsDisplayed()
        catalog.performScrollToNode(hasText("Medalhas"))
        compose.onNodeWithText("Medalhas").performClick()

        val medal = "atrio-qa-shop-product-medalha"
        catalog.performScrollToNode(hasTestTag(medal))
        compose.onNodeWithTag(medal).performClick()
        compose.onNodeWithTag("atrio-qa-shop-product").assertIsDisplayed()
        compose.onNodeWithText("Medalha de São Bento").assertIsDisplayed()
        compose.onNodeWithText("Voltar ao catálogo").performClick()

        catalog.performScrollToNode(hasTestTag(medal))
        compose.onNodeWithTag(medal).assertIsDisplayed()
        compose.onNodeWithTag("atrio-qa-shop-product-terco").assertDoesNotExist()
        catalog.performScrollToNode(hasText("Voltar ao Início"))
        compose.onNodeWithText("Voltar ao Início").performClick()
        home.assertIsDisplayed()
    }

    @Test fun lojaAbreSomenteDestinoHttpsDeTesteEPreservaProduto() {
        val opened = mutableListOf<String>()
        val browser = object : UriHandler {
            override fun openUri(uri: String) { opened.add(uri) }
        }
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalUriHandler provides browser) {
                    QaShopScreen(onClose = {})
                }
            }
        }

        val catalog = compose.onNodeWithTag("atrio-qa-shop-catalog")
        val medal = "atrio-qa-shop-product-medalha"
        catalog.performScrollToNode(hasTestTag(medal))
        compose.onNodeWithTag(medal).performClick()
        val details = compose.onNodeWithTag("atrio-qa-shop-product")
        details.performScrollToNode(hasText("Abrir página de teste"))
        compose.onNodeWithText("Abrir página de teste").performClick()
        compose.runOnIdle {
            org.junit.Assert.assertEquals(listOf("https://example.com/"), opened)
        }
        compose.onNodeWithText("Medalha de São Bento").assertIsDisplayed()
        compose.onNodeWithText("Voltar ao catálogo").performClick()
        catalog.assertIsDisplayed()
    }

    @Test fun lojaRetornaAoMesmoProdutoDoNavegadorAndroid() {
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        fun shell(command: String): String =
            ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand(command))
                .bufferedReader().use { it.readText().trim() }

        fun isForeground(packageName: String): Boolean =
            shell("dumpsys activity activities").lineSequence().any { line ->
                "topResumedActivity" in line && " $packageName/" in line
            }

        val browser = shell(
            "cmd package resolve-activity --brief -a android.intent.action.VIEW " +
                "-c android.intent.category.BROWSABLE -d https://example.com/"
        ).lineSequence().last().substringBefore('/')
        check(browser.isNotBlank() && browser != "android" &&
            browser != BuildConfig.APPLICATION_ID && browser.none(Char::isWhitespace)) {
            "O emulador precisa de um navegador padrão para abrir a página de QA."
        }

        compose.setContent { AtrioTheme { QaShopScreen(onClose = {}) } }
        val medal = "atrio-qa-shop-product-medalha"
        compose.onNodeWithTag("atrio-qa-shop-catalog").performScrollToNode(hasTestTag(medal))
        compose.onNodeWithTag(medal).performClick()
        compose.onNodeWithTag("atrio-qa-shop-product").performScrollToNode(hasText("Abrir página de teste"))
        compose.onNodeWithText("Abrir página de teste").performClick()
        try {
            compose.waitUntil(15_000) {
                isForeground(browser)
            }
        } finally {
            shell("input keyevent KEYCODE_BACK")
        }
        compose.waitUntil(15_000) {
            isForeground(BuildConfig.APPLICATION_ID)
        }
        compose.onNodeWithText("Medalha de São Bento").assertIsDisplayed()
    }

    @Test fun lojaAtualizaPrecoEBloqueiaEstoqueIndisponivel() {
        compose.setContent { AtrioTheme { QaShopScreen(onClose = {}) } }

        val catalog = compose.onNodeWithTag("atrio-qa-shop-catalog")
        val details = compose.onNodeWithTag("atrio-qa-shop-product")
        fun openProduct(id: String) {
            val tag = "atrio-qa-shop-product-$id"
            catalog.performScrollToNode(hasTestTag(tag))
            compose.onNodeWithTag(tag).performClick()
        }
        fun showText(label: String) {
            details.performScrollToNode(hasText(label, substring = true))
            compose.onNodeWithText(label, substring = true).assertIsDisplayed()
        }
        fun checkout() = compose.onNodeWithText("Abrir página de teste").also {
            details.performScrollToNode(hasText("Abrir página de teste"))
        }
        fun backToCatalog() {
            details.performScrollToNode(hasText("Voltar ao catálogo"))
            compose.onNodeWithText("Voltar ao catálogo").performClick()
        }

        openProduct("medalha")
        showText("19,90")
        checkout().assertIsEnabled()
        backToCatalog()
        catalog.performScrollToNode(hasText("Atualizar catálogo"))
        compose.onNodeWithText("Atualizar catálogo").performClick()
        openProduct("medalha")
        showText("24,90")
        details.performScrollToNode(hasText("Dourada"))
        compose.onNodeWithText("Dourada").performClick()
        showText("Esgotado")
        checkout().assertIsNotEnabled()
        backToCatalog()

        openProduct("oratorio")
        showText("Estoque não confirmado")
        checkout().assertIsNotEnabled()
    }

    @Test fun lojaExigeNovaConfirmacaoERecusaEstoquePerdidoNoCheckout() {
        val opened = mutableListOf<String>()
        var reads = 0
        val browser = object : UriHandler {
            override fun openUri(uri: String) { opened.add(uri) }
        }
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalUriHandler provides browser) {
                    QaShopScreen(
                        loadCatalog = {
                            reads++
                            val variant = QaShopVariant(
                                id = "medalha-prateada",
                                sku = "MED-PRA",
                                label = "Prateada",
                                unitPriceMinor = if (reads == 1) 1990 else 2490,
                                availability = if (reads < 3) QaShopAvailability.IN_STOCK
                                    else QaShopAvailability.OUT_OF_STOCK
                            )
                            listOf(QaShopProduct(
                                "medalha", "medalhas", "Medalhas", "Medalha de teste",
                                "Oferta do fornecedor simulado", listOf(variant)
                            ))
                        },
                        onClose = {}
                    )
                }
            }
        }
        val entry = "atrio-qa-shop-product-medalha"
        compose.onNodeWithTag("atrio-qa-shop-catalog").performScrollToNode(hasTestTag(entry))
        compose.onNodeWithTag(entry).performClick()

        val details = compose.onNodeWithTag("atrio-qa-shop-product")
        val buttonLabel = "Abrir página de teste"
        val button = compose.onNodeWithText(buttonLabel)
        fun showText(text: String) {
            details.performScrollToNode(hasText(text, substring = true))
            compose.onNodeWithText(text, substring = true).assertIsDisplayed()
        }

        showText("28,80")
        details.performScrollToNode(hasText(buttonLabel))
        button.performClick()
        showText("A cotação mudou.")
        showText("33,80")
        compose.runOnIdle { org.junit.Assert.assertTrue(opened.isEmpty()) }

        details.performScrollToNode(hasText(buttonLabel))
        button.performClick()
        showText("A variante selecionada ficou indisponível.")
        details.performScrollToNode(hasText(buttonLabel))
        button.assertIsNotEnabled()
        compose.runOnIdle { org.junit.Assert.assertTrue(opened.isEmpty()) }
    }

    @Test fun lojaSimulaPagamentoRastreioCancelamentoEDevolucao() {
        val browser = object : UriHandler {
            override fun openUri(uri: String) = Unit
        }
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalUriHandler provides browser) {
                    QaShopScreen(onClose = {})
                }
            }
        }
        val medal = "atrio-qa-shop-product-medalha"
        compose.onNodeWithTag("atrio-qa-shop-catalog").performScrollToNode(hasTestTag(medal))
        compose.onNodeWithTag(medal).performClick()
        val details = compose.onNodeWithTag("atrio-qa-shop-product")
        val order = compose.onNodeWithTag("atrio-qa-shop-order")
        fun clickIn(list: androidx.compose.ui.test.SemanticsNodeInteraction, label: String) {
            list.performScrollToNode(hasText(label))
            compose.onNodeWithText(label).performClick()
        }
        fun openOrder() {
            clickIn(details, "Abrir página de teste")
            clickIn(details, "Ver pedido simulado")
        }

        openOrder()
        clickIn(order, "Simular pagamento recusado")
        compose.onNodeWithText("Pagamento recusado").assertIsDisplayed()
        compose.onNodeWithText("Simular despacho").assertDoesNotExist()
        clickIn(order, "Voltar à Loja")

        openOrder()
        clickIn(order, "Simular pagamento aprovado")
        clickIn(order, "Simular cancelamento com estorno")
        compose.onNodeWithText("Cancelado · pagamento estornado").assertIsDisplayed()
        clickIn(order, "Voltar à Loja")

        openOrder()
        clickIn(order, "Simular pagamento aprovado")
        clickIn(order, "Simular despacho")
        compose.onNodeWithText("Rastreio fictício:", substring = true).assertIsDisplayed()
        clickIn(order, "Simular entrega")
        clickIn(order, "Solicitar devolução de teste")
        clickIn(order, "Concluir devolução com estorno")
        compose.onNodeWithText("Devolução concluída · pagamento estornado").assertIsDisplayed()
    }

    @Test fun lojaMostraCarregamentoErroETentaNovamente() {
        val firstRequest = CompletableDeferred<Unit>()
        var requests = 0
        compose.setContent {
            AtrioTheme {
                QaShopScreen(
                    loadCatalog = {
                        if (++requests == 1) {
                            firstRequest.await()
                            throw IOException("Falha fictícia")
                        }
                        emptyList()
                    },
                    onClose = {}
                )
            }
        }

        compose.onNodeWithTag("atrio-qa-shop-loading").assertIsDisplayed()
        firstRequest.complete(Unit)
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasText("Não foi possível carregar o catálogo."))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Tentar novamente").performClick()
        compose.waitUntil(5_000) {
            compose.onAllNodes(hasText("Nenhum produto disponível."))
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Nenhum produto disponível.").assertIsDisplayed()
        compose.onNodeWithTag("atrio-qa-shop-loading").assertDoesNotExist()
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
        // A entrada de resposta V2 está ancorada fora da lista de rolagem.
        compose.onNodeWithTag("atrio-open-reply-composer").assertIsDisplayed().performClick()
        compose.onNodeWithTag("atrio-reply-submit").assertIsNotEnabled()
        compose.onNodeWithTag("atrio-reply-input")
            .performTextInput("Resposta de teste enviada pelo toque no Android.")
        compose.onNodeWithTag("atrio-reply-submit").assertIsEnabled().performClick()
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
        compose.onNodeWithText("Suas discussões salvas aparecerão aqui").assertIsDisplayed()
    }
}
