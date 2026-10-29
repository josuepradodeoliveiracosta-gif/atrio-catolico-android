package br.com.atriocatolico

import androidx.compose.runtime.*
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Opção remota, desativada até o administrador publicar regras e habilitar
 * app_config/engagement.enabled. Em modo antigo usa somente lista local.
 */
internal data class SyncedFollowState(
    val ids: Set<String> = emptySet(),
    val loading: Boolean = false,
    val failed: Boolean = false
)

@Composable
internal fun rememberSyncedFollowedDiscussions(
    db: FirebaseFirestore, uid: String, enabled: Boolean
): SyncedFollowState {
    var state by remember(db, uid, enabled) {
        mutableStateOf(SyncedFollowState(loading = enabled))
    }
    DisposableEffect(db, uid, enabled) {
        if (!enabled) {
            state = SyncedFollowState()
            onDispose {}
        } else {
            var active = true
            val listener = db.collection("users").document(uid)
                .collection("followedPosts").limit(40)
                .addSnapshotListener { documents, failure ->
                    if (active) {
                        state = if (failure != null)
                            SyncedFollowState(failed = true)
                        else
                            SyncedFollowState(
                                ids = documents?.documents.orEmpty().map { it.id }.toSet()
                            )
                    }
                }
            onDispose { active = false; listener.remove() }
        }
    }
    return state
}

internal object SyncedFollowedDiscussions {
    /**
     * A escrita depende de autenticação e das regras de segurança publicadas.
     * Um documento por discussão/UID; set e delete são idempotentes.
     */
    fun change(
        db: FirebaseFirestore, uid: String, postId: String, isFollowing: Boolean,
        done: (Boolean) -> Unit
    ) {
        if (uid.isBlank() || !Regex("^[a-zA-Z0-9_-]{1,128}$").matches(postId)) {
            done(false)
            return
        }
        val ref = db.collection("users").document(uid).collection("followedPosts").document(postId)
        val operation = if (isFollowing) ref.delete()
        else ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
        operation.addOnCompleteListener { task -> done(task.isSuccessful) }
    }
}
