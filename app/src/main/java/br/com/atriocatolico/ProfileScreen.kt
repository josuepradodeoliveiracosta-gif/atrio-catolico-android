package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.outlined.ArrowForward
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.NotificationsNone
import androidx.compose.material.icons.outlined.VerifiedUser
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore

@Composable
internal fun OnlineProfileScreen(
    db: FirebaseFirestore, uid: String, name: String, email: String, biography: String,
    posts: List<Post>, publicationsFooter: @Composable () -> Unit,
    onSignOut: () -> Unit, onModeration: (() -> Unit)?, onClergyReview: (() -> Unit)?,
    onCreate: () -> Unit, onOpen: (String) -> Unit,
    onLike: (String) -> Unit, onSave: (String) -> Unit,
    onSavedPosts: () -> Unit, onNotifications: () -> Unit, onReviews: () -> Unit
) {
    var badgesOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var editorOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var publicationsOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var savedMessage by remember(uid) { mutableStateOf(false) }
    BackHandler(enabled = badgesOpen && !editorOpen) { badgesOpen = false }

    if (badgesOpen) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                TextButton(onClick = { badgesOpen = false }) { Text("Voltar ao perfil") }
                SectionTitle("Gerenciar selos")
                Text("Sua identificação na comunidade", color = Muted, fontSize = 13.sp)
            }
            item { MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { BadgeSettings(uid) }
            }
        }
    } else {
        val founderCanBroadcast = onModeration != null && onClergyReview != null &&
            LocalFounderUid.current.isNotBlank() && LocalFounderUid.current == uid
        val mine = remember(posts, uid) { posts.filter { it.mine } }
        LazyColumn(Modifier.fillMaxSize().testTag("atrio-profile-list"), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                ProfileSectionTitle("Meu perfil")
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Line)) {
                    Column(Modifier.fillMaxWidth().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (LocalFounderUid.current.isNotBlank() && LocalFounderUid.current == uid) {
                            FounderBadgeArt(Modifier.size(88.dp), compact = false)
                        } else {
                            Surface(shape = CircleShape, color = WineSoft, modifier = Modifier.size(76.dp)) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(name.trim().take(1).uppercase().ifBlank { "A" }, color = Wine,
                                        fontFamily = FontFamily.Serif, fontSize = 32.sp,
                                        fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                        Text(name, fontFamily = FontFamily.Serif, fontSize = 26.sp,
                            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true)
                        Text(biography.ifBlank { "Conte um pouco sobre sua caminhada na fé." },
                            color = Muted, fontSize = 14.sp, textAlign = TextAlign.Center)
                        Button(onClick = { savedMessage = false; editorOpen = true },
                            modifier = Modifier.fillMaxWidth().testTag("atrio-profile-edit")) { Text("Editar perfil") }
                        if (savedMessage) Text("Perfil atualizado.", color = Wine, fontSize = 14.sp,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                }
            }
            item {
                Card(onClick = { badgesOpen = true }, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-badges"),
                    colors = CardDefaults.cardColors(containerColor = WineSoft),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Meus selos", color = Wine, fontWeight = FontWeight.Bold)
                        Text("Escolha sua identificação e acompanhe verificações.", color = Muted, fontSize = 13.sp)
                        Text("Gerenciar selos →", color = Wine, fontSize = 13.sp)
                    }
                }
            }
            item {
                ProfileSectionTitle("Minha participação")
                Card(Modifier.fillMaxWidth()) {
                    ProfileAction("Publicações salvas", "Retome as discussões que você guardou.",
                        Icons.Outlined.BookmarkBorder, onSavedPosts)
                    HorizontalDivider()
                    ProfileAction("Minhas revisões", "Acompanhe suas revisões no Átrio Guardião.",
                        Icons.Outlined.VerifiedUser, onReviews)
                }
            }
            item {
                ProfileSectionTitle("Notificações")
                ProfileAction("Central de notificações", "Seus avisos e preferências por categoria.",
                    Icons.Outlined.NotificationsNone, onNotifications)
            }
            item { PushSettings(uid, db) }
            item {
                ProfileSectionTitle("Conta e privacidade")
                Card(Modifier.fillMaxWidth()) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text(email.ifBlank { "Conta autenticada" }, style = MaterialTheme.typography.bodyLarge)
                        Text("Seu e-mail e sua apresentação são privados. Seu nome e seus selos aparecem nas publicações.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        Text("Átrio Católico · ${BuildConfig.VERSION_NAME}", style = MaterialTheme.typography.labelMedium)
                        OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-signout")) {
                            Text("Sair da conta")
                        }
                    }
                }
            }
            if (onModeration != null || onClergyReview != null) item {
                HorizontalDivider(color = Line)
                Spacer(Modifier.height(16.dp))
                Text("Administração", fontWeight = FontWeight.Bold, color = Wine)
                onModeration?.let { action ->
                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) { Text("Denúncias") }
                }
                onClergyReview?.let { action ->
                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) { Text("Solicitações de selos") }
                }
            }
            // Somente o fundador que também é administrador vê a opção.
            if (founderCanBroadcast) item { AdminBroadcastPanel() }
            item {
                ProfileSectionTitle("Minhas publicações")
                Text("Esta lista mostra apenas suas publicações entre as discussões já carregadas; não é seu histórico completo.",
                    color = Muted, style = MaterialTheme.typography.bodyMedium)
                OutlinedButton(onClick = { publicationsOpen = !publicationsOpen },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-profile-publications")) {
                    Text(if (publicationsOpen) "Recolher publicações" else "Ver minhas publicações")
                }
            }
            if (publicationsOpen) {
                if (mine.isEmpty()) item {
                    Text("Nenhuma publicação sua nesta lista. Busque mais discussões ou inicie uma conversa.",
                        color = Muted, style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = onCreate) { Text("Criar discussão") }
                }
                items(mine, key = { "profile-post-${it.id}" }) { DiscussionCard(it, onOpen, onLike, onSave) }
                item { publicationsFooter() }
            }
        }
    }
    if (editorOpen) ProfileEditor(db, uid, name, biography,
        onClose = { editorOpen = false },
        onSaved = { editorOpen = false; savedMessage = true })
}

