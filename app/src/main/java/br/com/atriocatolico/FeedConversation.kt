package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query

@Composable
internal fun FeedConversation(
    db: FirebaseFirestore,
    post: DocumentSnapshot,
    uid: String,
) {
    val comments = remember(post.reference) { post.reference.collection("comments") }
    var entries by remember(comments, uid) { mutableStateOf<List<DocumentSnapshot>>(emptyList()) }
    var limit by rememberSaveable(post.id, uid) { mutableStateOf(30L) }
    var retry by remember(comments, uid) { mutableStateOf(0) }
    var failed by remember(comments, uid) { mutableStateOf(false) }
    var body by rememberSaveable(post.id, uid) { mutableStateOf("") }
    var parentId by rememberSaveable(post.id, uid) { mutableStateOf<String?>(null) }
    var busy by remember(comments, uid) { mutableStateOf(false) }
    var feedback by remember(comments, uid) { mutableStateOf("") }

    DisposableEffect(comments, uid, retry, limit) {
        val listener = comments.orderBy("createdAt", Query.Direction.ASCENDING).limit(limit)
            .addSnapshotListener(MetadataChanges.INCLUDE) { result, error ->
                entries = result?.takeUnless { it.metadata.isFromCache }?.documents.orEmpty()
                failed = error != null
            }
        onDispose { listener.remove() }
    }
    val parent = entries.firstOrNull { it.id == parentId }
    val children = entries.groupBy { it.getString("parentId").orEmpty() }
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Conversa", style = MaterialTheme.typography.titleLarge)
        FeedReportButton(db, uid, post, "post")
        if (failed) {
            Text("Não foi possível carregar a conversa.", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { retry++ }) { Text("Tentar novamente") }
        }
        for (root in children[""].orEmpty()) {
            FeedCommentRow(db, uid, post, root, onReply = { parentId = root.id })
            for (reply in children[root.id].orEmpty()) {
                Column(Modifier.padding(start = 16.dp)) { FeedCommentRow(db, uid, post, reply) }
            }
        }
        if (entries.size.toLong() >= limit) TextButton(onClick = { limit += 30 }) {
            Text("Carregar mais comentários")
        }
        if (parent != null) {
            Text("Respondendo a um comentário", color = MaterialTheme.colorScheme.primary)
            TextButton(enabled = !busy, onClick = { parentId = null }) { Text("Cancelar resposta") }
        }
        OutlinedTextField(body, { body = it.take(2000) }, enabled = !busy,
            label = { Text(if (parent == null) "Escreva um comentário" else "Escreva uma resposta") },
            modifier = Modifier.fillMaxWidth())
        Button(enabled = !busy && body.isNotBlank() && (parentId == null || parent != null), onClick = {
            busy = true
            feedback = ""
            val ref = comments.document()
            val batch = db.batch().set(ref, mapOf(
                "authorUid" to uid, "parentId" to parent?.id.orEmpty(),
                "body" to body.trim(), "createdAt" to FieldValue.serverTimestamp(),
            ))
            val recipients = mutableMapOf<String, String>()
            post.getString("authorUid")?.takeUnless { it == uid }?.let { recipients[it] = "comment" }
            parent?.getString("authorUid")?.takeUnless { it == uid }?.let { recipients[it] = "reply" }
            for ((recipient, kind) in recipients) {
                batch.set(db.document("feed_notices/$recipient/items/${ref.id}"), mapOf(
                    "postId" to post.id, "kind" to kind, "read" to false,
                    "createdAt" to FieldValue.serverTimestamp(),
                ))
            }
            batch.commit().addOnCompleteListener {
                busy = false
                if (it.isSuccessful) {
                    body = ""
                    parentId = null
                } else feedback = "Não foi possível enviar. Seu texto foi preservado."
            }
        }) { Text(if (parent == null) "Comentar" else "Responder") }
        if (feedback.isNotBlank()) Text(feedback, color = MaterialTheme.colorScheme.error)
    }
}

@Composable
private fun FeedCommentRow(
    db: FirebaseFirestore,
    uid: String,
    post: DocumentSnapshot,
    comment: DocumentSnapshot,
    onReply: (() -> Unit)? = null,
) {
    val removed = comment.getBoolean("removed") == true
    val owner = comment.getString("authorUid").orEmpty()
    Text(feedAuthorName(db, owner), style = MaterialTheme.typography.labelLarge)
    Text(if (removed) "Comentário removido." else comment.getString("body").orEmpty())
    Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
        if (!removed && onReply != null) TextButton(onClick = onReply) { Text("Responder") }
        if (!removed) FeedReportButton(db, uid, post, "comment", comment)
        if (!removed && owner == uid) FeedRemoveComment(comment.reference)
    }
}

@Composable
private fun FeedRemoveComment(ref: DocumentReference) {
    var confirm by remember(ref) { mutableStateOf(false) }
    var failed by remember(ref) { mutableStateOf(false) }
    var busy by remember(ref) { mutableStateOf(false) }
    TextButton(enabled = !busy, onClick = { confirm = true }) { Text("Remover") }
    if (confirm) AlertDialog(
        onDismissRequest = { confirm = false },
        title = { Text("Remover este comentário?") },
        text = { Text("As respostas ao comentário continuarão na conversa.") },
        confirmButton = {
            TextButton(onClick = {
                confirm = false
                busy = true
                ref.update("removed", true, "body", "").addOnCompleteListener {
                    busy = false
                    failed = !it.isSuccessful
                }
            }) { Text("Remover") }
        },
        dismissButton = { TextButton(onClick = { confirm = false }) { Text("Cancelar") } },
    )
    if (failed) Text("Não foi possível remover.", color = MaterialTheme.colorScheme.error)
}

