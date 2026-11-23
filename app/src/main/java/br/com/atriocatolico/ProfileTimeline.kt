package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source

@Composable
internal fun ProfileTimeline(db: FirebaseFirestore, ownerUid: String, viewerUid: String) {
    val own = ownerUid == viewerUid
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Linha do tempo", style = MaterialTheme.typography.titleLarge)
        if (own) {
            ProfilePublicationComposer(db, ownerUid)
            ProfilePublications(db, ownerUid, viewerUid)
        } else {
            TimelineFriendship(db, ownerUid, viewerUid)
        }
    }
}

@Composable
private fun TimelineFriendship(db: FirebaseFirestore, ownerUid: String, viewerUid: String) {
    val outgoing = remember(db, ownerUid, viewerUid) {
        db.document("feed_friendships/$viewerUid/peers/$ownerUid")
    }
    val incoming = remember(db, ownerUid, viewerUid) {
        db.document("feed_friendships/$ownerUid/peers/$viewerUid")
    }
    var sent by remember(outgoing) { mutableStateOf<String?>(null) }
    var received by remember(incoming) { mutableStateOf<String?>(null) }
    var busy by remember(outgoing, incoming) { mutableStateOf(false) }
    var error by remember(outgoing, incoming) { mutableStateOf(false) }
    var attempt by remember(outgoing, incoming) { mutableStateOf(0) }

    DisposableEffect(outgoing, incoming, attempt) {
        sent = null
        received = null
        val sentListener = outgoing.addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
            sent = if (failure == null && snapshot != null && !snapshot.metadata.isFromCache) {
                snapshot.getString("status").orEmpty()
            } else null
            if (failure != null) error = true
        }
        val receivedListener = incoming.addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
            received = if (failure == null && snapshot != null && !snapshot.metadata.isFromCache) {
                snapshot.getString("status").orEmpty()
            } else null
            if (failure != null) error = true
        }
        onDispose {
            sentListener.remove()
            receivedListener.remove()
        }
    }

    val accepted = sent == "accepted" || received == "accepted"
    if (accepted) ProfilePublications(db, ownerUid, viewerUid)
    else Text("As publicações da linha do tempo são visíveis aos amigos.",
        color = MaterialTheme.colorScheme.onSurfaceVariant)

    if (sent != null && received != null) {
        OutlinedButton(
            enabled = !busy,
            onClick = {
                busy = true
                error = false
                val task = when {
                    sent == "accepted" || sent == "pending" -> outgoing.delete()
                    received == "accepted" -> incoming.delete()
                    received == "pending" -> incoming.update("status", "accepted")
                    else -> outgoing.set(mapOf("status" to "pending", "createdAt" to FieldValue.serverTimestamp()))
                }
                task.addOnCompleteListener {
                    busy = false
                    error = !it.isSuccessful
                }
            }
        ) {
            Text(when {
                accepted -> "Encerrar amizade"
                sent == "pending" -> "Cancelar convite"
                received == "pending" -> "Aceitar amizade"
                else -> "Adicionar amigo"
            })
        }
    }
    if (error) {
        Text("Não foi possível atualizar a amizade. Confira a conexão.",
            color = MaterialTheme.colorScheme.error)
        if (sent == null || received == null) {
            OutlinedButton(onClick = { error = false; attempt++ }) { Text("Tentar novamente") }
        }
    }
}

