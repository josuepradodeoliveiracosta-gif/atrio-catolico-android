package br.com.atriocatolico

import android.graphics.Bitmap
import androidx.activity.compose.rememberLauncherForActivityResult
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
    if (uid.isNotBlank() && current?.ownerUid == uid && current.bitmap != null) {
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

/** Editor que já funciona offline. O upload público é bloqueado até haver regras aprovadas. */
@Composable
internal fun ProfilePhotoManager(
    uid: String,
    onChanged: () -> Unit
) {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    var open by rememberSaveable(uid) { mutableStateOf(false) }
    var source by remember(uid) { mutableStateOf<Bitmap?>(null) }
    var zoom by remember(uid) { mutableFloatStateOf(1f) }
    var x by remember(uid) { mutableFloatStateOf(0f) }
    var y by remember(uid) { mutableFloatStateOf(0f) }
    var busy by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf("") }
    var removeConfirm by remember(uid) { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        if (uri != null) {
            busy = true
            error = ""
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
    OutlinedButton(onClick = { error = ""; open = true },
        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-photo-manage")) {
        Text("Gerenciar foto de perfil")
    }
    if (open) {
        AlertDialog(
            onDismissRequest = { if (!busy) { open = false; source = null } },
            title = { Text("Foto de perfil") },
            text = {
                Column(
                    modifier = Modifier.heightIn(max = 440.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(12.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text("Sua foto fica privada neste aparelho por enquanto. " +
                        "A sincronização entre contas depende de armazenamento e regras ainda não publicados.",
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
                    if (busy) LinearProgressIndicator(Modifier.fillMaxWidth())
                    if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall)
                    OutlinedButton(onClick = { picker.launch("image/*") }, enabled = !busy,
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-photo-picker")) {
                        Text(if (source == null) "Escolher foto da galeria" else "Escolher outra foto")
                    }
                    TextButton(onClick = { removeConfirm = true }, enabled = !busy,
                        modifier = Modifier.testTag("atrio-profile-photo-remove")) {
                        Text("Remover foto deste aparelho")
                    }
                }
            },
            confirmButton = {
                val selected = source
                if (selected != null) {
                    TextButton(onClick = {
                        busy = true
                        error = ""
                        scope.launch {
                            val result = withContext(Dispatchers.IO) {
                                runCatching {
                                    val cropped = ProfilePhotoStore.crop(selected, zoom, x, y)
                                    ProfilePhotoStore.save(context, uid, cropped)
                                }
                            }
                            busy = false
                            result.onSuccess {
                                source = null
                                open = false
                                onChanged()
                            }.onFailure {
                                error = it.message ?: "Não foi possível salvar a foto."
                            }
                        }
                    }, enabled = !busy, modifier = Modifier.testTag("atrio-profile-photo-save")) {
                        Text("Salvar no aparelho")
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
            text = { Text("A foto salva neste aparelho será apagada. Seu avatar voltará à inicial do nome.") },
            confirmButton = {
                TextButton(enabled = !busy, onClick = {
                    busy = true
                    scope.launch {
                        val ok = withContext(Dispatchers.IO) { ProfilePhotoStore.remove(context, uid) }
                        busy = false
                        removeConfirm = false
                        if (ok) {
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
