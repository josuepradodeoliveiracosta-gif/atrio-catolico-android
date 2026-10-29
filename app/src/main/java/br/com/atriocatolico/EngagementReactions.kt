package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Rect
import androidx.compose.ui.layout.boundsInWindow
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import com.google.firebase.firestore.MetadataChanges
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
    db: FirebaseFirestore, uid: String, postId: String, replyId: String,
    requested: Boolean = false, onRequestDismiss: () -> Unit = {}
) {
    val context = LocalContext.current
    val view = LocalView.current
    val collection = remember(db, postId, replyId) {
        db.collection("posts").document(postId).collection("replies").document(replyId).collection("reactions")
    }
    var catalogFailed by remember { mutableStateOf(false) }
    val device by produceState<DeviceEmojiCatalog?>(null, context.applicationContext) {
        try { value = ReactionEmojiData.load(context.applicationContext) }
        catch (cancelled: kotlinx.coroutines.CancellationException) { throw cancelled }
        catch (_: Exception) { catalogFailed = true }
    }
    var visible by remember(uid, postId, replyId) { mutableStateOf(false) }
    var values by remember(uid, postId, replyId) { mutableStateOf<Map<String, String>>(emptyMap()) }
    var loading by remember(uid, postId, replyId) { mutableStateOf(true) }
    var fromCache by remember(uid, postId, replyId) { mutableStateOf(true) }
    var busy by remember(uid, postId, replyId) { mutableStateOf(false) }
    var failure by remember(uid, postId, replyId) { mutableStateOf("") }
    var retry by remember(uid, postId, replyId) { mutableStateOf(0) }
    val session = remember(uid, postId, replyId) { ReactionViewSession() }
    DisposableEffect(session) { onDispose { session.active = false } }
    // One realtime collection subscription per visible reply, not one query per emoji.
    // No arbitrary query limit: counts cover all reactions once the server snapshot arrives.
    DisposableEffect(collection, uid, visible, retry) {
        var active = true
        val registration = if (visible) collection.addSnapshotListener(MetadataChanges.INCLUDE) { snap, error ->
            if (active) {
                loading = false
                if (error != null) failure = "Não foi possível atualizar as reações."
                else if (snap != null) {
                    failure = ""
                    fromCache = snap.metadata.isFromCache
                    values = snap.documents.associate { it.id to it.getString("kind").orEmpty() }
                }
            }
        } else null
        onDispose { active = false; registration?.remove() }
    }
    val data = device
    Column(Modifier.fillMaxWidth().onGloballyPositioned { coordinates ->
        val bounds: Rect = coordinates.boundsInWindow()
        visible = bounds.height > 0 && bounds.width > 0 && bounds.bottom > 0 && bounds.top < view.height
    }) {
        if (data == null) {
            Text(if (catalogFailed) "Não foi possível carregar os emojis. Reabra a discussão." else "Carregando emojis…", style = MaterialTheme.typography.labelSmall)
        } else {
            val validValues = remember(values, data) {
                values.filterValues { reactionGlyph(it) in data.catalog.byGlyph }
            }
            key(uid, postId, replyId) {
                ReactionEmojiPicker(data, replyId, reactionGlyph(validValues[uid].orEmpty()),
                    summarizeReactions(validValues, uid), busy || loading,
                    requested = requested, onRequestDismiss = onRequestDismiss,
                    recents = { ReactionEmojiData.recent(context, uid) },
                    onPick = { glyph ->
                        if (!busy && glyph in data.catalog.byGlyph) {
                            busy = true
                            failure = ""
                            changeReplyReaction(db, uid, postId, replyId, glyph).addOnCompleteListener { task ->
                                if (session.active) {
                                    busy = false
                                    if (task.isSuccessful) ReactionEmojiData.record(context, uid, glyph)
                                    else failure = if ((task.exception as? com.google.firebase.firestore.FirebaseFirestoreException)?.code ==
                                        com.google.firebase.firestore.FirebaseFirestoreException.Code.PERMISSION_DENIED)
                                        "Esta reação ainda não está disponível. Tente ❤️, 🙏 ou ✨."
                                    else "Não foi possível salvar a reação. Confira sua conexão e tente novamente."
                                }
                            }
                        }
                    })
            }
            if (fromCache && !loading) Text("Contagem em cache; aguardando sincronização.",
                style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (failure.isNotEmpty()) {
            Text(failure, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
            TextButton(onClick = { failure = ""; retry++ }, enabled = !busy) { Text("Atualizar reações") }
        }
    }
}

private class ReactionViewSession(var active: Boolean = true)

/** The latest document is read inside a transaction, so two devices never rely on a stale local selection. */
internal fun changeReplyReaction(
    db: FirebaseFirestore, uid: String, postId: String, replyId: String, glyph: String
): com.google.android.gms.tasks.Task<String> {
    val ref = db.collection("posts").document(postId).collection("replies").document(replyId)
        .collection("reactions").document(uid)
    return db.runTransaction { transaction ->
        val current = transaction.get(ref)
        val next = nextReactionKind(current.getString("kind"), glyph)
        if (next == null) transaction.delete(ref)
        else if (current.exists()) transaction.update(ref, "kind", next)
        else transaction.set(ref, mapOf("kind" to next, "createdAt" to FieldValue.serverTimestamp()))
        next.orEmpty()
    }
}
