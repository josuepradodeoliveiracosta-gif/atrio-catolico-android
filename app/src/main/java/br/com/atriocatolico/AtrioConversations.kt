package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FieldPath
import com.google.android.gms.tasks.Task
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.Source
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import java.text.DateFormat
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume

/** Somente texto. Todas as autorizações são revalidadas nas regras Firestore. */
internal object AtrioChatPolicy {
    const val VERSION = "2026-11-v1"
    const val MAX_TEXT = 1500
    fun id(a: String, b: String): String = listOf(a, b).sorted().joinToString("__")
    fun validText(text: String): Boolean = text.isNotBlank() && text == text.trim() &&
        text.length <= MAX_TEXT && text.none { it.isISOControl() && it != '\n' }
    fun validRequest(text: String): Boolean = validText(text) &&
        !Regex("https?://|www\\.", RegexOption.IGNORE_CASE).containsMatchIn(text)
}
private data class ChatRoom(val id: String, val requester: String, val recipient: String,
    val status: String, val preview: String, val lastMessageId: String,
    val lastAt: Long, val unreadA: Int, val unreadB: Int) {
    fun peer(uid: String) = if (uid == requester) recipient else requester
    fun unread(uid: String) = if (uid == requester) unreadA else unreadB
    fun incomingRequest(uid: String) = status == "pending" && recipient == uid
}
private data class ChatItem(val id: String, val uid: String, val text: String, val whenSent: Long,
    val pending: Boolean, val replyToId: String? = null,
    val reactions: Map<String, String> = emptyMap(),
    val postId: String? = null, val postTitle: String? = null,
    val kind: String = "text", val edited: Boolean = false,
    val deletedForAll: Boolean = false)
private data class ChatPrefs(val muted: Boolean = false, val pinned: Boolean = false,
    val archived: Boolean = false)

private fun DocumentSnapshot.chatRoom(): ChatRoom? {
    val a = getString("requesterUid") ?: return null
    val b = getString("recipientUid") ?: return null
    return ChatRoom(id, a, b, getString("status").orEmpty(),
        getString("lastPreview").orEmpty(), getString("lastMessageId").orEmpty(),
        getTimestamp("updatedAt")?.toDate()?.time ?: 0L,
        (getLong("unreadRequester") ?: 0).toInt(),
        (getLong("unreadRecipient") ?: 0).toInt())
}
/**
 * Metadado minimizado de `chatInboxByPeer`: nunca traz direção do convite,
 * contadores de leitura, identificadores internos ou conteúdo do histórico.
 * A validade do par é conferida antes de criar qualquer card.
 */
private fun DocumentSnapshot.peerInboxRoom(owner: String, peer: String): ChatRoom? {
    val chatId = getString("chatId") ?: return null
    val preview = getString("lastPreview") ?: return null
    val status = getString("status") ?: return null
    if (id != chatId || !AtrioPeerInboxPolicy.entryMatches(
            owner, peer, chatId,
            getString("ownerUid"), getString("peerUid"), status, preview
        )) return null
    val updated = getTimestamp("updatedAt") ?: return null
    // Os papéis reais são lidos SOMENTE do documento de DM autorizado.
    // Nenhuma inferência de destinatário ou sinal de "nova solicitação".
    return ChatRoom(chatId, owner, peer, status, preview, "", updated.toDate().time, 0, 0)
}

private fun chatTime(value: Long): String =
    if (value <= 0) "" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(java.util.Date(value))

@Composable
private fun chatPeerName(db: FirebaseFirestore, uid: String, fallback: String = "Participante"): String {
    var label by remember(uid) { mutableStateOf(fallback) }
    DisposableEffect(db, uid, fallback) {
        // Uma notificação pode apontar para conversa removida ou não
        // autorizada. Antes de carregar o chat, não há UID do outro membro.
        // Firestore.document("") lançaria IllegalArgumentException na UI.
        if (uid.isBlank()) {
            label = fallback
            onDispose {}
        } else {
            val listener = db.collection("public_profiles").document(uid)
                .addSnapshotListener { doc, error ->
                    if (error == null) label = doc?.getString("displayName")
                        ?.takeIf { it.isNotBlank() } ?: fallback
                }
            onDispose { listener.remove() }
        }
    }
    return label
}

@Composable
internal fun AtrioConversationsScreen(
    db: FirebaseFirestore, uid: String, onBack: () -> Unit,
    initialPeer: PublicMemberTarget? = null,
    initialChatId: String? = null,
    initialGroupId: String? = null,
    initialSharePost: Pair<String, String>? = null,
    onOpenDiscussion: (String) -> Unit = {},
    blockedPeers: Set<String> = emptySet(),
    managedBlocks: AtrioManagedBlocks? = null,
    managedMessages: AtrioManagedMessages? = null
) {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    var user by remember(auth) { mutableStateOf(auth.currentUser, referentialEqualityPolicy()) }
    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { user = it.currentUser }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }
    val current = user
    if (current == null || current.uid != uid || auth.currentUser !== current) {
        Text("Sessão alterada. Entre novamente.", Modifier.padding(20.dp))
    } else key(current) {
        val messages = managedMessages ?: rememberAtrioManagedMessages(auth, current, db)
        AtrioConversationsForSession(db, auth, current, onBack, initialPeer, initialChatId,
            initialGroupId, initialSharePost, onOpenDiscussion, blockedPeers, managedBlocks, messages)
    }
}

