package br.com.atriocatolico

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
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
        // Marcador gravado PELA interface: o teste posterior de atualização
        // deve comprovar que o arquivo privado persistiu após trocar o APK.
        compose.onNodeWithTag("atrio-ota-qa-save-marker").performClick()
        compose.waitForIdle()
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

    @Test fun rejectsWrongCertificateBeforeDownload() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-unavailable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-unavailable").assertExists()
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
    }

    @Test fun rejectsWrongApkChecksumAfterDownloading() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-download-failed").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
    }

    @Test fun rejectsDowngradeWithoutOfferingDownload() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-up-to-date").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
    }

    @Test fun handlesOfflineServerWithoutOfferingInstallation() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        // Servidor intencionalmente parado: nenhuma oferta nem instalador.
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-unavailable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-check-button").assertExists()
    }

    @Test fun rejectsInterruptedDownloadWithoutOfferingInstallation() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-download-failed").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        // O erro conserva a opção de tentar novamente, sem contornar a validação.
        compose.onNodeWithTag("atrio-ota-download").assertExists()
    }

    @Test fun cancelsSlowDownloadWithoutOfferingInstallation() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag("atrio-ota-cancel").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-cancel").performClick()
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag("atrio-ota-download").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        // A mesma oferta pode ser baixada novamente depois de cancelar.
        compose.onNodeWithTag("atrio-ota-download").assertExists()
    }

    @Test fun refusesDownloadWhenStorageIsInsufficient() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val prefs = context.getSharedPreferences("atrio_ota_lab_prefs", 0)
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        // Apenas o laboratório .otalab permite injetar zero bytes livres.
        // Nenhum dado ou particao de armazenamento e realmente esgotado.
        assertTrue(prefs.edit().putBoolean("qa_force_low_space", true).commit())
        try {
            compose.onNodeWithTag("atrio-ota-download").performClick()
            compose.waitUntil(30_000) {
                compose.onAllNodesWithTag("atrio-ota-download-failed")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText(
                "Espaço insuficiente para baixar a atualização. Libere espaço e tente novamente."
            ).assertExists()
            compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
            compose.onNodeWithTag("atrio-ota-download").assertExists()
        } finally {
            prefs.edit().remove("qa_force_low_space").commit()
        }
    }
}
