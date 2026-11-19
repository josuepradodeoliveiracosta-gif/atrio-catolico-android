package br.com.atriocatolico

import android.content.Context
import android.content.SharedPreferences
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import java.text.DateFormat
import java.util.Date

/** Local preferences never grant a role. Permissions are checked by Firestore. */
internal class NotificationInbox(
    private val db: FirebaseFirestore,
    val uid: String,
    private val prefs: SharedPreferences,
    private val currentSession: () -> Boolean,
    private val blockedMembers: () -> Set<String>?,
    private val isAdmin: () -> Boolean
) {
    var replies by mutableStateOf<List<NoticeEvent>>(emptyList())
    var review by mutableStateOf<NoticeEvent?>(null)
    var reports by mutableStateOf<List<NoticeEvent>>(emptyList())
    var requests by mutableStateOf<List<NoticeEvent>>(emptyList())
    var seen by mutableStateOf(prefs.getStringSet("seen", emptySet())!!.toSet())
    var enabledReplies by mutableStateOf(prefs.getBoolean("replies", true))
    var enabledReview by mutableStateOf(prefs.getBoolean("review", true))
    var enabledAdmin by mutableStateOf(prefs.getBoolean("admin", true))
    var limit by mutableStateOf(50)
    var retry by mutableStateOf(0)
    var replyMore by mutableStateOf(false)
    var reportsMore by mutableStateOf(false)
    var requestsMore by mutableStateOf(false)
    var loadingReplies by mutableStateOf(true)
    var loadingReview by mutableStateOf(true)
    var loadingAdmin by mutableStateOf(false)
    var staleReplies by mutableStateOf(false)
    var staleReview by mutableStateOf(false)
    var replyError by mutableStateOf(false)
    var reviewError by mutableStateOf(false)
    var reportsError by mutableStateOf(false)
    var requestsError by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var feedback by mutableStateOf("")

    private var active = true

    fun sessionIsCurrent(): Boolean = active && currentSession()

    fun detach() { active = false }

    fun groups(admin: Boolean): List<NoticeGroup> {
        if (!sessionIsCurrent()) return emptyList()
        val blocked = blockedMembers() ?: return emptyList()
        val includeAdmin = admin && isAdmin()
        val local = (if (enabledReview) listOfNotNull(review) else emptyList()) +
            (if (includeAdmin && enabledAdmin) reports + requests else emptyList())
        val visibleReplies = if (enabledReplies) replies.filter {
            canShowWithBlockedMembers(blocked, it.actorUid)
        } else emptyList()
        return groupNotices(visibleReplies + local.map { it.copy(read = it.localToken in seen) }, includeAdmin)
    }

    fun preference(key: String, value: Boolean) {
        if (!sessionIsCurrent()) return
        when (key) { "replies" -> enabledReplies = value; "review" -> enabledReview = value; "admin" -> enabledAdmin = value }
        prefs.edit().putBoolean(key, value).apply()
    }

    fun markRead(selected: List<NoticeGroup>, done: () -> Unit = {}) {
        if (busy || !sessionIsCurrent() || !groups(isAdmin()).containsAll(selected)) return
        val events = selected.flatMap { it.events }.distinctBy { it.kind.name to it.id }
        val unreadReplies = events.filter { it.kind == NoticeKind.REPLY && !it.read }
        val localTokens = events.map { it.localToken }.filter { it.isNotBlank() }
        write(unreadReplies, dismiss = false) { ok ->
            if (ok) {
                // Metadados de leitura são locais à conta, limitados e consultivos.
                seen = (seen + localTokens).toList().takeLast(4000).toSet()
                prefs.edit().putStringSet("seen", seen).apply()
                done()
            } else {
                feedback = "Não foi possível marcar todos os avisos. Atualize a lista e tente novamente."
            }
        }
    }

    fun dismiss(group: NoticeGroup) {
        if (busy || !sessionIsCurrent() || group.kind != NoticeKind.REPLY ||
            group !in groups(admin = false)
        ) return
        write(group.events, dismiss = true) { ok ->
            if (!ok) feedback = "Não foi possível dispensar todos os avisos. Tente novamente."
        }
    }

    private fun write(events: List<NoticeEvent>, dismiss: Boolean, done: (Boolean) -> Unit) {
        busy = true
        feedback = ""
        val notices = db.collection("users").document(uid).collection("notifications")
        runNoticeBatches(events.chunked(400), ::sessionIsCurrent,
            submit = { chunk, complete ->
                val batch = db.batch()
                chunk.forEach {
                    val notice = notices.document(it.id)
                    if (dismiss) batch.delete(notice) else batch.update(notice, "read", true)
                }
                if (sessionIsCurrent()) {
                    batch.commit().addOnCompleteListener { complete(it.isSuccessful) }
                }
            },
            finish = { ok ->
                busy = false
                done(ok)
            }
        )
    }
}

