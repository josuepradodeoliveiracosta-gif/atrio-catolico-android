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
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.launch

private data class ModerationReport(
    val id: String, val postId: String, val reason: String,
    val status: String, val reviewNote: String, val reviewedBy: String,
    val replyId: String?, val source: String = "", val aiAssessment: String = ""
) {
    val fromGuardiao: Boolean get() = source == "guardiao"
    val isReply: Boolean get() = replyId != null
    val kind: String get() = if (isReply) "Resposta" else "Publicação"
}

private data class ModerationContent(
    val title: String, val body: String, val author: String, val uid: String, val createdAt: Timestamp?
)

private fun validModerationId(id: String): Boolean = id.length in 1..128 && !id.contains('/')

private fun ModerationReport.targetReference(db: FirebaseFirestore): DocumentReference? {
    if (!validModerationId(postId)) return null
    val parent = db.collection("posts").document(postId)
    return if (replyId == null) parent else if (validModerationId(replyId))
        parent.collection("replies").document(replyId) else null
}

private fun DocumentSnapshot.moderationContent(): ModerationContent? {
    if (!exists()) return null
    return ModerationContent(getString("title").orEmpty(), getString("body").orEmpty(),
        getString("authorName").orEmpty(), getString("uid").orEmpty(), getTimestamp("createdAt"))
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
    var photoTarget by remember(uid) { mutableStateOf("") }
    var photoReason by remember(uid) { mutableStateOf("") }
    var photoConfirm by remember(uid) { mutableStateOf(false) }
    var photoBusy by remember(uid) { mutableStateOf(false) }
    val photoScope = rememberCoroutineScope()

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
                                it.getString("reviewNote").orEmpty(), it.getString("reviewedBy").orEmpty(),
                                it.getString("replyId"), it.getString("source").orEmpty(),
                                it.getString("aiAssessment").orEmpty())
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
                Text("Analise o conteúdo antes de decidir. O Átrio Guardião apenas sinaliza possíveis violações; não exclui conteúdos automaticamente.", color = Muted)
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    FilterChip(!showReviewed, { showReviewed = false }, label = { Text("Pendentes") })
                    FilterChip(showReviewed, { showReviewed = true }, label = { Text("Analisadas") })
                }
            }
            if (CloudinaryAvatarClient.enabled) item {
                AvatarModerationPanel(uid)
            }
            if (CloudinaryAvatarClient.enabled) item {
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Moderação de fotos de perfil",
                            style = MaterialTheme.typography.titleMedium)
                        Text("Apenas administradores autorizados podem remover fotos públicas. A ação será auditada.",
                            style = MaterialTheme.typography.bodySmall)
                        OutlinedTextField(value = photoTarget,
                            onValueChange = { if (it.length <= 128) photoTarget = it.trim() },
                            label = { Text("UID do usuário") }, singleLine = true,
                            modifier = Modifier.fillMaxWidth())
                        OutlinedTextField(value = photoReason,
                            onValueChange = { if (it.length <= 100) photoReason = it },
                            label = { Text("Motivo da remoção") },
                            modifier = Modifier.fillMaxWidth())
                        Button(
                            onClick = { photoConfirm = true },
                            enabled = !photoBusy &&
                                Regex("^[A-Za-z0-9_-]{1,128}$").matches(photoTarget) &&
                                photoReason.trim().length >= 5
                        ) { Text("Remover foto inadequada") }
                    }
                }
            }
            if (!loading && !loadError && shown.isEmpty()) item {
                Text(if (hasMore) "Nenhuma nesta parte da lista. Carregue mais para consultar as anteriores."
                    else "Nenhuma denúncia nesta categoria.", color = Muted)
            }
            items(shown, key = { it.id }) { report ->
                Card(onClick = { selectedId = report.id }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(if (report.fromGuardiao) "🛡 Átrio Guardião · ${report.kind}"
                            else "Denúncia de ${report.kind.lowercase()}", color = Wine)
                        Text(report.reason)
                        if (report.fromGuardiao) Text("Sinalização automática — análise humana obrigatória.",
                            fontSize = 12.sp, color = Muted)
                        Text(when (report.status) {
                            "removed" -> "Analisada — ${report.kind.lowercase()} removida"
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
    if (photoConfirm) AlertDialog(
        onDismissRequest = { if (!photoBusy) photoConfirm = false },
        title = { Text("Confirmar remoção da foto?") },
        text = { Text("A foto pública do usuário " + photoTarget +
            " será retirada da comunidade. Essa ação será registrada.") },
        confirmButton = {
            TextButton(enabled = !photoBusy, onClick = {
                photoBusy = true
                photoScope.launch {
                    val result = runCatching {
                        CloudinaryAvatarClient.moderateRemove(uid, photoTarget, photoReason)
                    }
                    photoBusy = false
                    photoConfirm = false
                    result.onSuccess {
                        photoTarget = ""; photoReason = ""
                        message = "Foto removida pela moderação."
                    }.onFailure {
                        message = it.message ?: "Não foi possível remover a foto."
                    }
                }
            }) { Text("Confirmar remoção") }
        },
        dismissButton = {
            TextButton(enabled = !photoBusy, onClick = { photoConfirm = false }) {
                Text("Cancelar")
            }
        }
    )
    if (message.isNotBlank()) AlertDialog(onDismissRequest = { message = "" },
        title = { Text("Moderação") }, text = { Text(message) },
        confirmButton = { TextButton(onClick = { message = "" }) { Text("Entendi") } })
}

@Composable
private fun ReportReviewDialog(
    db: FirebaseFirestore, uid: String, report: ModerationReport,
    onClose: () -> Unit, onMessage: (String) -> Unit
) {
    var content by remember(report.id) { mutableStateOf<ModerationContent?>(null) }
    var loading by remember(report.id) { mutableStateOf(true) }
    var loadFailed by remember(report.id) { mutableStateOf(false) }
    var note by remember(report.id) { mutableStateOf("") }
    var busy by remember(report.id) { mutableStateOf(false) }
    var confirmRemove by remember(report.id) { mutableStateOf(false) }
    var retry by remember(report.id) { mutableStateOf(0) }
    var parentContext by remember(report.id) { mutableStateOf("Carregando discussão...") }
    var heldStatus by remember(report.id) { mutableStateOf("") }
    var archivedContent by remember(report.id) { mutableStateOf<ModerationContent?>(null) }
    var appealText by remember(report.id) { mutableStateOf("") }
    val held = report.fromGuardiao && heldStatus == "held"
    val targetRef = remember(db, report.postId, report.replyId) { report.targetReference(db) }
    DisposableEffect(db, report.postId, report.replyId, retry) {
        var active = true
        loading = true
        loadFailed = false
        val registration = if (targetRef == null) {
            loading = false
            loadFailed = true
            null
        } else targetRef.addSnapshotListener { snapshot, failure ->
            if (active) {
                loading = false
                loadFailed = failure != null
                content = if (failure == null) snapshot?.moderationContent() else null
            }
        }
        val parentRegistration = if (report.isReply && validModerationId(report.postId)) {
            db.collection("posts").document(report.postId).addSnapshotListener { snapshot, failure ->
                if (active) parentContext = when {
                    failure != null -> "Não foi possível carregar o título da discussão."
                    snapshot == null || !snapshot.exists() -> "Discussão principal removida."
                    else -> "Discussão: ${snapshot.getString("title").orEmpty()}"
                }
            }
        } else null
        onDispose { active = false; registration?.remove(); parentRegistration?.remove() }
    }
    DisposableEffect(db, report.id, report.fromGuardiao) {
        if (!report.fromGuardiao) {
            onDispose { }
        } else {
            val subscription = db.collection("guardiao_quarantine").document(report.id)
                .addSnapshotListener { snapshot, failure ->
                    if (failure == null) {
                        heldStatus = snapshot?.getString("status").orEmpty()
                        appealText = snapshot?.getString("appealText").orEmpty()
                        val original = snapshot?.get("originalFields") as? Map<*, *>
                        archivedContent = if (original == null) null else ModerationContent(
                            original["title"] as? String ?: "",
                            original["body"] as? String ?: "",
                            original["authorName"] as? String ?: "",
                            original["uid"] as? String ?: "",
                            original["createdAt"] as? Timestamp
                        )
                    }
                }
            onDispose { subscription.remove() }
        }
    }
    fun decideHeld(restore: Boolean) {
        if (busy || !held || note.trim().length !in 5..300) return
        busy = true
        GuardiaoReviewClient.decide(report.id, restore, note.trim()) { ok, info ->
            busy = false
            if (ok) onClose()
            onMessage(info)
        }
    }
    fun review(remove: Boolean, expected: ModerationContent?) {
        if (busy || note.trim().length !in 5..300) return
        busy = true
        val noteToSave = note.trim()
        val reportRef = db.collection("reports").document(report.id)
        db.runTransaction { tx ->
            val currentReport = tx.get(reportRef)
            check(currentReport.exists() && (currentReport.getString("status") ?: "pending") == "pending") {
                "Esta denúncia já foi analisada."
            }
            check(currentReport.getString("postId") == report.postId &&
                currentReport.getString("replyId") == report.replyId) {
                "O alvo da denúncia foi alterado. Reabra a análise."
            }
            if (remove) {
                val removalRef = checkNotNull(targetRef) { "Conteúdo inválido para remoção." }
                val current = tx.get(removalRef).moderationContent()
                check(current != null && current == expected) {
                    "O conteúdo foi alterado ou removido. Reabra a análise antes de decidir."
                }
                tx.delete(removalRef)
            }
            tx.update(reportRef, mapOf(
                "status" to if (remove) "removed" else "dismissed",
                "reviewedBy" to uid, "reviewedAt" to FieldValue.serverTimestamp(), "reviewNote" to noteToSave,
                "reviewTarget" to if (report.isReply) "reply" else "post"
            ))
            true
        }.addOnCompleteListener { result ->
            busy = false
            confirmRemove = false
            if (result.isSuccessful) {
                onClose()
                onMessage(if (remove) "${report.kind} removida e análise registrada." else "Denúncia encerrada sem remover o conteúdo.")
            } else onMessage("Não foi possível concluir: ${result.exception?.localizedMessage ?: "confira sua conexão e permissão"}")
        }
    }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Analisar ${report.kind.lowercase()}") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (report.fromGuardiao) Text("Átrio Guardião: alerta automático sujeito a enganos. Confira o contexto antes de decidir.",
                    color = Wine, fontSize = 12.sp)
                if (report.fromGuardiao && report.aiAssessment.isNotBlank()) Text(
                    when (report.aiAssessment) {
                        "concern" -> "IA: possível risco no contexto. Avaliação humana necessária."
                        "contextual" -> "IA: pode ser citação, relato ou prevenção. Confira o contexto; o alerta continua pendente."
                        "uncertain" -> "IA: contexto insuficiente para avaliar."
                        else -> "Análise contextual indisponível. Alerta baseado nas regras iniciais."
                    }, fontSize = 12.sp, color = Muted)
                Text("Motivo: ${report.reason}")
                if (held) Text("Conteúdo retido em quarentena privada. Pode ser restaurado.",
                    color = Wine, fontSize = 12.sp)
                if (held && appealText.isNotBlank()) Text("Contestação do autor: $appealText",
                    color = Wine, fontSize = 12.sp)
                if (report.isReply) Text(parentContext, fontSize = 12.sp, color = Muted)
                when {
                    loading -> Text("Carregando ${report.kind.lowercase()}...")
                    loadFailed -> {
                        Text("Não foi possível ler o conteúdo denunciado.")
                        TextButton(onClick = { retry++ }) { Text("Tentar novamente") }
                    }
                    held && archivedContent != null -> {
                        Text(archivedContent!!.author, color = Wine)
                        if (!report.isReply) Text(archivedContent!!.title, style = MaterialTheme.typography.titleMedium)
                        Text(archivedContent!!.body)
                    }
                    content == null -> Text("${report.kind} já não está disponível. Você pode encerrar a denúncia sem remoção.")
                    else -> {
                        Text(content!!.author, color = Wine)
                        if (!report.isReply) Text(content!!.title, style = MaterialTheme.typography.titleMedium)
                        Text(content!!.body)
                    }
                }
                if (report.status == "pending") {
                    OutlinedTextField(note, { note = it.take(300) }, enabled = !busy,
                        label = { Text("Justificativa da decisão") }, minLines = 2,
                        supportingText = { Text("De 5 a 300 caracteres; registro restrito à moderação.") })
                    Text(if (report.isReply)
                        "A remoção se aplica somente à resposta denunciada. A discussão e as outras respostas são preservadas."
                        else "Remover retira a publicação do fórum. Respostas e referências podem permanecer armazenadas até uma limpeza administrativa.",
                        fontSize = 12.sp, color = Muted)
                    if (held) OutlinedButton(
                        onClick = { decideHeld(true) },
                        enabled = !busy && archivedContent != null && note.trim().length >= 5
                    ) { Text("Restaurar conteúdo ao fórum") }
                    OutlinedButton(onClick = { confirmRemove = true },
                        enabled = !busy && note.trim().length >= 5 &&
                            (if (held) archivedContent != null else !loading && !loadFailed && content != null)) {
                        Text("Remover ${report.kind.lowercase()}", color = MaterialTheme.colorScheme.error)
                    }
                } else {
                    Text("Decisão: ${if (report.status == "removed") "Removida" else "Encerrada sem remoção"}")
                    Text("Justificativa: ${report.reviewNote}")
                    Text("Administrador: ${report.reviewedBy}", fontSize = 12.sp)
                }
            }
        },
        confirmButton = {
            if (report.status == "pending" && !held) TextButton(
                enabled = !busy && !loading && !loadFailed && note.trim().length >= 5,
                onClick = { review(false, null) }) { Text(if (busy) "Salvando..." else "Encerrar sem remover") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Fechar") } }
    )
    if (confirmRemove) {
        // Captura o conteúdo mostrado ao abrir a confirmação. A transação recusa alterações posteriores.
        val expected = remember { if (held) archivedContent else content }
        AlertDialog(onDismissRequest = { if (!busy) confirmRemove = false },
            title = { Text("Remover esta ${report.kind.lowercase()}?") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (report.isReply) {
                        Text("Resposta de ${expected?.author.orEmpty()}")
                        Text(expected?.body.orEmpty())
                    } else Text(expected?.title.orEmpty())
                    Text(if (held)
                        "Confirmar exclusão do conteúdo retido? A cópia protegida permanece para auditoria."
                        else "A remoção não poderá ser desfeita pelo aplicativo. A decisão ficará registrada na denúncia.")
                }
            },
            confirmButton = { TextButton(enabled = !busy, onClick = {
                if (held) decideHeld(false) else review(true, expected)
            }) {
                Text(if (busy) "Removendo..." else "Confirmar remoção", color = MaterialTheme.colorScheme.error)
            } },
            dismissButton = { TextButton(enabled = !busy, onClick = { confirmRemove = false }) { Text("Cancelar") } })
    }
}

