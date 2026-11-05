package br.com.atriocatolico

import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.io.RandomAccessFile

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

    @Test fun blocksExternalRedirectForManifestBeforeOfferingDownload() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        // O servidor local anuncia o release, mas o update.json responde
        // 302 para host HTTPS externo nao confiavel. Nenhum GET externo.
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-unavailable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-available").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
    }

    @Test fun blocksExternalRedirectForApkWithoutKeepingPartialFile() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "ota")
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-download-failed").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-download").assertExists()
        assertTrue("APK pronto indevidamente apos redirect externo",
            !File(folder, "atrio-catolico-ota.apk").exists())
        assertTrue("APK parcial permaneceu apos redirect externo",
            !File(folder, "atrio-catolico-ota.part.apk").exists())
    }

    @Test fun refusesCircularRedirectForManifestWithinBoundedRequests() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        // update.json responde 302 para ele mesmo. A consulta deve falhar
        // sem ficar em loop e sem expor nenhuma oferta.
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-unavailable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-available").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-check-button").assertExists()
    }

    @Test fun refusesCircularRedirectForApkWithoutCacheOrInstallation() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "ota")
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-download-failed").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-download").assertExists()
        assertTrue("APK pronto nao pode persistir apos loop HTTP",
            !File(folder, "atrio-catolico-ota.apk").exists())
        assertTrue("APK parcial nao pode persistir apos loop HTTP",
            !File(folder, "atrio-catolico-ota.part.apk").exists())
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

    @Test fun recoversFromUnavailableServerAfterManualRefresh() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        // O servidor QA devolve HTTP 503 SOMENTE na primeira consulta.
        // Nenhum download ou instalador pode ser mostrado durante a falha.
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-unavailable").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()

        // Repetir sem fechar a Activity: a segunda consulta agora e valida.
        compose.onNodeWithTag("atrio-ota-check-button").performClick()
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-available").assertExists()
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-install").fetchSemanticsNodes().isNotEmpty()
        }
        // A disponibilidade recuperada nao pula SHA-256, assinatura e versionCode.
        compose.onNodeWithTag("atrio-ota-install").assertExists()
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val apk = File(context.cacheDir, "ota/atrio-catolico-ota.apk")
        assertTrue("APK valido nao foi salvo apos recuperacao", apk.isFile)
        assertTrue("O APK recuperado nao pode ser parcial", apk.length() > 4096L)
        // Nunca abre o instalador automaticamente no teste.
        OtaApkDelivery.discardCachedApk(context)
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

    @Test fun retriesInterruptedDownloadAndVerifiesSameOffer() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "ota")
        val apk = File(folder, "atrio-catolico-ota.apk")
        val partial = File(folder, "atrio-catolico-ota.part.apk")
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        try {
            // Primeira requisicao recebe Content-Length correto, corpo cortado.
            compose.onNodeWithTag("atrio-ota-download").performClick()
            compose.waitUntil(90_000) {
                compose.onAllNodesWithTag("atrio-ota-download-failed")
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
            assertTrue("Falha deixou APK parcial", !partial.exists())
            assertTrue("Falha deixou APK pronto", !apk.exists())

            // A mesma oferta e consultada uma unica vez: a nova tentativa
            // reutiliza-a, mas baixa e valida o arquivo inteiro de novo.
            compose.onNodeWithTag("atrio-ota-download").performClick()
            compose.waitUntil(90_000) {
                compose.onAllNodesWithTag("atrio-ota-install").fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag("atrio-ota-install").assertExists()
            assertTrue("APK da segunda tentativa nao foi salvo", apk.isFile)
            assertTrue("APK completo esperado na segunda tentativa", apk.length() > 4096L)
            assertTrue("APK parcial sobreviveu a tentativa valida", !partial.exists())
        } finally {
            // Teste nao aciona instalador; remove cache de QA antes do proximo caso.
            OtaApkDelivery.discardCachedApk(context)
        }
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

    @Test fun clearsOrphanedPartialOnAppStartWithoutDeletingInstallerApk() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val folder = File(context.cacheDir, "ota")
        val partial = File(folder, "atrio-catolico-ota.part.apk")
        val ready = File(folder, "atrio-catolico-ota.apk")
        val unrelated = File(folder, "qa-other-cache.txt")
        // O script de QA criou estes arquivos antes da Activity iniciar.
        // O controlador deve recuperar apenas o .part na consulta inicial.
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        assertTrue("Arquivo parcial nao foi descartado no primeiro refresh", !partial.exists())
        assertTrue("Arquivo pronto pode estar em uso pelo instalador", ready.isFile)
        assertTrue("Cache de outros componentes nao pode ser excluido", unrelated.isFile)
        // Um APK pronto de processo anterior nao e confiado pela nova UI.
        // O download exige nova verificacao completa, nunca instala sozinho.
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
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

    @Test fun unknownSourcesDeniedKeepsInstallerBlockedAndVersionUnchanged() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        // O runner revoga explicitamente REQUEST_INSTALL_PACKAGES somente
        // para o pacote de laboratorio. Nunca se tenta alterar o app oficial.
        assertFalse("O laboratorio deve iniciar sem autorizacao de origem",
            context.packageManager.canRequestPackageInstalls())
        val packageManager = context.packageManager
        val before = packageManager.getPackageInfo(context.packageName, 0).longVersionCode
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-install").fetchSemanticsNodes().isNotEmpty()
        }
        val apk = File(context.cacheDir, "ota/atrio-catolico-ota.apk")
        assertTrue("Somente o arquivo previamente verificado pode ser oferecido",
            apk.isFile)
        try {
            // Deve abrir apenas a pagina de autorizacao da fonte. Sem
            // permissao, o fluxo nao pode abrir o instalador do APK.
            compose.onNodeWithTag("atrio-ota-install").performClick()
            compose.waitForIdle()
            assertFalse("Nenhuma permissao pode ser concedida pelo aplicativo",
                packageManager.canRequestPackageInstalls())
            assertTrue("Sem consentimento nao deve haver atualizacao",
                packageManager.getPackageInfo(context.packageName, 0)
                    .longVersionCode == before)
            assertTrue("Voltar das configuracoes permite nova tentativa",
                apk.isFile)
        } finally {
            // Sem instalador iniciado, este cache pertence somente ao QA.
            OtaApkDelivery.discardCachedApk(context)
        }
    }

    @Test fun rejectsTamperedDownloadedApkBeforeInstall() {
        assumeTrue(BuildConfig.DEBUG && OtaQaChannel.active)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        compose.waitUntil(45_000) {
            compose.onAllNodesWithTag("atrio-ota-available").fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-download").performClick()
        compose.waitUntil(90_000) {
            compose.onAllNodesWithTag("atrio-ota-install").fetchSemanticsNodes().isNotEmpty()
        }
        val apk = File(context.cacheDir, "ota/atrio-catolico-ota.apk")
        assertTrue("APK verificado precisa existir no cache privado", apk.isFile)
        assertTrue(apk.length() > 4096L)
        val originalLength = apk.length()
        // Modifica exatamente um byte SEM alterar o tamanho. So a nova
        // verificacao SHA-256 imediatamente antes de instalar pode detectar.
        RandomAccessFile(apk, "rw").use { file ->
            val position = file.length() / 2L
            file.seek(position)
            val previous = file.readUnsignedByte()
            file.seek(position)
            file.writeByte(previous xor 1)
        }
        assertTrue(apk.length() == originalLength)
        compose.onNodeWithTag("atrio-ota-install").performClick()
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag("atrio-ota-download-failed")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-ota-install").assertDoesNotExist()
        compose.onNodeWithTag("atrio-ota-download").assertExists()
        // Uma falha de revalidacao nao pode deixar APKs consumiveis no cache.
        assertTrue(!apk.exists())
        assertTrue(!File(context.cacheDir, "ota/atrio-catolico-ota.part.apk").exists())
    }
}