private fun DocumentSnapshot.noticeTime(field: String = "createdAt") = getTimestamp(field)?.toDate()?.time ?: 0L
private fun DocumentSnapshot.noticeToken(prefix: String, field: String = "createdAt"): String {
    val time = getTimestamp(field)
    return "$prefix:$id:${time?.seconds ?: 0}:${time?.nanoseconds ?: 0}"
}

@Composable
internal fun rememberNotificationInbox(
    db: FirebaseFirestore, uid: String, admin: Boolean, blocked: Set<String>?
): NotificationInbox {
    val context = LocalContext.current.applicationContext
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    val session = rememberAtrioCurrentUser(auth)
    val blockedMembers = rememberUpdatedState(blocked)
    val currentAdmin = rememberUpdatedState(admin)
    val inbox = remember(db, uid, session) {
        NotificationInbox(db, uid, context.getSharedPreferences("atrio_notices_$uid", Context.MODE_PRIVATE),
            { session != null && session.uid == uid && auth.currentUser === session },
            { blockedMembers.value }, { currentAdmin.value })
    }
    DisposableEffect(inbox) {
        onDispose { inbox.detach() }
    }
    if (!inbox.sessionIsCurrent()) return inbox
    DisposableEffect(inbox, inbox.limit, inbox.retry) {
        var active = true
        inbox.loadingReplies = true
        inbox.replyError = false
        val listener = db.collection("users").document(uid).collection("notifications")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(inbox.limit.toLong() + 1)
            .addSnapshotListener(MetadataChanges.INCLUDE) { data, error -> if (active && inbox.sessionIsCurrent()) {
                inbox.staleReplies = error == null && data != null &&
                    (data.metadata.isFromCache || data.metadata.hasPendingWrites())
                inbox.loadingReplies = false
                inbox.replyError = error != null
                inbox.replyMore = error == null && (data?.size() ?: 0) > inbox.limit
                inbox.replies = if (error != null) emptyList() else data?.documents?.take(inbox.limit)?.mapNotNull {
                    val post = it.getString("postId").orEmpty()
                    if (post.isBlank() || '/' in post) null else {
                        val mentioned = !it.getString("mentionUid").isNullOrBlank()
                        val direct = !it.getString("replyToId").isNullOrBlank()
                        val actor = NoticePrivacyPolicy.safeActorName(it.getString("actorName"))
                        val title = when {
                            mentioned -> "$actor mencionou você"
                            direct -> "$actor respondeu ao seu comentário"
                            else -> "$actor respondeu à discussão"
                        }
                        NoticeEvent(it.id, NoticeKind.REPLY, post, title,
                            "Toque para abrir a discussão.", it.noticeTime(),
                            it.getBoolean("read") == true,
                            directReply = direct, mentioned = mentioned,
                            actorUid = it.getString("actorUid").orEmpty())
                    }
                } ?: emptyList()
            } }
        onDispose { active = false; listener.remove() }
    }
    DisposableEffect(inbox, inbox.retry) {
        var active = true
        inbox.loadingReview = true
        inbox.reviewError = false
        val listener = db.collection("badge_requests").document(uid)
            .addSnapshotListener(MetadataChanges.INCLUDE) { data, error ->
            if (active && inbox.sessionIsCurrent()) {
                inbox.staleReview = error == null && data != null &&
                    (data.metadata.isFromCache || data.metadata.hasPendingWrites())
                inbox.loadingReview = false
                inbox.reviewError = error != null
                // Never expose reviewNote, reviewedBy or another member's private profile.
                inbox.review = if (error != null || data == null || !data.exists()) null else reviewNotice(
                    data.getString("status").orEmpty(), data.getString("kind").orEmpty(),
                    data.noticeTime("reviewedAt"), data.noticeToken("review", "reviewedAt") + ":" + data.getString("status"))
            }
        }
        onDispose { active = false; listener.remove() }
    }
    DisposableEffect(inbox, admin, inbox.limit, inbox.retry) {
        var active = true
        inbox.reports = emptyList()
        inbox.requests = emptyList()
        inbox.reportsMore = false
        inbox.requestsMore = false
        inbox.reportsError = false
        inbox.requestsError = false
        inbox.loadingAdmin = admin
        if (!admin) {
            onDispose { active = false }
        } else {
            var reportsLoaded = false
            var requestsLoaded = false
            // Legacy reports omit status; scan paginated records to include those pending reports.
            val reports = db.collection("reports").orderBy("createdAt", Query.Direction.DESCENDING)
                .limit(inbox.limit.toLong() + 1)
                .addSnapshotListener(MetadataChanges.INCLUDE) { data, error -> if (active && inbox.sessionIsCurrent()) {
                    reportsLoaded = true
                    inbox.loadingAdmin = !requestsLoaded
                    val trusted = error == null && data != null &&
                        NoticePrivacyPolicy.serverConfirmed(
                            data.metadata.isFromCache, data.metadata.hasPendingWrites(),
                            inbox.sessionIsCurrent())
                    inbox.reportsError = !trusted
                    inbox.reportsMore = trusted && (data?.size() ?: 0) > inbox.limit
                    inbox.reports = if (!trusted) emptyList() else data?.documents?.take(inbox.limit)
                        ?.filter { (it.getString("status") ?: "pending") == "pending" }?.map {
                            NoticeEvent(it.id, NoticeKind.REPORTS, title = "Denúncia pendente", body = "",
                                at = it.noticeTime(), localToken = it.noticeToken("report"))
                        } ?: emptyList()
                } }
            // Equality-only query avoids requiring a new composite index.
            val requests = db.collection("badge_requests").whereEqualTo("status", "pending")
                .limit(inbox.limit.toLong() + 1)
                .addSnapshotListener(MetadataChanges.INCLUDE) { data, error -> if (active && inbox.sessionIsCurrent()) {
                    requestsLoaded = true
                    inbox.loadingAdmin = !reportsLoaded
                    val trusted = error == null && data != null &&
                        NoticePrivacyPolicy.serverConfirmed(
                            data.metadata.isFromCache, data.metadata.hasPendingWrites(),
                            inbox.sessionIsCurrent())
                    inbox.requestsError = !trusted
                    inbox.requestsMore = trusted && (data?.size() ?: 0) > inbox.limit
                    inbox.requests = if (!trusted) emptyList() else data?.documents?.take(inbox.limit)?.map {
                        NoticeEvent(it.id, NoticeKind.REQUESTS, title = "Solicitação pendente", body = "",
                            at = it.noticeTime(), localToken = it.noticeToken("request"))
                    } ?: emptyList()
                } }
            onDispose { active = false; reports.remove(); requests.remove() }
        }
    }
    return inbox
}

