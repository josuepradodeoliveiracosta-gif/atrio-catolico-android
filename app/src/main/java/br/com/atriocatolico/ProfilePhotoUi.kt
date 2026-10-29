package br.com.atriocatolico

import android.graphics.Bitmap
import android.widget.Toast
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.Image
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/** Foto do usuário autenticado: nunca reutilizar entre contas. */
internal data class LocalAvatarState(val ownerUid: String, val bitmap: ImageBitmap?)
internal val LocalProfileAvatar = compositionLocalOf<LocalAvatarState?> { null }

@Composable
internal fun MemberAvatar(name: String, uid: String, modifier: Modifier = Modifier.size(40.dp)) {
    val current = LocalProfileAvatar.current
    val remote = rememberPublicAvatar(uid)
    if (remote != null) {
        Image(remote, contentDescription = "Foto de " + name,
            contentScale = ContentScale.Crop, modifier = modifier.clip(CircleShape))
    } else if (uid.isNotBlank() && current?.ownerUid == uid && current.bitmap != null) {
        Image(
            bitmap = current.bitmap,
            contentDescription = "Foto de " + name,
            contentScale = ContentScale.Crop,
            modifier = modifier.clip(CircleShape)
        )
    } else {
        Avatar(name, modifier)
    }
}

/** Editor local e público: upload só aparece quando o Worker seguro estiver configurado. */
@Composable
internal fun ProfilePhotoManager(
    uid: String,
    onChanged: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val publicEnabled = CloudinaryAvatarClient.enabled
    var open by rememberSaveable(uid) { mutableStateOf(false) }
    var source by remember(uid) { mutableStateOf<Bitmap?>(null) }
    var zoom by remember(uid) { mutableFloatStateOf(1f) }
    var x by remember(uid) { mutableFloatStateOf(0f) }
    var y by remember(uid) { mutableFloatStateOf(0f) }
    var busy by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf("") }
    var notice by remember(uid) { mutableStateOf("") }
    var removeConfirm by remember(uid) { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            busy = true
            error = ""
            notice = ""
            scope.launch {
                val result = withContext(Dispatchers.IO) {
                    runCatching { ProfilePhotoStore.decodeSelection(context, uri) }
                }
                busy = false
                result.onSuccess {
                    source = it
                    zoom = 1f
                    x = 0f
                    y = 0f
                    open = true
                }.onFailure {
                    error = it.message ?: "Não foi possível abrir a imagem."
                    open = true
                }
            }
        }
    }
    OutlinedButton(onClick = { error = ""; notice = ""; open = true },
        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-photo-manage")) {
        Text("Gerenciar foto de perfil")
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { if (!busy) { open = false; source = null } },
            title = { Text("Foto de perfil") },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 440.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    // Status FIXO: não fica escondido sob os controles de recorte.
                    if (busy) {
                        LinearProgressIndicator(Modifier.fillMaxWidth()
                            .testTag("atrio-profile-photo-upload-progress"))
                        Text("Enviando foto, aguarde...",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    if (error.isNotBlank()) {
                        Text(error, color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.testTag("atrio-profile-photo-upload-error"))
                    }
                    if (notice.isNotBlank()) {
                        Text(notice, color = MaterialTheme.colorScheme.primary,
                            style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.testTag("atrio-profile-photo-upload-notice"))
                    }
                    Column(
                        modifier = Modifier.verticalScroll(rememberScrollState()),
                        verticalArrangement = Arrangement.spacedBy(12.dp),
                        horizontalAlignment = Alignment.CenterHorizontally
                    ) {
                    Text(if (publicEnabled)
                        "Sua foto poderá ser vista por todos os participantes. Ela será publicada somente depois da aprovação da moderação. A URL pública poderá ser acessada fora do Átrio."
                        else "A foto fica apenas neste aparelho. O serviço de fotos públicas ainda não está configurado.",
                        style = MaterialTheme.typography.bodySmall)
                    source?.let { selected ->
                        val cropped = remember(selected, zoom, x, y) {
                            ProfilePhotoStore.crop(selected, zoom, x, y).asImageBitmap()
                        }
                        Image(cropped, "Prévia do recorte da foto", contentScale = ContentScale.Crop,
                            modifier = Modifier.size(148.dp).clip(CircleShape)
                                .testTag("atrio-profile-photo-preview"))
                        Text("Ajustar zoom", style = MaterialTheme.typography.labelMedium)
                        Slider(value = zoom, onValueChange = { zoom = it }, valueRange = 1f..3f,
                            enabled = !busy)
                        Text("Mover na horizontal", style = MaterialTheme.typography.labelMedium)
                        Slider(value = x, onValueChange = { x = it }, valueRange = -1f..1f,
                            enabled = !busy)
                        Text("Mover na vertical", style = MaterialTheme.typography.labelMedium)
                        Slider(value = y, onValueChange = { y = it }, valueRange = -1f..1f,
                            enabled = !busy)
                    }
                    OutlinedButton(onClick = { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-photo-picker")) {
                        Text(if (source == null) "Escolher foto da galeria" else "Escolher outra foto")
                    }
                    if (publicEnabled) OutlinedButton(onClick = {
                        busy = true; error = ""
                        scope.launch {
                            val result = runCatching { CloudinaryAvatarClient.status(uid) }
                            busy = false
                            result.onSuccess { state ->
                                error = when (state) {
                                    "published" -> "Sua foto foi aprovada e publicada."
                                    "pending_moderation" -> "Sua foto ainda aguarda aprovação."
                                    "rejected" -> "A foto foi rejeitada pela moderação."
                                    else -> "Nenhuma nova foto aguardando aprovação."
                                }
                                if (state == "published") {
                                    withContext(Dispatchers.IO) { ProfilePhotoStore.remove(context, uid) }
                                    onChanged()
                                }
                            }.onFailure { error = it.message ?: "Não foi possível verificar." }
                        }
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()
                        .testTag("atrio-profile-photo-status")) { Text("Verificar aprovação da foto") }
                    TextButton(onClick = { removeConfirm = true }, enabled = !busy,
                        modifier = Modifier.testTag("atrio-profile-photo-remove")) {
                        Text(if (publicEnabled) "Remover foto pública" else "Remover foto deste aparelho")
                    }
                    }
                }
            },
            confirmButton = {
                val selected = source
                if (selected != null) {
                    TextButton(onClick = {
                        if (busy) return@TextButton
                        busy = true
                        error = ""
                        notice = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                runCatching {
                                    val cropped = ProfilePhotoStore.crop(selected, zoom, x, y)
                                    if (publicEnabled) CloudinaryAvatarClient.upload(uid, cropped)
                                    else { ProfilePhotoStore.save(context, uid, cropped); "saved_local" }
                                }
                            }
                            busy = false
                            result.onSuccess { state ->
                                source = null
                                if (state == "pending_moderation") {
                                    notice = "Foto recebida! Aguarde a aprovação da moderação."
                                    Toast.makeText(context, "Foto enviada para aprovação.", Toast.LENGTH_LONG).show()
                                } else {
                                    open = false
                                    if (state == "published") ProfilePhotoStore.remove(context, uid)
                                    Toast.makeText(context, "Foto salva com sucesso.", Toast.LENGTH_SHORT).show()
                                }
                                onChanged()
                            }.onFailure {
                                error = it.message ?: "Não foi possível enviar a foto."
                                Toast.makeText(context, "Falha ao enviar: " + error, Toast.LENGTH_LONG).show()
                            }
                        }
                    }, enabled = !busy, modifier = Modifier.testTag("atrio-profile-photo-save")) {
                        Text(if (busy) "Enviando..." else if (publicEnabled) "Enviar foto para aprovação" else "Salvar no aparelho")
                    }
                }
            },
            dismissButton = {
                TextButton(onClick = { open = false; source = null }, enabled = !busy) {
                    Text("Fechar")
                }
            }
        )
    }
    if (removeConfirm) {
        AlertDialog(
            onDismissRequest = { if (!busy) removeConfirm = false },
            title = { Text("Remover foto?") },
            text = { Text(if (publicEnabled) "Sua foto pública será removida para todos os participantes. Seu avatar voltará à inicial do nome."
                else "A foto salva neste aparelho será apagada. Seu avatar voltará à inicial do nome.") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        val result = runCatching {
                            if (publicEnabled) CloudinaryAvatarClient.remove(uid)
                            withContext(Dispatchers.IO) { check(ProfilePhotoStore.remove(context, uid)) }
                        }
                        busy = false
                        removeConfirm = false
                        if (result.isSuccess) {
                            source = null
                            open = false
                            onChanged()
                        } else error = "Não foi possível remover a foto. Tente novamente."
                    }
                }, modifier = Modifier.testTag("atrio-profile-photo-remove-confirm")) {
                    Text("Remover")
                }
            },
            dismissButton = { TextButton(onClick = { removeConfirm = false }) { Text("Cancelar") } }
        )
    }
}
