package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Timestamp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions

/**
 * Painel somente para administradores habilitados em admins/{uid}.
 * Firestore Rules fazem a autorização; ocultar botões não concede privilégios.
 * Nunca use o nome declarado pelo usuário como prova de ordenação sacerdotal.
 */
private data class ClergyRequest(
    val uid: String,
    val kind: String,
    val createdAt: Timestamp?
) {
    val title: String get() = if (kind == "padre") "Padre" else "Diácono"
}

private fun DocumentSnapshot.toClergyRequest(): ClergyRequest? {
    if (getString("status") != "pending") return null
    val kind = getString("kind") ?: return null
    if (kind !in listOf("padre", "diacono")) return null
    return ClergyRequest(id, kind, getTimestamp("createdAt"))
}

@Composable
internal fun ClergyBadgeReviewScreen(
    db: FirebaseFirestore, reviewerUid: String, onBack: () -> Unit
) {
    var requests by remember(reviewerUid) { mutableStateOf<List<ClergyRequest>>(emptyList()) }
    var limit by remember(reviewerUid) { mutableStateOf(30) }
    var retry by remember(reviewerUid) { mutableStateOf(0) }
    var loading by remember(reviewerUid) { mutableStateOf(true) }
    var failed by remember(reviewerUid) { mutableStateOf(false) }
    var more by remember(reviewerUid) { mutableStateOf(false) }
    var selected by remember(reviewerUid) { mutableStateOf<String?>(null) }
    var message by remember(reviewerUid) { mutableStateOf("") }

    BackHandler { if (selected != null) selected = null else onBack() }

    DisposableEffect(db, reviewerUid, limit, retry) {
        var active = true
        loading = true
        failed = false
        // Somente administradores podem listar esta coleção (validado no servidor).
        val registration = db.collection("badge_requests")
            .whereEqualTo("status", "pending")
            .limit(limit.toLong() + 1)
            .addSnapshotListener { snapshot, error ->
                if (active) {
                    loading = false
                    failed = error != null
                    if (error == null) {
                        more = (snapshot?.size() ?: 0) > limit
                        requests = (snapshot?.documents?.take(limit)?.mapNotNull {
                            it.toClergyRequest()
                        } ?: emptyList()).sortedByDescending {
                            it.createdAt?.toDate()?.time ?: 0L
                        }
                    } else {
                        more = false
                        requests = emptyList()
                    }
                }
            }
        onDispose { active = false; registration.remove() }
    }

    Scaffold(containerColor = Paper, topBar = {
        Surface(color = Paper, modifier = Modifier.statusBarsPadding()) {
            Row(Modifier.fillMaxWidth().padding(12.dp)) {
                TextButton(onClick = onBack) { Text("Voltar") }
                SectionTitle("Solicitações de selos", Modifier.padding(top = 8.dp))
            }
        }
    }) { insets ->
        LazyColumn(Modifier.fillMaxSize().padding(insets),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item {
                Text("Verificação de Padres e Diáconos", color = Wine)
                Text("A solicitação não comprova a ordenação. Confira a identidade do titular " +
                    "e sua condição de ministro ordenado por um canal eclesial confiável antes de aprovar.",
                    color = Muted, fontSize = 13.sp)
            }
            if (failed) item {
                Text("Não foi possível consultar a fila. Confira sua permissão de administrador, " +
                    "a conexão e as regras publicadas no Firebase.", color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { retry++ }) { Text("Tentar novamente") }
            }
            if (!loading && !failed && requests.isEmpty()) item {
                Text("Nenhuma solicitação pendente nesta página.", color = Muted)
            }
            items(requests, key = { it.uid }) { item ->
                Card(onClick = { selected = item.uid }, modifier = Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Solicitação de ${item.title}", color = Wine)
                        Text("UID: ${item.uid}", fontSize = 11.sp)
                        Text("Status: Pendente", color = Muted, fontSize = 12.sp)
                        Text("Toque para verificar", fontSize = 12.sp)
                    }
                }
            }
            if (loading || more) item {
                OutlinedButton(enabled = !loading, onClick = { limit += 30 },
                    modifier = Modifier.fillMaxWidth()) {
                    Text(if (loading) "Carregando..." else "Carregar mais solicitações")
                }
            }
        }
    }

    val current = requests.firstOrNull { it.uid == selected }
    if (current != null) key(current.uid) {
        ClergyReviewDialog(db, reviewerUid, current,
            onClose = { selected = null },
            onResult = { message = it; selected = null })
    }
    if (message.isNotEmpty()) AlertDialog(
        onDismissRequest = { message = "" },
        title = { Text("Verificação de selo") },
        text = { Text(message) },
        confirmButton = { TextButton(onClick = { message = "" }) { Text("Entendi") } }
    )
}

