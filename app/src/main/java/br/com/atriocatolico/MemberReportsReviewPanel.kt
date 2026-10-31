package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source

private data class MemberSafetyReport(
    val id: String, val targetUid: String, val reason: String, val status: String
)

/** Renderizar somente após autorização administrativa de servidor na ModerationScreen. */
@Composable
internal fun MemberReportsReviewPanel(db: FirebaseFirestore, moderatorUid: String) {
    var reports by remember(moderatorUid) { mutableStateOf<List<MemberSafetyReport>>(emptyList()) }
    var refresh by remember(moderatorUid) { mutableIntStateOf(0) }
    var page by remember(moderatorUid) { mutableIntStateOf(0) }
    var lastPageDocument by remember(moderatorUid) { mutableStateOf<DocumentSnapshot?>(null) }
    var morePages by remember(moderatorUid) { mutableStateOf(false) }
    var loading by remember(moderatorUid) { mutableStateOf(false) }
    var error by remember(moderatorUid) { mutableStateOf(false) }
    var busy by remember(moderatorUid) { mutableStateOf(false) }
    var selected by remember(moderatorUid) { mutableStateOf<String?>(null) }
    var note by remember(moderatorUid) { mutableStateOf("") }
    fun authorized() = GuardianUiPolicy.sameSession(
        moderatorUid, FirebaseAuth.getInstance().currentUser?.uid
    )
    // Lista paginada, sempre consultada do servidor, com cancelamento de
    // callbacks que chegam depois de alterar a sessao ou pagina.
    DisposableEffect(db, moderatorUid, refresh, page) {
        var active = true
        if (!authorized()) {
            reports = emptyList()
            morePages = false
            loading = false
        } else {
            loading = true
            val base = db.collection("user_reports")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(20)
            val query = if (page == 0 || lastPageDocument == null) base
                else base.startAfter(lastPageDocument!!)
            query.get(Source.SERVER).addOnCompleteListener { task ->
                if (!active || !authorized()) return@addOnCompleteListener
                loading = false
                error = !task.isSuccessful
                if (task.isSuccessful) {
                    val docs = task.result?.documents.orEmpty()
                    val current = docs.map {
                        MemberSafetyReport(it.id, it.getString("targetUid").orEmpty(),
                            it.getString("reason").orEmpty(),
                            it.getString("status") ?: "pending")
                    }
                    reports = if (page == 0) current else
                        (reports + current).distinctBy { it.id }
                    lastPageDocument = docs.lastOrNull()
                    morePages = docs.size == 20
                } else morePages = false
            }
        }
        onDispose { active = false }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Denúncias de usuários", style = MaterialTheme.typography.titleMedium)
        Text("Exigem análise humana. Marcar como analisada não suspende contas nem remove conteúdo.",
            style = MaterialTheme.typography.bodySmall)
        if (error) Text("Consulta falhou. Verifique a conexão e sua permissão.")
        OutlinedButton(onClick = {
            page = 0
            lastPageDocument = null
            morePages = false
            reports = emptyList()
            selected = null
            refresh++
        }, enabled = !busy && !loading,
            modifier = Modifier.testTag("atrio-user-reports-reload")) { Text("Atualizar denúncias") }
        if (loading) Text("Consultando denúncias no servidor...")
        reports.filter { it.status == "pending" }.take(10).forEach { item ->
            Card(Modifier.fillMaxWidth()) {
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text("Usuário denunciado: " + item.targetUid)
                    Text(item.reason, style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(
                        enabled = !busy && authorized(),
                        onClick = { selected = item.id; note = "" }
                    ) { Text("Analisar denúncia") }
                }
            }
        }
        if (!loading && !error && reports.isEmpty()) {
            Text("Nenhuma denúncia de usuário encontrada.")
        } else if (!loading && !error &&
            reports.isNotEmpty() && reports.none { it.status == "pending" }) {
            Text("Nenhuma denúncia pendente entre as páginas consultadas.")
        }
        if (morePages && !error) {
            OutlinedButton(
                onClick = { if (lastPageDocument != null) page++ },
                enabled = !loading && !busy && authorized(),
                modifier = Modifier.testTag("atrio-user-reports-load-more")
            ) { Text("Carregar denúncias anteriores") }
        }
        val selection = reports.firstOrNull { it.id == selected && it.status == "pending" }
        if (selection != null) {
            OutlinedTextField(value = note, onValueChange = {
                if (it.length <= 300) note = it
            }, label = { Text("Justificativa da decisão") },
                modifier = Modifier.fillMaxWidth().testTag("atrio-user-report-review-note"))
            fun decision(status: String) {
                if (!authorized() || busy || note.trim().length !in 5..300) return
                busy = true
                db.collection("user_reports").document(selection.id).update(mapOf(
                    "status" to status, "reviewedBy" to moderatorUid,
                    "reviewedAt" to FieldValue.serverTimestamp(),
                    "reviewNote" to note.trim()
                )).addOnCompleteListener { task ->
                    if (!authorized()) return@addOnCompleteListener
                    busy = false
                    error = !task.isSuccessful
                    if (task.isSuccessful) {
                        selected = null
                        note = ""
                        page = 0
                        lastPageDocument = null
                        morePages = false
                        reports = emptyList()
                        refresh++
                    }
                }
            }
            Button(enabled = !busy && note.trim().length in 5..300 && authorized(),
                onClick = { decision("reviewed") }) { Text("Marcar como analisada") }
            OutlinedButton(enabled = !busy && note.trim().length in 5..300 && authorized(),
                onClick = { decision("dismissed") }) { Text("Encerrar sem ação") }
        }
    }
}
