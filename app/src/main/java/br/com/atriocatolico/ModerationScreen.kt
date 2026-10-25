package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

private data class ModerationReport(
    val id: String, val postId: String, val reason: String,
    val status: String, val reviewNote: String, val reviewedBy: String
)

private data class ModerationPost(val title: String, val body: String, val author: String, val uid: String)

private fun DocumentSnapshot.moderationPost(): ModerationPost? {
    if (!exists()) return null
    return ModerationPost(getString("title").orEmpty(), getString("body").orEmpty(),
        getString("authorName").orEmpty(), getString("uid").orEmpty())
}

@Composable
internal fun ModerationScreen(db: FirebaseFirestore, uid: String, onBack: () -> Unit) {
    var reports by remember(uid) { mutableStateOf<List<ModerationReport>>(emptyList()) }
    var limit by remember(uid) { mutableStateOf(30) }
    var loading by remember(uid) { mutableStateOf(true) }
    var hasMore by remember(uid) { mutableStateOf(false) }
    var loadError by remember(uid) { mutableStateOf(false) }
    var retry by remember(uid) { mutableStateOf(0) }
    var showReviewed by remember(uid) { mutableStateOf(false) }
    var selectedId by remember(uid) { mutableStateOf<String?>(null) }
    var message by remember(uid) { mutableStateOf("") }

    BackHandler { if (selectedId != null) selectedId = null else onBack() }
    DisposableEffect(db, uid, limit, retry) {
        var active = true
        loading = true
        loadError = false
        val registration = db.collection("reports").orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit.toLong() + 1).addSnapshotListener { snapshot, failure ->
                if (active) {
                    loading = false
                    loadError = failure != null
                    if (failure != null) {
                        reports = emptyList()
                        message = "Não foi possível consultar denúncias. Confira a conexão, as regras e sua permissão."
                    } else {
                        hasMore = (snapshot?.size() ?: 0) > limit
                        reports = snapshot?.documents?.take(limit)?.map {
                            ModerationReport(it.id, it.getString("postId").orEmpty(),
                                it.getString("reason").orEmpty(), it.getString("status") ?: "pending",
                                it.getString("reviewNote").orEmpty(), it.getString("reviewedBy").orEmpty())
                        } ?: emptyList()
                    }
                }
            }
        onDispose { active = false; registration.remove() }
    }

    Scaffold(containerColor = Paper, topBar = {
        Surface(color = Paper, modifier = Modifier.statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(12.dp)) {
                TextButton(onClick = onBack) { Text("Voltar") }
                SectionTitle("Moderação", Modifier.padding(top = 8.dp))
            }
        }
    }) { insets ->
        val shown = reports.filter { (it.status != "pending") == showReviewed }
        LazyColumn(Modifier.fillMaxSize().padding(insets), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Analise o conteúdo antes de decidir. Uma denúncia não remove a publicação automaticamente.", color = Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(!showReviewed, { showReviewed = false }, label = { Text("Pendentes") })
                    FilterChip(showReviewed, { showReviewed = true }, label = { Text("Analisadas") })
                }
            }
            if (!loading && !loadError && shown.isEmpty()) item {
                Text(if (hasMore) "Nenhuma nesta parte da lista. Carregue mais para consultar as anteriores."
                    else "Nenhuma denúncia nesta categoria.", color = Muted)
            }
            items(shown, key = { it.id }) { report ->
                Card(onClick = { selectedId = report.id }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(report.reason)
                        Text(when (report.status) {
                            "removed" -> "Analisada — publicação removida"
                            "dismissed" -> "Analisada — encerrada sem remoção"
                            else -> "Pendente de análise"
                        }, color = Wine, fontSize = 12.sp)
                        Text("Toque para analisar", fontSize = 12.sp)
                    }
                }
            }
            if (loading || hasMore || loadError) item {
                OutlinedButton(enabled = !loading, onClick = {
                    if (loadError) retry++ else limit += 30
                }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (loading) "Carregando..." else if (loadError) "Tentar novamente" else "Carregar mais denúncias")
                }
            }
        }
    }
    val selected = reports.firstOrNull { it.id == selectedId }
    if (selected != null) key(selected.id) {
        ReportReviewDialog(db, uid, selected, onClose = { selectedId = null }, onMessage = { message = it })
    }
    if (message.isNotBlank()) AlertDialog(onDismissRequest = { message = "" },
        title = { Text("Moderação") }, text = { Text(message) },
        confirmButton = { TextButton(onClick = { message = "" }) { Text("Entendi") } })
}

