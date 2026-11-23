package br.com.atriocatolico

import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.Blob
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Source
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ProfilePublicationComposer(
    db: FirebaseFirestore,
    uid: String,
    destination: String = "timeline",
) {
    var open by rememberSaveable(uid, destination) { mutableStateOf(false) }
    var target by rememberSaveable(uid, destination) { mutableStateOf(destination) }
    var question by rememberSaveable(uid, destination) { mutableStateOf(false) }
    var title by rememberSaveable(uid, destination) { mutableStateOf("") }
    var body by rememberSaveable(uid, destination) { mutableStateOf("") }
    var image by remember(uid, destination) { mutableStateOf<Blob?>(null) }
    var draftId by rememberSaveable(uid, destination) { mutableStateOf<String?>(null) }
    var busy by remember(uid, destination) { mutableStateOf(false) }
    var notice by remember(uid, destination) { mutableStateOf("") }
    var channelError by remember(uid, destination) { mutableStateOf(false) }
    var channelAttempt by remember(uid, destination) { mutableStateOf(0) }
    var creatingChannel by rememberSaveable(uid, destination) { mutableStateOf(false) }

    if (!open) {
        Button(onClick = { open = true }) { Text("Publicar") }
        if (notice.isNotBlank()) Text(notice)
        return
    }

    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val channel = remember(db, uid) { db.document("feed_channels/$uid") }
    var channelSnapshot by remember(channel) { mutableStateOf<DocumentSnapshot?>(null) }
    DisposableEffect(channel, channelAttempt) {
        channelError = false
        val listener = channel.addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
            if (snapshot != null && !snapshot.metadata.isFromCache && !snapshot.metadata.hasPendingWrites()) {
                channelSnapshot = snapshot
            } else if (error != null || snapshot?.metadata?.isFromCache == true) {
                channelSnapshot = null
            }
            channelError = error != null
        }
        onDispose { listener.remove() }
    }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            busy = true
            notice = ""
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching {
                        val source = ProfilePhotoStore.decodeSelection(context, uri)
                        val cropped = ProfilePhotoStore.crop(source, 1f, 0f, 0f)
                        Blob.fromBytes(ProfilePhotoStore.encodeUpload(cropped))
                    }
                }
                busy = false
                result.onSuccess { image = it }
                    .onFailure { notice = "Não foi possível preparar a imagem." }
            }
        }
    }

    val selectedChannel = channelSnapshot
    val canPublish = target == "timeline" || selectedChannel?.exists() == true
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Destino", style = MaterialTheme.typography.titleMedium)
        FilterChip(selected = target == "timeline", onClick = { target = "timeline" },
            enabled = !busy, label = { Text("Linha do tempo • Amigos") })
        FilterChip(selected = target == "channel", onClick = { target = "channel" },
            enabled = !busy, label = { Text("Canal • Todos no Átrio") })
        if (target == "channel" && !canPublish) {
            when {
                channelError -> OutlinedButton(onClick = { channelAttempt++ }) {
                    Text("Tentar carregar o canal novamente")
                }
                selectedChannel == null -> Text("Consultando o canal…")
                creatingChannel -> ChannelEditor(channel, selectedChannel, onClose = { creatingChannel = false })
                else -> OutlinedButton(onClick = { creatingChannel = true }) { Text("Criar canal") }
            }
        }

        Text("Formato", style = MaterialTheme.typography.titleMedium)
        FilterChip(selected = !question, onClick = { question = false },
            enabled = !busy, label = { Text("Publicação") })
        FilterChip(selected = question, onClick = { question = true },
            enabled = !busy, label = { Text("Pergunta") })

        OutlinedTextField(title, { title = it.take(140) },
            label = { Text(if (question) "Pergunta" else "Título opcional") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth())
        OutlinedTextField(body, { body = it.take(8000) },
            label = { Text(if (question) "Contexto opcional" else "Texto") },
            enabled = !busy, modifier = Modifier.fillMaxWidth())
        FeedThumbnail(image)
        OutlinedButton(enabled = !busy, onClick = {
            picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
        }) { Text("Adicionar imagem") }
        if (image != null) {
            TextButton(enabled = !busy, onClick = { image = null }) { Text("Remover imagem") }
        }
        Text(if (target == "timeline") "Seus amigos poderão ver esta publicação."
            else "Todos no Átrio poderão ver esta publicação.",
            color = MaterialTheme.colorScheme.onSurfaceVariant)

        Button(enabled = canPublish && !busy && if (question) title.isNotBlank() else body.isNotBlank(),
            onClick = {
                val posts = db.collection("feed_posts")
                val ref = draftId?.let(posts::document) ?: posts.document()
                val attachment = image
                val data = mapOf(
                    "authorUid" to uid,
                    "destination" to target,
                    "format" to if (question) "question" else "post",
                    "title" to title.trim(),
                    "body" to body.trim(),
                    "published" to true,
                    "hasImage" to (attachment != null),
                )
                draftId = ref.id
                busy = true
                notice = ""
                val media = ref.collection("media").document("image")
                val batch = db.batch().set(ref, data + ("createdAt" to FieldValue.serverTimestamp()))
                if (attachment != null) {
                    batch.set(media, mapOf("contentType" to "image/jpeg", "bytes" to attachment))
                }
                fun finish(saved: Boolean) {
                    busy = false
                    notice = if (saved) "Publicação enviada." else "Não foi possível publicar. Seu rascunho foi preservado."
                    if (saved) {
                        draftId = null
                        title = ""
                        body = ""
                        image = null
                        open = false
                    }
                }
                batch.commit().addOnCompleteListener { result ->
                    if (result.isSuccessful) finish(true)
                    else ref.get(Source.SERVER).addOnCompleteListener { read ->
                        val previous = if (read.isSuccessful) read.result else null
                        if (previous?.exists() != true) finish(false)
                        else if (data.any { (field, value) -> previous.get(field) != value }) {
                            draftId = null
                            finish(false)
                            notice = "O envio anterior já foi publicado. Seu rascunho atual foi preservado."
                        } else if (attachment == null) finish(true)
                        else media.get(Source.SERVER).addOnCompleteListener { check ->
                            val existingImage = if (check.isSuccessful) check.result?.getBlob("bytes") else null
                            finish(existingImage == attachment)
                            if (existingImage != null && existingImage != attachment) {
                                draftId = null
                                notice = "A imagem anterior já foi publicada. Seu rascunho atual foi preservado."
                            }
                        }
                    }
                }
            },
        ) { Text(if (busy) "Publicando…" else "Publicar") }
        TextButton(enabled = !busy, onClick = { open = false }) { Text("Fechar editor") }
        if (notice.isNotBlank()) Text(notice, color = MaterialTheme.colorScheme.error)
    }
}
