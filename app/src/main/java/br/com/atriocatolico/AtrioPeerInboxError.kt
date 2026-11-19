package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.heightIn
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/** Confirmação da primeira mensagem: a transação não substitui o GET seguro. */
@Composable
internal fun AtrioFirstContactStatus(modifier: Modifier = Modifier) {
    Text(
        "Solicitação enviada. Verificando a conversa no servidor.",
        modifier = modifier.testTag("atrio-first-contact-verifying")
            .semantics { liveRegion = LiveRegionMode.Polite },
        style = MaterialTheme.typography.bodyMedium,
        color = MaterialTheme.colorScheme.onSurface
    )
}

/** Erro de servidor não é estado vazio nem autorização para usar cache. */
@Composable
internal fun AtrioPeerInboxError(
    message: String, modifier: Modifier = Modifier, onRetry: () -> Unit
) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(message, color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.testTag("atrio-peer-inbox-error")
                .semantics { liveRegion = LiveRegionMode.Polite })
        OutlinedButton(onClick = onRetry,
            modifier = Modifier.heightIn(min = 48.dp)
                .testTag("atrio-peer-inbox-retry")) {
            Text("Tentar novamente")
        }
    }
}
