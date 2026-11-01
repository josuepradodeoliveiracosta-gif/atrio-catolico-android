package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source

/**
 * Representa somente evidência do pedido, NÃO do processamento ou exclusão.
 * Esta tela não remove Firebase Auth, Firestore, mídias ou notificações.
 */
internal enum class DeletionRequestState {
    CHECKING, NOT_REQUESTED, REQUESTED, INDETERMINATE, ERROR
}

/** Um documento existente e malformado nunca habilita criar outro pedido. */
internal fun verifiedDeletionRequestState(
    exists: Boolean,
    status: String?,
    source: String?,
    hasRequestedAt: Boolean
): DeletionRequestState = when {
    !exists -> DeletionRequestState.NOT_REQUESTED
    status == "requested" && source in setOf("android", "web") && hasRequestedAt ->
        DeletionRequestState.REQUESTED
    else -> DeletionRequestState.INDETERMINATE
}

/** Pedido autenticado, com confirmação exclusiva no Firestore remoto. */
@Composable
internal fun AccountDeletionRequestSection(db: FirebaseFirestore, uid: String) {
    var state by remember(db, uid) { mutableStateOf(DeletionRequestState.CHECKING) }
    var confirmation by remember(db, uid) { mutableStateOf(false) }
    var serial by remember(db, uid) { mutableIntStateOf(0) }
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
                state = verifiedDeletionRequestState(
                    snapshot.exists(),
                    snapshot.getString("status"),
                    snapshot.getString("source"),
                    snapshot.getTimestamp("requestedAt") != null
                )
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
