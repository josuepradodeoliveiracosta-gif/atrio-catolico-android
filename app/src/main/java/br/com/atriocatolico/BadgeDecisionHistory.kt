package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

/** Últimas decisões, disponíveis apenas a administradores habilitados. */
@Composable
internal fun BadgeDecisionHistory(db: FirebaseFirestore) {
    var expanded by remember { mutableStateOf(false) }
    var loading by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    var events by remember { mutableStateOf<List<Triple<String, String, String>>>(emptyList()) }
    DisposableEffect(db, expanded) {
        if (!expanded) {
            onDispose { }
        } else {
            loading = true
            failed = false
            val listener = db.collection("badge_events")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(20)
                .addSnapshotListener { snapshot, error ->
                    loading = false
                    failed = error != null
                    events = if (error == null) snapshot?.documents?.map { doc ->
                        Triple(
                            "${verifiedBadgeLabel(doc.getString("kind").orEmpty())} • " +
                                (doc.getString("decision") ?: ""),
                            doc.getString("targetUid").orEmpty(),
                            doc.getString("reason").orEmpty()
                        )
                    }.orEmpty() else emptyList()
                }
            onDispose { listener.remove() }
        }
    }
    Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
        OutlinedButton(onClick = { expanded = !expanded },
            modifier = Modifier.fillMaxWidth()) {
            Text(if (expanded) "Ocultar histórico" else "Consultar histórico administrativo")
        }
        if (expanded) {
            Text("Últimas 20 decisões. Justificativas privadas da administração.",
                color = Muted, fontSize = 12.sp)
            if (loading) CircularProgressIndicator(Modifier.size(24.dp))
            if (failed) Text("Não foi possível consultar o histórico.", color = Wine)
            if (!loading && !failed && events.isEmpty()) Text("Nenhum evento registrado.", color = Muted)
            events.forEach { (title, target, reason) ->
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(12.dp)) {
                        Text(title, style = MaterialTheme.typography.labelLarge, color = Wine)
                        Text("UID: $target", fontSize = 11.sp, color = Muted)
                        Text(reason, fontSize = 12.sp)
                    }
                }
            }
        }
    }
}
