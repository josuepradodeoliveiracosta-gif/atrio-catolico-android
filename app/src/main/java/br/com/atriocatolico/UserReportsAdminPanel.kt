package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

private data class ReportedMember(
    val id: String, val targetUid: String,
    val reporterUid: String, val reason: String, val status: String
)

/**
 * Fila de denúncias de usuários. Chamado SOMENTE depois do portão de admin
 * fresco e verificado em ModerationScreen; regras do Firestore também
 * exigem admin para consultas e mudanças de status.
 */
@Composable
internal fun UserReportsAdminPanel(db: FirebaseFirestore, adminUid: String) {
    var reports by remember(adminUid) { mutableStateOf<List<ReportedMember>>(emptyList()) }
    var loading by remember(adminUid) { mutableStateOf(true) }
    var failed by remember(adminUid) { mutableStateOf(false) }
    var busyId by remember(adminUid) { mutableStateOf("") }
    var info by remember(adminUid) { mutableStateOf("") }
    DisposableEffect(db, adminUid) {
        var active = true
        val subscription = db.collection("user_reports")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(30).addSnapshotListener { data, failure ->
                if (active && FirebaseAuth.getInstance().currentUser?.uid == adminUid) {
                    loading = false
                    failed = failure != null
                    reports = if (failure == null) data?.documents?.map {
                        ReportedMember(
                            it.id, it.getString("targetUid").orEmpty(),
                            it.getString("reporterUid").orEmpty(),
                            it.getString("reason").orEmpty(),
                            it.getString("status") ?: "pending"
                        )
                    }.orEmpty() else emptyList()
                }
            }
        onDispose { active = false; subscription.remove() }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Denúncias de participantes", style = MaterialTheme.typography.titleMedium)
            if (loading) Text("Carregando denúncias...")
            if (failed) Text("Não foi possível carregar denúncias de usuários.")
            if (!loading && !failed && reports.none { it.status == "pending" })
                Text("Nenhuma denúncia pendente entre as 30 mais recentes.")
            reports.filter { it.status == "pending" }.forEach { report ->
                Text("Participante denunciado: " + report.targetUid.take(128),
                    style = MaterialTheme.typography.bodySmall)
                Text("Denunciante: " + report.reporterUid.take(128),
                    style = MaterialTheme.typography.bodySmall)
                Text(report.reason, style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(
                    enabled = busyId.isEmpty(),
                    onClick = {
                        if (FirebaseAuth.getInstance().currentUser?.uid != adminUid) {
                            info = "Sessão administrativa alterada."
                        } else {
                            busyId = report.id
                            db.collection("user_reports").document(report.id)
                                .update(mapOf(
                                    "status" to "reviewed",
                                    "reviewedBy" to adminUid,
                                    "reviewedAt" to FieldValue.serverTimestamp()
                                )).addOnCompleteListener { result ->
                                    busyId = ""
                                    info = if (result.isSuccessful)
                                        "Denúncia marcada como analisada."
                                        else "Não foi possível registrar a análise."
                                }
                        }
                    }
                ) { Text(if (busyId == report.id) "Salvando..." else "Marcar como analisada") }
            }
            if (info.isNotBlank()) Text(info, style = MaterialTheme.typography.bodySmall)
        }
    }
}
