package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source

internal const val ACCOUNT_DELETION_SUPPORT_EMAIL = "atriocatolico.privacidade@gmail.com"

/**
 * Representa somente evidência do pedido, NÃO do processamento ou exclusão.
 * Esta tela não remove Firebase Auth, Firestore, mídias ou notificações.
 */
internal enum class DeletionRequestState {
    CHECKING, NOT_REQUESTED, REQUESTED, PROCESSING, COMPLETION_REPORTED,
    REVIEW_REQUIRED, INDETERMINATE, ERROR
}

/** Um documento existente e malformado nunca habilita criar outro pedido. */
internal fun verifiedDeletionRequestState(
    exists: Boolean,
    status: String?,
    source: String?,
    hasRequestedAt: Boolean
): DeletionRequestState = when {
    !exists -> DeletionRequestState.NOT_REQUESTED
    source !in setOf("android", "web") || !hasRequestedAt ->
        DeletionRequestState.INDETERMINATE
    status == "requested" -> DeletionRequestState.REQUESTED
    status == "processing" -> DeletionRequestState.PROCESSING
    status == "completed" -> DeletionRequestState.COMPLETION_REPORTED
    status == "rejected" -> DeletionRequestState.REVIEW_REQUIRED
    else -> DeletionRequestState.INDETERMINATE
}

