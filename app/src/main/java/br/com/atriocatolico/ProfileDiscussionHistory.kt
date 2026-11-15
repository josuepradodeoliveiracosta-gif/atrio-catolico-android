package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

internal data class MyDiscussion(
    val id: String,
    val title: String,
    val category: String,
    val createdAtSeconds: Long,
    val hasCreatedAt: Boolean = true
)

private const val PROFILE_HISTORY_PAGE_SIZE = 20

/**
 * Fonte unica das discussoes proprias no Perfil: consulta sob demanda,
 * ordenada e paginada. O indice uid/createdAt ja consta em firestore.indexes.json.
 * Nenhuma leitura do feed e tratada como historico completo.
 */
@Composable
internal fun ProfileDiscussionHistory(
    db: FirebaseFirestore,
    uid: String,
    onBack: () -> Unit,
    onOpen: ((String) -> Unit)?
) {
    var entries by remember(uid) { mutableStateOf<List<MyDiscussion>>(emptyList()) }
    var cursor by remember(uid) { mutableStateOf<DocumentSnapshot?>(null) }
    var page by remember(uid) { mutableIntStateOf(0) }
    var retry by remember(uid) { mutableIntStateOf(0) }
    var loading by remember(uid) { mutableStateOf(true) }
    var error by remember(uid) { mutableStateOf(false) }
    var hasMore by remember(uid) { mutableStateOf(true) }
    var legacyStarted by remember(uid) { mutableStateOf(false) }
    var legacyCursor by remember(uid) { mutableStateOf<DocumentSnapshot?>(null) }
    var legacyPage by remember(uid) { mutableIntStateOf(0) }
    var legacyPageLoaded by remember(uid) { mutableIntStateOf(-1) }
    var legacyRetry by remember(uid) { mutableIntStateOf(0) }
    var legacyLoading by remember(uid) { mutableStateOf(false) }
    var legacyError by remember(uid) { mutableStateOf(false) }
    var legacyHasMore by remember(uid) { mutableStateOf(true) }

    DisposableEffect(db, uid, page, retry) {
        var active = true
        loading = true
        error = false
        val base = db.collection("posts")
            .whereEqualTo("uid", uid)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(PROFILE_HISTORY_PAGE_SIZE.toLong())
        val last = cursor
        val request = if (page > 0 && last != null) base.startAfter(last) else base
        request.get().addOnCompleteListener { result ->
            if (!active) return@addOnCompleteListener
            loading = false
            if (!result.isSuccessful) {
                error = true
                return@addOnCompleteListener
            }
            val docs = result.result?.documents.orEmpty()
            val batch = docs.mapNotNull { doc ->
                if (doc.getString("uid") != uid) return@mapNotNull null
                MyDiscussion(
                    id = doc.id,
                    title = doc.getString("title").orEmpty().ifBlank { "Discussão sem título" },
                    category = doc.getString("category").orEmpty(),
                    createdAtSeconds = doc.getTimestamp("createdAt")?.seconds ?: 0L
                )
            }
            entries = (if (page == 0) batch else entries + batch).distinctBy { it.id }
            cursor = docs.lastOrNull()
            hasMore = docs.size == PROFILE_HISTORY_PAGE_SIZE
        }
        onDispose { active = false }
    }


    // Consulta alternativa, opt-in, que percorre até 20 documentos por vez.
    // orderBy(createdAt) exclui registros sem esse campo: nenhum dado é migrado.
    DisposableEffect(db, uid, legacyStarted, legacyPage, legacyRetry) {
        if (!legacyStarted) return@DisposableEffect onDispose {}
        var active = true
        legacyLoading = true
        legacyError = false
        val base = db.collection("posts")
            .whereEqualTo("uid", uid)
            .orderBy(FieldPath.documentId())
            .limit(PROFILE_HISTORY_PAGE_SIZE.toLong())
        val last = legacyCursor
        val request = if (legacyPage > 0 && last != null) base.startAfter(last) else base
        request.get().addOnCompleteListener { result ->
            if (!active) return@addOnCompleteListener
            legacyLoading = false
            if (!result.isSuccessful) {
                legacyError = true
                return@addOnCompleteListener
            }
            val docs = result.result?.documents.orEmpty()
            val undated = docs.filter { it.getString("uid") == uid && !it.contains("createdAt") }
                .map { post ->
                    MyDiscussion(
                        id = post.id,
                        title = post.getString("title").orEmpty()
                            .ifBlank { "Discussão sem título" },
                        category = post.getString("category").orEmpty(),
                        createdAtSeconds = 0L,
                        hasCreatedAt = false
                    )
                }
            entries = (entries + undated).distinctBy { it.id }
            legacyCursor = docs.lastOrNull()
            legacyHasMore = docs.size == PROFILE_HISTORY_PAGE_SIZE
            legacyPageLoaded = legacyPage
        }
        onDispose { active = false }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("atrio-profile-history"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            TextButton(onClick = onBack) { Text("Voltar ao perfil") }
            Text("Minhas discussões", style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() })
            Text(
                "Mais recentes primeiro. Carregamos até 20 por vez; use Carregar mais para continuar.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        if (entries.isNotEmpty()) {
            item {
                Text(
                    "${entries.size} " +
                        if (entries.size == 1) "discussão carregada" else "discussões carregadas",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.testTag("atrio-history-count")
                        .semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
            items(entries, key = { it.id }) { item ->
                val content: @Composable () -> Unit = {
                    Column(Modifier.fillMaxWidth().padding(16.dp)) {
                        Text(item.title, style = MaterialTheme.typography.titleMedium)
                        if (item.category.isNotBlank()) Text(item.category,
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (!item.hasCreatedAt) Text("Publicação antiga · sem data informada",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
                val open = onOpen
                val modifier = Modifier.fillMaxWidth().testTag("atrio-history-item-${item.id}")
                if (open == null) {
                    // Perfil QA: exibir o post sem abrir respostas ou tela comunitária.
                    Card(modifier = modifier) { content() }
                } else {
                    Card(onClick = { open(item.id) }, modifier = modifier) { content() }
                }
            }
        }
        if (loading) item {
            CircularProgressIndicator(Modifier.testTag("atrio-history-loading")
                .semantics { contentDescription = "Carregando discussões" })
        }
        if (error) item {
            Text(
                "Não foi possível carregar as discussões. Confira a conexão e tente novamente.",
                color = MaterialTheme.colorScheme.error,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite }
            )
            OutlinedButton(onClick = { retry++ }, modifier = Modifier.testTag("atrio-history-retry")) {
                Text("Tentar novamente")
            }
        }
        if (!loading && !error && hasMore) item {
            OutlinedButton(
                onClick = { page++ },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-history-more")
            ) { Text("Carregar mais discussões") }
        }
        if (!loading && !error && !hasMore && !legacyStarted) item {
            Text(
                "As discussões com data foram carregadas. " +
                    "Publicações antigas podem não ter data cadastrada.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            OutlinedButton(
                onClick = { legacyStarted = true },
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-history-legacy-start")
            ) { Text("Procurar publicações antigas") }
        }
        if (!loading && !error && !hasMore && legacyStarted) {
            if (legacyLoading || (legacyPageLoaded < legacyPage && !legacyError)) item {
                CircularProgressIndicator(
                    Modifier.testTag("atrio-history-legacy-loading")
                        .semantics { contentDescription = "Procurando publicações antigas" }
                )
            }
            if (legacyError) item {
                Text("Não foi possível procurar publicações antigas. Tente novamente.",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                OutlinedButton(
                    onClick = { legacyRetry++ },
                    modifier = Modifier.heightIn(min = 48.dp)
                        .testTag("atrio-history-legacy-retry")
                ) { Text("Tentar novamente") }
            }
            if (!legacyLoading && !legacyError && legacyPageLoaded == legacyPage &&
                legacyHasMore) item {
                Text(
                    "Consultamos até 20 registros por etapa. Continue mesmo se " +
                        "um lote não contiver publicações antigas.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodySmall
                )
                OutlinedButton(
                    onClick = { legacyPage++ },
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .testTag("atrio-history-legacy-more")
                ) { Text("Continuar buscando publicações antigas") }
            }
            if (!legacyLoading && !legacyError && legacyPageLoaded == legacyPage &&
                !legacyHasMore) item {
                Text(
                    if (entries.isEmpty()) "Nenhuma discussão encontrada nesta conta."
                    else "Não há mais discussões disponíveis para carregar.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("atrio-history-end")
                        .semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
        }
    }
}