@Composable
internal fun ProfilePublications(
    db: FirebaseFirestore,
    ownerUid: String,
    viewerUid: String,
    destination: String = "timeline",
) {
    var entries by remember(db, ownerUid, viewerUid, destination) { mutableStateOf<List<DocumentSnapshot>>(emptyList()) }
    var loading by remember(db, ownerUid, viewerUid, destination) { mutableStateOf(true) }
    var failed by remember(db, ownerUid, viewerUid, destination) { mutableStateOf(false) }
    var limit by rememberSaveable(ownerUid, viewerUid, destination) { mutableStateOf(10L) }
    var attempt by remember(db, ownerUid, viewerUid, destination) { mutableStateOf(0) }
    DisposableEffect(db, ownerUid, viewerUid, destination, limit, attempt) {
        loading = true
        failed = false
        val listener = db.collection("feed_posts")
            .whereEqualTo("published", true)
            .whereEqualTo("destination", destination)
            .whereEqualTo("authorUid", ownerUid)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(limit)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
                val serverConfirmed = snapshot != null && !snapshot.metadata.isFromCache
                entries = if (serverConfirmed) snapshot?.documents.orEmpty() else emptyList()
                loading = !serverConfirmed && failure == null
                failed = failure != null
            }
        onDispose { listener.remove() }
    }
    for (entry in entries) {
        Card(Modifier.fillMaxWidth()) {
            Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (entry.getString("format") == "question") {
                    Text("Pergunta", style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.primary)
                }
                entry.getString("title")?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.titleMedium)
                }
                entry.getString("body")?.takeIf { it.isNotBlank() }?.let {
                    Text(it, style = MaterialTheme.typography.bodyMedium)
                }
            }
        }
    }
    when {
        failed -> {
            Text("Não foi possível carregar as publicações.", color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { attempt++ }) { Text("Tentar novamente") }
        }
        loading -> Text("Carregando publicações…")
        entries.isEmpty() -> Text(
            if (destination == "timeline") "Ainda não há publicações na linha do tempo."
            else if (ownerUid == viewerUid) "Crie sua primeira publicação no canal."
            else "Este canal ainda não publicou."
        )
        entries.size.toLong() >= limit -> OutlinedButton(onClick = { limit += 10 }) {
            Text("Carregar mais publicações")
        }
    }
}

@Composable
internal fun ProfilePublicationComposer(
    db: FirebaseFirestore,
    uid: String,
    destination: String = "timeline",
) {
    var body by rememberSaveable(uid, destination) { mutableStateOf("") }
    var draftId by rememberSaveable(uid, destination) { mutableStateOf<String?>(null) }
    var sending by remember(db, uid, destination) { mutableStateOf(false) }
    var failed by remember(db, uid, destination) { mutableStateOf(false) }
    OutlinedTextField(
        value = body,
        onValueChange = { body = it.take(8000); failed = false },
        enabled = !sending,
        label = { Text("Escreva uma publicação") },
        supportingText = { Text(if (destination == "timeline") "Visível para seus amigos." else "Visível para todos no Átrio.") },
        modifier = Modifier.fillMaxWidth().testTag("atrio-$destination-draft"),
    )
    Button(
        enabled = body.isNotBlank() && !sending,
        onClick = {
            val posts = db.collection("feed_posts")
            val ref = draftId?.let(posts::document) ?: posts.document()
            draftId = ref.id
            val content = body.trim()
            sending = true
            failed = false
            fun finish(sent: Boolean) {
                sending = false
                failed = !sent
                if (sent) {
                    body = ""
                    draftId = null
                }
            }
            ref.set(mapOf(
                "authorUid" to uid,
                "destination" to destination,
                "format" to "post",
                "body" to content,
                "published" to true,
                "createdAt" to FieldValue.serverTimestamp(),
            )).addOnCompleteListener { result ->
                if (result.isSuccessful) finish(true)
                else ref.get(Source.SERVER).addOnCompleteListener { read ->
                    val saved = if (read.isSuccessful) read.result else null
                    finish(saved != null && saved.getString("authorUid") == uid
                        && saved.getString("destination") == destination && saved.getString("body") == content)
                }
            }
        },
        modifier = Modifier.testTag("atrio-$destination-publish"),
    ) { Text(if (sending) "Publicando…" else if (destination == "timeline") "Publicar na linha do tempo" else "Publicar no canal") }
    if (failed) Text("Não foi possível publicar. Seu texto foi preservado.",
        color = MaterialTheme.colorScheme.error)
}
