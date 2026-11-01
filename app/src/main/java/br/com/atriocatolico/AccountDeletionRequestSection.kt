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
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source

/**
 * Só registra intenção autenticada. NÃO remove conta, publicações, Firebase Auth
 * ou mídia de usuários. A exclusão requer backend administrativo revisado.
 */
@Composable
internal fun AccountDeletionRequestSection(db: FirebaseFirestore, uid: String) {
    var loading by remember(uid) { mutableStateOf(true) }
    var saved by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf(false) }
    var confirmation by remember(uid) { mutableStateOf(false) }
    // Evita atualizar esta UI depois da troca de perfil ou saída da tela.
    val lifetime = remember(uid) { AccountRequestLifetime() }
    DisposableEffect(lifetime) { onDispose { lifetime.active = false } }
    val request = remember(db, uid) {
        db.collection("account_deletion_requests").document(uid)
    }
    fun checkExisting() {
        loading = true
        error = false
        request.get(Source.SERVER).addOnCompleteListener { result ->
            if (!lifetime.active) return@addOnCompleteListener
            loading = false
            if (result.isSuccessful) {
                saved = result.result?.exists() == true
            } else {
                error = true
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
            when {
                saved -> Text("Sua solicitação já foi registrada. A conta ainda não foi excluída.",
                    modifier = Modifier.testTag("atrio-deletion-request-saved"),
                    color = MaterialTheme.colorScheme.primary)
                loading -> Text("Consultando o registro de solicitação...")
                error -> Text(
                    "Não foi possível consultar ou registrar a solicitação. Verifique a conexão.",
                    color = MaterialTheme.colorScheme.error
                )
                else -> {
                    OutlinedButton(
                        onClick = { confirmation = true },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-deletion-request-open")
                    ) { Text("Solicitar exclusão de conta") }
                }
            }
            if (error && !loading) {
                TextButton(onClick = { checkExisting() }) { Text("Tentar novamente") }
            }
        }
    }
    if (confirmation) AlertDialog(
        onDismissRequest = { if (!loading) confirmation = false },
        title = { Text("Confirmar solicitação?") },
        text = {
            Text("Este pedido exige atendimento administrativo. Sua conta continuará " +
                "ativa enquanto a solicitação é analisada; não será excluída agora.")
        },
        confirmButton = {
            Button(
                enabled = !loading,
                modifier = Modifier.testTag("atrio-deletion-request-confirm"),
                onClick = {
                    confirmation = false
                    loading = true
                    error = false
                    request.set(mapOf(
                        "status" to "requested",
                        "source" to "android",
                        "requestedAt" to FieldValue.serverTimestamp()
                    )).addOnCompleteListener { result ->
                        if (!lifetime.active) return@addOnCompleteListener
                        loading = false
                        if (result.isSuccessful) saved = true
                        else checkExisting() // Pedido pré-existente não pode ser sobrescrito.
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
