package br.com.atriocatolico

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.withContext
import java.io.File

internal sealed class OtaDownloadState {
    data object Idle : OtaDownloadState()
    data class Downloading(val received: Long, val total: Long) : OtaDownloadState()
    data object Verifying : OtaDownloadState()
    data class Ready(val offer: OtaApkOffer, val apk: File) : OtaDownloadState()
    data class Failed(val message: String) : OtaDownloadState()
}

/**
 * O usuário escolhe baixar e instalar. Cada etapa é isolada da conta Firebase.
 * Nunca instalar em builds debug nem realizar ação silenciosa.
 */
internal class OtaUpdateController(private val appContext: Context) {
    var status by mutableStateOf<OtaCheckStatus>(OtaCheckStatus.Idle)
        private set
    var downloadState by mutableStateOf<OtaDownloadState>(OtaDownloadState.Idle)
        private set
    var installMessage by mutableStateOf("")
        private set
    private var downloadJob: Job? = null

    suspend fun refresh() {
        if (BuildConfig.PLAY_STORE_BUILD) {
            status = OtaCheckStatus.PlayStore
            return
        }
        if (status == OtaCheckStatus.Checking ||
            downloadState is OtaDownloadState.Downloading ||
            downloadState == OtaDownloadState.Verifying) return
        status = OtaCheckStatus.Checking
        status = withContext(Dispatchers.IO) { OtaReleaseClient.check(appContext) }
        if (downloadState is OtaDownloadState.Ready &&
            (status !is OtaCheckStatus.Available ||
                (status as OtaCheckStatus.Available).apk !=
                    (downloadState as OtaDownloadState.Ready).offer)) {
            downloadState = OtaDownloadState.Idle
        }
    }

    suspend fun download(offer: OtaApkOffer) {
        if (BuildConfig.PLAY_STORE_BUILD || BuildConfig.DEBUG ||
            (status as? OtaCheckStatus.Available)?.apk != offer ||
            downloadJob != null || downloadState == OtaDownloadState.Verifying) return
        downloadJob = currentCoroutineContext()[Job]
        installMessage = ""
        downloadState = OtaDownloadState.Downloading(0, offer.sizeBytes)
        try {
            val apk = OtaApkDelivery.download(appContext, offer) { progress ->
                withContext(Dispatchers.Main) {
                    downloadState = OtaDownloadState.Downloading(progress, offer.sizeBytes)
                }
            }
            // Outro release pode ter sido publicado durante o download.
            if ((status as? OtaCheckStatus.Available)?.apk != offer) {
                apk.delete()
                downloadState = OtaDownloadState.Idle
            } else {
                downloadState = OtaDownloadState.Ready(offer, apk)
            }
        } catch (cancelled: CancellationException) {
            downloadState = OtaDownloadState.Idle
        } catch (_: Exception) {
            downloadState = OtaDownloadState.Failed(
                "Não foi possível baixar ou validar o APK. Confira a conexão e tente novamente."
            )
        } finally {
            downloadJob = null
        }
    }

    fun cancelDownload() {
        downloadJob?.cancel()
    }

    suspend fun install() {
        val ready = downloadState as? OtaDownloadState.Ready ?: return
        if (BuildConfig.PLAY_STORE_BUILD || BuildConfig.DEBUG ||
            (status as? OtaCheckStatus.Available)?.apk != ready.offer) return
        installMessage = ""
        downloadState = OtaDownloadState.Verifying
        try {
            withContext(Dispatchers.IO) { OtaApkDelivery.validate(appContext, ready.offer, ready.apk) }
            downloadState = OtaDownloadState.Ready(ready.offer, ready.apk)
            val started = OtaApkDelivery.requestInstall(appContext, ready.apk)
            installMessage = if (started)
                "Confirme a atualização na tela do Android."
            else "Autorize instalações pelo Átrio nas configurações do Android, volte ao app e toque em Instalar."
        } catch (_: Exception) {
            downloadState = OtaDownloadState.Failed(
                "O Android não conseguiu abrir a instalação, ou a verificação falhou. Baixe novamente."
            )
        }
    }
}

@Composable
internal fun rememberOtaUpdateController(): OtaUpdateController {
    val context = LocalContext.current.applicationContext
    val controller = remember(context) { OtaUpdateController(context) }
    // Consulta uma vez na abertura da comunidade; não é um serviço em background.
    LaunchedEffect(controller) { controller.refresh() }
    return controller
}

