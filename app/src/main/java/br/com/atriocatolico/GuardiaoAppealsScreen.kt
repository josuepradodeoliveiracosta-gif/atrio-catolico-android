package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

private data class RetainedCase(
    val id: String, val status: String, val targetType: String, val reason: String,
    val appealText: String, val reviewNote: String
)

/**
 * Recurso voluntário do autor. A lista é limitada a casos que pertencem ao
 * usuário autenticado, e as regras Firestore validam a propriedade novamente.
 */
@Composable
internal fun GuardiaoAppealsScreen(db: FirebaseFirestore, uid: String) {
    val context = LocalContext.current
    var cases by remember(uid) { mutableStateOf<List<RetainedCase>>(emptyList()) }
    var loading by remember(uid) { mutableStateOf(true) }
    var error by remember(uid) { mutableStateOf("") }
    var chosen by remember(uid) { mutableStateOf<String?>(null) }
    var busy by remember(uid) { mutableStateOf(false) }
    var result by remember(uid) { mutableStateOf("") }

    DisposableEffect(db, uid) {
        val listener = db.collection("guardiao_quarantine")
            .whereEqualTo("ownerUid", uid).limit(30)
            .addSnapshotListener { snapshot, failure ->
                loading = false
                if (failure != null) {
                    error = "Não foi possível consultar os casos. Confira a conexão e as regras."
                    cases = emptyList()
                } else {
                    error = ""
                    cases = snapshot?.documents?.map { doc ->
                        RetainedCase(
                            doc.id, doc.getString("status").orEmpty(),
                            doc.getString("targetType").orEmpty(),
                            doc.getString("reason").orEmpty(),
                            doc.getString("appealText").orEmpty(),
                            doc.getString("reviewNote").orEmpty()
                        )
                    }.orEmpty()
                }
            }
        onDispose { listener.remove() }
    }

    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Text("Minhas revisões de moderação", style = MaterialTheme.typography.titleMedium)
            Text("Se uma discussão ou resposta for retida, você poderá solicitar revisão. " +
                "Somente administradores decidem remover ou restaurar conteúdos.",
                style = MaterialTheme.typography.bodySmall)
            Text("Último diagnóstico da triagem no aparelho: " +
                InstantPushRelay.lastGuardiaoStatus(context, uid),
                style = MaterialTheme.typography.bodySmall)
        }
        item { GuardianNoticeFeed(db, uid) }
        if (loading) item { CircularProgressIndicator() }
        if (error.isNotBlank()) item { Text(error, color = MaterialTheme.colorScheme.error) }
        if (!loading && error.isBlank() && cases.isEmpty())
            item { Text("Nenhuma publicação sua foi retida pelo Guardião.") }
        items(cases, key = { it.id }) { entry ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                    Text(if (entry.targetType == "reply") "Resposta" else "Discussão",
                        style = MaterialTheme.typography.titleSmall)
                    Text(when (entry.status) {
                        "held" -> "Ocultada temporariamente, aguardando revisão."
                        "restored" -> "Restaurada ao fórum."
                        "removed" -> "Remoção confirmada por um administrador."
                        else -> "Em análise."
                    })
                    Text(entry.reason, style = MaterialTheme.typography.bodySmall)
                    if (entry.reviewNote.isNotBlank())
                        Text("Decisão: ${entry.reviewNote}")
                    if (entry.appealText.isNotBlank())
                        Text("Sua contestação: ${entry.appealText}")
                    if (entry.status == "held" && entry.appealText.isBlank())
                        OutlinedButton(onClick = { chosen = entry.id }) { Text("Solicitar revisão") }
                }
            }
        }
    }

    val target = cases.firstOrNull { it.id == chosen && it.status == "held" && it.appealText.isBlank() }
    if (target != null) {
        var note by remember(target.id) { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { if (!busy) chosen = null },
            title = { Text("Contestar retenção") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Explique o contexto da sua publicação. Seu recurso será lido pela administração.")
                    OutlinedTextField(note, { note = it.take(500) }, enabled = !busy,
                        label = { Text("Justificativa (10 a 500 caracteres)") }, minLines = 3)
                }
            },
            confirmButton = {
                TextButton(enabled = !busy && note.trim().length in 10..500, onClick = {
                    busy = true
                    db.collection("guardiao_quarantine").document(target.id).update(
                        mapOf("appealText" to note.trim(),
                            "appealedAt" to FieldValue.serverTimestamp())
                    ).addOnCompleteListener { task ->
                        busy = false
                        if (task.isSuccessful) {
                            chosen = null
                            result = "Contestação registrada para análise humana."
                        } else result = "Não foi possível registrar. Verifique a conexão e tente novamente."
                    }
                }) { Text(if (busy) "Enviando..." else "Enviar contestação") }
            },
            dismissButton = { TextButton(enabled = !busy, onClick = { chosen = null }) { Text("Cancelar") } }
        )
    }
    if (result.isNotBlank()) AlertDialog(
        onDismissRequest = { result = "" }, title = { Text("Átrio Guardião") },
        text = { Text(result) }, confirmButton = { TextButton(onClick = { result = "" }) { Text("Entendi") } }
    )
}
