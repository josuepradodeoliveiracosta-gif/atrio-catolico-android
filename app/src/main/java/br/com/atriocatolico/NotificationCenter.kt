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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import java.text.DateFormat
import java.util.Date

/** Local preferences never grant a role. Permissions are checked by Firestore. */
internal class NotificationInbox(val db: FirebaseFirestore, val uid: String, private val prefs: SharedPreferences) {
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
    var replyError by mutableStateOf(false)
    var reviewError by mutableStateOf(false)
    var reportsError by mutableStateOf(false)
    var requestsError by mutableStateOf(false)
    var busy by mutableStateOf(false)
    var feedback by mutableStateOf("")

    fun groups(admin: Boolean): List<NoticeGroup> {
        val local = (if (enabledReview) listOfNotNull(review) else emptyList()) +
            (if (admin && enabledAdmin) reports + requests else emptyList())
        return groupNotices((if (enabledReplies) replies else emptyList()) +
            local.map { it.copy(read = it.localToken in seen) }, admin)
    }
    fun preference(key: String, value: Boolean) {
        when (key) { "replies" -> enabledReplies = value; "review" -> enabledReview = value; "admin" -> enabledAdmin = value }
        prefs.edit().putBoolean(key, value).apply()
    }
    fun markRead(groups: List<NoticeGroup>, done: () -> Unit = {}) {
        if (busy) return
        val events = groups.flatMap { it.events }.distinctBy { it.kind.name + it.id }
        val unreadReplies = events.filter { it.kind == NoticeKind.REPLY && !it.read }
        val localTokens = events.map { it.localToken }.filter { it.isNotBlank() }
        fun saveLocal() {
            // Bounded per-account metadata. Read state is advisory, never authorization.
            seen = (seen + localTokens).toList().takeLast(4000).toSet()
            prefs.edit().putStringSet("seen", seen).apply()
            busy = false
            done()
        }
        if (unreadReplies.isEmpty()) { saveLocal(); return }
        busy = true
        feedback = ""
        val chunks = unreadReplies.chunked(400)
        fun commit(index: Int) {
            if (index == chunks.size) { saveLocal(); return }
            val batch = db.batch()
            chunks[index].forEach { batch.update(db.collection("users").document(uid)
                .collection("notifications").document(it.id), "read", true) }
            batch.commit().addOnSuccessListener { commit(index + 1) }.addOnFailureListener {
                busy = false
                feedback = "Não foi possível marcar todos os avisos. Atualize a lista e tente novamente."
            }
        }
        commit(0)
    }
    fun dismiss(group: NoticeGroup) {
        if (busy || group.kind != NoticeKind.REPLY) return
        busy = true
        feedback = ""
        val chunks = group.events.chunked(400)
        fun commit(index: Int) {
            if (index == chunks.size) { busy = false; return }
            val batch = db.batch()
            chunks[index].forEach { batch.delete(db.collection("users").document(uid)
                .collection("notifications").document(it.id)) }
            batch.commit().addOnSuccessListener { commit(index + 1) }.addOnFailureListener {
                busy = false
                feedback = "Não foi possível dispensar todos os avisos. Tente novamente."
            }
        }
        commit(0)
    }
}

private fun DocumentSnapshot.noticeTime(field: String = "createdAt") = getTimestamp(field)?.toDate()?.time ?: 0L
private fun DocumentSnapshot.noticeToken(prefix: String, field: String = "createdAt"): String {
    val time = getTimestamp(field)
    return "$prefix:$id:${time?.seconds ?: 0}:${time?.nanoseconds ?: 0}"
}