@Composable
internal fun FeedReportButton(
    db: FirebaseFirestore,
    uid: String,
    target: DocumentSnapshot,
    type: String,
    comment: DocumentSnapshot? = null,
) {
    val targetUid = when (type) {
        "channel" -> target.id
        "comment" -> comment?.getString("authorUid")
        else -> target.getString("authorUid")
    }
    if (targetUid == null || targetUid == uid) return
    var open by remember(target.reference, comment?.reference, uid) { mutableStateOf(false) }
    var reason by remember(target.reference, comment?.reference, uid) { mutableStateOf("") }
    var busy by remember(target.reference, comment?.reference, uid) { mutableStateOf(false) }
    var error by remember(target.reference, comment?.reference, uid) { mutableStateOf(false) }
    var sent by remember(target.reference, comment?.reference, uid) { mutableStateOf(false) }

    TextButton(enabled = !sent, onClick = { open = true }) {
        Text(if (sent) "Denúncia enviada" else "Denunciar")
    }
    if (!open) return
    AlertDialog(
        onDismissRequest = { if (!busy) open = false },
        title = { Text("Enviar denúncia") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(reason, { reason = it.take(500) }, enabled = !busy,
                    label = { Text("Motivo da denúncia") })
                if (error) Text("Não foi possível enviar a denúncia.", color = MaterialTheme.colorScheme.error)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && reason.trim().length >= 5, onClick = {
                busy = true
                error = false
                db.collection("feed_reports").document().set(mapOf(
                    "reporterUid" to uid, "targetUid" to targetUid,
                    "targetId" to target.id, "targetType" to type, "commentId" to comment?.id.orEmpty(),
                    "title" to when (type) {
                        "channel" -> target.getString("name").orEmpty()
                        "comment" -> ""
                        else -> target.getString("title").orEmpty()
                    },
                    "body" to when (type) {
                        "channel" -> target.getString("description").orEmpty()
                        "comment" -> comment?.getString("body").orEmpty()
                        else -> target.getString("body").orEmpty()
                    },
                    "reason" to reason.trim(), "status" to "pending",
                    "createdAt" to FieldValue.serverTimestamp(),
                )).addOnCompleteListener {
                    busy = false
                    if (it.isSuccessful) { sent = true; open = false } else error = true
                }
            }) { Text("Enviar") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { open = false }) { Text("Cancelar") } },
    )
}

@Composable
internal fun FeedNotices(db: FirebaseFirestore, uid: String, unreadOnly: Boolean, onOpen: (String) -> Unit) {
    val notices = db.collection("feed_notices").document(uid).collection("items")
        .orderBy("createdAt", Query.Direction.DESCENDING)
    val page = feedPageForConversation(notices, uid)
    for (notice in page.documents.filter { !unreadOnly || it.getBoolean("read") == false }) {
        val postId = notice.getString("postId") ?: continue
        val post = feedDocument(db, "feed_posts", postId)
        if (post?.getBoolean("published") != true) continue
        TextButton(onClick = {
            if (notice.getBoolean("read") == false) notice.reference.update("read", true)
            onOpen(postId)
        }) {
            Text(if (notice.getString("kind") == "reply") "Responderam ao seu comentário"
                else "Comentaram na sua publicação")
        }
    }
    if (page.failed) Text("Não foi possível carregar os avisos do feed.", color = MaterialTheme.colorScheme.error)
}

@Composable
internal fun FeedReportsAdminPanel(db: FirebaseFirestore, uid: String) {
    val page = feedPageForConversation(db.collection("feed_reports").whereEqualTo("status", "pending"), uid)
    if (page.documents.isEmpty()) return
    Text("Denúncias do feed", style = MaterialTheme.typography.titleLarge)
    for (report in page.documents) {
        Text(when (report.getString("targetType")) {
            "post" -> "Publicação"
            "comment" -> "Comentário"
            else -> "Canal"
        }, style = MaterialTheme.typography.titleMedium)
        report.getString("title")?.takeIf { it.isNotBlank() }?.let { Text(it) }
        report.getString("body")?.takeIf { it.isNotBlank() }?.let { Text(it) }
        Text(report.getString("reason").orEmpty(), color = MaterialTheme.colorScheme.onSurfaceVariant)
        var busy by remember(report.id, uid) { mutableStateOf(false) }
        var error by remember(report.id, uid) { mutableStateOf(false) }
        TextButton(enabled = !busy, onClick = {
            busy = true
            report.reference.update(mapOf(
                "status" to "reviewed", "reviewedBy" to uid, "reviewedAt" to FieldValue.serverTimestamp(),
            )).addOnCompleteListener {
                busy = false
                error = !it.isSuccessful
            }
        }) { Text("Marcar como analisada") }
        if (error) Text("Não foi possível registrar a análise.", color = MaterialTheme.colorScheme.error)
    }
}

private data class FeedConversationPage(
    val documents: List<DocumentSnapshot> = emptyList(),
    val failed: Boolean = false,
)

@Composable
private fun feedPageForConversation(query: Query, uid: String): FeedConversationPage {
    var page by remember(query, uid) { mutableStateOf(FeedConversationPage()) }
    var limit by remember(query, uid) { mutableStateOf(30L) }
    DisposableEffect(query, uid, limit) {
        val registration = query.limit(limit).addSnapshotListener(MetadataChanges.INCLUDE) { result, error ->
            page = FeedConversationPage(
                result?.takeUnless { it.metadata.isFromCache }?.documents.orEmpty(),
                error != null,
            )
        }
        onDispose { registration.remove() }
    }
    if (page.documents.size.toLong() >= limit) {
        TextButton(onClick = { limit += 30 }) { Text("Carregar mais") }
    }
    return page
}
