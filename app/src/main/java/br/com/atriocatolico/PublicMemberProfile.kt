package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import java.text.DateFormat

/** Apenas atributos publicados voluntariamente; nunca lê profiles/{uid} de terceiros. */
internal data class PublicMemberTarget(val uid: String, val nameFromPublication: String)
private data class PublicMemberInfo(val name: String, val bio: String, val joinedAt: com.google.firebase.Timestamp?)
private data class PublicMemberDiscussion(
    val id: String, val title: String, val excerpt: String, val category: String, val date: String
)

/**
 * Lista publicações visíveis com paginação no servidor. Requer índice (uid ASC, createdAt DESC)
 * previsto em firestore.indexes.json; não consulta perfis privados ou respostas globais.
 */
@Composable
internal fun PublicMemberProfileScreen(
    db: FirebaseFirestore,
    target: PublicMemberTarget,
    onBack: () -> Unit,
    onOpenDiscussion: (String) -> Unit
) {
    val uid = target.uid
    var info by remember(uid) { mutableStateOf<PublicMemberInfo?>(null) }
    var infoLoading by remember(uid) { mutableStateOf(true) }
    var infoError by remember(uid) { mutableStateOf(false) }
    val entries = remember(uid) { mutableStateListOf<PublicMemberDiscussion>() }
    var last by remember(uid) { mutableStateOf<DocumentSnapshot?>(null) }
    var nextPage by remember(uid) { mutableIntStateOf(0) }
    var loading by remember(uid) { mutableStateOf(true) }
    var failed by remember(uid) { mutableStateOf(false) }
    var more by remember(uid) { mutableStateOf(false) }

    BackHandler(onBack = onBack)
    DisposableEffect(db, uid) {
        var active = true
        db.collection("public_profiles").document(uid).get().addOnCompleteListener { result ->
            if (!active) return@addOnCompleteListener
            infoLoading = false
            infoError = !result.isSuccessful
            val doc = result.result
            info = if (result.isSuccessful && doc != null && doc.exists()) {
                PublicMemberInfo(
                    name = doc.getString("displayName").orEmpty(),
                    bio = doc.getString("bio").orEmpty(),
                    joinedAt = doc.getTimestamp("joinedAt")
                )
            } else null
        }
        onDispose { active = false }
    }
    DisposableEffect(db, uid, nextPage) {
        var active = true
        loading = true
        failed = false
        val query = db.collection("posts").whereEqualTo("uid", uid)
            .orderBy("createdAt", Query.Direction.DESCENDING).limit(20)
        val page = if (last == null) query else query.startAfter(last!!)
        page.get().addOnCompleteListener { task ->
            if (!active) return@addOnCompleteListener
            loading = false
            failed = !task.isSuccessful
            if (task.isSuccessful) {
                val docs = task.result?.documents.orEmpty()
                more = docs.size == 20
                last = docs.lastOrNull()
                entries.addAll(docs.mapNotNull { doc ->
                    if (doc.getString("uid") != uid) return@mapNotNull null
                    PublicMemberDiscussion(
                        id = doc.id,
                        title = doc.getString("title").orEmpty().ifBlank { "Discussão sem título" },
                        excerpt = doc.getString("body").orEmpty(),
                        category = doc.getString("category").orEmpty(),
                        date = doc.getTimestamp("createdAt")?.toDate()?.let {
                            DateFormat.getDateInstance(DateFormat.MEDIUM).format(it)
                        }.orEmpty()
                    )
                })
            }
        }
        onDispose { active = false }
    }
    LazyColumn(Modifier.fillMaxSize().testTag("atrio-public-profile"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            TextButton(onClick = onBack, modifier = Modifier.testTag("atrio-public-profile-back")) {
                Text("Voltar")
            }
            Card(shape = RoundedCornerShape(22.dp), border = BorderStroke(1.dp, Line),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) {
                Column(Modifier.fillMaxWidth().padding(20.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(9.dp)) {
                    val displayName = info?.name?.takeIf { it.isNotBlank() }
                        ?: target.nameFromPublication.ifBlank { "Participante" }
                    MemberAvatar(displayName, uid, Modifier.size(86.dp))
                    Text(displayName, fontFamily = FontFamily.Serif, fontSize = 25.sp,
                        fontWeight = FontWeight.Bold, modifier = Modifier.testTag("atrio-public-profile-name"))
                    MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true)
                    if (infoLoading) CircularProgressIndicator(Modifier.size(20.dp))
                    if (info?.bio?.isNotBlank() == true) {
                        Text(info!!.bio, style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text("Este participante não publicou uma apresentação.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    info?.joinedAt?.toDate()?.let { joined ->
                        Text("Na comunidade desde " +
                            DateFormat.getDateInstance(DateFormat.MEDIUM).format(joined),
                            style = MaterialTheme.typography.labelMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (infoError) Text("Apresentação indisponível. Os dados privados permanecem protegidos.",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
        }
        item {
            Text("Discussões", style = MaterialTheme.typography.titleLarge)
            Text("${entries.size} discussões carregadas · lista paginada",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        items(entries, key = { "public-post-${it.id}" }) { post ->
            Card(onClick = { onOpenDiscussion(post.id) }, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-public-post-${post.id}")) {
                Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    Text(post.title, style = MaterialTheme.typography.titleMedium)
                    if (post.excerpt.isNotBlank()) Text(post.excerpt, maxLines = 3,
                        overflow = TextOverflow.Ellipsis, style = MaterialTheme.typography.bodySmall)
                    Text(listOf(post.category, post.date).filter { it.isNotBlank() }.joinToString(" · "),
                        style = MaterialTheme.typography.labelSmall, color = Muted)
                }
            }
        }
        if (loading) item { CircularProgressIndicator(Modifier.testTag("atrio-public-posts-loading")) }
        if (failed) item {
            Text("Não foi possível carregar as discussões. Confira a conexão ou o índice necessário.",
                color = MaterialTheme.colorScheme.error)
            OutlinedButton(onClick = { nextPage++ }) { Text("Tentar novamente") }
        }
        if (!loading && !failed && entries.isEmpty()) item {
            Text("Este participante ainda não publicou discussões disponíveis.")
        }
        if (!loading && !failed && more) item {
            OutlinedButton(onClick = { nextPage++ }, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-public-load-more")) { Text("Carregar mais discussões") }
        }
    }
}

/** Opt-in: nem a bio privada, nem o e-mail são copiados sem uma ação expressa. */
@Composable
internal fun PublicProfilePublicationSettings(
    db: FirebaseFirestore, uid: String, displayName: String, privateBio: String
) {
    var published by remember(uid) { mutableStateOf(false) }
    var loading by remember(uid) { mutableStateOf(true) }
    var busy by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf("") }
    DisposableEffect(db, uid) {
        var active = true
        db.collection("public_profiles").document(uid).get().addOnCompleteListener { result ->
            if (active) {
                published = result.isSuccessful && result.result?.exists() == true
                loading = false
                if (!result.isSuccessful) message = "Publicação indisponível até a aprovação das regras."
            }
        }
        onDispose { active = false }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Apresentação pública", style = MaterialTheme.typography.titleMedium)
        Text("Sua biografia é privada. Ela só aparecerá para outros participantes se você publicar aqui.",
            style = MaterialTheme.typography.bodySmall)
        if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall, color = Wine)
        if (!loading) {
            OutlinedButton(enabled = !busy, onClick = {
                busy = true; message = ""
                val ref = db.collection("public_profiles").document(uid)
                if (published) ref.delete().addOnCompleteListener { task ->
                    busy = false
                    if (task.isSuccessful) { published = false; message = "Apresentação retirada da área pública." }
                    else message = "Não foi possível retirar a apresentação."
                } else {
                    db.collection("profiles").document(uid).get().addOnCompleteListener { task ->
                        if (!task.isSuccessful || task.result?.exists() != true) {
                            busy = false; message = "Perfil privado indisponível."
                        } else {
                            val private = task.result!!
                            val joined = private.getTimestamp("createdAt")
                            val storedName = private.getString("displayName").orEmpty()
                            if (joined == null || storedName.length !in 2..35) {
                                busy = false; message = "Não foi possível validar seu cadastro."
                            } else ref.set(mapOf(
                                "displayName" to storedName,
                                "bio" to private.getString("bio").orEmpty(),
                                "joinedAt" to joined,
                                "updatedAt" to FieldValue.serverTimestamp()
                            )).addOnCompleteListener { result ->
                                busy = false
                                if (result.isSuccessful) { published = true; message = "Apresentação publicada." }
                                else message = "Publicação indisponível até a aprovação das regras."
                            }
                        }
                    }
                }
            }, modifier = Modifier.fillMaxWidth().testTag("atrio-public-profile-visibility")) {
                Text(if (busy) "Aguarde..." else if (published) "Retirar apresentação pública"
                    else "Publicar minha apresentação")
            }
        }
    }
}