/** Pedido autenticado, com confirmação exclusiva no Firestore remoto. */
@Composable
internal fun AccountDeletionRequestSection(db: FirebaseFirestore, uid: String) {
    var state by remember(db, uid) { mutableStateOf(DeletionRequestState.CHECKING) }
    var confirmation by remember(db, uid) { mutableStateOf(false) }
    var serial by remember(db, uid) { mutableIntStateOf(0) }
    var mailAppUnavailable by remember(db, uid) { mutableStateOf(false) }
    var webAppUnavailable by remember(db, uid) { mutableStateOf(false) }
    val uriHandler = LocalUriHandler.current
    val lifetime = remember(db, uid) { AccountRequestLifetime() }
    DisposableEffect(lifetime) { onDispose { lifetime.active = false } }
    val request = remember(db, uid) {
        db.collection("account_deletion_requests").document(uid)
    }

    fun currentSession() = lifetime.active && FirebaseAuth.getInstance().currentUser?.uid == uid

    fun checkExisting() {
        serial++
        val expectedSerial = serial
        state = DeletionRequestState.CHECKING
        if (!currentSession()) {
            state = DeletionRequestState.ERROR
            return
        }
        request.get(Source.SERVER).addOnCompleteListener { result ->
            if (!currentSession() || serial != expectedSerial) return@addOnCompleteListener
            if (!result.isSuccessful || result.result == null) {
                state = DeletionRequestState.ERROR
            } else {
                val snapshot = result.result!!
                // Em Source.SERVER ainda é possível receber uma escrita local
                // pendente fundida ao snapshot. Não confirmar sem ACK remoto.
                state = if (snapshot.metadata.isFromCache ||
                    snapshot.metadata.hasPendingWrites()) {
                    DeletionRequestState.INDETERMINATE
                } else {
                    // Campos com tipo inesperado não podem derrubar a UI.
                    // Deixe o backend corrigir o registro, sem sobreescrevê-lo.
                    verifiedDeletionRequestState(
                        snapshot.exists(),
                        snapshot.get("status") as? String,
                        snapshot.get("source") as? String,
                        snapshot.get("requestedAt") is com.google.firebase.Timestamp
                    )
                }
            }
        }
    }

    LaunchedEffect(db, uid) { checkExisting() }
    Card(modifier = Modifier.fillMaxWidth().testTag("atrio-account-deletion-request")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Exclusão de conta e dados", style = MaterialTheme.typography.titleMedium)
            Text(
                "Você pode solicitar a exclusão da sua conta e dos dados associados. " +
                    "A solicitação não apaga a conta imediatamente; os dados serão " +
                    "tratados por um processo administrativo próprio.",
                style = MaterialTheme.typography.bodyMedium
            )
            when (state) {
                DeletionRequestState.REQUESTED -> Text(
                    "Solicitação confirmada no servidor. A conta ainda não foi excluída.",
                    modifier = Modifier.testTag("atrio-deletion-request-saved"),
                    color = MaterialTheme.colorScheme.primary
                )
                DeletionRequestState.PROCESSING -> Text(
                    "O atendimento informou que a solicitação está em processamento. " +
                        "O aplicativo não comprova que os dados já foram excluídos.",
                    modifier = Modifier.testTag("atrio-deletion-request-processing")
                )
                DeletionRequestState.COMPLETION_REPORTED -> Text(
                    "O atendimento registrou a conclusão do pedido. O aplicativo " +
                        "não verifica se todos os dados foram eliminados; confirme " +
                        "o resultado pelo canal oficial de privacidade.",
                    modifier = Modifier.testTag("atrio-deletion-request-completed-unverified")
                )
                DeletionRequestState.REVIEW_REQUIRED -> Text(
                    "O atendimento informou uma pendência no pedido. Entre em contato " +
                        "pelo canal oficial. Nenhuma exclusão foi comprovada.",
                    modifier = Modifier.testTag("atrio-deletion-request-needs-support")
                )
                DeletionRequestState.CHECKING -> Text("Verificando solicitação no servidor...")
                DeletionRequestState.INDETERMINATE -> Text(
                    "Existe um registro de solicitação, mas seu estado não foi confirmado. " +
                        "Nenhuma exclusão foi comprovada; não envie outro pedido.",
                    modifier = Modifier.testTag("atrio-deletion-request-unknown"),
                    color = MaterialTheme.colorScheme.error
                )
                DeletionRequestState.ERROR -> Text(
                    "Não foi possível confirmar a solicitação no servidor. " +
                        "Verifique sua conexão e tente novamente.",
                    modifier = Modifier.testTag("atrio-deletion-request-error"),
                    color = MaterialTheme.colorScheme.error
                )
                DeletionRequestState.NOT_REQUESTED -> OutlinedButton(
                    onClick = { confirmation = true },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-deletion-request-open")
                ) { Text("Solicitar exclusão de conta") }
            }
            Text(
                "Para acompanhar seu pedido ou esclarecer dúvidas sobre privacidade, " +
                    "contate o atendimento oficial. Não envie senhas, códigos ou " +
                    "documentos de identidade por e-mail.",
                style = MaterialTheme.typography.bodySmall
            )
            SelectionContainer {
                Text(
                    ACCOUNT_DELETION_SUPPORT_EMAIL,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("atrio-deletion-support-address")
                )
            }
            // O link público da Google Play é independente do pedido
            // autenticado. Sem URL auditada, a variante Play mostra que
            // este recurso ainda não está pronto para distribuição.
            if (BuildConfig.DELETION_WEB_URL.isNotBlank()) {
                OutlinedButton(
                    onClick = {
                        webAppUnavailable = false
                        runCatching { uriHandler.openUri(BuildConfig.DELETION_WEB_URL) }
                            .onFailure { webAppUnavailable = true }
                    },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-deletion-web-open")
                ) { Text("Solicitar exclusão pelo site") }
                if (webAppUnavailable) Text(
                    "Não foi possível abrir a página; use o atendimento por e-mail.",
                    modifier = Modifier.testTag("atrio-deletion-web-fallback"),
                    style = MaterialTheme.typography.bodySmall
                )
            } else if (BuildConfig.PLAY_STORE_BUILD) {
                Text(
                    "Página pública de exclusão ainda pendente de homologação. " +
                        "Esta compilação Play não deve ser distribuída.",
                    modifier = Modifier.testTag("atrio-deletion-web-pending"),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }
            OutlinedButton(
                onClick = {
                    mailAppUnavailable = false
                    // Assunto fixo: nenhum UID, e-mail privado ou token no URI.
                    val address = "mailto:" + ACCOUNT_DELETION_SUPPORT_EMAIL +
                        "?subject=Atrio%20Catolico%20-%20Atendimento%20privacidade"
                    runCatching { uriHandler.openUri(address) }
                        .onFailure { mailAppUnavailable = true }
                },
                modifier = Modifier.fillMaxWidth().testTag("atrio-deletion-support-open")
            ) { Text("Contatar atendimento por e-mail") }
            if (mailAppUnavailable) {
                Text(
                    "Não foi possível abrir o aplicativo de e-mail. " +
                        "Copie o endereço exibido acima e envie sua mensagem manualmente.",
                    modifier = Modifier.testTag("atrio-deletion-support-fallback"),
                    style = MaterialTheme.typography.bodySmall
                )
            }
            if (state == DeletionRequestState.ERROR ||
                state == DeletionRequestState.INDETERMINATE) {
                TextButton(
                    onClick = { checkExisting() },
                    modifier = Modifier.testTag("atrio-deletion-request-retry")
                ) { Text("Tentar novamente") }
            }
        }
    }

    if (confirmation) AlertDialog(
        onDismissRequest = { if (state != DeletionRequestState.CHECKING) confirmation = false },
        title = { Text("Confirmar solicitação?") },
        text = {
            Text("Este pedido exige atendimento administrativo. Sua conta continuará " +
                "ativa enquanto a solicitação é analisada; não será excluída agora.")
        },
        confirmButton = {
            Button(
                enabled = state == DeletionRequestState.NOT_REQUESTED && currentSession(),
                modifier = Modifier.testTag("atrio-deletion-request-confirm"),
                onClick = {
                    if (state != DeletionRequestState.NOT_REQUESTED || !currentSession())
                        return@Button
                    confirmation = false
                    serial++
                    val expectedSerial = serial
                    state = DeletionRequestState.CHECKING
                    request.set(mapOf(
                        "status" to "requested",
                        "source" to "android",
                        "requestedAt" to FieldValue.serverTimestamp()
                    )).addOnCompleteListener {
                        if (!currentSession() || serial != expectedSerial)
                            return@addOnCompleteListener
                        // Mesmo após sucesso, só declarar recebido com
                        // leitura remota. Falha ambígua também é reconciliada.
                        checkExisting()
                    }
                }
            ) { Text("Registrar solicitação") }
        },
        dismissButton = {
            TextButton(onClick = { confirmation = false }) { Text("Cancelar") }
        }
    )
}

private class AccountRequestLifetime(var active: Boolean = true)
