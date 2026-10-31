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
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
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
    var refresh by remember(moderatorUid) { mutableStateOf(0) }
    var error by remember(moderatorUid) { mutableStateOf(false) }
    var busy by remember(moderatorUid) { mutableStateOf(false) }
    var selected by remember(moderatorUid) { mutableStateOf<String?>(null) }
    var note by remember(moderatorUid) { mutableStateOf("") }
    fun authorized() = GuardianUiPolicy.sameSession(
        moderatorUid, FirebaseAuth.getInstance().currentUser?.uid
    )
    LaunchedEffect(db, moderatorUid, refresh) {
        if (!authorized()) {
            reports = emptyList()
        } else {
            db.collection("user_reports").orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(20).get(Source.SERVER).addOnCompleteListener { task ->
                    if (!authorized()) return@addOnCompleteListener
                    error = !task.isSuccessful
                    reports = if (task.isSuccessful) task.result?.documents?.map {
                        MemberSafetyReport(it.id, it.getString("targetUid").orEmpty(),
                            it.getString("reason").orEmpty(),
                            it.getString("status") ?: "pending")
                    }.orEmpty() else emptyList()
                }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Denúncias de usuários", style = MaterialTheme.typography.titleMedium)
        Text("Exigem análise humana. Marcar como analisada não suspende contas nem remove conteúdo.",
            style = MaterialTheme.typography.bodySmall)
        if (error) Text("Consulta falhou. Verifique a conexão e sua permissão.")
        OutlinedButton(onClick = { refresh++ }, enabled = !busy,
            modifier = Modifier.testTag("atrio-user-reports-reload")) { Text("Atualizar denúncias") }
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
        if (!error && reports.isNotEmpty() && reports.none { it.status == "pending" }) {
            Text("Nenhuma denúncia de usuário pendente nesta página.")
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