@Composable
private fun AtrioConversationsForSession(
    db: FirebaseFirestore, authentication: FirebaseAuth, user: FirebaseUser, onBack: () -> Unit,
    initialPeer: PublicMemberTarget?, initialChatId: String?, initialGroupId: String?,
    initialSharePost: Pair<String, String>?, onOpenDiscussion: (String) -> Unit,
    blockedPeers: Set<String>, managedBlocks: AtrioManagedBlocks?,
    managedMessages: AtrioManagedMessages?
) {
    val uid = user.uid
    var enabled by remember(uid) { mutableStateOf(false) }
    var loadedConfig by remember(uid) { mutableStateOf(false) }
    var editingEnabled by remember(uid) { mutableStateOf(false) }
    var deletingEnabled by remember(uid) { mutableStateOf(false) }
    var editWindowMinutes by remember(uid) { mutableIntStateOf(0) }
    var deleteWindowMinutes by remember(uid) { mutableIntStateOf(0) }
    var requestPolicy by remember(uid) { mutableStateOf("none") }
    var rooms by remember(uid) { mutableStateOf<List<ChatRoom>>(emptyList()) }
    var prefs by remember(uid) { mutableStateOf<Map<String, ChatPrefs>>(emptyMap()) }
    var loaded by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf("") }
    var search by remember(uid) { mutableStateOf("") }
    var requestsTab by remember(uid) { mutableStateOf(false) }
    var groupsOpen by remember(uid,initialGroupId) {
        mutableStateOf(initialGroupId!=null)
    }
    var sharePost by remember(uid, initialSharePost) { mutableStateOf(initialSharePost) }
    var archivesTab by remember(uid) { mutableStateOf(false) }
    var selected by remember(uid, initialPeer?.uid, initialChatId) {
        mutableStateOf(initialChatId ?: initialPeer?.uid?.let { AtrioChatPolicy.id(uid, it) })
    }
    // O índice por par serve aos perfis e links exatos. A caixa geral usa a
    // descoberta HTTP quando habilitada no emulador.
    val peerUid = remember(uid, initialPeer?.uid, initialChatId) {
        initialPeer?.uid?.takeIf {
            AtrioPeerInboxPolicy.validPeer(uid, it) &&
                (initialChatId == null || AtrioChatPolicy.id(uid, it) == initialChatId)
        } ?: AtrioPeerInboxPolicy.peerFromChatId(uid, initialChatId)
    }
    val knownPeer = peerUid != null
    var retryInbox by remember(uid, peerUid) { mutableIntStateOf(0) }
    val ownSession = authentication.currentUser === user
    val useDiscovery = isAtrioManagedInboxQa(db) && initialPeer == null && initialChatId == null
    var selectedDiscoveryRoom by remember { mutableStateOf<ChatRoom?>(null) }
    val chosen = selectedDiscoveryRoom?.takeIf { it.id == selected && it.peer(uid) !in blockedPeers }
        ?: rooms.firstOrNull { it.id == selected }
        ?: rooms.singleOrNull()?.takeIf {
            managedMessages != null && initialChatId == null && peerUid != null &&
                initialPeer?.uid == peerUid && selected == AtrioChatPolicy.id(uid, peerUid)
        }
    val discovery = if (useDiscovery && enabled && ownSession && selected == null && !groupsOpen)
        rememberAtrioInboxNavigation(authentication, user, blockedPeers) else null
    val page = discovery?.result as? AtrioInboxResult.Page
    val visibleRooms = if (useDiscovery) page?.items.orEmpty().map {
        ChatRoom(it.chatId, uid, it.peerUid, it.status, it.preview, "", it.updatedAtMs,
            it.unreadCount, 0)
    } else rooms
    val hiddenByPendingBlock = managedBlocks?.hiddenPeers().orEmpty()
    var prefsError by remember { mutableStateOf("") }

    fun closeThread() {
        selected = null
        selectedDiscoveryRoom = null
    }

    // O bloqueio realizado pelo próprio titular remove imediatamente a
    // prévia visível, mesmo antes do próximo ciclo de consulta do índice.
    // O bloqueio do OUTRO participante continua sendo decidido nas Rules
    // e revalidado pela consulta Source.SERVER.
    var ownBlockedPeer by remember(uid, peerUid) { mutableStateOf(false) }
    DisposableEffect(db, uid, peerUid, ownSession) {
        if (!ownSession || peerUid == null) {
            ownBlockedPeer = false
            onDispose {}
        } else {
            val blocked = db.collection("users").document(uid)
                .collection("blockedMembers").document(peerUid)
                .addSnapshotListener { doc, failure ->
                    if (authentication.currentUser === user &&
                        failure == null) ownBlockedPeer = doc?.exists() == true
                }
            onDispose { blocked.remove() }
        }
    }

    DisposableEffect(db, uid, ownSession, useDiscovery) {
        if (!ownSession) {
            enabled = false
            loadedConfig = false
            rooms = emptyList()
            prefs = emptyMap()
            requestPolicy = "none"
            onDispose {}
        } else {
        val config = db.document("app_config/conversations")
            .addSnapshotListener(atrioChatMetadataChanges) { doc, failure ->
            loadedConfig = failure != null || atrioChatSnapshotUsable(doc)
            enabled = failure == null && atrioConversationConfigEnabled(doc)
            editWindowMinutes = (doc?.getLong("editWindowMinutes") ?: 0L)
                .coerceIn(0L, 1440L).toInt()
            deleteWindowMinutes = (doc?.getLong("deleteWindowMinutes") ?: 0L)
                .coerceIn(0L, 1440L).toInt()
            editingEnabled = enabled && doc?.getBoolean("editEnabled") == true &&
                editWindowMinutes > 0
            deletingEnabled = enabled && doc?.getBoolean("deleteEnabled") == true &&
                deleteWindowMinutes > 0
        }
        val privacy = db.collection("users").document(uid).collection("chatSettings")
            .document("privacy").addSnapshotListener { doc, failure ->
                if (failure == null) requestPolicy = doc?.getString("requests") ?: "none"
            }
        onDispose { config.remove(); privacy.remove() }
        }
    }
    // #355: a listagem global de chats é negada pela Rule, inclusive com
    // whereArrayContains. Nenhuma descoberta por chatBox ou collectionGroup.
    val inbox = remember(db, uid, peerUid) {
        peerUid?.let { peer ->
            db.collection("users").document(uid)
                .collection("chatInboxByPeer").document(peer)
                .collection("entries").limit(20)
        }
    }
    fun updateInbox(snapshot: QuerySnapshot?, failure: Throwable?) {
        if (authentication.currentUser !== user) {
            rooms = emptyList()
            loaded = true
            error = ""
            return
        }
        loaded = true
        // Source.SERVER é obrigatório: um índice revogado pode permanecer
        // no cache do aparelho depois do bloqueio bilateral.
        val confirmed = failure == null && snapshot != null &&
            AtrioPeerInboxPolicy.freshServer(
                snapshot.metadata.isFromCache,
                snapshot.metadata.hasPendingWrites(),
                authentication.currentUser === user
            )
        if (!confirmed) {
            rooms = emptyList()
            error = "Não foi possível confirmar suas conversas no servidor. " +
                "Confira a conexão e tente novamente."
            return
        }
        val peer = peerUid ?: return
        val verified = snapshot!!.documents.mapNotNull { it.peerInboxRoom(uid, peer) }
        if (verified.size != snapshot.size()) {
            rooms = emptyList()
            error = "Os dados desta conversa não puderam ser confirmados com segurança."
        } else {
            rooms = verified
            error = ""
            val operation = managedMessages?.draft(peer)
            if (verified.isEmpty() && operation?.intent?.firstPeer == peer &&
                (operation.result as? AtrioMessageReply.Conflict)?.code != "conversation_exists"
            ) managedMessages.reconcile(peer)
        }
    }
    LaunchedEffect(db, uid, inbox, enabled, ownSession, ownBlockedPeer, retryInbox) {
        // Ao trocar de conta, offline ou revogar acesso: eliminar previews de
        // memória imediatamente. Não usar cache como fallback visual.
        rooms = emptyList()
        error = if (ownBlockedPeer) "Conversa indisponível por bloqueio." else ""
        loaded = inbox == null || !enabled || !ownSession || ownBlockedPeer
        if (inbox != null && enabled && ownSession && !ownBlockedPeer) {
            pollAtrioPilotServer({ inbox.get(Source.SERVER) },
                { snapshot, failure -> updateInbox(snapshot, failure) },
                intervalMs = 10_000L)
        }
    }
    val discoveryChatIds = page?.items.orEmpty().map { it.chatId }
    DisposableEffect(db, uid, enabled, ownSession, useDiscovery, discoveryChatIds) {
        if (useDiscovery) prefs = emptyMap()
        if (!enabled || !ownSession || (useDiscovery && discoveryChatIds.isEmpty())) onDispose {}
        else {
            val settings = db.collection("users").document(uid).collection("chatBox")
            val query = if (useDiscovery) settings.whereIn(FieldPath.documentId(), discoveryChatIds)
                else settings.limit(100)
            val listener = query.addSnapshotListener(atrioChatMetadataChanges) { snapshot, failure ->
                    if (failure == null && atrioChatSnapshotUsable(snapshot)) {
                        prefs = snapshot?.documents.orEmpty().associate { d ->
                            d.id to ChatPrefs(d.getBoolean("muted") == true,
                                d.getBoolean("pinned") == true, d.getBoolean("archived") == true)
                        }
                    } else if (atrioChatRequiresServer) prefs = emptyMap()
                }
            onDispose { listener.remove() }
        }
    }
    fun changePrefs(chatId: String, updated: ChatPrefs) {
        // Preferências não concedem acesso; só operar sobre índice validado
        // no servidor e na própria sessão.
        if (authentication.currentUser !== user ||
            visibleRooms.none { it.id == chatId }) return
        prefsError = ""
        db.collection("users").document(uid).collection("chatBox").document(chatId)
            .set(mapOf("muted" to updated.muted, "pinned" to updated.pinned,
                "archived" to updated.archived, "updatedAt" to FieldValue.serverTimestamp()))
            .addOnFailureListener { prefsError = "Não foi possível atualizar as preferências." }
    }
    BackHandler(enabled = selected != null && !groupsOpen, onBack = ::closeThread)
    Column(Modifier.fillMaxSize().background(Paper).testTag("atrio-chats-screen")) {
        if (!ownSession) {
            Text("Sessão alterada. Entre novamente.", Modifier.padding(20.dp))
        } else if (!loadedConfig) {
            CircularProgressIndicator(Modifier.padding(24.dp))
        } else if (!enabled) {
            Column(Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Átrio Conversas", color = Wine, style = MaterialTheme.typography.headlineSmall)
                Text("As conversas ainda não foram liberadas. " +
                    "A implantação exige aprovação das regras e política de proteção de menores.")
                OutlinedButton(onClick = onBack) { Text("Voltar") }
            }
        } else if (groupsOpen) {
            AtrioGroupsScreen(db,uid,
                knownPeers = rooms.filter { it.status == "accepted" }
                    .map { it.peer(uid) }.distinct(),
                onBack = { groupsOpen = false },
                initialGroupId = initialGroupId)
        } else if (selected != null) {
            // O controle precisa continuar acessível quando as Rules já ocultam a conversa.
            val blockPeer = selectedDiscoveryRoom?.takeIf { it.id == selected }?.peer(uid) ?: peerUid
            if (managedBlocks != null && blockPeer != null)
                AtrioManagedBlockControl(managedBlocks, blockPeer, "atrio-chat-block-toggle")
            val firstContact = AtrioPeerInboxPolicy.explicitFirstContact(
                uid, initialPeer?.uid, selected, rooms.isNotEmpty()
            ) && peerUid == initialPeer?.uid && loaded && error.isBlank()
            when {
                !loaded -> CircularProgressIndicator(
                    Modifier.padding(24.dp).testTag("atrio-peer-inbox-loading"))
                error.isNotBlank() -> Column(Modifier.padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    AtrioPeerInboxError(error, onRetry = { retryInbox++ })
                    TextButton(onClick = ::closeThread) { Text("Voltar") }
                }
                chosen == null && !firstContact ->
                    Column(Modifier.padding(20.dp)) {
                        Text("Conversa indisponível para esta conta.",
                            modifier = Modifier.testTag("atrio-peer-inbox-unavailable"))
                        TextButton(onClick = ::closeThread) { Text("Voltar") }
                    }
                else -> AtrioChatThread(db, uid, chosen?.id ?: selected!!, chosen,
                    initialPeer?.takeIf { AtrioChatPolicy.id(uid, it.uid) == selected },
                    onBack = ::closeThread,
                    sharePost = sharePost,
                    onShareSent = { sharePost = null },
                    onOpenDiscussion = onOpenDiscussion,
                    editingEnabled = editingEnabled,
                    deletingEnabled = deletingEnabled,
                    editWindowMinutes = editWindowMinutes,
                    deleteWindowMinutes = deleteWindowMinutes,
                    managedBlocks = managedBlocks,
                    managedMessages = managedMessages,
                    onContactConflict = { retryInbox++ })
            }
        } else {
            Row(Modifier.fillMaxWidth().padding(horizontal=12.dp),
                verticalAlignment=Alignment.CenterVertically) {
                Text("Átrio Conversas",fontWeight=FontWeight.SemiBold,
                    color=Wine,modifier=Modifier.weight(1f))
                TextButton(onClick={groupsOpen=true},
                    modifier=Modifier.testTag("atrio-open-groups")) {
                    Text("Grupos")
                }
            }
            if (sharePost != null) {
                Text("Escolha uma conversa já aceita para enviar o cartão textual da discussão. " +
                    "Para falar com alguém novo, abra primeiro o perfil dessa pessoa.",
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                    color = Wine, fontSize = 14.sp)
            }
            if (!knownPeer && !useDiscovery) {
                Text("Caixa de entrada completa indisponível nesta etapa. " +
                    "Por segurança, abra uma conversa pelo perfil de um participante. " +
                    "Seus contatos e solicitações anteriores não são listados até " +
                    "a descoberta autorizada pelo servidor estar pronta.",
                    Modifier.fillMaxWidth().padding(16.dp)
                        .testTag("atrio-peer-discovery-unavailable"),
                    color = MaterialTheme.colorScheme.onSurface)
            } else if (knownPeer) {
                Text("Mostrando apenas o contato aberto pelo perfil ou por um " +
                    "destino conhecido. A caixa completa ainda não está disponível.",
                    Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                    color = MaterialTheme.colorScheme.onSurface)
            }
            OutlinedTextField(search, { search = it.take(80) },
                modifier = Modifier.fillMaxWidth().padding(12.dp)
                    .testTag("atrio-chats-search"),
                enabled = knownPeer || page != null,
                singleLine = true, label = {
                    Text(if (useDiscovery) "Buscar nesta página" else "Buscar neste contato")
                })
            Row(Modifier.padding(horizontal = 12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(!requestsTab && !archivesTab,
                    onClick = { requestsTab = false; archivesTab = false },
                    label = { Text("Mensagens") })
                FilterChip(requestsTab,
                    onClick = { requestsTab = true; archivesTab = false },
                    label = { Text("Solicitações") })
                FilterChip(archivesTab,
                    onClick = { requestsTab = false; archivesTab = true },
                    label = { Text("Arquivadas") })
            }
            val matches = visibleRooms.filter { room ->
                room.peer(uid) !in hiddenByPendingBlock &&
                (if (requestsTab) room.status == "pending"
                 else if (archivesTab) prefs[room.id]?.archived == true
                 else room.status != "pending" && prefs[room.id]?.archived != true) &&
                (search.isBlank() || room.preview.contains(search, true))
            }.sortedWith(compareByDescending<ChatRoom> { prefs[it.id]?.pinned == true }
                .thenByDescending { it.lastAt })
            if (prefsError.isNotBlank()) Text(prefsError, Modifier.padding(horizontal = 12.dp))
            if (discovery != null) {
                when (discovery.result) {
                    null -> LinearProgressIndicator(Modifier.fillMaxWidth()
                        .testTag("atrio-inbox-loading"))
                    AtrioInboxResult.Unavailable, AtrioInboxResult.RestartRequired -> AtrioPeerInboxError(
                        "Serviço de conversas indisponível. Tente novamente.",
                        modifier = Modifier.padding(16.dp).testTag("atrio-inbox-unavailable"),
                        onRetry = discovery.restart)
                    AtrioInboxResult.Denied -> AtrioPeerInboxError(
                        "Não foi possível autorizar a consulta. Atualize e tente novamente.",
                        modifier = Modifier.padding(16.dp).testTag("atrio-inbox-denied"),
                        onRetry = discovery.restart)
                    is AtrioInboxResult.Page -> if (matches.isEmpty()) Text(
                        when {
                            page?.items?.isEmpty() == true && discovery.page == 1 ->
                                "Nenhuma conversa encontrada."
                            else -> "Nenhum resultado nesta página."
                        }, Modifier.padding(20.dp).testTag("atrio-inbox-empty"), color = Muted)
                }
            }
            if (!loaded && knownPeer) LinearProgressIndicator(
                Modifier.fillMaxWidth().testTag("atrio-peer-inbox-loading"))
            if (error.isNotBlank()) {
                AtrioPeerInboxError(error, modifier = Modifier.padding(16.dp),
                    onRetry = { retryInbox++ })
            }
            if (knownPeer && loaded && error.isBlank() && matches.isEmpty()) Text(
                when {
                    search.isNotBlank() -> "Nenhum resultado para este contato."
                    requestsTab -> "Nenhuma solicitação confirmada para este contato."
                    archivesTab -> "Nenhuma conversa arquivada confirmada para este contato."
                    else -> "Nenhuma conversa confirmada para este contato."
                }, Modifier.padding(20.dp), color = Muted)
            LazyColumn(Modifier.weight(1f).testTag("atrio-chats-list"),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp)) {
                items(matches, key = { it.id }) { room ->
                    val peer = room.peer(uid)
                    val name = chatPeerName(db, peer)
                    val minePrefs = prefs[room.id] ?: ChatPrefs()
                    Card(onClick = {
                        if (authentication.currentUser === user && error.isBlank()) {
                            if (useDiscovery) selectedDiscoveryRoom = room.copy(preview = "")
                            selected = room.id
                        }
                    },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-chat-" + room.id),
                        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                        border = BorderStroke(1.dp, Line), shape = RoundedCornerShape(16.dp)) {
                        Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(7.dp)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                MemberAvatar(name, peer, Modifier.size(42.dp))
                                Spacer(Modifier.width(9.dp))
                                Column(Modifier.weight(1f)) {
                                    Text(name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                                    Text(chatTime(room.lastAt), fontSize = 12.sp, color = Muted)
                                }
                                if (room.unread(uid) > 0) Badge {
                                    Text(room.unread(uid).coerceAtMost(99).toString())
                                }
                            }
                            Text(room.preview, maxLines = 2, overflow = TextOverflow.Ellipsis,
                                fontSize = 14.sp, color = Muted)
                            if (room.status == "pending") Text(
                                "Solicitação pendente • abra para conferir",
                                color = Wine, fontSize = 13.sp)
                            Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                TextButton(onClick = {
                                    changePrefs(room.id, minePrefs.copy(pinned = !minePrefs.pinned))
                                }) { Text(if (minePrefs.pinned) "Desafixar" else "Fixar") }
                                TextButton(onClick = {
                                    changePrefs(room.id, minePrefs.copy(muted = !minePrefs.muted))
                                }) { Text(if (minePrefs.muted) "Reativar" else "Silenciar") }
                                TextButton(onClick = {
                                    changePrefs(room.id, minePrefs.copy(archived = !minePrefs.archived))
                                }) { Text(if (minePrefs.archived) "Restaurar" else "Arquivar") }
                            }
                        }
                    }
                }
            }
            if (discovery != null && page != null) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Text(if (page.nextCursor == null) "Página ${discovery.page} · Última página"
                        else "Página ${discovery.page}",
                        Modifier.weight(1f).testTag("atrio-inbox-page"))
                    TextButton(onClick = discovery.restart) { Text("Atualizar") }
                }
                Row(Modifier.padding(horizontal = 12.dp)) {
                    if (discovery.page > 1) TextButton(onClick = discovery.previous,
                        modifier = Modifier.testTag("atrio-inbox-previous")) { Text("Anterior") }
                    if (page.nextCursor != null) TextButton(onClick = discovery.next,
                        modifier = Modifier.testTag("atrio-inbox-next")) { Text("Próxima página") }
                }
            }
            HorizontalDivider(color = Line)
            Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("Permitir solicitações", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                    Text(if (requestPolicy == "all") "De todos" else "De ninguém",
                        fontSize = 13.sp, color = Muted)
                }
                Switch(requestPolicy == "all", onCheckedChange = { allowed ->
                    db.collection("users").document(uid).collection("chatSettings")
                        .document("privacy").set(mapOf(
                            "requests" to if (allowed) "all" else "none",
                            "readReceipts" to false, "showPushPreview" to false,
                            "updatedAt" to FieldValue.serverTimestamp()))
                        .addOnFailureListener { prefsError = "Não foi possível salvar sua preferência." }
                }, modifier = Modifier.testTag("atrio-chat-privacy"))
            }
        }
    }
}

