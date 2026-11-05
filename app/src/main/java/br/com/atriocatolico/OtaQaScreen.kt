package br.com.atriocatolico

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/**
 * Mesmo controlador, detector, downloader, verificacao e instalador do app.
 * A tela de QA nao pede login nem toca Firebase de producao.
 * So e alcancavel se BuildConfig.DEBUG && OTA_QA_LOOPBACK.
 */
@Composable
internal fun OtaQaScreen() {
    if (!OtaQaChannel.active) return
    val ota = rememberOtaUpdateController()
    val scope = rememberCoroutineScope()

    AtrioTheme {
        Column(
            Modifier.fillMaxSize().background(Paper)
                .verticalScroll(rememberScrollState())
                .padding(24.dp)
                .testTag("atrio-ota-qa-loopback"),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("Átrio Católico — Laboratório OTA")
            Text("Teste isolado: o servidor de atualização deve funcionar somente neste aparelho (127.0.0.1:8765).")
            Text("Este APK Debug não é uma versão oficial. Nenhum Release será publicado durante o teste.")
            OtaUpdatesSection(
                status = ota.status,
                onRefresh = { scope.launch { ota.refresh() } },
                download = ota.downloadState,
                installMessage = ota.installMessage,
                onDownload = { offer -> scope.launch { ota.download(offer) } },
                onCancel = { ota.cancelDownload() },
                onInstall = { scope.launch { ota.install() } }
            )
        }
    }
}