@Composable
internal fun rememberNotificationInbox(db: FirebaseFirestore, uid: String, admin: Boolean): NotificationInbox {
    val context = LocalContext.current.applicationContext
    val inbox = remember(db, uid) { NotificationInbox(db, uid,
        context.getSharedPreferences("atrio_notices_$uid", Context.MODE_PRIVATE)) }
    DisposableEffect(db, uid, inbox.limit, inbox.retry) {
        var active = true
        inbox.loadingReplies = true
        inbox.replyError = false
        val listener = db.collection("users").document(uid).collection("notifications")
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(inbox.limit.toLong() + 1)
            .addSnapshotListener { data, error -> if (active) {
                inbox.loadingReplies = false
                inbox.replyError = error != null
                inbox.replyMore = error == null && (data?.size() ?: 0) > inbox.limit
                inbox.replies = if (error != null) emptyList() else data?.documents?.take(inbox.limit)?.mapNotNull {
                    val post = it.getString("postId").orEmpty()
                    if (post.isBlank() || '/' in post) null else NoticeEvent(it.id, NoticeKind.REPLY, post,
                        "${it.getString("actorName") ?: "Alguém"} respondeu à discussão",
                        "Toque para abrir a conversa.", it.noticeTime(), it.getBoolean("read") == true)
                } ?: emptyList()
            } }
        onDispose { active = false; listener.remove() }
    }
    DisposableEffect(db, uid, inbox.retry) {
        var active = true
        inbox.loadingReview = true
        inbox.reviewError = false
        val listener = db.collection("badge_requests").document(uid).addSnapshotListener { data, error ->
            if (active) {
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
    DisposableEffect(db, uid, admin, inbox.limit, inbox.retry) {
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
                .limit(inbox.limit.toLong() + 1).addSnapshotListener { data, error -> if (active) {
                    reportsLoaded = true
                    inbox.loadingAdmin = !requestsLoaded
                    inbox.reportsError = error != null
                    inbox.reportsMore = error == null && (data?.size() ?: 0) > inbox.limit
                    inbox.reports = if (error != null) emptyList() else data?.documents?.take(inbox.limit)
                        ?.filter { (it.getString("status") ?: "pending") == "pending" }?.map {
                            NoticeEvent(it.id, NoticeKind.REPORTS, title = "Denúncia pendente", body = "",
                                at = it.noticeTime(), localToken = it.noticeToken("report"))
                        } ?: emptyList()
                } }
            // Equality-only query avoids requiring a new composite index.
            val requests = db.collection("badge_requests").whereEqualTo("status", "pending")
                .limit(inbox.limit.toLong() + 1).addSnapshotListener { data, error -> if (active) {
                    requestsLoaded = true
                    inbox.loadingAdmin = !reportsLoaded
                    inbox.requestsError = error != null
                    inbox.requestsMore = error == null && (data?.size() ?: 0) > inbox.limit
                    inbox.requests = if (error != null) emptyList() else data?.documents?.take(inbox.limit)?.map {
                        NoticeEvent(it.id, NoticeKind.REQUESTS, title = "Solicitação pendente", body = "",
                            at = it.noticeTime(), localToken = it.noticeToken("request"))
                    } ?: emptyList()
                } }
            onDispose { active = false; reports.remove(); requests.remove() }
        }
    }
    return inbox
}

@Composable
internal fun NotificationCenter(
    inbox: NotificationInbox, admin: Boolean, postTitles: Map<String, String>,
    onOpen: (NoticeGroup) -> Unit
) {
    var filter by rememberSaveable(inbox.uid) { mutableStateOf("Todas") }
    var preferences by rememberSaveable(inbox.uid) { mutableStateOf(false) }
    var dismissTarget by remember { mutableStateOf<NoticeGroup?>(null) }
    val groups = inbox.groups(admin)
    val selectedFilter = if (!admin && filter == "Administração") "Todas" else filter
    val shown = groups.filter { when (selectedFilter) {
        "Não lidas" -> it.unread
        "Administração" -> it.administrative
        else -> true
    } }
    val loading = inbox.loadingReplies || inbox.loadingReview || (admin && inbox.loadingAdmin)
    val failed = inbox.replyError || inbox.reviewError || (admin && (inbox.reportsError || inbox.requestsError))
    val more = inbox.replyMore || (admin && (inbox.reportsMore || inbox.requestsMore))
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            SectionTitle("Sua central de avisos")
            Text("Respostas, verificações e novidades dos seus pedidos, dentro do aplicativo.", color = Muted, fontSize = 13.sp)
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
                "As contagens consideram os registros carregados.", color = Muted, fontSize = 12.sp)
        }
        if (failed) item {
            Text("Alguns avisos não puderam ser consultados. Confira sua conexão e suas permissões.",
                color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
            OutlinedButton(onClick = { inbox.retry++ }) { Text("Tentar novamente") }
        }
        if (inbox.feedback.isNotBlank()) item { Text(inbox.feedback, color = Wine, fontSize = 13.sp) }
        if (loading) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
        if (shown.isEmpty() && !loading && !failed) item {
            Text(if (more) "Nenhum aviso neste filtro entre os registros carregados. Busque mais para consultar os anteriores."
                else "Nenhum aviso neste filtro. Confira também suas preferências.", color = Muted)
        }
        items(shown, key = { it.id }) { group ->
            Card(onClick = { if (!inbox.busy) { inbox.markRead(listOf(group)); onOpen(group) } },
                modifier = Modifier.fillMaxWidth(),
                colors = CardDefaults.cardColors(containerColor = if (group.unread) WineSoft else Color.White)) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(when (group.kind) {
                            NoticeKind.REPLY -> "Respostas"
                            NoticeKind.REVIEW -> "Verificação de selo"
                            NoticeKind.REPORTS -> "Administração · denúncias"
                            NoticeKind.REQUESTS -> "Administração · selos"
                        }, color = Wine, fontSize = 12.sp, modifier = Modifier.weight(1f))
                        if (group.unread) Badge { Text("Novo") }
                    }
                    Text(group.title, fontWeight = FontWeight.Bold)
                    Text(if (group.kind == NoticeKind.REPLY) postTitles[group.target] ?: group.body else group.body,
                        color = Muted, fontSize = 13.sp)
                    if (group.at > 0L) Text(DateFormat.getDateTimeInstance(DateFormat.SHORT, DateFormat.SHORT)
                        .format(Date(group.at)), color = Muted, fontSize = 11.sp)
                    if (group.administrative) Text("Pendente de decisão", color = Wine, fontSize = 12.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        if (group.unread) TextButton(enabled = !inbox.busy,
                            onClick = { inbox.markRead(listOf(group)) }) { Text("Marcar como lido") }
                        if (group.kind == NoticeKind.REPLY) TextButton(enabled = !inbox.busy,
                            onClick = { dismissTarget = group }) { Text("Dispensar") }
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
                Text("Estas opções controlam os avisos exibidos na central e no sino. Não apagam pedidos nem denúncias.", fontSize = 12.sp, color = Muted)
                Text("Preferências e leitura dos avisos de verificação e administração são salvas por conta neste aparelho. " +
                    "A leitura das respostas é sincronizada na sua conta. Para avisos fora do aplicativo, confira Avisos neste aparelho no Perfil.", fontSize = 12.sp, color = Muted)
            }
        }, confirmButton = { TextButton(onClick = { preferences = false }) { Text("Concluir") } })
    dismissTarget?.let { target -> AlertDialog(onDismissRequest = { dismissTarget = null },
        title = { Text("Dispensar avisos de respostas?") },
        text = { Text("Os ${target.events.size} aviso(s) carregados desta conversa serão removidos. As respostas continuarão na discussão.") },
        confirmButton = { TextButton(onClick = { inbox.dismiss(target); dismissTarget = null }) { Text("Dispensar") } },
        dismissButton = { TextButton(onClick = { dismissTarget = null }) { Text("Cancelar") } }) }
}

@Composable
private fun NoticePreference(label: String, value: Boolean, change: (Boolean) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, modifier = Modifier.weight(1f), fontSize = 14.sp)
        Switch(checked = value, onCheckedChange = change)
    }
}
