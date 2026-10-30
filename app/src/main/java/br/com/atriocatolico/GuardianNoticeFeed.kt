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
    val observedUid = rememberGuardianAuthUid()
    val sessionActive = GuardianUiPolicy.sameSession(uid, observedUid)
    DisposableEffect(db, uid, observedUid) {
        if (!sessionActive) {
            notices = emptyList()
            failed = false
            onDispose { }
        } else {
            var active = true
            val listener = db.collection("guardian_notices").document(uid).collection("items")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(15)
                .addSnapshotListener { snapshot, failure ->
                    if (active && GuardianUiPolicy.sameSession(
                            uid, com.google.firebase.auth.FirebaseAuth.getInstance().currentUser?.uid
                        )) {
                        failed = failure != null
                        notices = if (failure == null) snapshot?.documents?.map {
                            GuardianNotice(it.id, it.getString("title").orEmpty(),
                                it.getString("body").orEmpty())
                        }.orEmpty() else emptyList()
                    }
                }
            onDispose { active = false; listener.remove() }
        }
    }
    // Hide previously cached private notices on the first frame of logout.
    if (!sessionActive) {
        Text("Sessão alterada. Entre novamente.")
        return
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
