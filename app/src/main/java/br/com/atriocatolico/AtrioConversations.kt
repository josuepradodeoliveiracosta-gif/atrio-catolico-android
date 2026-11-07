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
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import java.text.DateFormat

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
    val postId: String? = null, val postTitle: String? = null)
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
private fun chatTime(value: Long): String =
    if (value <= 0) "" else DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
        .format(java.util.Date(value))

@Composable
private fun chatPeerName(db: FirebaseFirestore, uid: String, fallback: String = "Participante"): String {
    var label by remember(uid) { mutableStateOf(fallback) }
    DisposableEffect(db, uid) {
        val listener = db.collection("public_profiles").document(uid)
            .addSnapshotListener { doc, error ->
                if (error == null) label = doc?.getString("displayName")
                    ?.takeIf { it.isNotBlank() } ?: fallback
            }
        onDispose { listener.remove() }
    }
    return label
}

@Composable
internal fun AtrioConversationsScreen(
    db: FirebaseFirestore, uid: String, onBack: () -> Unit,
    initialPeer: PublicMemberTarget? = null,
    initialChatId: String? = null,
    initialSharePost: Pair<String, String>? = null,
    onOpenDiscussion: (String) -> Unit = {}
) {
    var enabled by remember(uid) { mutableStateOf(false) }
    var loadedConfig by remember(uid) { mutableStateOf(false) }
    var requestPolicy by remember(uid) { mutableStateOf("none") }
    var rooms by remember(uid) { mutableStateOf<List<ChatRoom>>(emptyList()) }
    var prefs by remember(uid) { mutableStateOf<Map<String, ChatPrefs>>(emptyMap()) }
    var loaded by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf("") }
    var search by remember(uid) { mutableStateOf("") }
    var requestsTab by remember(uid) { mutableStateOf(false) }
    var sharePost by remember(uid, initialSharePost) { mutableStateOf(initialSharePost) }
    var archivesTab by remember(uid) { mutableStateOf(false) }
    var selected by remember(uid, initialPeer?.uid, initialChatId) {
        mutableStateOf(initialChatId ?: initialPeer?.uid?.let { AtrioChatPolicy.id(uid, it) })
    }
    val chosen = rooms.firstOrNull { it.id == selected }

    DisposableEffect(db, uid) {
        val config = db.document("app_config/conversations").addSnapshotListener { doc, failure ->
            loadedConfig = true
            enabled = failure == null && doc?.getBoolean("enabled") == true &&
                doc.getString("version") == AtrioChatPolicy.VERSION
        }
        val privacy = db.collection("users").document(uid).collection("chatSettings")
            .document("privacy").addSnapshotListener { doc, failure ->
                if (failure == null) requestPolicy = doc?.getString("requests") ?: "none"
            }
        onDispose { config.remove(); privacy.remove() }
    }
    DisposableEffect(db, uid, enabled) {
        if (!enabled) { rooms = emptyList(); loaded = true; onDispose {} }
        else {
            loaded = false
            val listener = db.collection("chats").whereArrayContains("participants", uid)
                .limit(100).addSnapshotListener { snapshot, failure ->
                    loaded = true
                    if (failure == null) rooms = snapshot?.documents
                        ?.mapNotNull { it.chatRoom() }.orEmpty()
                    else error = "Não foi possível carregar as conversas."
                }
            onDispose { listener.remove() }
        }
    }
    DisposableEffect(db, uid, enabled) {
        if (!enabled) onDispose {}
        else {
            val listener = db.collection("users").document(uid).collection("chatBox")
                .limit(100).addSnapshotListener { snapshot, failure ->
                    if (failure == null) prefs = snapshot?.documents.orEmpty().associate { d ->
                        d.id to ChatPrefs(d.getBoolean("muted") == true,
                            d.getBoolean("pinned") == true, d.getBoolean("archived") == true)
                    }
                }
            onDispose { listener.remove() }
        }
    }
    fun changePrefs(chatId: String, updated: ChatPrefs) {
        db.collection("users").document(uid).collection("chatBox").document(chatId)
            .set(mapOf("muted" to updated.muted, "pinned" to updated.pinned,
                "archived" to updated.archived, "updatedAt" to FieldValue.serverTimestamp()))
            .addOnFailureListener { error = "Não foi possível atualizar as preferências." }
    }
    BackHandler(enabled = selected != null) { selected = null }
    Column(Modifier.fillMaxSize().background(Paper).testTag("atrio-chats-screen")) {
        if (FirebaseAuth.getInstance().currentUser?.uid != uid) {
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
        } else if (selected != null) {
            AtrioChatThread(db, uid, selected!!, chosen,
                initialPeer?.takeIf { AtrioChatPolicy.id(uid, it.uid) == selected },
                onBack = { selected = null },
                sharePost = sharePost,
                onShareSent = { sharePost = null },
                onOpenDiscussion = onOpenDiscussion)
        } else {
            if (sharePost != null) {
                Text("Escolha uma conversa já aceita para enviar o cartão textual da discussão. " +
                    "Para falar com alguém novo, abra primeiro o perfil dessa pessoa.",
                    Modifier.fillMaxWidth().padding(horizontal = 14.dp, vertical = 8.dp),
                    color = Wine, fontSize = 14.sp)
            }
            OutlinedTextField(search, { search = it.take(80) },
                modifier = Modifier.fillMaxWidth().padding(12.dp)
                    .testTag("atrio-chats-search"),
                singleLine = true, label = { Text("Buscar conversa") })
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
            val matches = rooms.filter { room ->
                (if (requestsTab) room.incomingRequest(uid)
                 else if (archivesTab) prefs[room.id]?.archived == true
                 else !room.incomingRequest(uid) && prefs[room.id]?.archived != true) &&
                (search.isBlank() || room.preview.contains(search, true))
            }.sortedWith(compareByDescending<ChatRoom> { prefs[it.id]?.pinned == true }
                .thenByDescending { it.lastAt })
            if (!loaded) LinearProgressIndicator(Modifier.fillMaxWidth())
            if (error.isNotBlank()) Text(error, Modifier.padding(12.dp), color = MaterialTheme.colorScheme.error)
            if (loaded && matches.isEmpty()) Text(
                if (requestsTab) "Nenhuma solicitação recebida."
                else if (archivesTab) "Nenhuma conversa arquivada."
                else "Nenhuma conversa nesta caixa de entrada.",
                Modifier.padding(20.dp), color = Muted)
            LazyColumn(Modifier.weight(1f).testTag("atrio-chats-list"),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(9.dp)) {
                items(matches, key = { it.id }) { room ->
                    val peer = room.peer(uid)
                    val name = chatPeerName(db, peer)
                    val minePrefs = prefs[room.id] ?: ChatPrefs()
                    Card(onClick = { selected = room.id },
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
                                if (room.incomingRequest(uid)) "Novo pedido" else "Aguardando aceite",
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
                        .addOnFailureListener { error = "Não foi possível salvar sua preferência." }
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
    onOpenDiscussion: (String) -> Unit
) {
    val ref = remember(db, chatId) { db.collection("chats").document(chatId) }
    var chat by remember(uid, chatId) { mutableStateOf(preview) }
    var loaded by remember(uid, chatId) { mutableStateOf(false) }
    var limit by remember(uid, chatId) { mutableIntStateOf(40) }
    var messages by remember(uid, chatId) { mutableStateOf<List<ChatItem>>(emptyList()) }
    var hiddenMessageIds by remember(uid, chatId) { mutableStateOf<Set<String>>(emptySet()) }
    DisposableEffect(db, uid, chatId) {
        val listener = db.collection("users").document(uid)
            .collection("chatHidden").document(chatId).collection("messages")
            .limit(500).addSnapshotListener { snapshot, failure ->
                if (failure == null) hiddenMessageIds = snapshot?.documents
                    ?.map { it.id }?.toSet().orEmpty()
            }
        onDispose { listener.remove() }
    }
    var draft by remember(uid, chatId) { mutableStateOf("") }
    var pendingAttemptId by remember(uid, chatId) { mutableStateOf("") }
    var pendingAttemptText by remember(uid, chatId) { mutableStateOf("") }
    var saving by remember(uid, chatId) { mutableStateOf(false) }
    var info by remember(uid, chatId) { mutableStateOf("") }
    var replyingTo by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var reactingTo by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var report by remember(uid, chatId) { mutableStateOf<ChatItem?>(null) }
    var reason by remember(uid, chatId) { mutableStateOf("") }
    val peerUid = chat?.peer(uid) ?: initialPeer?.uid.orEmpty()
    val peerName = chatPeerName(db, peerUid, initialPeer?.nameFromPublication ?: "Participante")
    DisposableEffect(uid, chatId) {
        AtrioChatForeground.open(uid, chatId)
        onDispose { AtrioChatForeground.close(uid, chatId) }
    }

    DisposableEffect(db, uid, chatId) {
        val listener = ref.addSnapshotListener { snapshot, error ->
            loaded = true
            if (error == null) chat = snapshot?.takeIf { it.exists() }?.chatRoom()
            else info = "Não foi possível sincronizar a conversa."
        }
        onDispose { listener.remove() }
    }
    DisposableEffect(db, chatId, limit, chat?.id) {
        if (chat == null) onDispose {}
        else {
            val listener = ref.collection("messages")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(limit.toLong())
                .addSnapshotListener { data, error ->
                    if (error == null) messages = data?.documents.orEmpty().mapNotNull { doc ->
                        val sender = doc.getString("uid") ?: return@mapNotNull null
                        val body = doc.getString("text") ?: return@mapNotNull null
                        val reactions = (doc.get("reactions") as? Map<*, *>)
                            ?.mapNotNull { (userId, emoji) ->
                                if (userId is String && emoji is String) userId to emoji else null
                            }?.toMap().orEmpty()
                        ChatItem(doc.id, sender, body,
                            doc.getTimestamp("createdAt")?.toDate()?.time ?: 0,
                            doc.metadata.hasPendingWrites(),
                            doc.getString("replyToId"), reactions,
                            doc.getString("postId"), doc.getString("postTitle"))
                    }.reversed() else info = "Não foi possível carregar as mensagens."
                }
            onDispose { listener.remove() }
        }
    }
    LaunchedEffect(chat?.id, chat?.unread(uid), chat?.status) {
        if (chat != null && chat!!.unread(uid) > 0 &&
            chat!!.status in listOf("pending", "accepted")) {
            ref.update(if (uid == chat!!.requester) "unreadRequester" else "unreadRecipient", 0)
        }
    }

    // Reconcilia resposta de rede perdida com a mensagem confirmada no servidor.
    LaunchedEffect(chat?.lastMessageId, pendingAttemptId) {
        if (pendingAttemptId.isNotBlank() && chat?.lastMessageId == pendingAttemptId &&
            chat?.preview == pendingAttemptText) {
            if (draft.trim() == pendingAttemptText) draft = ""
            pendingAttemptId = ""
            pendingAttemptText = ""
        }
    }

    fun send(shared: Pair<String, String>? = null) {
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
                    "createdAt" to FieldValue.serverTimestamp(),
                    "updatedAt" to FieldValue.serverTimestamp(),
                    "unreadRequester" to 0, "unreadRecipient" to 1))
                tx.set(messageRef, bodyData)
                true
            }.addOnCompleteListener { response ->
                saving = false
                if (response.isSuccessful) {
                    if (draft.trim() == body) draft = ""
                    info = "Solicitação enviada."
                    replyingTo = null
                    pendingAttemptId = ""; pendingAttemptText = ""
                    if (response.result == true &&
                        !(BuildConfig.DEBUG &&
                            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"))
                        InstantPushRelay.chatMessage(chatId, messageRef.id)
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
                    if (response.result == true &&
                        !(BuildConfig.DEBUG && com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"))
                        InstantPushRelay.chatMessage(chatId, messageRef.id)
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
        if (chat == null && initialPeer == null && loaded) {
            Text("Conversa não encontrada ou acesso negado.", Modifier.padding(20.dp))
        } else {
            if (chat?.incomingRequest(uid) == true) {
                Text("Apenas aceitar autoriza uma nova conversa. Visualizar não significa aceitar.",
                    Modifier.padding(12.dp), fontSize = 14.sp, color = Wine)
                Row(Modifier.padding(12.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Button(onClick = {
                        ref.update("status", "accepted", "updatedAt", FieldValue.serverTimestamp())
                            .addOnFailureListener { info = "Aceite não confirmado." }
                    }) { Text("Aceitar") }
                    OutlinedButton(onClick = {
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
            LazyColumn(Modifier.weight(1f).fillMaxWidth(), contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (messages.size >= limit) item {
                    TextButton(onClick = { limit += 40 }) { Text("Carregar anteriores") }
                }
                items(messages.filterNot { it.id in hiddenMessageIds }, key = { it.id }) { msg ->
                    Column(Modifier.fillMaxWidth(),
                        horizontalAlignment = if (msg.uid == uid) Alignment.End else Alignment.Start) {
                        Surface(shape = RoundedCornerShape(14.dp),
                            color = if (msg.uid == uid) WineSoft else MaterialTheme.colorScheme.surface,
                            border = BorderStroke(1.dp, Line)) {
                            Column(Modifier.widthIn(max = 320.dp).padding(12.dp)) {
                                if (msg.replyToId != null) {
                                    val quoted = messages.firstOrNull { it.id == msg.replyToId }
                                    Text("↪ " + (quoted?.text?.take(100)
                                        ?: "Mensagem anterior"), fontSize = 13.sp,
                                        color = Muted, maxLines = 2,
                                        overflow = TextOverflow.Ellipsis)
                                    Spacer(Modifier.height(5.dp))
                                }
                                if (msg.postId != null && msg.postTitle != null) {
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
                                if (msg.reactions.isNotEmpty()) {
                                    val summary = msg.reactions.values.groupingBy { it }
                                        .eachCount().entries.joinToString("  ") {
                                            it.key + " " + it.value
                                        }
                                    Text(summary, fontSize = 13.sp, color = Wine,
                                        modifier = Modifier.testTag("atrio-chat-reactions"))
                                }
                                Text(if (msg.pending) "Aguardando servidor" else chatTime(msg.whenSent),
                                    fontSize = 12.sp, color = Muted)
                            }
                        }
                        if (chat?.status == "accepted") {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                TextButton(onClick = { replyingTo = msg }) {
                                    Text("Responder", fontSize = 12.sp)
                                }
                                TextButton(onClick = { reactingTo = msg }) {
                                    Text(if (msg.reactions.containsKey(uid))
                                        "Reagiu " + msg.reactions[uid] else "Reagir",
                                        fontSize = 12.sp)
                                }
                                TextButton(onClick = { report = msg }) {
                                    Text("Denunciar", fontSize = 12.sp)
                                }
                                TextButton(onClick = {
                                    db.collection("users").document(uid)
                                        .collection("chatHidden").document(chatId)
                                        .collection("messages").document(msg.id)
                                        .set(mapOf(
                                            "hidden" to true,
                                            "createdAt" to FieldValue.serverTimestamp()))
                                        .addOnFailureListener {
                                            info = "Não foi possível ocultar a mensagem."
                                        }
                                }) { Text("Ocultar para mim", fontSize = 12.sp) }
                            }
                        } else {
                            Row(horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                                TextButton(onClick = { report = msg }) {
                                    Text("Denunciar", fontSize = 12.sp)
                                }
                                TextButton(onClick = {
                                    db.collection("users").document(uid)
                                        .collection("chatHidden").document(chatId)
                                        .collection("messages").document(msg.id)
                                        .set(mapOf(
                                            "hidden" to true,
                                            "createdAt" to FieldValue.serverTimestamp()))
                                        .addOnFailureListener {
                                            info = "Não foi possível ocultar a mensagem."
                                        }
                                }) { Text("Ocultar para mim", fontSize = 12.sp) }
                            }
                        }
                    }
                }
            }
            if (info.isNotBlank()) Text(info, Modifier.padding(12.dp), color = Muted, fontSize = 13.sp)
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
                        Button(onClick = { send(sharePost) }, enabled = !saving,
                            modifier = Modifier.testTag("atrio-chat-share-post")) {
                            Text("Enviar cartão textual")
                        }
                    }
                }
            }
            if (chat == null || chat?.status == "accepted") {
                if (replyingTo != null) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text("↪ " + replyingTo!!.text.take(100),
                            modifier = Modifier.weight(1f), fontSize = 13.sp,
                            color = Wine, maxLines = 2,
                            overflow = TextOverflow.Ellipsis)
                        TextButton(onClick = { replyingTo = null }) { Text("Cancelar resposta") }
                    }
                }
                OutlinedTextField(draft, { if (it.length <= AtrioChatPolicy.MAX_TEXT) draft = it },
                    enabled = !saving,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)
                        .testTag("atrio-chat-composer"),
                    label = { Text(if (chat == null) "Primeira mensagem" else "Mensagem") },
                    maxLines = 5,
                    supportingText = { Text(draft.length.toString() + "/1500 • somente texto") })
                Button(onClick = { send() }, enabled = !saving && draft.isNotBlank(),
                    modifier = Modifier.fillMaxWidth().padding(12.dp)
                        .heightIn(min = 48.dp).testTag("atrio-chat-send")) {
                    Text(if (chat == null) "Solicitar conversa" else "Enviar")
                }
            }
            if (chat != null && peerUid.isNotBlank()) {
                OutlinedButton(onClick = {
                    db.collection("users").document(uid).collection("blockedMembers")
                        .document(peerUid).set(mapOf("createdAt" to FieldValue.serverTimestamp()))
                        .addOnSuccessListener { onBack() }
                        .addOnFailureListener { info = "Bloqueio não confirmado." }
                }, modifier = Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                    Text("Bloquear participante")
                }
            }
        }
    }
    if (reactingTo != null && chat?.status == "accepted") {
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
    if (report != null && chat != null) {
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
                    db.collection("chat_reports").add(mapOf(
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
