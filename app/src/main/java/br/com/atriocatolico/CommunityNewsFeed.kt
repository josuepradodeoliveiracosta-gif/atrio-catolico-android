package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query

private data class FeedPage(val documents: List<DocumentSnapshot>, val loading: Boolean, val failed: Boolean)

@Composable
private fun feedPage(query: Query, retry: Int): FeedPage {
    var page by remember(query, retry) { mutableStateOf(FeedPage(emptyList(), true, false)) }
    DisposableEffect(query, retry) {
        val registration = query.addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
            val confirmedSnapshot = snapshot?.takeUnless { it.metadata.isFromCache }
            page = FeedPage(
                documents = confirmedSnapshot?.documents.orEmpty(),
                loading = confirmedSnapshot == null && error == null,
                failed = error != null,
            )
        }
        onDispose { registration.remove() }
    }
    return page
}

@Composable
internal fun CommunityNewsFeed(
    db: FirebaseFirestore,
    uid: String,
    memberName: String,
    blockedMembers: Set<String>,
    searchOpen: Boolean,
    onTextSearch: (String) -> Unit,
    search: String,
    onPublish: () -> Unit,
    onAuthor: (String, String) -> Unit,
) {
    var following by rememberSaveable(uid) { mutableStateOf(false) }
    var questions by rememberSaveable(uid) { mutableStateOf(false) }
    var visibleCount by rememberSaveable(uid) { mutableStateOf(20) }
    var retry by remember(uid) { mutableStateOf(0) }
    var detail by rememberSaveable(uid) { mutableStateOf<String?>(null) }
    var channel by rememberSaveable(uid) { mutableStateOf<String?>(null) }
    val friends = mutableSetOf<String>()
    val pages = mutableListOf<FeedPage>()
    if (!following || detail != null) {
        val edges = remember(db) { db.collectionGroup("feed_friendship_edges") }
        val outgoing = feedPage(edges.whereEqualTo("senderUid", uid), retry)
        val incoming = feedPage(edges.whereEqualTo("recipientUid", uid), retry)
        pages += outgoing
        pages += incoming
        friends += outgoing.documents.filter { it.getString("status") == "accepted" }
            .mapNotNull { it.getString("recipientUid") }
        friends += incoming.documents.filter { it.getString("status") == "accepted" }
            .mapNotNull { it.getString("senderUid") }
        friends.removeAll(blockedMembers)
    }

    fun posts(destination: String): Query {
        var query = db.collection("feed_posts")
            .whereEqualTo("destination", destination)
            .whereEqualTo("published", true)
        if (!following && questions) query = query.whereEqualTo("format", "question")
        return query.orderBy("createdAt", Query.Direction.DESCENDING).limit(visibleCount.toLong())
    }

    val publications = mutableListOf<FeedPage>()
    if (following) {
        val follows = feedPage(db.collection("feed_following").document(uid).collection("channels"), retry)
        pages += follows
        for (edge in follows.documents.filterNot { it.id in blockedMembers }) {
            key(edge.id) {
                publications += feedPage(posts("channel").whereEqualTo("authorUid", edge.id), retry)
            }
        }
    } else {
        publications += feedPage(posts("channel"), retry)
        for (friend in friends.sorted()) {
            key(friend) {
                publications += feedPage(posts("timeline").whereEqualTo("authorUid", friend), retry)
            }
        }
    }
    pages += publications
    val displayed = publications.flatMap { it.documents }
        .filterNot { it.getString("authorUid") in blockedMembers }
        .filter { search.isBlank() || !searchOpen || listOf(it.getString("title"), it.getString("body"))
            .any { value -> value?.contains(search.trim(), ignoreCase = true) == true } }
        .distinctBy { it.id }
        .sortedWith(compareByDescending<DocumentSnapshot> { it.getTimestamp("createdAt") }.thenBy { it.id })

    BackHandler(enabled = detail != null || channel != null) {
        if (detail != null) detail = null else channel = null
    }
    if (detail != null) {
        FeedPublicationDetail(db, uid, detail!!, friends, blockedMembers, onBack = { detail = null })
        return
    }
    if (channel != null) {
        val owner = channel!!
        val name = feedAuthorName(db, owner)
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)) {
            item { TextButton(onClick = { channel = null }) { Text("Voltar ao feed") } }
            if (owner !in blockedMembers) item { ProfileChannel(db, owner, uid, name) }
        }
        return
    }

    val showWelcome by welcomePreference(uid)
    LazyColumn(
        Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background).testTag("atrio-community-feed"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        if (showWelcome) item { LiturgicalWelcome(memberName) }
        item {
            Text("Feed de notícias", style = MaterialTheme.typography.headlineSmall)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = !following, onClick = { following = false; visibleCount = 20 },
                    modifier = Modifier.testTag("atrio-feed-recentes"), label = { Text("Recentes") })
                FilterChip(selected = following, onClick = { following = true; visibleCount = 20 },
                    modifier = Modifier.testTag("atrio-feed-seguindo"), label = { Text("Seguindo") })
            }
            if (!following) FilterChip(selected = questions,
                onClick = { questions = !questions; visibleCount = 20 },
                modifier = Modifier.testTag("atrio-feed-perguntas"), label = { Text("Perguntas") })
            if (searchOpen) OutlinedTextField(search, onTextSearch, label = { Text("Buscar no feed") },
                singleLine = true, modifier = Modifier.fillMaxWidth())
            OutlinedButton(onClick = onPublish) { Text("Publicar") }
        }
        items(displayed.take(visibleCount), key = { it.id }) { entry ->
            val authorUid = entry.getString("authorUid").orEmpty()
            val author = feedAuthorName(db, authorUid)
            val isChannel = entry.getString("destination") == "channel"
            val channelName = if (isChannel) feedChannelName(db, authorUid) else null
            Card(Modifier.fillMaxWidth()) {
                Column(Modifier.padding(12.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    TextButton(onClick = { onAuthor(authorUid, author) }, enabled = authorUid.isNotEmpty()) {
                        Text(author)
                    }
                    if (isChannel) TextButton(onClick = { channel = authorUid }) {
                        Text(channelName ?: "Canal")
                    } else Text("Linha do tempo", style = MaterialTheme.typography.labelMedium)
                    Column(Modifier.fillMaxWidth().clickable { detail = entry.id }) {
                        FeedPublicationBody(entry, uid)
                    }
                    TextButton(onClick = { detail = entry.id }) { Text("Abrir publicação") }
                }
            }
        }
        if (pages.any { it.failed }) item {
            Text("Não foi possível carregar todas as publicações.", color = MaterialTheme.colorScheme.error)
            TextButton(onClick = { retry++ }) { Text("Tentar novamente") }
        } else if (displayed.isEmpty()) item {
            when {
                pages.any { it.loading } -> Text("Carregando publicações…")
                following -> {
                    Text("Ainda não há publicações de canais que você segue.")
                    TextButton(onClick = { following = false; visibleCount = 20 }) { Text("Explorar publicações") }
                }
                else -> Text("Nenhuma publicação encontrada.")
            }
        }
        if (displayed.size > visibleCount || publications.any { it.documents.size >= visibleCount }) item {
            TextButton(onClick = { visibleCount += 20 }) { Text("Carregar mais") }
        }
    }
}