@Composable
internal fun OtaUpdatesSection(
    status: OtaCheckStatus,
    onRefresh: () -> Unit,
    download: OtaDownloadState = OtaDownloadState.Idle,
    installMessage: String = "",
    onDownload: (OtaApkOffer) -> Unit = {},
    onCancel: () -> Unit = {},
    onInstall: () -> Unit = {}
) {
    val appContext = LocalContext.current
    Column(
        modifier = Modifier.fillMaxWidth().testTag("atrio-ota-section"),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        Text("Atualizações do Átrio", style = MaterialTheme.typography.titleMedium,
            color = MaterialTheme.colorScheme.primary)
        when (status) {
            OtaCheckStatus.Idle -> Text("Aguardando a primeira verificação.")
            OtaCheckStatus.Checking -> {
                CircularProgressIndicator(modifier = Modifier.testTag("atrio-ota-checking"))
                Text("Verificando atualizações oficiais...")
            }
            OtaCheckStatus.NoRelease ->
                Text("Ainda não há atualizações publicadas no canal oficial.")
            OtaCheckStatus.UpToDate ->
                Text("O aplicativo está atualizado conforme o canal oficial.")
            OtaCheckStatus.TestBuild ->
                Text("Versão de testes. Atualizações oficiais exigem um APK release assinado.")
            OtaCheckStatus.PlayStore -> {
                Text("Esta instalação é atualizada pela Google Play. " +
                    "Nenhum APK externo será baixado.")
                OutlinedButton(
                    onClick = {
                        val packageId = OtaUpdatePolicy.PACKAGE
                        val marketIntent = Intent(
                            Intent.ACTION_VIEW, Uri.parse("market://details?id=" + packageId)
                        ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                        try {
                            appContext.startActivity(marketIntent)
                        } catch (_: ActivityNotFoundException) {
                            val webIntent = Intent(
                                Intent.ACTION_VIEW,
                                Uri.parse("https://play.google.com/store/apps/details?id=" + packageId)
                            ).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                            try {
                                appContext.startActivity(webIntent)
                            } catch (_: Exception) {
                                // Play indisponível: não oferecer sideload como alternativa.
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-play-store-open")
                ) {
                    Text("Abrir Google Play")
                }
                Text("Em testes fechados, é necessário ter aceitado o convite de participação.",
                    style = MaterialTheme.typography.bodySmall)
            }
            OtaCheckStatus.Incompatible ->
                Text("Há uma versão oficial que exige um Android mais recente.")
            OtaCheckStatus.Unavailable ->
                Text("Não foi possível confirmar as atualizações. Confira a internet e tente novamente.")
            is OtaCheckStatus.Available -> {
                Text("Nova versão oficial detectada: ${status.version}",
                    style = MaterialTheme.typography.titleSmall,
                    modifier = Modifier.testTag("atrio-ota-available"))
                Text(status.notes, style = MaterialTheme.typography.bodyMedium,
                    maxLines = 5, overflow = TextOverflow.Ellipsis)
                when (download) {
                    is OtaDownloadState.Downloading -> {
                        val progress = (download.received.toFloat() / download.total)
                            .coerceIn(0f, 1f)
                        LinearProgressIndicator(progress = { progress },
                            modifier = Modifier.fillMaxWidth().testTag("atrio-ota-progress"))
                        Text("Baixando: ${(progress * 100).toInt()}%")
                        OutlinedButton(onClick = onCancel, modifier = Modifier.fillMaxWidth()) {
                            Text("Cancelar download")
                        }
                    }
                    OtaDownloadState.Verifying -> {
                        CircularProgressIndicator()
                        Text("Conferindo integridade, versão e assinatura...")
                    }
                    is OtaDownloadState.Ready -> {
                        if (download.offer == status.apk) {
                            Text("APK verificado. O Android solicitará sua confirmação para instalar.")
                            Button(onClick = onInstall,
                                modifier = Modifier.fillMaxWidth().testTag("atrio-ota-install")) {
                                Text("Instalar atualização")
                            }
                        }
                    }
                    else -> {
                        if (download is OtaDownloadState.Failed) {
                            Text(download.message, color = MaterialTheme.colorScheme.error)
                        }
                        Button(onClick = { onDownload(status.apk) },
                            modifier = Modifier.fillMaxWidth().testTag("atrio-ota-download")) {
                            Text("Baixar atualização")
                        }
                    }
                }
                if (installMessage.isNotBlank()) {
                    Text(installMessage, style = MaterialTheme.typography.bodySmall)
                }
                Text("A atualização é opcional e depende da confirmação do Android.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        if (status != OtaCheckStatus.PlayStore) OutlinedButton(onClick = onRefresh,
            enabled = status != OtaCheckStatus.Checking &&
                status != OtaCheckStatus.TestBuild &&
                download !is OtaDownloadState.Downloading &&
                download != OtaDownloadState.Verifying,
            modifier = Modifier.fillMaxWidth().testTag("atrio-ota-check-button")) {
            Text("Verificar atualizações")
        }
    }
}
