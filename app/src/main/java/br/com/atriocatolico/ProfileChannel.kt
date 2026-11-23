package br.com.atriocatolico

import android.graphics.BitmapFactory
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.Blob
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

@Composable
internal fun ProfileChannel(
    db: FirebaseFirestore,
    ownerUid: String,
    viewerUid: String,
    ownerName: String,
) {
    val own = ownerUid == viewerUid
    val channel = remember(db, ownerUid) { db.document("feed_channels/$ownerUid") }
    var snapshot by remember(channel, viewerUid) { mutableStateOf<DocumentSnapshot?>(null) }
    var failed by remember(channel, viewerUid) { mutableStateOf(false) }
    var attempt by remember(channel, viewerUid) { mutableStateOf(0) }
    var editing by rememberSaveable(ownerUid, viewerUid) { mutableStateOf(false) }
    DisposableEffect(channel, viewerUid, attempt) {
        failed = false
        val listener = channel.addSnapshotListener(MetadataChanges.INCLUDE) { result, error ->
            if (result != null && !result.metadata.hasPendingWrites()) {
                snapshot = result.takeUnless { it.metadata.isFromCache }
            } else if (error != null) {
                snapshot = null
            }
            failed = error != null
        }
        onDispose { listener.remove() }
    }
    val current = snapshot
    if (!own && current?.exists() != true) return

    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Canal", style = MaterialTheme.typography.titleLarge)
        when {
            failed -> {
                Text("Não foi possível carregar o canal.", color = MaterialTheme.colorScheme.error)
                OutlinedButton(onClick = { attempt++ }) { Text("Tentar novamente") }
            }
            current == null -> Text("Carregando canal…")
            own && editing -> ChannelEditor(channel, current, onClose = { editing = false })
            !current.exists() -> Button(onClick = { editing = true }) { Text("Criar canal") }
            else -> {
                FeedThumbnail(current.getBlob("imageJpeg"))
                Text(current.getString("name").orEmpty(), style = MaterialTheme.typography.titleMedium)
                if (ownerName.isNotBlank()) Text("Responsável: $ownerName",
                    color = MaterialTheme.colorScheme.onSurfaceVariant)
                current.getString("description")?.takeIf { it.isNotBlank() }?.let { Text(it) }
                if (own) {
                    OutlinedButton(onClick = { editing = true }) { Text("Editar canal") }
                    ProfilePublicationComposer(db, uid = ownerUid, destination = "channel")
                } else {
                    FollowChannel(db, viewerUid, ownerUid)
                }
                ProfilePublications(db, ownerUid, viewerUid, destination = "channel")
            }
        }
    }
}

@Composable
internal fun ChannelEditor(ref: DocumentReference, initial: DocumentSnapshot, onClose: () -> Unit) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var name by rememberSaveable(ref.path) { mutableStateOf(initial.getString("name").orEmpty()) }
    var description by rememberSaveable(ref.path) {
        mutableStateOf(initial.getString("description").orEmpty())
    }
    var image by remember(ref) { mutableStateOf(initial.getBlob("imageJpeg")) }
    var busy by remember(ref) { mutableStateOf(false) }
    var error by remember(ref) { mutableStateOf("") }
    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            busy = true
            error = ""
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
                    .onFailure { error = "Não foi possível preparar a imagem." }
            }
        }
    }

    OutlinedTextField(name, { name = it.take(80) }, label = { Text("Nome do canal") },
        singleLine = true, enabled = !busy, modifier = Modifier.fillMaxWidth())
    OutlinedTextField(description, { description = it.take(500) },
        label = { Text("Descrição opcional") }, enabled = !busy, modifier = Modifier.fillMaxWidth())
    FeedThumbnail(image)
    OutlinedButton(enabled = !busy, onClick = {
        picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly))
    }) { Text("Escolher imagem") }
    if (image != null) {
        TextButton(enabled = !busy, onClick = { image = null }) { Text("Remover imagem") }
    }
    Button(enabled = !busy && name.isNotBlank(), onClick = {
        busy = true
        error = ""
        val data = mutableMapOf<String, Any>(
            "name" to name.trim(),
            "description" to description.trim(),
            "updatedAt" to FieldValue.serverTimestamp(),
        )
        image?.let { data["imageJpeg"] = it }
        ref.set(data).addOnCompleteListener {
            busy = false
            if (it.isSuccessful) onClose()
            else error = "Não foi possível salvar. Confira a conexão e tente novamente."
        }
    }) { Text("Salvar canal") }
    TextButton(enabled = !busy, onClick = onClose) { Text("Cancelar") }
    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
}

@Composable
internal fun FeedThumbnail(image: Blob?) {
    if (image == null) return
    var bitmap by remember(image) { mutableStateOf<android.graphics.Bitmap?>(null) }
    LaunchedEffect(image) {
        bitmap = withContext(Dispatchers.IO) {
            val bytes = image.toBytes()
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
            if (bounds.outMimeType == "image/jpeg" && bounds.outWidth in 1..400 && bounds.outHeight in 1..400) {
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } else null
        }
    }
    bitmap?.let { Image(it.asImageBitmap(), contentDescription = null, modifier = Modifier.size(72.dp)) }
}

@Composable
private fun FollowChannel(db: FirebaseFirestore, viewerUid: String, ownerUid: String) {
    val ref = remember(db, viewerUid, ownerUid) { db.document("feed_following/$viewerUid/channels/$ownerUid") }
    var following by remember(ref) { mutableStateOf<Boolean?>(null) }
    var busy by remember(ref) { mutableStateOf(false) }
    var failed by remember(ref) { mutableStateOf(false) }
    var attempt by remember(ref) { mutableStateOf(0) }
    DisposableEffect(ref, attempt) {
        val listener = ref.addSnapshotListener(MetadataChanges.INCLUDE) { result, error ->
            following = result?.takeUnless { it.metadata.isFromCache }?.exists()
            if (error != null) failed = true
        }
        onDispose { listener.remove() }
    }
    following?.let { active ->
        OutlinedButton(enabled = !busy, onClick = {
            busy = true
            failed = false
            val task = if (active) ref.delete() else ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
            task.addOnCompleteListener {
                busy = false
                failed = !it.isSuccessful
            }
        }) { Text(if (active) "Deixar de seguir" else "Seguir canal") }
    }
    if (failed) {
        Text("Não foi possível atualizar os canais seguidos.", color = MaterialTheme.colorScheme.error)
        if (following == null) {
            TextButton(onClick = { failed = false; attempt++ }) { Text("Tentar novamente") }
        }
    }
}