@Composable
private fun ProfileEditor(
    db: FirebaseFirestore, uid: String, name: String, biography: String,
    onClose: () -> Unit, onSaved: () -> Unit
) {
    ProfileEditorDialog(uid, name, biography, onClose, onSaved = onSaved, onSave = { newName, newBio, complete ->
        db.collection("profiles").document(uid).update(mapOf(
            "displayName" to newName, "bio" to newBio
        )).addOnCompleteListener { result -> complete(result.isSuccessful) }
    })
}

@Composable
internal fun ProfileEditorDialog(
    uid: String, name: String, biography: String,
    onClose: () -> Unit,
    onSave: (String, String, (Boolean) -> Unit) -> Unit,
    onSaved: () -> Unit = onClose
) {
    var draftName by rememberSaveable(uid) { mutableStateOf(name) }
    var draftBio by rememberSaveable(uid) { mutableStateOf(biography) }
    var busy by remember(uid) { mutableStateOf(false) }
    var failure by remember(uid) { mutableStateOf("") }
    var discardOpen by rememberSaveable(uid) { mutableStateOf(false) }
    val session = remember(uid) { ProfileEditorSession() }
    DisposableEffect(session) { onDispose { session.active = false } }
    val validName = draftName.trim().length in 2..35
    val changed = draftName.trim() != name || draftBio.trim() != biography
    fun closeEditor() {
        if (!busy) {
            if (changed) discardOpen = true else onClose()
        }
    }
    AlertDialog(
        onDismissRequest = ::closeEditor,
        title = { Text("Editar perfil") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(draftName, { draftName = it.take(35) },
                    enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-name"), singleLine = true,
                    label = { Text("Nome público") }, isError = !validName,
                    supportingText = { Text("${draftName.trim().length}/35 · mínimo de 2 caracteres") })
                OutlinedTextField(draftBio, { draftBio = it.take(180) },
                    enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-bio"), minLines = 3, maxLines = 5,
                    label = { Text("Apresentação (opcional)") },
                    supportingText = { Text("${draftBio.length}/180 caracteres") })
                Text("O nome será usado nas próximas publicações. Sua apresentação permanece privada.",
                    color = Muted, fontSize = 12.sp)
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error, fontSize = 14.sp,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        },
        confirmButton = {
            TextButton(modifier = Modifier.testTag("atrio-profile-save"), enabled = !busy && validName && changed, onClick = {
                busy = true
                failure = ""
                onSave(draftName.trim(), draftBio.trim()) { successful ->
                    if (session.active) {
                        busy = false
                        if (successful) onSaved()
                        else failure = "Não foi possível salvar. Confira a conexão e tente novamente."
                    }
                }
            }) { Text(if (busy) "Salvando..." else "Salvar alterações") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = ::closeEditor) { Text("Cancelar") } }
    )
    if (discardOpen) AlertDialog(
        onDismissRequest = { discardOpen = false },
        title = { Text("Descartar alterações?") },
        text = { Text("As alterações ainda não foram salvas.") },
        confirmButton = { TextButton(onClick = onClose) { Text("Descartar") } },
        dismissButton = { TextButton(onClick = { discardOpen = false }) { Text("Continuar editando") } }
    )
}

private class ProfileEditorSession(var active: Boolean = true)

@Composable
private fun ProfileSectionTitle(title: String) {
    Text(title, modifier = Modifier.padding(bottom = 8.dp).semantics { heading() },
        style = MaterialTheme.typography.titleMedium, color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun ProfileAction(title: String, description: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) {
        ListItem(
            headlineContent = { Text(title) },
            supportingContent = { Text(description) },
            leadingContent = { Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary) },
            trailingContent = { Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null) }
        )
    }
}
