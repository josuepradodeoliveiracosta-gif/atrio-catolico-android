package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
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
import androidx.compose.material.icons.outlined.Forum
import androidx.compose.material.icons.outlined.Groups
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.PersonOutline
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
import androidx.compose.ui.platform.LocalContext
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
    onSavedPosts: () -> Unit, onNotifications: () -> Unit, onReviews: () -> Unit,
    followedRevision: Int = 0, savedCount: Int = 0,
    followedRemoteEnabled: Boolean = false, followedRemoteIds: Set<String> = emptySet(),
    followedRemoteLoading: Boolean = false, followedRemoteFailed: Boolean = false,
    onPhotoChanged: () -> Unit = {},
    otaStatus: OtaCheckStatus = OtaCheckStatus.Idle,
    onRefreshUpdates: () -> Unit = {},
    otaDownload: OtaDownloadState = OtaDownloadState.Idle,
    otaInstallMessage: String = "",
    onDownloadUpdate: (OtaApkOffer) -> Unit = {},
    onCancelUpdateDownload: () -> Unit = {},
    onInstallUpdate: () -> Unit = {}
) {
    var badgesOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var editorOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var publicationsOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var discussionsOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var followedOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var savedMessage by remember(uid) { mutableStateOf(false) }
    var accountExpanded by rememberSaveable(uid) { mutableStateOf(false) }
    var helpExpanded by rememberSaveable(uid) { mutableStateOf(false) }
    BackHandler(enabled = badgesOpen && !editorOpen) { badgesOpen = false }
    BackHandler(enabled = discussionsOpen) { discussionsOpen = false }
    BackHandler(enabled = followedOpen) { followedOpen = false }

    if (followedOpen) {
        FollowedDiscussionsScreen(db, uid, followedRevision,
            onBack = { followedOpen = false }, onOpen = onOpen,
            remoteEnabled = followedRemoteEnabled, remoteIds = followedRemoteIds,
            remoteLoading = followedRemoteLoading, remoteFailed = followedRemoteFailed)
    } else if (discussionsOpen) {
        ProfileDiscussionHistory(db, uid, onBack = { discussionsOpen = false }, onOpen = onOpen)
    } else if (badgesOpen) {
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
        LazyColumn(Modifier.fillMaxSize().background(Paper).testTag("atrio-profile-list"), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                ProfileSectionTitle("Meu perfil")
                Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(AtrioDimensions.CardRadius), border = BorderStroke(1.dp, Line)) {
                    Column(Modifier.fillMaxWidth().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MemberAvatar(name, uid, Modifier.size(80.dp).testTag("atrio-profile-avatar"))
                        if (LocalFounderUid.current.isNotBlank() && LocalFounderUid.current == uid) {
                            FounderBadgeArt(Modifier.size(58.dp), compact = true)
                        }
                        Text(name, fontFamily = FontFamily.Serif, fontSize = 24.sp,
                            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true)
                        Text(biography.ifBlank { "Conte um pouco sobre sua caminhada na fé." },
                            color = Muted, fontSize = 14.sp, textAlign = TextAlign.Center)
                        OutlinedButton(onClick = { savedMessage = false; editorOpen = true },
                            modifier = Modifier.fillMaxWidth().testTag("atrio-profile-edit")) { Text("Editar perfil") }
                        ProfilePhotoManager(uid = uid, onChanged = onPhotoChanged)
                        if (savedMessage) Text("Perfil atualizado.", color = Wine, fontSize = 14.sp,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                }
            }
            item {
                PublicProfilePublicationSettings(db = db, uid = uid, displayName = name,
                    privateBio = biography)
            }
            item {
                Card(onClick = { badgesOpen = true }, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-badges"),
                    colors = CardDefaults.cardColors(containerColor = WineSoft),
                    shape = RoundedCornerShape(AtrioDimensions.CardRadius)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Meus selos", color = Wine, fontWeight = FontWeight.Bold)
                        Text("Escolha sua identificação e acompanhe verificações.", color = Muted, fontSize = 13.sp)
                        Text("Gerenciar selos →", color = Wine, fontSize = 13.sp)
                    }
                }
            }
            item {
                ProfileSectionTitle("Minha participação")
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, Line),
                    shape = RoundedCornerShape(18.dp),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    ProfileAction("Minhas discussões", "Consulte até 50 discussões; seu histórico pode ser maior.",
                        Icons.Outlined.Forum) { discussionsOpen = true }
                    HorizontalDivider()
                    ProfileAction("Discussões acompanhadas",
                        if (followedRemoteEnabled) "Lista sincronizada na sua conta."
                        else "Sua lista pessoal neste aparelho.",
                        Icons.Outlined.BookmarkBorder) { followedOpen = true }
                    HorizontalDivider()
                    ProfileAction("Publicações salvas", "Retome as discussões que você guardou.",
                        Icons.Outlined.BookmarkBorder, onSavedPosts)
                    HorizontalDivider()
                    ProfileAction("Minhas revisões", "Acompanhe suas revisões no Átrio Guardião.",
                        Icons.Outlined.VerifiedUser, onReviews)
                    HorizontalDivider()
                    OutlinedButton(onClick = { publicationsOpen = !publicationsOpen },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-publications")) {
                        Text(if (publicationsOpen) "Recolher publicações carregadas" else "Ver publicações carregadas")
                    }
                }
            }
            if (publicationsOpen) {
                item {
                    Text("Mostramos apenas suas publicações já carregadas no feed. Esta lista não é o histórico completo.",
                        color = Muted, style = MaterialTheme.typography.bodyMedium)
                }
                if (mine.isEmpty()) item {
                    Text("Nenhuma publicação sua nesta lista. Busque mais discussões ou inicie uma conversa.",
                        color = Muted, style = MaterialTheme.typography.bodyMedium)
                    OutlinedButton(onClick = onCreate) { Text("Criar discussão") }
                }
                items(mine, key = { "profile-post-${it.id}" }) { DiscussionCard(it, onOpen, onLike, onSave) }
                item { publicationsFooter() }
            }
            item { ProfileSectionTitle("Preferências") }
            item { PushSettings(uid, db, onNotifications = onNotifications) }
            item { DeveloperSupportPanel(db, uid, founderAdmin = founderCanBroadcast) }
            item {
                ProfileSectionTitle("Conta e privacidade")
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, Line),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.fillMaxWidth().padding(12.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Surface(onClick = { accountExpanded = !accountExpanded },
                            color = MaterialTheme.colorScheme.surface,
                            modifier = Modifier.fillMaxWidth().testTag("atrio-account-toggle")) {
                            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp).padding(horizontal = 6.dp),
                                verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Outlined.PersonOutline, contentDescription = null, tint = Wine)
                                Spacer(Modifier.width(12.dp))
                                Text("Gerenciar conta", modifier = Modifier.weight(1f), color = Ink,
                                    style = MaterialTheme.typography.titleMedium)
                                Icon(if (accountExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                                    contentDescription = if (accountExpanded) "Recolher conta" else "Expandir conta",
                                    tint = Wine)
                            }
                        }
                        if (accountExpanded) {
                            HorizontalDivider(color = Line)
                        Text(email.ifBlank { "Conta autenticada" }, style = MaterialTheme.typography.bodyLarge)
                        Text("Seu e-mail é privado. Sua apresentação só fica pública após sua autorização.",
                            style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                        EmailVerificationPanel(uid)
                        OutlinedButton(onClick = onSignOut,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("atrio-profile-signout")) {
                            Text("Sair da conta")
                        }
                        HorizontalDivider()
                        AccountDeletionRequestPanel(db, uid)
                        Text("A solicitação de exclusão não remove os dados imediatamente. " +
                            "A publicação na Google Play exige também um canal externo de solicitação.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
            }
            item {
                ProfileSectionTitle("Ajuda e suporte")
                Card(Modifier.fillMaxWidth(), border = BorderStroke(1.dp, Line),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                    Column(Modifier.fillMaxWidth().padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Text("Átrio Católico · ${BuildConfig.ATRIO_VISIBLE_VERSION}",
                            style = MaterialTheme.typography.labelMedium, color = Muted)
                        Text("Encontre atualizações, orientações e recursos para resolver dificuldades.",
                            color = Muted, style = MaterialTheme.typography.bodySmall)
                        OutlinedButton(onClick = { helpExpanded = !helpExpanded },
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("atrio-help-toggle")) {
                            Text(if (helpExpanded) "Recolher ajuda e ferramentas" else "Ver ajuda e ferramentas")
                            Spacer(Modifier.width(8.dp))
                            Icon(if (helpExpanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                                contentDescription = if (helpExpanded) "Recolher ajuda" else "Expandir ajuda",
                                tint = Wine)
                        }
                        if (helpExpanded) {
                            HorizontalDivider(color = Line)
                            Text("Atualizações e instalação",
                                color = Wine, style = MaterialTheme.typography.titleMedium)
                            OtaUpdatesSection(otaStatus, onRefreshUpdates, otaDownload, otaInstallMessage,
                                onDownloadUpdate, onCancelUpdateDownload, onInstallUpdate)
                            HorizontalDivider(color = Line)
                            PushSettings(uid, db, advancedOnly = true)
                            if (onModeration != null || onClergyReview != null) {
                                HorizontalDivider(color = Line)
                                Text("Administração", fontWeight = FontWeight.Bold, color = Wine)
                                onModeration?.let { action ->
                                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) {
                                        Text("Moderação de conteúdo e fotos")
                                    }
                                }
                                onClergyReview?.let { action ->
                                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) {
                                        Text("Solicitações de selos")
                                    }
                                }
                            }
                            if (founderCanBroadcast) AdminBroadcastPanel()
                        }
                    }
                }
            }
            item { ProfileBasilicaFooter() }
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
        val privateRef = db.collection("profiles").document(uid)
        val publicRef = db.collection("public_profiles").document(uid)
        // Salvar ambos na MESMA transação: não deixar a biografia pública
        // desatualizada se a segunda gravação falhar. Se a apresentação tiver
        // sido retirada, a transação não poderá recriá-la por acidente.
        db.runTransaction { transaction ->
            val published = transaction.get(publicRef) // todas as leituras antes das escritas
            transaction.update(privateRef, mapOf(
                "displayName" to newName, "bio" to newBio
            ))
            if (published.exists()) {
                val joined = published.getTimestamp("joinedAt")
                    ?: throw IllegalStateException("Data do perfil público inválida")
                transaction.set(publicRef, mapOf(
                    "displayName" to newName,
                    "bio" to newBio,
                    "joinedAt" to joined,
                    "updatedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                ))
            }
            true
        }.addOnCompleteListener { result -> complete(result.isSuccessful) }
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
                Text("O nome será usado nas próximas publicações. Sua apresentação só é pública com sua autorização.",
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
    val icon = when (title) {
        "Minha participação" -> Icons.Outlined.Groups
        "Preferências" -> Icons.Outlined.Settings
        "Conta e privacidade" -> Icons.Outlined.VerifiedUser
        "Ajuda e suporte" -> Icons.Outlined.Settings
        "Minhas publicações" -> Icons.Outlined.Forum
        else -> null
    }
    Row(Modifier.fillMaxWidth().padding(bottom = 8.dp).semantics { heading() },
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(10.dp)) {
        if (icon != null) Icon(icon, contentDescription = null, tint = Gold, modifier = Modifier.size(26.dp))
        Text(title, fontFamily = FontFamily.Serif, color = Wine, fontWeight = FontWeight.Bold,
            fontSize = 22.sp)
        HorizontalDivider(Modifier.weight(1f), color = Gold, thickness = 1.dp)
    }
}

@Composable
private fun ProfileAction(title: String, description: String, icon: ImageVector, onClick: () -> Unit) {
    Surface(onClick = onClick, modifier = Modifier.fillMaxWidth(), color = MaterialTheme.colorScheme.surface) {
        Row(Modifier.fillMaxWidth().heightIn(min = 58.dp).padding(horizontal = 14.dp, vertical = 6.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(icon, contentDescription = null, tint = Wine, modifier = Modifier.size(24.dp))
            Column(Modifier.weight(1f)) {
                Text(title, style = MaterialTheme.typography.bodyLarge, color = Ink,
                    fontWeight = FontWeight.Medium)
                // Informação contextual concisa, sem números potencialmente imprecisos.
                if (description.isNotBlank()) Text(description,
                    style = MaterialTheme.typography.bodySmall, color = Muted)
            }
            Icon(Icons.AutoMirrored.Outlined.ArrowForward, contentDescription = null, tint = Wine)
        }
    }
}