/**
 * Mensagem de conectividade acessível. Distingue erro de lista realmente vazia
 * e cache local de confirmação remota, sem exibir payloads privados.
 */
@Composable
internal fun NotificationConnectionStatus(
    failed: Boolean, stale: Boolean, onRetry: () -> Unit
) {
    if (failed) {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Alguns avisos não puderam ser consultados. Confira sua conexão e suas permissões.",
                color = MaterialTheme.colorScheme.error, fontSize = AtrioType.secondary,
                modifier = Modifier.testTag("atrio-notices-load-error")
                    .semantics { liveRegion = LiveRegionMode.Polite })
            OutlinedButton(onClick = onRetry,
                modifier = Modifier.heightIn(min = 48.dp).testTag("atrio-notices-retry")) {
                Text("Tentar novamente")
            }
        }
    } else if (stale) {
        Text("Sem conexão com o servidor. Os avisos salvos neste aparelho podem estar desatualizados.",
            color = MaterialTheme.colorScheme.error, fontSize = AtrioType.secondary,
            modifier = Modifier.testTag("atrio-notices-offline")
                .semantics { liveRegion = LiveRegionMode.Polite })
    }
}

@Composable
internal fun NotificationCenter(
    inbox: NotificationInbox, admin: Boolean, postTitles: Map<String, String>,
    onOpen: (NoticeGroup) -> Unit
) {
    if (!inbox.sessionIsCurrent()) {
        Text("Sessão alterada. Entre novamente para consultar seus avisos.",
            modifier = Modifier.padding(20.dp).semantics {
                liveRegion = LiveRegionMode.Polite
            })
        return
    }
    var filter by rememberSaveable(inbox.uid) { mutableStateOf("Todas") }
    var preferences by rememberSaveable(inbox.uid) { mutableStateOf(false) }
    var dismissTarget by remember(inbox) { mutableStateOf<NoticeGroup?>(null) }
    val groups = inbox.groups(admin)
    LaunchedEffect(dismissTarget, groups) {
        if (dismissTarget?.let { it !in groups } == true) dismissTarget = null
    }
    val selectedFilter = if (!admin && filter == "Administração") "Todas" else filter
    val shown = groups.filter { when (selectedFilter) {
        "Não lidas" -> it.unread
        "Administração" -> it.administrative
        else -> true
    } }
    val loading = inbox.loadingReplies || inbox.loadingReview || (admin && inbox.loadingAdmin)
    val failed = inbox.replyError || inbox.reviewError || (admin && (inbox.reportsError || inbox.requestsError))
    val more = inbox.replyMore || (admin && (inbox.reportsMore || inbox.requestsMore))
    val stale = inbox.staleReplies || inbox.staleReview
    LazyColumn(Modifier.fillMaxSize().testTag("atrio-notices-list"), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionTitle("Sua central de avisos",
                Modifier.semantics { heading() })
            Text("Respostas a discussões, verificações e novidades dos seus pedidos. " +
                "O texto de mensagens privadas não aparece nesta central.",
                color = Muted, fontSize = AtrioType.secondary)
            TextButton(onClick = { preferences = true }) { Text("Preferências de avisos") }
            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                items(listOf("Todas", "Não lidas") + if (admin) listOf("Administração") else emptyList()) { label ->
                    FilterChip(selected = selectedFilter == label, onClick = { filter = label }, label = { Text(label) })
                }
            }
            TextButton(enabled = !inbox.busy && groups.any { it.unread }, onClick = {
                inbox.markRead(groups) { inbox.feedback = "Avisos carregados marcados como lidos." }
            }) { Text(if (inbox.busy) "Aguarde..." else "Marcar todas as carregadas como lidas") }
        }
        if (admin && inbox.enabledAdmin) item {
            Text("As pendências continuam abertas até uma decisão. Ler o aviso não conclui a análise. " +
                "As contagens consideram os registros carregados.", color = Muted, fontSize = AtrioType.secondary)
        }
        if (failed || stale) item {
            NotificationConnectionStatus(failed = failed, stale = stale) {
                inbox.retry++
            }
        }
        if (inbox.feedback.isNotBlank()) item { Text(inbox.feedback, color = Wine, fontSize = AtrioType.secondary) }
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (shown.isEmpty() && !loading && !failed) item {
            Text(when {
                stale -> "Não há avisos carregados neste filtro. Reconecte-se para conferir novos avisos."
                more -> "Nenhum aviso neste filtro entre os registros carregados. Busque mais para consultar os anteriores."
                selectedFilter == "Não lidas" -> "Nenhum aviso não lido. Confira novamente mais tarde."
                else -> "Nenhum aviso neste filtro. Confira também suas preferências."
            }, color = Muted)
        }
        items(shown, key = { it.id }) { group ->
            Card(onClick = {
                // O callback de navegação também valida a conta no instante do toque.
                // Não abrir destinos da sessão anterior enquanto o Compose recompõe.
                if (!inbox.busy &&
                    FirebaseAuth.getInstance(inbox.db.app).currentUser?.uid == inbox.uid) {
                    inbox.markRead(listOf(group)); onOpen(group)
                }
            },
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = if (group.unread) WineSoft else Color.White)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(when (group.kind) {
                            NoticeKind.REPLY -> "Respostas"
                            NoticeKind.REVIEW -> "Verificação de selo"
                            NoticeKind.REPORTS -> "Administração · denúncias"
                            NoticeKind.REQUESTS -> "Administração · selos"
                        }, color = Wine, fontSize = AtrioType.secondary, modifier = Modifier.weight(1f))
                        if (group.unread) Badge { Text("Novo") }
                    }
                    Text(group.title, fontWeight = FontWeight.Bold)
                    Text(if (group.kind == NoticeKind.REPLY) postTitles[group.target] ?: group.body else group.body,
                        color = Muted, fontSize = AtrioType.reading, lineHeight = AtrioType.readingLine)
                    if (group.at > 0L) Text(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                        .format(Date(group.at)), color = Muted, fontSize = AtrioType.metadata)
                    if (group.administrative) Text("Pendente de decisão", color = Wine, fontSize = AtrioType.secondary)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (group.unread) TextButton(enabled = !inbox.busy,
                            onClick = { inbox.markRead(listOf(group)) }) { Text("Marcar como lido") }
                        if (group.kind == NoticeKind.REPLY) TextButton(enabled = !inbox.busy,
                            modifier = Modifier.testTag("atrio-notice-dismiss"),
                            onClick = { if (group in inbox.groups(admin)) dismissTarget = group }) { Text("Dispensar") }
                    }
                }
            }
        }
        if (more) item {
            OutlinedButton(enabled = !loading && !inbox.busy, modifier = Modifier.fillMaxWidth(),
                onClick = { inbox.limit += 50 }) { Text("Buscar mais avisos e pendências") }
        }
    }
    if (preferences) AlertDialog(onDismissRequest = { preferences = false },
        title = { Text("Preferências de avisos") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                NoticePreference("Respostas às minhas discussões", inbox.enabledReplies) { inbox.preference("replies", it) }
                NoticePreference("Resultado da verificação de selo", inbox.enabledReview) { inbox.preference("review", it) }
                if (admin) NoticePreference("Pendências administrativas", inbox.enabledAdmin) { inbox.preference("admin", it) }
                Text("Estas opções controlam os avisos exibidos na central e no sino. Não apagam pedidos nem denúncias.", fontSize = AtrioType.secondary, color = Muted)
                Text("Preferências e leitura dos avisos de verificação e administração são salvas por conta neste aparelho. " +
                    "A leitura das respostas é sincronizada na sua conta. Para avisos fora do aplicativo, confira Avisos neste aparelho no Perfil.", fontSize = AtrioType.secondary, color = Muted)
            }
        }, confirmButton = { TextButton(onClick = { preferences = false }) { Text("Concluir") } })
    dismissTarget?.takeIf { it in groups }?.let { target -> AlertDialog(onDismissRequest = { dismissTarget = null },
        title = { Text("Dispensar avisos de respostas?") },
        text = { Text("Os ${target.events.size} aviso(s) carregados desta conversa serão removidos. As respostas continuarão na discussão.") },
        confirmButton = { TextButton(onClick = { inbox.dismiss(target); dismissTarget = null }) { Text("Dispensar") } },
        dismissButton = { TextButton(onClick = { dismissTarget = null }) { Text("Cancelar") } }) }
}

@Composable
private fun NoticePreference(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(Modifier.fillMaxWidth().heightIn(min = 56.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Switch(checked = value, onCheckedChange = change)
    }
}