@Composable
internal fun feedAuthorName(db: FirebaseFirestore, uid: String): String =
    feedDocument(db, "public_profiles", uid)?.getString("displayName")?.takeIf { it.isNotBlank() }
        ?: "Participante do Átrio"

@Composable
private fun feedChannelName(db: FirebaseFirestore, uid: String): String? =
    feedDocument(db, "feed_channels", uid)?.getString("name")

@Composable
internal fun feedDocument(db: FirebaseFirestore, collection: String, id: String): DocumentSnapshot? {
    var document by remember(db, collection, id) { mutableStateOf<DocumentSnapshot?>(null) }
    DisposableEffect(db, collection, id) {
        if (id.isBlank()) onDispose {}
        else {
            val registration = db.collection(collection).document(id)
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                    document = snapshot?.takeIf { error == null && !it.metadata.isFromCache && it.exists() }
                }
            onDispose { registration.remove() }
        }
    }
    return document
}

@Composable
private fun FeedPublicationDetail(
    db: FirebaseFirestore,
    uid: String,
    id: String,
    friends: Set<String>,
    blockedMembers: Set<String>,
    onBack: () -> Unit,
) {
    val post = feedDocument(db, "feed_posts", id)
    val authorUid = post?.getString("authorUid")
    val visible = post != null && authorUid != null && authorUid !in blockedMembers &&
        (post.getString("destination") == "channel" || authorUid == uid || authorUid in friends)
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp)) {
        item { TextButton(onClick = onBack) { Text("Voltar ao feed") } }
        item {
            if (post != null && visible) {
                FeedPublicationBody(post, uid)
                FeedConversation(db, post, uid)
            } else Text("Publicação indisponível.")
        }
    }
}

@Composable
internal fun FeedPublicationBody(post: DocumentSnapshot, uid: String) {
    if (post.getString("format") == "question") Text("Pergunta",
        style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
    post.getString("title")?.takeIf { it.isNotBlank() }?.let {
        Text(it, style = MaterialTheme.typography.titleMedium)
    }
    post.getString("body")?.takeIf { it.isNotBlank() }?.let { Text(it) }
    if (post.getBoolean("hasImage") == true) FeedPublicationImage(post, uid)
}
