package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

/**
 * A configuração é escrita somente por administrador/SDK em produção.
 * Regras novas + documento app_config/engagement enabled=true são necessários.
 * Sem ambos, recursos experimentais permanecem desabilitados.
 */
@Composable
internal fun rememberAdvancedEngagementEnabled(db: FirebaseFirestore, uid: String): Boolean {
    var enabled by remember(db, uid) { mutableStateOf(false) }
    DisposableEffect(db, uid) {
        var active = true
        db.document("app_config/engagement").get().addOnCompleteListener { result ->
            if (active) enabled = result.isSuccessful &&
                result.result?.getBoolean("enabled") == true
        }
        onDispose { active = false }
    }
    return enabled
}

@Composable
internal fun ReplyReactionBar(
    db: FirebaseFirestore, uid: String, postId: String, replyId: String
) {
    val ref = remember(db, uid, postId, replyId) {
        db.collection("posts").document(postId).collection("replies")
            .document(replyId).collection("reactions").document(uid)
    }
    var selected by remember(uid, replyId) { mutableStateOf("") }
    var busy by remember(uid, replyId) { mutableStateOf(false) }
    var failure by remember(uid, replyId) { mutableStateOf(false) }
    DisposableEffect(ref) {
        var active = true
        val listener = ref.addSnapshotListener { snap, error ->
            if (active) {
                if (error == null) selected = snap?.getString("kind").orEmpty()
                else failure = true
            }
        }
        onDispose { active = false; listener.remove() }
    }
    Column {
        Text("Minha reação", style = MaterialTheme.typography.labelSmall)
        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
            listOf(
                "heart" to "❤️",
                "prayer" to "🙏",
                "light" to "✨"
            ).forEach { (kind, icon) ->
                OutlinedButton(
                    onClick = {
                        if (busy) return@OutlinedButton
                        busy = true
                        failure = false
                        val task = if (kind == selected) ref.delete()
                        else if (selected.isBlank()) ref.set(mapOf(
                            "kind" to kind, "createdAt" to FieldValue.serverTimestamp()
                        )) else ref.update("kind", kind)
                        task.addOnCompleteListener { done ->
                            busy = false
                            failure = !done.isSuccessful
                        }
                    },
                    enabled = !busy,
                    contentPadding = PaddingValues(horizontal = 10.dp, vertical = 2.dp),
                    modifier = Modifier.testTag("atrio-reaction-$kind-$replyId")
                ) { Text(if (selected == kind) "$icon ✓" else icon) }
            }
        }
        if (failure) Text("Não foi possível registrar a reação.",
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall)
    }
}
