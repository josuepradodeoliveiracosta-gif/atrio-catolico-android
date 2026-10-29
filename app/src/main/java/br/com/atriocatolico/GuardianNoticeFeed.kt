package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

private data class GuardianNotice(val id: String, val title: String, val body: String)

/** Avisos privados do Guardião no perfil; não dependem da entrega de FCM. */
@Composable
internal fun GuardianNoticeFeed(db: FirebaseFirestore, uid: String) {
    var notices by remember(uid) { mutableStateOf<List<GuardianNotice>>(emptyList()) }
    var failed by remember(uid) { mutableStateOf(false) }
    DisposableEffect(db, uid) {
        val listener = db.collection("guardian_notices").document(uid).collection("items")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(15)
            .addSnapshotListener { snapshot, failure ->
                failed = failure != null
                if (failure == null) notices = snapshot?.documents?.map {
                    GuardianNotice(it.id, it.getString("title").orEmpty(),
                        it.getString("body").orEmpty())
                }.orEmpty()
            }
        onDispose { listener.remove() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Avisos privados do Átrio Guardião", style = MaterialTheme.typography.titleSmall)
        if (failed) Text("Os avisos não puderam ser consultados. Verifique a conexão.",
            color = MaterialTheme.colorScheme.error)
        if (!failed && notices.isEmpty()) Text("Nenhum aviso recente.",
            style = MaterialTheme.typography.bodySmall)
        notices.forEach { notice ->
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp)) {
                    Text(notice.title, style = MaterialTheme.typography.titleSmall)
                    Text(notice.body, style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
