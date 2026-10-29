package br.com.atriocatolico

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.launch

/** Moderação humana: o servidor revalida a permissão em todas as ações. */
@Composable
internal fun AvatarModerationPanel(actorUid: String) {
    val scope = rememberCoroutineScope()
    var revision by remember(actorUid) { mutableIntStateOf(0) }
    var loading by remember(actorUid) { mutableStateOf(true) }
    var busy by remember(actorUid) { mutableStateOf(false) }
    var error by remember(actorUid) { mutableStateOf("") }
    var feedback by remember(actorUid) { mutableStateOf("") }
    var photos by remember(actorUid) {
        mutableStateOf<List<CloudinaryAvatarClient.PendingAvatar>>(emptyList())
    }
    var selected by remember(actorUid) {
        mutableStateOf<CloudinaryAvatarClient.PendingAvatar?>(null)
    }
    var approving by remember(actorUid) { mutableStateOf(false) }
    var reason by remember(actorUid) { mutableStateOf("") }

    LaunchedEffect(actorUid, revision) {
        loading = true
        error = ""
        runCatching { CloudinaryAvatarClient.moderationPending(actorUid) }
            .onSuccess { photos = it }
            .onFailure { error = it.message ?: "Falha ao consultar fotos pendentes." }
        loading = false
    }
    Card(Modifier.fillMaxWidth().testTag("atrio-avatar-moderation-panel")) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Text("Fotos aguardando moderação", style = MaterialTheme.typography.titleMedium, color = Wine)
            Text("Analise cada imagem antes de aprovar ou rejeitar. Somente administradores autorizados podem decidir; as ações são registradas.",
                style = MaterialTheme.typography.bodySmall, color = Muted)
            OutlinedButton(onClick = { revision++ }, enabled = !loading && !busy,
                modifier = Modifier.testTag("atrio-avatar-moderation-refresh")) {
                Text("Atualizar fila")
            }
            if (loading) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error.isNotBlank())
                Text(error, color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("atrio-avatar-moderation-error"))
            if (feedback.isNotBlank()) Text(feedback, color = Wine)
            if (!loading && error.isBlank() && photos.isEmpty())
                Text("Nenhuma foto aguardando análise.", color = Muted)
            photos.forEach { photo ->
                key(photo.uid, photo.revision) {
                    AvatarReviewCard(actorUid, photo, busy) { approve ->
                        approving = approve
                        selected = photo
                        reason = if (approve) "Foto adequada para publicação" else ""
                    }
                }
            }
        }
    }
    val target = selected
    if (target != null) AlertDialog(
        onDismissRequest = { if (!busy) selected = null },
        title = { Text(if (approving) "Aprovar foto?" else "Rejeitar foto?") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (approving) "A foto será aprovada e publicada para a comunidade."
                    else "A foto será rejeitada e não será publicada.")
                OutlinedTextField(value = reason, onValueChange = { reason = it.take(100) },
                    label = { Text("Motivo da decisão") }, minLines = 2, maxLines = 3,
                    enabled = !busy, modifier = Modifier.fillMaxWidth()
                        .testTag("atrio-avatar-moderation-reason"))
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && reason.trim().length in 5..100,
                onClick = {
                    busy = true
                    scope.launch {
                        val outcome = runCatching {
                            CloudinaryAvatarClient.moderationReview(
                                actorUid, target.uid, target.revision, approving, reason)
                        }
                        busy = false
                        selected = null
                        outcome.onSuccess { state ->
                            feedback = when(state) {
                                "published" -> "Foto aprovada e publicada."
                                "rejected" -> "Foto rejeitada pela moderação."
                                "pending_moderation" -> "Decisão registrada; publicação ainda pendente."
                                else -> "Decisão recebida: $state"
                            }
                            revision++
                        }.onFailure {
                            error = it.message ?: "Não foi possível concluir a decisão."
                            revision++
                        }
                    }
                }, modifier = Modifier.testTag("atrio-avatar-moderation-confirm")) {
                Text(if (busy) "Processando..." else if (approving) "Confirmar aprovação"
                    else "Confirmar rejeição")
            }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = { selected = null }) { Text("Cancelar") }
        }
    )
}

@Composable
private fun AvatarReviewCard(
    actorUid: String, photo: CloudinaryAvatarClient.PendingAvatar, busy: Boolean,
    onDecision: (Boolean) -> Unit
) {
    var bitmap by remember(photo.uid, photo.revision) { mutableStateOf<ImageBitmap?>(null) }
    var previewLoading by remember(photo.uid, photo.revision) { mutableStateOf(true) }
    LaunchedEffect(actorUid, photo.uid, photo.revision, photo.status) {
        previewLoading = photo.status == "pending"
        if (photo.status == "pending")
            bitmap = runCatching {
                CloudinaryAvatarClient.moderationPreview(actorUid, photo.uid, photo.revision)?.asImageBitmap()
            }.getOrNull()
        previewLoading = false
    }
    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surface) {
        Column(Modifier.fillMaxWidth().padding(12.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp),
            horizontalAlignment = Alignment.Start) {
            Text("Conta: ${photo.uid}", style = MaterialTheme.typography.bodySmall)
            if (photo.status == "approved") {
                Text("Aprovada; publicação pendente. Confirme novamente.",
                    color = Wine, style = MaterialTheme.typography.bodySmall)
            } else if (bitmap != null) {
                Image(bitmap = bitmap!!, contentDescription = "Foto enviada para análise",
                    modifier = Modifier.size(150.dp), contentScale = ContentScale.Crop)
            } else {
                Text(if (previewLoading) "Carregando prévia protegida..."
                     else "Prévia indisponível. Não aprove sem analisar a imagem.",
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = { onDecision(true) },
                    enabled = !busy && !previewLoading &&
                        (bitmap != null || photo.status == "approved"),
                    modifier = Modifier.testTag("atrio-avatar-moderation-approve")) {
                    Text("Aprovar")
                }
                if (photo.status == "pending") OutlinedButton(onClick = { onDecision(false) },
                    enabled = !busy, modifier = Modifier.testTag("atrio-avatar-moderation-reject")) {
                    Text("Rejeitar")
                }
            }
        }
    }
}