@Composable
private fun AtrioChatThread(
    db: FirebaseFirestore, uid: String, chatId: String, preview: ChatRoom?,
    initialPeer: PublicMemberTarget?, onBack: () -> Unit,
    sharePost: Pair<String, String>?,
    onShareSent: () -> Unit,
    onOpenDiscussion: (String) -> Unit,
    editingEnabled: Boolean, deletingEnabled: Boolean,
    editWindowMinutes: Int, deleteWindowMinutes: Int,
    managedBlocks: AtrioManagedBlocks?,
    managedMessages: AtrioManagedMessages?,
    onContactConflict: () -> Unit
) {
    val legacyWrites = !BuildConfig.ATRIO_QA_INBOX_DISCOVERY
    val ref = remember(db, chatId) { db.collection("chats").document(chatId) }
    var chat by remember(uid, chatId) {
        // O índice minimizado NÃO contém os papéis e permissões do chat.
        // Ler o documento real exclusivamente no servidor após confirmar índice.
        mutableStateOf<ChatRoom?>(null)
    }
    var accessDenied by remember(uid, chatId) { mutableStateOf(false) }
    var loaded by remember(uid, chatId) { mutableStateOf(false) }
    var limit by remember(uid, chatId) { mutableIntStateOf(40) }
    var messages by remember(uid, chatId) { mutableStateOf<List<ChatItem>>(emptyList()) }
    var hiddenMessageIds by remember(uid, chatId) { mutableStateOf<Set<String>>(emptySet()) }
    var showHiddenMessages by remember(uid, chatId) { mutableStateOf(false) }
    var messageMenuId by remember(uid, chatId) { mutableStateOf<String?>(null) }
    // Uma conversa ainda inexistente não autoriza a leitura de sua
    // subcoleção privada. Aguarde o chat ser confirmado antes de ouvir
    // mensagens ocultadas, evitando listeners encerrados por PERMISSION_DENIED.
    DisposableEffect(db, uid, chatId, chat?.id) {
        if (chat == null) onDispose {}
        else {
            val listener = db.collection("users").document(uid)
                .collection("chatHidden").document(chatId).collection("messages")
                .limit(500).addSnapshotListener { snapshot, failure ->
                    if (failure == null) hiddenMessageIds = snapshot?.documents
                        ?.map { it.id }?.toSet().orEmpty()
                }
            onDispose { listener.remove() }
        }
    }
    var draft by remember(uid, chatId) { mutableStateOf("") }
    var pendingAttemptId by remember(uid, chatId) { mutableStateOf("") }
    var pendingAttemptText by remember(uid, chatId) { mutableStateOf("") }
    var saving by remember(uid, chatId) { mutableStateOf(false) }
    var info by remember(uid, chatId) { mutableStateOf("") }
    var replyingTo by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var reactingTo by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var editingMessage by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var editDraft by remember(uid, chatId) { mutableStateOf("") }
    var deletingMessage by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var report by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var reason by remember(uid, chatId) { mutableStateOf("") }
    val peerUid = chat?.peer(uid) ?: initialPeer?.uid
        ?: if (legacyWrites) "" else preview?.peer(uid).orEmpty()
    val draftKey = peerUid.ifBlank { chatId }
    val managedDraft = managedMessages?.draft(draftKey)
    val textDraft = managedDraft?.text ?: draft
    val scope = rememberCoroutineScope()
    val waitingForWrite = managedDraft?.sending == true
    val retryingWrite = managedDraft?.pending == true
    val retryAtMs = managedDraft?.retryAtMs
    var coolingDown by remember(retryAtMs) {
        mutableStateOf(retryAtMs?.let { it > atrioMessageClockMs() } == true)
    }
    LaunchedEffect(retryAtMs) {
        if (retryAtMs != null) delay((retryAtMs - atrioMessageClockMs()).coerceAtLeast(0))
        coolingDown = false
    }
    val peerName = chatPeerName(db, peerUid, initialPeer?.nameFromPublication ?: "Participante")
    // Apenas o próprio titular pode ler sua lista de bloqueados. Não tentar
    // descobrir se o outro participante bloqueou esta conta.
    var legacyBlockedByMe by remember(uid, peerUid) { mutableStateOf<Boolean?>(null) }
    val blockedByMe = if (legacyWrites) legacyBlockedByMe
        else managedBlocks?.confirmed(peerUid)?.blocked
    val hiddenByManagedBlock = !legacyWrites &&
        (blockedByMe == true || peerUid in managedBlocks?.hiddenPeers().orEmpty())
    DisposableEffect(db, uid, peerUid, legacyWrites) {
        if (!legacyWrites || peerUid.isBlank()) onDispose {}
        else {
            val listener = db.collection("users").document(uid)
                .collection("blockedMembers").document(peerUid)
                .addSnapshotListener { snapshot, failure ->
                    legacyBlockedByMe = if (failure == null) snapshot?.exists() == true else null
                }
            onDispose { listener.remove() }
        }
    }
    // Um contato novo não possui índice; nesse caso a UI permite somente
    // o pedido inicial, sujeito às Rules. Para chats existentes, o índice
    // pelo par precisa vir do servidor antes de ler mensagens.
    var confirmedRoom by remember(uid, chatId) { mutableStateOf(preview != null) }
    var requestSubmitted by remember(uid, chatId) { mutableStateOf(false) }
    LaunchedEffect(preview?.id) {
        if (preview != null) confirmedRoom = true
    }
    val contactCommitted = managedDraft?.intent?.firstPeer != null &&
        managedDraft.result is AtrioMessageReply.Committed
    val firstContact = AtrioPeerInboxPolicy.explicitFirstContact(
        uid, initialPeer?.uid, chatId, confirmedRoom || contactCommitted
    )
    fun updateRoom(snapshot: DocumentSnapshot?, failure: Throwable?) {
        // Respostas atrasadas da sessão anterior nunca reabrem conteúdo.
        if (FirebaseAuth.getInstance().currentUser?.uid != uid) {
            loaded = true
            accessDenied = true
            chat = null
            messages = emptyList()
            return
        }
        loaded = failure != null || atrioChatSnapshotUsable(snapshot)
        val fresh = failure == null && atrioChatSnapshotUsable(snapshot)
        val candidate = if (fresh && snapshot?.exists() == true)
            snapshot.chatRoom() else null
        val verified = candidate?.takeIf {
            AtrioPeerInboxPolicy.roomMatches(
                uid, chatId, it.requester, it.recipient, it.status
            ) && (initialPeer == null || it.peer(uid) == initialPeer.uid) &&
                (preview == null || it.peer(uid) == preview.peer(uid))
        }
        accessDenied = failure != null ||
            (fresh && snapshot?.exists() == true && verified == null)
        chat = verified
        if (verified != null) managedMessages?.reconcile(draftKey)
        if (chat == null) messages = emptyList()
        if (failure != null) info = "Não foi possível sincronizar a conversa."
    }
    // Revalidar no servidor durante a thread: listener local isolado não
    // garante revogação de acesso após bloqueio. Offline não usa cache.
    val revalidateWriteConflict = managedDraft?.requiresRoomRefresh == true
    LaunchedEffect(ref, uid, firstContact, revalidateWriteConflict) {
        if (!firstContact || revalidateWriteConflict) {
            pollAtrioPilotServer({ ref.get(Source.SERVER) }, ::updateRoom)
        } else loaded = true
    }
    DisposableEffect(db, chatId, limit, chat?.id) {
        if (chat == null) onDispose {}
        else {
            val listener = ref.collection("messages")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(limit.toLong())
                .addSnapshotListener(MetadataChanges.INCLUDE) { data, error ->
                    messages = if (error == null && data != null &&
                        !data.metadata.isFromCache && !data.metadata.hasPendingWrites() &&
                        FirebaseAuth.getInstance().currentUser?.uid == uid)
                        data?.documents.orEmpty().mapNotNull { doc ->
                        val sender = doc.getString("uid") ?: return@mapNotNull null
                        val body = doc.getString("text") ?: return@mapNotNull null
                        val edited = doc.getString("editedText")
                        val removed = doc.getBoolean("deletedForAll") == true
                        val reactions = (doc.get("reactions") as? Map<*, *>)
                            ?.mapNotNull { (userId, emoji) ->
                                if (userId is String && emoji is String) userId to emoji else null
                            }?.toMap().orEmpty()
                        ChatItem(doc.id, sender,
                            if (removed) "[Mensagem removida]" else edited ?: body,
                            doc.getTimestamp("createdAt")?.toDate()?.time ?: 0,
                            doc.metadata.hasPendingWrites(),
                            doc.getString("replyToId"), reactions,
                            doc.getString("postId"), doc.getString("postTitle"),
                            doc.getString("kind") ?: "text", edited != null, removed)
                    }.reversed() else emptyList()
                    if (error != null) {
                        accessDenied = true
                        chat = null
                        info = "Não foi possível carregar as mensagens."
                    }
                }
            onDispose { listener.remove() }
        }
    }
    // Evitar cascatas de writes quando o servidor recusa a alteração
    // (p.ex. bloqueio entre participantes ou troca de conta). O mesmo
    // snapshot não deve gerar milhares de tentativas de "marcar lida".
    // Um evento de mensagem novo ou reabrir a tela permite uma nova tentativa.
    var lastReadAttemptKey by remember(uid, chatId) { mutableStateOf<String?>(null) }
    LaunchedEffect(uid, chatId, chat?.lastMessageId, chat?.unread(uid), chat?.status) {
        val currentRoom = chat
        if (legacyWrites && FirebaseAuth.getInstance().currentUser?.uid == uid &&
            currentRoom != null &&
            currentRoom.unread(uid) > 0 &&
            currentRoom.status in listOf("pending", "accepted")) {
            val attemptKey = currentRoom.lastMessageId + ":" +
                currentRoom.unread(uid).toString() + ":" + currentRoom.status
            if (lastReadAttemptKey != attemptKey) {
                lastReadAttemptKey = attemptKey
                // Se a regra negar o update, não transformar o erro em loop.
                // O contador é local ao chat, NÃO representa confirmação
                // genuína de leitura no aparelho do destinatário.
                ref.update(
                    if (uid == currentRoom.requester) "unreadRequester" else "unreadRecipient", 0
                )
            }
        }
    }

    // Reconcilia resposta de rede perdida com a mensagem confirmada no servidor.
    LaunchedEffect(chat?.lastMessageId, pendingAttemptId) {
        if (legacyWrites && pendingAttemptId.isNotBlank() && chat?.lastMessageId == pendingAttemptId &&
            chat?.preview == pendingAttemptText) {
            if (draft.trim() == pendingAttemptText) draft = ""
            pendingAttemptId = ""
            pendingAttemptText = ""
        }
    }

    fun send(shared: Pair<String, String>? = null) {
        if (!legacyWrites) {
            if (shared != null || blockedByMe != false || managedMessages == null) return
            val firstPeer = if (chat == null && firstContact) initialPeer?.uid else null
            if (!retryingWrite && firstPeer == null && chat?.status != "accepted") return
            val startedFirst = firstPeer != null || managedDraft?.intent?.firstPeer != null
            scope.launch {
                when (managedMessages.send(draftKey, chatId, firstPeer, replyingTo?.id)) {
                    is AtrioMessageReply.Committed -> {
                        if (startedFirst && chat == null) loaded = false
                        replyingTo = null
                    }
                    is AtrioMessageReply.Conflict -> if (startedFirst) onContactConflict()
                    else -> Unit
                }
            }
            return
        }
        if (blockedByMe != false) {
            info = "Aguarde a verificação de bloqueio ou desbloqueie este participante."
            return
        }
        val body = if (shared == null) draft.trim() else "Discussão: " + shared.second
        if (saving || FirebaseAuth.getInstance().currentUser?.uid != uid ||
            !AtrioChatPolicy.validText(body)) {
            info = "Escreva uma mensagem válida de até 1.500 caracteres."
            return
        }
        if (chat == null && shared != null) {
            info = "Compartilhamentos exigem uma conversa aceita."
            return
        }
        if (chat == null && (!firstContact || requestSubmitted)) {
            info = "Aguarde a confirmação da conversa no servidor."
            return
        }
        if (chat == null && !AtrioChatPolicy.validRequest(body)) {
            info = "A primeira mensagem não pode conter links."
            return
        }
        if (chat == null && initialPeer == null) {
            info = "Não foi possível identificar o destinatário."
            return
        }
        saving = true
        info = "Aguardando confirmação do servidor..."
        val messageRef = if (pendingAttemptText == body && pendingAttemptId.isNotBlank())
            ref.collection("messages").document(pendingAttemptId)
        else ref.collection("messages").document().also { doc ->
            pendingAttemptId = doc.id
            pendingAttemptText = body
        }
        val bodyData = mutableMapOf<String, Any>(
            "uid" to uid, "text" to body,
            "kind" to if (shared == null) "text" else "post",
            "createdAt" to FieldValue.serverTimestamp())
        if (shared != null) {
            bodyData["postId"] = shared.first
            bodyData["postTitle"] = shared.second
        } else if (chat?.status == "accepted")
            replyingTo?.id?.let { bodyData["replyToId"] = it }
        if (chat == null) {
            val peer = initialPeer!!.uid
            val quotaRef = db.collection("users").document(uid)
                .collection("chatLimits").document("requests")
            db.runTransaction { tx ->
                // A leitura do contador é autorizada ao próprio usuário.
                // Não consultar um chat inexistente: uma leitura desse caminho
                // seria corretamente negada pelas regras de privacidade.
                val currentQuota = tx.get(quotaRef)
                val now = System.currentTimeMillis()
                val windowStart = currentQuota.getTimestamp("windowStart")
                val newWindow = windowStart == null ||
                    now - windowStart.toDate().time >= 86_400_000L
                val number = if (newWindow) 1L else
                    (currentQuota.getLong("count") ?: 0L) + 1L
                check(number <= 5L) { "Limite provisório de pedidos atingido." }
                tx.set(quotaRef, mapOf(
                    "count" to number,
                    "windowStart" to if (newWindow)
                        FieldValue.serverTimestamp() else windowStart!!,
                    "updatedAt" to FieldValue.serverTimestamp(),
                    "lastChatId" to chatId))
                tx.set(ref, mapOf(
                    "participants" to listOf(uid, peer),
                    "requesterUid" to uid, "recipientUid" to peer,
                    "status" to "pending", "initialId" to messageRef.id,
                    "lastMessageId" to messageRef.id, "lastPreview" to body,
                    "lastSenderUid" to uid,
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp(),
                    "unreadRequester" to 0, "unreadRecipient" to 1))
                tx.set(messageRef, bodyData)
                true
            }.addOnCompleteListener { response ->
                saving = false
                if (response.isSuccessful &&
                    FirebaseAuth.getInstance().currentUser?.uid == uid) {
                    if (draft.trim() == body) draft = ""
                    // Não permitir nova criação enquanto o GET autenticado
                    // confirma a transação. O índice pode ainda não existir.
                    requestSubmitted = true
                    loaded = false
                    confirmedRoom = true
                    info = "Solicitação enviada."
                    replyingTo = null
                    pendingAttemptId = ""; pendingAttemptText = ""
                } else if (FirebaseAuth.getInstance().currentUser?.uid != uid) {
                    info = "Sessão alterada. Entre novamente."
                } else {
                    info = "Pedido não confirmado. O destinatário pode não aceitar " +
                        "solicitações ou você atingiu o limite de novos contatos."
                }
            }
        } else if (chat?.status == "accepted") {
            db.runTransaction { tx ->
                val current = tx.get(ref)
                check(current.getString("status") == "accepted") { "Conversa não aceita." }
                val requester = current.getString("requesterUid")
                check(requester == uid || current.getString("recipientUid") == uid)
                val previous = tx.get(messageRef)
                if (previous.exists()) {
                    check(previous.getString("uid") == uid && previous.getString("text") == body)
                    false // Reenvio identificado: sem nova escrita ou notificação.
                } else {
                    val counter = if (requester == uid) "unreadRecipient" else "unreadRequester"
                    val number = current.getLong(counter) ?: 0L
                    tx.set(messageRef, bodyData)
                    tx.update(ref, mapOf(
                        "lastMessageId" to messageRef.id, "lastPreview" to body,
                    "lastSenderUid" to uid,
                        "updatedAt" to FieldValue.serverTimestamp(),
                        counter to (number + 1).coerceAtMost(99L)))
                    true
                }
            }.addOnCompleteListener { response ->
                saving = false
                if (response.isSuccessful) {
                    if (draft.trim() == body) draft = ""
                    replyingTo = null
                    if (shared != null) onShareSent()
                    info = ""
                    pendingAttemptId = ""; pendingAttemptText = ""
                }
                else info = "Envio não confirmado. Confira a conexão."
            }
        } else {
            saving = false
            info = "Aguarde o aceite antes de continuar."
        }
    }

    Column(Modifier.fillMaxSize().testTag("atrio-chat-thread")) {
        Row(Modifier.fillMaxWidth().padding(12.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack) { Text("Voltar") }
            Column(Modifier.weight(1f)) {
                Text(peerName, color = Wine, fontWeight = FontWeight.Bold, fontSize = 17.sp)
                if (peerUid.isNotBlank()) MemberBadgeRow(peerUid, Modifier.fillMaxWidth())
            }
        }
        HorizontalDivider(color = Line)
        if (!loaded) LinearProgressIndicator(Modifier.fillMaxWidth())
        if (!hiddenByManagedBlock && managedDraft != null) {
            val writeFeedback = when (val result = managedDraft.result) {
                null -> if (waitingForWrite) "Aguardando confirmação do servidor..." else ""
                is AtrioMessageReply.Committed ->
                    if (contactCommitted) "Solicitação enviada." else "Mensagem enviada."
                AtrioMessageReply.Pending -> "Envio pendente. Tente novamente."
                is AtrioMessageReply.Conflict -> when (result.code) {
                    "conversation_exists" -> "Já existe uma conversa. Conferindo o estado no servidor."
                    "conversation_not_accepted" -> "Envio não aceito. Confira o estado da conversa."
                    else -> "Conflito no envio. Confira a conversa e tente novamente."
                }
                is AtrioMessageReply.RateLimited -> if (result.seconds != null)
                    "Aguarde alguns segundos antes de reenviar." else "Limite de solicitações atingido."
                is AtrioMessageReply.Rejected -> when (result.code) {
                    "invalid_reply" -> "A mensagem citada está indisponível. Revise o rascunho."
                    "invalid_request" -> "Revise o texto antes de enviar."
                    else -> "Não foi possível enviar nesta conversa."
                }
            }
            if (writeFeedback.isNotBlank()) Text(writeFeedback,
                Modifier.padding(12.dp).testTag("atrio-message-write-feedback"),
                color = Muted, fontSize = 13.sp)
        }
        if (hiddenByManagedBlock) {
            Text("Conversa oculta por bloqueio ou solicitação pendente.", Modifier.padding(20.dp))
        } else if (accessDenied || (chat == null && !firstContact && loaded)) {
            Text("Conversa não encontrada ou acesso negado.", Modifier.padding(20.dp))
        } else {
            if ((requestSubmitted || contactCommitted) && chat == null) AtrioFirstContactStatus(
                Modifier.fillMaxWidth().padding(12.dp))
            if (chat?.incomingRequest(uid) == true) {
                Text("Apenas aceitar autoriza uma nova conversa. Visualizar não significa aceitar.",
                    Modifier.padding(12.dp), fontSize = 14.sp, color = Wine)
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(enabled = legacyWrites, onClick = {
                        ref.update("status", "accepted", "updatedAt", FieldValue.serverTimestamp())
                            .addOnFailureListener { info = "Aceite não confirmado." }
                    }) { Text("Aceitar") }
                    OutlinedButton(enabled = legacyWrites, onClick = {
                        ref.update("status", "declined", "updatedAt", FieldValue.serverTimestamp())
                            .addOnSuccessListener { onBack() }
                            .addOnFailureListener { info = "Recusa não confirmada." }
                    }) { Text("Recusar") }
                }
            } else if (chat?.status == "pending") {
                Text("Aguardando aceite do destinatário.", Modifier.padding(12.dp), color = Muted)
            } else if (chat?.status == "declined") {
                Text("Solicitação recusada.", Modifier.padding(12.dp), color = Muted)
            }
            if (hiddenMessageIds.isNotEmpty()) {
                TextButton(onClick = { showHiddenMessages = !showHiddenMessages },
                    modifier = Modifier.padding(horizontal = 12.dp)
                        .testTag("atrio-chat-hidden-toggle")) {
                    Text(if (showHiddenMessages) "Esconder mensagens ocultadas"
                        else "Ver mensagens ocultadas (" + hiddenMessageIds.size + ")")
                }
            }
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (messages.size >= limit) item {
                    TextButton(onClick = { limit += 40 }) { Text("Carregar anteriores") }
                }
                items(
                    if (showHiddenMessages) messages
                    else messages.filterNot { it.id in hiddenMessageIds },
                    key = { it.id }
                ) { msg ->
                    val isHidden = msg.id in hiddenMessageIds
                    Column(Modifier.fillMaxWidth(),
                        horizontalAlignment = if (msg.uid == uid) Alignment.End else Alignment.Start) {
                        Surface(shape = RoundedCornerShape(14.dp),
                            color = if (msg.uid == uid) WineSoft else MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, Line)) {
                            Column(Modifier.widthIn(max = 320.dp).padding(12.dp)) {
                                if (msg.replyToId != null) {
                                    val quoted = messages.firstOrNull {
                                        it.id == msg.replyToId &&
                                            it.id !in hiddenMessageIds
                                    }
                                    Text("↪ " + (quoted?.text?.take(100)
                                        ?: "Mensagem anterior"), fontSize = 13.sp,
                                        color = Muted, maxLines = 2,
                                        overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.height(5.dp))
                                }
                                if (isHidden) {
                                    Text("Esta mensagem está ocultada apenas para você.",
                                        fontSize = 14.sp, color = Muted)
                                } else if (msg.postId != null && msg.postTitle != null) {
                                    Text("Discussão compartilhada", fontSize = 13.sp,
                                        fontWeight = FontWeight.SemiBold, color = Wine)
                                    Text(msg.postTitle, fontSize = 16.sp, lineHeight = 22.sp,
                                        color = Ink)
                                    TextButton(onClick = { onOpenDiscussion(msg.postId) },
                                        modifier = Modifier.testTag("atrio-chat-open-post")) {
                                        Text("Abrir discussão original")
                                    }
                                } else Text(msg.text, fontSize = 16.sp,
                                    lineHeight = 22.sp, color = Ink)
                                if (!isHidden && !msg.deletedForAll && msg.reactions.isNotEmpty()) {
                                    val summary = msg.reactions.values.groupingBy { it }
                                        .eachCount().entries.joinToString("  ") {
                                            it.key + " " + it.value
                                        }
                                    Text(summary, fontSize = 13.sp, color = Wine,
                                        modifier = Modifier.testTag("atrio-chat-reactions"))
                                }
                                Text(
                                    (if (msg.pending) "Aguardando servidor"
                                    else chatTime(msg.whenSent)) +
                                    (if (msg.edited && !msg.deletedForAll) " • editada" else ""),
                                    fontSize = 12.sp, color = Muted)
                            }
                        }
                        if (isHidden) {
                            TextButton(onClick = {
                                db.collection("users").document(uid)
                                    .collection("chatHidden").document(chatId)
                                    .collection("messages").document(msg.id).delete()
                                    .addOnFailureListener {
                                        info = "Não foi possível restaurar a mensagem."
                                    }
                            }, modifier = Modifier.testTag("atrio-chat-unhide-message")) {
                                Text("Restaurar para mim", fontSize = 13.sp)
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                if (chat?.status == "accepted" && !msg.deletedForAll) {
                                    TextButton(enabled = managedDraft?.locked != true,
                                        onClick = { replyingTo = msg }) {
                                        Text("Responder", fontSize = 13.sp)
                                    }
                                    TextButton(enabled = legacyWrites, onClick = { reactingTo = msg }) {
                                        Text(if (msg.reactions.containsKey(uid))
                                            "Reagiu " + msg.reactions[uid] else "Reagir",
                                            fontSize = 13.sp)
                                    }
                                }
                                Box {
                                    TextButton(onClick = { messageMenuId = msg.id },
                                        modifier = Modifier.testTag("atrio-chat-more-message")) {
                                        Text("Mais", fontSize = 13.sp)
                                    }
                                    DropdownMenu(
                                        expanded = messageMenuId == msg.id,
                                        onDismissRequest = { messageMenuId = null }) {
                                        if (msg.uid == uid &&
                                            msg.kind == "text" && !msg.deletedForAll &&
                                            msg.whenSent > 0L) {
                                            val elapsed = System.currentTimeMillis() - msg.whenSent
                                            if (legacyWrites && editingEnabled && elapsed >= 0 &&
                                                elapsed <= editWindowMinutes * 60_000L) {
                                                DropdownMenuItem(text = { Text("Editar mensagem") },
                                                    onClick = {
                                                        messageMenuId = null
                                                        editingMessage = msg
                                                        editDraft = msg.text
                                                    })
                                            }
                                            if (legacyWrites && deletingEnabled && elapsed >= 0 &&
                                                elapsed <= deleteWindowMinutes * 60_000L) {
                                                DropdownMenuItem(text = {
                                                    Text("Remover para todos")
                                                }, onClick = {
                                                    messageMenuId = null
                                                    deletingMessage = msg
                                                })
                                            }
                                        }
                                        DropdownMenuItem(text = { Text("Denunciar mensagem") },
                                            onClick = {
                                                messageMenuId = null
                                                report = msg
                                            })
                                        DropdownMenuItem(text = {
                                            Text("Ocultar apenas para mim")
                                        }, onClick = {
                                            messageMenuId = null
                                            db.collection("users").document(uid)
                                                .collection("chatHidden").document(chatId)
                                                .collection("messages").document(msg.id)
                                                .set(mapOf(
                                                    "hidden" to true,
                                                    "createdAt" to FieldValue.serverTimestamp()))
                                                .addOnFailureListener {
                                                    info = "Não foi possível ocultar a mensagem."
                                                }
                                        })
                                    }
                                }
                            }
                        }
                    }
                }
            }
            if (info.isNotBlank()) Text(info, Modifier.padding(12.dp), color = Muted, fontSize = 13.sp)
            if (blockedByMe == true) Text(
                "Você bloqueou este participante. Desbloqueie para enviar mensagens.",
                Modifier.padding(horizontal = 12.dp, vertical = 6.dp), color = Wine)
            if (peerUid.isNotBlank() && blockedByMe == null) Text(
                "Verificando bloqueios...", Modifier.padding(horizontal = 12.dp),
                color = Muted, fontSize = 13.sp)
            if (chat?.status == "accepted" && sharePost != null) {
                Surface(shape = RoundedCornerShape(14.dp),
                    border = BorderStroke(1.dp, Gold),
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                    Column(Modifier.padding(12.dp),
                        verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        Text("Compartilhar discussão", fontWeight = FontWeight.SemiBold,
                            color = Wine)
                        Text(sharePost.second, maxLines = 2,
                            overflow = TextOverflow.Ellipsis)
                        Button(onClick = { send(sharePost) }, enabled = legacyWrites && !saving && blockedByMe == false,
                            modifier = Modifier.testTag("atrio-chat-share-post")) {
                            Text("Enviar cartão textual")
                        }
                    }
                }
            }
            if ((chat == null && firstContact && !requestSubmitted) ||
                chat?.status == "accepted" || retryingWrite) {
                if (replyingTo != null) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("↪ " + replyingTo!!.text.take(100),
                            modifier = Modifier.weight(1f), fontSize = 13.sp,
                            color = Wine, maxLines = 2,
                            overflow = TextOverflow.Ellipsis)
                        TextButton(enabled = managedDraft?.locked != true,
                            onClick = { replyingTo = null }) { Text("Cancelar resposta") }
                    }
                }
                val canWrite = (legacyWrites || managedMessages != null) &&
                    !saving && blockedByMe == false
                OutlinedTextField(textDraft, {
                    if (it.length <= AtrioChatPolicy.MAX_TEXT) {
                        if (legacyWrites) draft = it else managedMessages?.edit(draftKey, it)
                    }
                }, enabled = canWrite && managedDraft?.locked != true,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                        .testTag("atrio-chat-composer"),
                    label = { Text(if (chat == null) "Primeira mensagem" else "Mensagem") },
                    maxLines = 5,
                    supportingText = { Text(textDraft.length.toString() + "/1500 • somente texto") })
                val validDraft = if (!legacyWrites && firstContact)
                    AtrioChatPolicy.validRequest(textDraft.trim()) else textDraft.isNotBlank()
                Button(onClick = { send() }, enabled = canWrite && !waitingForWrite &&
                    !coolingDown && !revalidateWriteConflict && (retryingWrite || validDraft),
                    modifier = Modifier.fillMaxWidth().padding(12.dp)
                        .heightIn(min = 48.dp).testTag("atrio-chat-send")) {
                    Text(if (retryingWrite) "Tentar novamente"
                        else if (chat == null) "Solicitar conversa" else "Enviar")
                }
            }
            if (legacyWrites && chat != null && peerUid.isNotBlank() && blockedByMe != null) {
                OutlinedButton(onClick = {
                    val ref = db.collection("users").document(uid)
                        .collection("blockedMembers").document(peerUid)
                    if (blockedByMe == true) {
                        ref.delete().addOnFailureListener {
                            info = "Desbloqueio não confirmado."
                        }
                    } else {
                        ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
                            .addOnSuccessListener { onBack() }
                            .addOnFailureListener { info = "Bloqueio não confirmado." }
                    }
                }, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                    .testTag("atrio-chat-block-toggle")) {
                    Text(if (blockedByMe == true) "Desbloquear participante"
                         else "Bloquear participante")
                }
            }
        }
    }
    if (!hiddenByManagedBlock && legacyWrites && editingMessage != null && editingEnabled && chat?.status == "accepted") {
        val selectedMessage = editingMessage!!
        val proposed = editDraft.trim()
        AlertDialog(
            onDismissRequest = { if (!saving) editingMessage = null },
            title = { Text("Editar mensagem") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("A mensagem ficará identificada como editada. " +
                        "O texto anterior pode permanecer em denúncias já registradas.",
                        fontSize = 13.sp, color = Muted)
                    OutlinedTextField(editDraft, {
                        if (it.length <= AtrioChatPolicy.MAX_TEXT) editDraft = it
                    }, label = { Text("Texto atualizado") },
                        maxLines = 5,
                        modifier = Modifier.fillMaxWidth().testTag("atrio-chat-edit-field"))
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !saving && AtrioChatPolicy.validText(proposed) &&
                        proposed != selectedMessage.text,
                    onClick = {
                        saving = true
                        val messageRef = ref.collection("messages")
                            .document(selectedMessage.id)
                        db.runTransaction { tx ->
                            val latestRoom = tx.get(ref)
                            val latestMessage = tx.get(messageRef)
                            check(latestRoom.getString("status") == "accepted")
                            check(latestMessage.getString("uid") == uid)
                            check(latestMessage.getString("kind") == "text")
                            check(latestMessage.getBoolean("deletedForAll") != true)
                            tx.update(messageRef, mapOf(
                                "editedText" to proposed,
                                "editedAt" to FieldValue.serverTimestamp()))
                            if (latestRoom.getString("lastMessageId") == selectedMessage.id)
                                tx.update(ref, "lastPreview", proposed)
                            true
                        }.addOnCompleteListener { result ->
                            saving = false
                            info = if (result.isSuccessful) "Mensagem editada."
                                else "Edição não autorizada ou prazo encerrado."
                            if (result.isSuccessful) editingMessage = null
                        }
                    }) { Text("Salvar edição") }
            },
            dismissButton = {
                TextButton(onClick = { if (!saving) editingMessage = null }) {
                    Text("Cancelar")
                }
            }
        )
    }
    if (!hiddenByManagedBlock && legacyWrites && deletingMessage != null && deletingEnabled && chat?.status == "accepted") {
        val selectedMessage = deletingMessage!!
        AlertDialog(
            onDismissRequest = { if (!saving) deletingMessage = null },
            title = { Text("Remover mensagem para todos?") },
            text = {
                Text("O texto será substituído por 'Mensagem removida' na conversa " +
                    "dos participantes. Denúncias já registradas e eventuais cópias " +
                    "administrativas podem permanecer armazenadas.")
            },
            confirmButton = {
                TextButton(enabled = !saving,
                    onClick = {
                        saving = true
                        val messageRef = ref.collection("messages")
                            .document(selectedMessage.id)
                        db.runTransaction { tx ->
                            val latestRoom = tx.get(ref)
                            val latestMessage = tx.get(messageRef)
                            check(latestRoom.getString("status") == "accepted")
                            check(latestMessage.getString("uid") == uid)
                            check(latestMessage.getString("kind") == "text")
                            check(latestMessage.getBoolean("deletedForAll") != true)
                            tx.update(messageRef, mapOf(
                                "text" to "[Mensagem removida]",
                                "editedText" to FieldValue.delete(),
                                "reactions" to FieldValue.delete(),
                                "deletedForAll" to true,
                                "deletedAt" to FieldValue.serverTimestamp()))
                            if (latestRoom.getString("lastMessageId") == selectedMessage.id)
                                tx.update(ref, "lastPreview", "[Mensagem removida]")
                            true
                        }.addOnCompleteListener { result ->
                            saving = false
                            info = if (result.isSuccessful) "Mensagem retirada da conversa."
                                else "Remoção não autorizada ou prazo encerrado."
                            if (result.isSuccessful) deletingMessage = null
                        }
                    }) { Text("Remover para todos") }
            },
            dismissButton = {
                TextButton(onClick = { if (!saving) deletingMessage = null }) {
                    Text("Cancelar")
                }
            }
        )
    }
    if (!hiddenByManagedBlock && legacyWrites && reactingTo != null && chat?.status == "accepted") {
        val selected = reactingTo!!
        AlertDialog(onDismissRequest = { reactingTo = null },
            title = { Text("Reagir à mensagem") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    listOf("🙏", "❤️", "👍", "🙌", "🕊️").forEach { emoji ->
                        TextButton(onClick = {
                            ref.collection("messages").document(selected.id)
                                .update(FieldPath.of("reactions", uid), emoji)
                                .addOnFailureListener { info = "Reação não autorizada." }
                            reactingTo = null
                        }, modifier = Modifier.fillMaxWidth()) {
                            Text(emoji, fontSize = 24.sp)
                        }
                    }
                    if (selected.reactions[uid] != null) {
                        TextButton(onClick = {
                            ref.collection("messages").document(selected.id)
                                .update(FieldPath.of("reactions", uid), FieldValue.delete())
                                .addOnFailureListener { info = "Não foi possível remover a reação." }
                            reactingTo = null
                        }) { Text("Remover minha reação") }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { reactingTo = null }) { Text("Fechar") }
            })
    }
    if (!accessDenied && report != null && chat != null) {
        val selectedMessage = report!!
        AlertDialog(onDismissRequest = { if (!saving) report = null },
            title = { Text("Denunciar mensagem") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("A moderação recebe apenas esta mensagem e o motivo informado.")
                    Text(selectedMessage.text, maxLines = 3, overflow = TextOverflow.Ellipsis)
                    OutlinedTextField(reason, { reason = it.take(300) },
                        label = { Text("Motivo") }, maxLines = 4)
                }
            },
            confirmButton = {
                TextButton(enabled = !saving && reason.trim().length >= 5, onClick = {
                    saving = true
                    db.collection("chat_reports")
                        .document(uid + "__" + chatId + "__" + selectedMessage.id)
                        .set(mapOf(
                        "chatId" to chatId, "messageId" to selectedMessage.id,
                        "reporterUid" to uid, "reason" to reason.trim(),
                        "reportedText" to selectedMessage.text,
                        "createdAt" to FieldValue.serverTimestamp()))
                        .addOnCompleteListener { response ->
                            saving = false
                            info = if (response.isSuccessful) "Denúncia registrada."
                                else "Não foi possível denunciar."
                            if (response.isSuccessful) report = null
                        }
                }) { Text("Enviar denúncia") }
            },
            dismissButton = {
                TextButton(onClick = { report = null }) { Text("Cancelar") }
            })
    }
}

