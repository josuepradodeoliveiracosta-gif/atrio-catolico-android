package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/**
 * Etapa 3: detecção somente. Não baixa APK, não abre instalador e não altera contas.
 */
internal class OtaUpdateController(private val appContext: Context) {
    var status by mutableStateOf<OtaCheckStatus>(OtaCheckStatus.Idle)
        private set

    suspend fun refresh() {
        if (status == OtaCheckStatus.Checking) return
        status = OtaCheckStatus.Checking
        status = withContext(Dispatchers.IO) { OtaReleaseClient.check(appContext) }
    }
}

@Composable
internal fun rememberOtaUpdateController(): OtaUpdateController {
    val context = LocalContext.current.applicationContext
    val controller = remember(context) { OtaUpdateController(context) }
    // Uma verificação por abertura da comunidade; sem polling, push ou execução em segundo plano.
    LaunchedEffect(controller) { controller.refresh() }
    return controller
}

@Composable
internal fun OtaUpdatesSection(status: OtaCheckStatus, onRefresh: () -> Unit) {
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
                Text("Esta é uma versão de testes. Atualizações oficiais exigem um APK release assinado.")
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
                Text("A instalação pelo aplicativo será habilitada em uma próxima etapa.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
            }
        }
        OutlinedButton(onClick = onRefresh,
            enabled = status != OtaCheckStatus.Checking && status != OtaCheckStatus.TestBuild,
            modifier = Modifier.fillMaxWidth().testTag("atrio-ota-check-button")) {
            Text("Verificar atualizações")
        }
    }
}
