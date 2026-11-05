package br.com.atriocatolico

import androidx.compose.ui.test.assertExists
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Testa consulta e download autentico dentro da UI com o mesmo controlador
 * de producao e APK assinado no fixture local de QA.
 *
 * Nao autoriza publicacao, nao usa Firebase real e NAO afirma que a
 * instalacao Android ja foi concluida pelo usuario.
 */
@RunWith(AndroidJUnit4::class)
class OtaQaLoopbackUiTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun discoversAndVerifiesDownloadInApp() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.onNodeWithTag("atrio-ota-qa-loopback").assertExists()
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-available").assertExists()
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-install").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertExists()
        // Botao so surge depois de OtaApkDelivery validar pacote, SHA-256,
        // versao, versionCode e fingerprint do certificado instalado.
        assertTrue(OtaQaChannel.active)
    }
}
