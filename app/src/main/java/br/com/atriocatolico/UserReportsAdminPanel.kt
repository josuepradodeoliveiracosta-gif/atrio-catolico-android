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
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Source

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
    // Uma página por vez: evitar limitar a cobertura aos 30 casos recentes
    // ou baixar todo o histórico confidencial no dispositivo.
    val pageSize = 30L
    var reports by remember(db, adminUid) { mutableStateOf<List<ReportedMember>>(emptyList()) }
    val cursors = remember(db, adminUid) { mutableStateListOf<DocumentSnapshot>() }
    var pageIndex by remember(db, adminUid) { mutableIntStateOf(0) }
    var requestVersion by remember(db, adminUid) { mutableIntStateOf(0) }
    var hasMore by remember(db, adminUid) { mutableStateOf(false) }
    var loading by remember(db, adminUid) { mutableStateOf(true) }
    var failed by remember(db, adminUid) { mutableStateOf(false) }
    var busyId by remember(db, adminUid) { mutableStateOf("") }
    var info by remember(db, adminUid) { mutableStateOf("") }

    DisposableEffect(db, adminUid, pageIndex, requestVersion) {
        var active = true
        val cursor = if (pageIndex == 0) null else cursors.getOrNull(pageIndex - 1)
        reports = emptyList()
        hasMore = false
        loading = true
        failed = false
        if (pageIndex > 0 && cursor == null) {
            loading = false
            failed = true
        } else {
            val base = db.collection("user_reports")
                .orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(pageSize + 1)
            val query = if (cursor == null) base else base.startAfter(cursor)
            // Fonte SERVER: não confundir cache do moderador anterior com
            // autorização ativa, nem apresentar uma página obsoleta como atual.
            query.get(Source.SERVER).addOnCompleteListener { task ->
                if (active && FirebaseAuth.getInstance().currentUser?.uid == adminUid) {
                    loading = false
                    failed = !task.isSuccessful
                    if (task.isSuccessful) {
                        val documents = task.result?.documents.orEmpty()
                        val visible = documents.take(pageSize.toInt())
                        hasMore = documents.size > pageSize.toInt()
                        reports = visible.map {
                            ReportedMember(
                                it.id, it.getString("targetUid").orEmpty(),
                                it.getString("reporterUid").orEmpty(),
                                it.getString("reason").orEmpty(),
                                it.getString("status") ?: "pending"
                            )
                        }
                        // Descartar cursores de páginas seguintes em caso de
                        // atualização e evitar reutilizar fronteiras antigas.
                        while (cursors.size > pageIndex) cursors.removeAt(cursors.lastIndex)
                        visible.lastOrNull()?.let { cursors.add(it) }
                    }
                }
            }
        }
        onDispose { active = false }
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Denúncias de participantes", style = MaterialTheme.typography.titleMedium)
            if (loading) Text("Carregando denúncias...")
            if (failed) Text("Não foi possível carregar denúncias de usuários.")
            if (loading) Text("Consultando página no servidor...")
            if (failed) {
                Text("Não foi possível consultar esta página no servidor. Nenhum registro em cache será exibido.")
                OutlinedButton(onClick = { requestVersion++ }, enabled = busyId.isEmpty()) {
                    Text("Tentar novamente")
                }
            }
            if (!loading && !failed && reports.none { it.status == "pending" })
                Text("Nenhuma denúncia pendente nesta página. Consulte as demais páginas.")
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
                                    if (FirebaseAuth.getInstance().currentUser?.uid == adminUid) {
                                        busyId = ""
                                        if (result.isSuccessful) {
                                            reports = reports.map {
                                                if (it.id == report.id) it.copy(status = "reviewed") else it
                                            }
                                        }
                                        info = if (result.isSuccessful)
                                            "Denúncia marcada como analisada."
                                            else "Não foi possível registrar a análise."
                                    }
                                }
                        }
                    }
                ) { Text(if (busyId == report.id) "Salvando..." else "Marcar como analisada") }
            }
            if (!loading && !failed) {
                Text("Página ${pageIndex + 1} • até 30 registros por página",
                    style = MaterialTheme.typography.bodySmall)
                androidx.compose.foundation.layout.Row(
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        enabled = pageIndex > 0 && busyId.isEmpty(),
                        onClick = { pageIndex-- }
                    ) { Text("Anteriores") }
                    OutlinedButton(
                        enabled = hasMore && busyId.isEmpty(),
                        onClick = { pageIndex++ }
                    ) { Text("Mais antigas") }
                    OutlinedButton(
                        enabled = busyId.isEmpty(),
                        onClick = {
                            // Recomeçar do topo para incluir denúncias novas.
                            cursors.clear()
                            pageIndex = 0
                            requestVersion++
                        }
                    ) { Text("Atualizar") }
                }
            }
            if (info.isNotBlank()) Text(info, style = MaterialTheme.typography.bodySmall)
        }
    }
}