@Composable
private fun ReportReviewDialog(
    db: FirebaseFirestore, uid: String, report: ModerationReport,
    onClose: () -> Unit, onMessage: (String) -> Unit
) {
    var post by remember(report.id) { mutableStateOf<ModerationPost?>(null) }
    var loading by remember(report.id) { mutableStateOf(true) }
    var loadFailed by remember(report.id) { mutableStateOf(false) }
    var note by remember(report.id) { mutableStateOf("") }
    var busy by remember(report.id) { mutableStateOf(false) }
    var confirmRemove by remember(report.id) { mutableStateOf(false) }
    var retry by remember(report.id) { mutableStateOf(0) }
    DisposableEffect(db, report.postId, retry) {
        var active = true
        loading = true
        loadFailed = false
        val registration = if (report.postId.isBlank() || report.postId.contains('/')) {
            loading = false
            loadFailed = true
            null
        } else db.collection("posts").document(report.postId).addSnapshotListener { snapshot, failure ->
            if (active) {
                loading = false
                loadFailed = failure != null
                post = if (failure == null) snapshot?.moderationPost() else null
            }
        }
        onDispose { active = false; registration?.remove() }
    }
    fun review(remove: Boolean, expected: ModerationPost?) {
        if (busy || note.trim().length !in 5..300) return
        busy = true
        val noteToSave = note.trim()
        val reportRef = db.collection("reports").document(report.id)
        db.runTransaction { tx ->
            val currentReport = tx.get(reportRef)
            check(currentReport.exists() && (currentReport.getString("status") ?: "pending") == "pending") {
                "Esta denúncia já foi analisada."
            }
            check(currentReport.getString("postId") == report.postId) { "A denúncia foi alterada. Reabra a análise." }
            if (remove) {
                val postRef = db.collection("posts").document(report.postId)
                val current = tx.get(postRef).moderationPost()
                check(current != null && current == expected) {
                    "A publicação foi alterada ou removida. Reabra a análise antes de decidir."
                }
                tx.delete(postRef)
            }
            tx.update(reportRef, mapOf(
                "status" to if (remove) "removed" else "dismissed",
                "reviewedBy" to uid, "reviewedAt" to FieldValue.serverTimestamp(), "reviewNote" to noteToSave
            ))
            true
        }.addOnCompleteListener { result ->
            busy = false
            confirmRemove = false
            if (result.isSuccessful) {
                onClose()
                onMessage(if (remove) "Publicação removida e análise registrada." else "Denúncia encerrada sem remover a publicação.")
            } else onMessage("Não foi possível concluir: ${result.exception?.localizedMessage ?: "confira sua conexão e permissão"}")
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Analisar denúncia") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Motivo: ${report.reason}")
                when {
                    loading -> Text("Carregando publicação...")
                    loadFailed -> {
                        Text("Não foi possível ler a publicação.")
                        TextButton(onClick = { retry++ }) { Text("Tentar novamente") }
                    }
                    post == null -> Text("A publicação já não está disponível.")
                    else -> {
                        Text(post!!.author, color = Wine)
                        Text(post!!.title, style = MaterialTheme.typography.titleMedium)
                        Text(post!!.body)
                    }
                }
                if (report.status == "pending") {
                    OutlinedTextField(note, { note = it.take(300) }, enabled = !busy,
                        label = { Text("Justificativa da decisão") }, minLines = 2,
                        supportingText = { Text("De 5 a 300 caracteres; registro restrito à moderação.") })
                    Text("Remover retira a publicação do fórum. Respostas e referências podem permanecer armazenadas até uma limpeza administrativa.", fontSize = 12.sp, color = Muted)
                    OutlinedButton(onClick = { confirmRemove = true },
                        enabled = !busy && !loading && !loadFailed && post != null && note.trim().length >= 5) {
                        Text("Remover publicação", color = MaterialTheme.colorScheme.error)
                    }
                } else {
                    Text("Decisão: ${if (report.status == "removed") "Removida" else "Encerrada sem remoção"}")
                    Text("Justificativa: ${report.reviewNote}")
                    Text("Administrador: ${report.reviewedBy}", fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            if (report.status == "pending") TextButton(
                enabled = !busy && !loading && !loadFailed && note.trim().length >= 5,
                onClick = { review(false, null) }) { Text(if (busy) "Salvando..." else "Encerrar sem remover") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Fechar") } }
    )
    if (confirmRemove) {
        // Captura o conteúdo mostrado ao abrir a confirmação. A transação recusa alterações posteriores.
        val expected = remember { post }
        AlertDialog(onDismissRequest = { if (!busy) confirmRemove = false },
            title = { Text("Remover esta publicação?") },
            text = { Text("A remoção de “${expected?.title.orEmpty()}” não poderá ser desfeita pelo aplicativo. A decisão ficará registrada na denúncia.") },
            confirmButton = { TextButton(enabled = !busy, onClick = { review(true, expected) }) {
                Text(if (busy) "Removendo..." else "Confirmar remoção", color = MaterialTheme.colorScheme.error)
            } },
            dismissButton = { TextButton(enabled = !busy, onClick = { confirmRemove = false }) { Text("Cancelar") } })
    }
}