@Composable
private fun ClergyReviewDialog(
    db: FirebaseFirestore,
    reviewerUid: String,
    request: ClergyRequest,
    onClose: () -> Unit,
    onResult: (String) -> Unit
) {
    var note by remember(request.uid) { mutableStateOf("") }
    var verified by remember(request.uid) { mutableStateOf(false) }
    var busy by remember(request.uid) { mutableStateOf(false) }
    var failure by remember(request.uid) { mutableStateOf("") }
    val ownRequest = request.uid == reviewerUid

    fun decide(approve: Boolean) {
        val justification = note.trim()
        if (busy || ownRequest || justification.length !in 10..300 || (approve && !verified)) return
        busy = true
        failure = ""
        val requestRef = db.collection("badge_requests").document(request.uid)
        val batch = db.batch()
        batch.update(requestRef, mapOf(
            "status" to if (approve) "approved" else "rejected",
            "reviewedBy" to reviewerUid,
            "reviewedAt" to FieldValue.serverTimestamp(),
            "reviewNote" to justification
        ))
        if (approve) {
            // Conceder a medalha e revisar o pedido no MESMO batch.
            // As regras exigem o estado 'pending' antes e 'approved' depois.
            batch.set(db.collection("badges").document(request.uid),
                mapOf("clergy" to request.kind), SetOptions.merge())
        }
        batch.commit().addOnCompleteListener { result ->
            busy = false
            if (result.isSuccessful) {
                onResult(if (approve) "Identidade verificada. Selo ${request.title} concedido."
                    else "Solicitação rejeitada e registrada.")
            } else {
                failure = "Não foi possível registrar a decisão. Confira as regras do Firebase, " +
                    "sua permissão administrativa e se o pedido ainda está pendente."
            }
        }
    }

    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Verificar solicitação de ${request.title}") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Conta solicitante:", fontSize = 12.sp)
                SelectionContainer { Text(request.uid, fontSize = 12.sp) }
                if (ownRequest) {
                    Text("Você não pode analisar seu próprio pedido. Peça a outro administrador autorizado.",
                        color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
                Text("Confira este UID no Firebase Authentication e confirme a identidade " +
                    "e ordenação por um contato independente. Não use apenas uma declaração do aplicativo.",
                    fontSize = 12.sp, color = Muted)
                Row {
                    Checkbox(checked = verified, onCheckedChange = { verified = it },
                        enabled = !busy)
                    Text("Confirmei a identidade e a ordenação por meio confiável.",
                        modifier = Modifier.padding(top = 10.dp), fontSize = 12.sp)
                }
                OutlinedTextField(value = note, onValueChange = { note = it.take(300) },
                    modifier = Modifier.fillMaxWidth(), enabled = !busy,
                    label = { Text("Justificativa da decisão") },
                    minLines = 2, maxLines = 4)
                Text("Registre apenas a justificativa necessária. Não inclua documentos " +
                    "pessoais ou informações sensíveis.", fontSize = 11.sp, color = Muted)
                if (failure.isNotBlank())
                    Text(failure, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(onClick = { decide(true) },
                enabled = !busy && !ownRequest && verified && note.trim().length in 10..300) {
                Text(if (busy) "Registrando..." else "Aprovar e conceder")
            }
        },
        dismissButton = {
            Row {
                TextButton(enabled = !busy && !ownRequest && note.trim().length in 10..300,
                    onClick = { decide(false) }) { Text("Rejeitar") }
                TextButton(enabled = !busy, onClick = onClose) { Text("Cancelar") }
            }
        }
    )
}
