package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Lista de acompanhadas privada deste aparelho.
 * Não fingir sincronização entre contas ou avisos de terceiros:
 * a extensão segura do Firestore/Worker depende de publicação autorizada.
 */
internal object LocalFollowedDiscussions {
    private const val PREFS = "atrio_followed_threads_local"
    private const val MAX_IDS = 40
    private val validPostId = Regex("^[a-zA-Z0-9_-]{1,128}$")

    fun ids(context: Context, uid: String): Set<String> {
        if (uid.isBlank()) return emptySet()
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getStringSet("following_$uid", emptySet()).orEmpty()
            .filterTo(mutableSetOf()) { validPostId.matches(it) }
            .take(MAX_IDS).toSet()
    }

    /** Returns the new follow status. Always keyed by authenticated account UID. */
    fun toggle(context: Context, uid: String, postId: String): Boolean {
        require(uid.isNotBlank() && validPostId.matches(postId))
        val before = ids(context, uid)
        val after = if (postId in before) before - postId
        else {
            require(before.size < MAX_IDS) { "Limite de 40 discussões acompanhadas." }
            before + postId
        }
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putStringSet("following_$uid", after).apply()
        return postId in after
    }
}

internal data class FollowedDiscussion(val id: String, val title: String)

@Composable
internal fun FollowedDiscussionsScreen(
    db: FirebaseFirestore, uid: String, revision: Int,
    onBack: () -> Unit, onOpen: (String) -> Unit,
    remoteEnabled: Boolean = false, remoteIds: Set<String> = emptySet(),
    remoteLoading: Boolean = false, remoteFailed: Boolean = false
) {
    val context = LocalContext.current
    val ids = remember(uid, revision, remoteEnabled, remoteIds) {
        if (remoteEnabled) remoteIds.sorted() else LocalFollowedDiscussions.ids(context, uid).sorted()
    }
    var found by remember(uid, revision) { mutableStateOf<List<FollowedDiscussion>>(emptyList()) }
    var loading by remember(uid, revision) { mutableStateOf(ids.isNotEmpty()) }
    var error by remember(uid, revision) { mutableStateOf(false) }
    var retry by remember(uid, revision) { mutableIntStateOf(0) }

    DisposableEffect(db, uid, ids, retry) {
        var active = true
        found = emptyList()
        error = false
        loading = ids.isNotEmpty()
        if (ids.isEmpty()) {
            loading = false
            onDispose { active = false }
        } else {
            var pending = ids.size
            val entries = mutableMapOf<String, FollowedDiscussion>()
            ids.forEach { id ->
                db.collection("posts").document(id).get()
                    .addOnCompleteListener { task ->
                        if (!active) return@addOnCompleteListener
                        if (task.isSuccessful) {
                            val doc = task.result
                            if (doc?.exists() == true) {
                                entries[id] = FollowedDiscussion(id,
                                    doc.getString("title").orEmpty().ifBlank { "Discussão" })
                            }
                        } else error = true
                        pending--
                        if (pending == 0) {
                            found = entries.values.sortedBy { it.title.lowercase() }
                            loading = false
                        }
                    }
            }
            onDispose { active = false }
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("atrio-followed-list"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("Voltar ao perfil") }
            Text("Discussões acompanhadas", style = MaterialTheme.typography.headlineSmall)
            Text(if (remoteEnabled) "Lista privada sincronizada na sua conta."
                else "Lista privada deste aparelho. Para sincronizar com outros celulares será necessária uma atualização das regras da comunidade.",
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall)
        }
        if (loading || remoteLoading) item { CircularProgressIndicator() }
        if (remoteFailed) item {
            Text("Não foi possível sincronizar suas discussões. Confira a conexão.",
                color = MaterialTheme.colorScheme.error)
        }
        if (error) item {
            Text("Algumas discussões não puderam ser carregadas.", color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { retry++ }) { Text("Tentar novamente") }
        }
        if (!loading && !remoteLoading && !remoteFailed && ids.isEmpty()) item {
            Text("Acompanhe uma discussão pelo botão disponível na conversa.")
        }
        if (!loading && found.isEmpty() && ids.isNotEmpty() && !error) item {
            Text("Essas discussões não estão mais disponíveis.")
        }
        if (!loading) items(found, key = { it.id }) { item ->
            Card(onClick = { onOpen(item.id) }, modifier = Modifier.fillMaxWidth()) {
                Text(item.title, Modifier.padding(16.dp),
                    style = MaterialTheme.typography.titleMedium)
            }
        }
    }
}