internal val atrioChatRequiresServer
    get() = BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT || BuildConfig.ATRIO_QA_GERAL_CELULAR_RODADA ||
        BuildConfig.ATRIO_QA_INBOX_DISCOVERY

internal val atrioChatMetadataChanges
    get() = if (atrioChatRequiresServer) MetadataChanges.INCLUDE
        else MetadataChanges.EXCLUDE

internal fun atrioChatSnapshotUsable(snapshot: DocumentSnapshot?): Boolean =
    !atrioChatRequiresServer || snapshot?.metadata?.isFromCache == false

internal fun atrioChatSnapshotUsable(snapshot: QuerySnapshot?): Boolean =
    !atrioChatRequiresServer || snapshot?.metadata?.isFromCache == false

internal fun atrioConversationConfigEnabled(snapshot: DocumentSnapshot?): Boolean =
    snapshot != null && atrioChatSnapshotUsable(snapshot) &&
        snapshot.get("enabled") == true && snapshot.get("minorPolicyApproved") == true &&
        snapshot.get("safetyReviewVersion") == "2026-11-safety-v1" &&
        snapshot.get("version") == AtrioChatPolicy.VERSION


// As regras leem documentos de controle além do alvo. O Emulator pode
// negar uma nova leitura sem encerrar um listener ativo sobre o alvo.
// O piloto usa uma consulta ao servidor sem listener persistente no mesmo alvo.
internal suspend fun <T> pollAtrioPilotServer(
    read: () -> Task<T>,
    onRead: (T?, Throwable?) -> Unit,
    intervalMs: Long = 2_000L
) {
    while (true) {
        val result = suspendCancellableCoroutine<Result<T>> { continuation ->
            read().addOnCompleteListener { task ->
                if (task.isSuccessful) continuation.resume(Result.success(task.result))
                else continuation.resume(Result.failure(task.exception
                    ?: IllegalStateException("Leitura do piloto cancelada.")))
            }
        }
        onRead(result.getOrNull(), result.exceptionOrNull())
        delay(intervalMs)
    }
}
