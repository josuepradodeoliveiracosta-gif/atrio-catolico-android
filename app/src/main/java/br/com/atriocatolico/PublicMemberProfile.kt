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
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import com.google.firebase.firestore.Query
import java.text.DateFormat

/** Apenas atributos publicados voluntariamente; nunca lê profiles/{uid} de terceiros. */
internal data class PublicMemberTarget(val uid: String, val nameFromPublication: String)
private data class PublicMemberInfo(
    val name: String,
    val bio: String,
    val joinedAt: com.google.firebase.Timestamp?,
    val saint: String,
    val devotionPhrase: String,
    val ageBand: String,
    val maritalStatus: String,
    val interests: List<String>,
    val interestQuestions: Map<String, String>,
    val revision: com.google.firebase.Timestamp?
)
private fun DocumentSnapshot.toPublicMemberInfo(): PublicMemberInfo? {
    if (!exists()) return null
    val confirmed = !metadata.isFromCache && !metadata.hasPendingWrites()
    return PublicMemberInfo(
        name = getString("displayName").orEmpty(),
        bio = getString("bio").orEmpty(),
        joinedAt = getTimestamp("joinedAt"),
        saint = if (confirmed) getString("saint").orEmpty() else "",
        devotionPhrase = if (confirmed) getString("devotionPhrase").orEmpty() else "",
        ageBand = if (confirmed) getString("ageBand").orEmpty() else "",
        maritalStatus = if (confirmed) getString("maritalStatus").orEmpty() else "",
        interests = if (confirmed) (get("interests") as? List<*>)
            ?.filterIsInstance<String>().orEmpty()
            .filter { it in RegistrationOptionalPolicy.interests }.take(3) else emptyList(),
        interestQuestions = if (confirmed) {
            val raw = get("interestQuestions") as? Map<*, *>
            ProfileV3Interest.entries.mapNotNull { interest ->
                (raw?.get(interest.id) as? String)?.takeIf {
                    it.isNotBlank() && it.profileV3QuestionLength() <= PROFILE_V3_QUESTION_LIMIT
                }?.let { interest.id to it }
            }.toMap()
        } else emptyMap(),
        revision = if (confirmed) getTimestamp("updatedAt") else null
    )
}

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
    onOpenDiscussion: (String) -> Unit,
    viewerUid: String = "",
    onConverse: (() -> Unit)? = null,
    managedBlocks: AtrioManagedBlocks? = null,
    discussionResolver: ProfileV3DiscussionResolver? = null
) {
    val uid = target.uid
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    var session by remember(auth) { mutableStateOf(auth.currentUser, referentialEqualityPolicy()) }
    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { session = it.currentUser }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }
    val viewer = session?.takeIf { it.uid == viewerUid && auth.currentUser === it }
    val resolver = discussionResolver ?: remember(auth) { ProfileV3DiscussionClient(auth) }
    var info by remember(db, viewer, viewerUid, uid) { mutableStateOf<PublicMemberInfo?>(null) }
    var infoLoading by remember(db, viewerUid, uid) { mutableStateOf(true) }
    var infoError by remember(db, viewerUid, uid) { mutableStateOf(false) }
    var viewerInfo by remember(db, viewer, viewerUid, uid) { mutableStateOf<PublicMemberInfo?>(null) }
    val entries = remember(uid) { mutableStateListOf<PublicMemberDiscussion>() }
    var last by remember(uid) { mutableStateOf<DocumentSnapshot?>(null) }
    var nextPage by remember(uid) { mutableIntStateOf(0) }
    var loading by remember(uid) { mutableStateOf(true) }
    var failed by remember(uid) { mutableStateOf(false) }
    var more by remember(uid) { mutableStateOf(false) }
    val managed = BuildConfig.ATRIO_QA_INBOX_DISCOVERY
    val blocked = if (managed) {
        managedBlocks?.confirmed(uid)?.blocked != false || uid in managedBlocks.hiddenPeers()
    } else uid in rememberBlockedMembers(db, viewerUid)
    var actionBusy by remember(viewerUid, uid) { mutableStateOf(false) }
    var reportOpen by remember(viewerUid, uid) { mutableStateOf(false) }
    var reportReason by remember(viewerUid, uid) { mutableStateOf("") }
    var reportMessage by remember(viewerUid, uid) { mutableStateOf("") }

    BackHandler(onBack = onBack)
    DisposableEffect(db, viewer, viewerUid, uid) {
        var active = true
        val listener = db.collection("public_profiles").document(uid)
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (!active) return@addSnapshotListener
                infoLoading = false
                infoError = error != null
                info = snapshot?.toPublicMemberInfo()
            }
        onDispose { active = false; listener.remove() }
    }
    DisposableEffect(db, viewer, viewerUid, uid) {
        var active = true
        val listener = if (viewer == null || viewerUid == uid) null
            else db.collection("public_profiles").document(viewerUid)
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, _ ->
                    if (active && auth.currentUser === viewer) viewerInfo = snapshot?.toPublicMemberInfo()
                }
        onDispose { active = false; listener?.remove() }
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
                    ContributionPublicBadge(db, uid, Modifier.fillMaxWidth())
                    if (infoLoading) CircularProgressIndicator(Modifier.size(20.dp))
                    if (info?.bio?.isNotBlank() == true) {
                        Text(info!!.bio, style = MaterialTheme.typography.bodyMedium)
                    } else {
                        Text("Este participante não publicou uma apresentação.",
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            style = MaterialTheme.typography.bodySmall)
                    }
                    if (info?.saint?.isNotBlank() == true) {
                        Text("Santo de devoção · ${info!!.saint}",
                            style = MaterialTheme.typography.bodyMedium, color = Wine)
                    }
                    if (info?.devotionPhrase?.isNotBlank() == true) {
                        Text("“${info!!.devotionPhrase}”",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                    if (info?.ageBand?.isNotBlank() == true) {
                        Text("Faixa etária · ${info!!.ageBand}", style = MaterialTheme.typography.bodySmall)
                    }
                    if (info?.maritalStatus?.isNotBlank() == true) {
                        Text("Estado civil · ${info!!.maritalStatus}", style = MaterialTheme.typography.bodySmall)
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
        val publicProfile = info
        if (!blocked && viewer != null && publicProfile != null) {
            val common = publicProfile.interests.intersect(viewerInfo?.interests.orEmpty().toSet())
            val devotion = publicProfile.saint.takeIf {
                viewerUid != uid && it.isNotBlank() && it.equals(viewerInfo?.saint, ignoreCase = true)
            }
            val affinity = devotion ?: publicProfile.interests.firstOrNull { it in common }
            if (affinity != null) item {
                Card(
                    Modifier.fillMaxWidth().testTag("atrio-public-profile-affinity"),
                    border = BorderStroke(1.dp, Gold),
                    colors = CardDefaults.cardColors(containerColor = WineSoft),
                    shape = RoundedCornerShape(AtrioDimensions.CardRadius)
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Afinidade em comum", style = MaterialTheme.typography.labelMedium, color = Muted)
                        Text(affinity, style = MaterialTheme.typography.titleLarge,
                            fontWeight = FontWeight.Bold, color = Wine)
                    }
                }
            }
            if (publicProfile.interests.isNotEmpty()) item {
                Card(
                    Modifier.fillMaxWidth().testTag("atrio-public-profile-interests"),
                    border = BorderStroke(1.dp, Line),
                    colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
                    shape = RoundedCornerShape(AtrioDimensions.CardRadius)
                ) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text("Vamos conversar sobre…", style = MaterialTheme.typography.titleMedium, color = Wine)
                        publicProfile.interests.sortedBy { it !in common }.forEach { label ->
                            val interest = ProfileV3Interest.forLabel(label) ?: return@forEach
                            key(viewer, uid, interest, publicProfile.revision, resolver) {
                                PublicProfileV3Interest(
                                    auth = auth,
                                    viewer = viewer,
                                    profileUid = uid,
                                    interest = interest,
                                    question = publicProfile.interestQuestions[interest.id],
                                    inCommon = label in common,
                                    resolver = resolver,
                                    stillVisible = {
                                        val current = info
                                        !blocked && current != null && current.revision == publicProfile.revision &&
                                            label in current.interests
                                    },
                                    onOpen = onOpenDiscussion
                                )
                            }
                        }
                    }
                }
            }
        }
        if (viewerUid.isNotBlank() && uid != viewerUid) item {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                if (!blocked && onConverse != null) {
                    Button(onClick = onConverse,
                        modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                            .testTag("atrio-public-profile-converse")) {
                        Text("Conversar")
                    }
                }
                if (managed) {
                    if (managedBlocks != null) AtrioManagedBlockControl(
                        managedBlocks, uid, "atrio-member-block"
                    )
                } else OutlinedButton(
                    enabled = !actionBusy,
                    onClick = {
                        actionBusy = true
                        val ref = db.collection("users").document(viewerUid)
                            .collection("blockedMembers").document(uid)
                        val task = if (blocked) ref.delete()
                            else ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
                        task.addOnCompleteListener { result ->
                            actionBusy = false
                            reportMessage = if (result.isSuccessful) {
                                if (blocked) "Participante desbloqueado." else "Participante bloqueado."
                            } else "Não foi possível atualizar o bloqueio. Tente novamente."
                        }
                    },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-member-block")
                ) { Text(if (blocked) "Desbloquear participante" else "Bloquear participante") }
                OutlinedButton(
                    onClick = { reportOpen = true },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-member-report")
                ) { Text("Denunciar participante") }
                if (reportMessage.isNotBlank()) Text(reportMessage,
                    style = MaterialTheme.typography.bodySmall, color = Muted)
                if (blocked) Text("As publicações deste participante estão ocultas para você.",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        }
        if (viewer != null && !blocked && viewerUid != uid) {
            item { ProfileTimeline(db, ownerUid = uid, viewerUid = viewerUid) }
        }
        item {
            Text("Discussões", style = MaterialTheme.typography.titleLarge)
            Text("${entries.size} discussões carregadas · lista paginada",
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        if (!blocked) items(entries, key = { "public-post-${it.id}" }) { post ->
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
        if (!blocked && !loading && !failed && entries.isEmpty()) item {
            Text("Este participante ainda não publicou discussões disponíveis.")
        }
        if (!blocked && !loading && !failed && more) item {
            OutlinedButton(onClick = { nextPage++ }, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-public-load-more")) { Text("Carregar mais discussões") }
        }
    }
    if (reportOpen && viewerUid.isNotBlank() && uid != viewerUid) {
        AlertDialog(
            onDismissRequest = { if (!actionBusy) reportOpen = false },
            title = { Text("Denunciar participante") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Explique o comportamento que precisa de análise. " +
                        "A denúncia é privada e não aparece para o participante.")
                    OutlinedTextField(
                        reportReason, { reportReason = it.take(500) },
                        label = { Text("Motivo da denúncia") },
                        minLines = 3, maxLines = 5,
                        modifier = Modifier.fillMaxWidth().testTag("atrio-member-report-reason"),
                        supportingText = { Text(reportReason.trim().length.toString() + "/500 caracteres") }
                    )
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !actionBusy && reportReason.trim().length in 10..500,
                    onClick = {
                        actionBusy = true
                        val id = viewerUid + "__" + uid
                        db.collection("user_reports").document(id).set(mapOf(
                            "reporterUid" to viewerUid,
                            "targetUid" to uid,
                            "reason" to reportReason.trim(),
                            "createdAt" to FieldValue.serverTimestamp()
                        )).addOnCompleteListener { result ->
                            actionBusy = false
                            reportOpen = false
                            reportMessage = if (result.isSuccessful)
                                "Denúncia registrada para análise da moderação."
                                else "Não foi possível registrar. Caso já tenha denunciado, " +
                                    "sua denúncia anterior permanece registrada."
                        }
                    },
                    modifier = Modifier.testTag("atrio-member-report-submit")
                ) { Text("Enviar denúncia") }
            },
            dismissButton = {
                TextButton(onClick = { reportOpen = false }, enabled = !actionBusy) {
                    Text("Cancelar")
                }
            }
        )
    }
}

/** Opt-in explícito: a projeção contém somente campos autorizados pelo titular. */
@Composable
internal fun PublicProfilePublicationSettings(
    db: FirebaseFirestore, uid: String
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
        Text("Publique sua apresentação quando quiser. Devoção, faixa etária, estado civil e interesses " +
            "só aparecem se você os marcar como visíveis no editor.",
            style = MaterialTheme.typography.bodySmall)
        if (message.isNotBlank()) Text(message, style = MaterialTheme.typography.bodySmall, color = Wine)
        if (!loading) {
            OutlinedButton(enabled = !busy, onClick = {
                busy = true; message = ""
                val ref = db.collection("public_profiles").document(uid)
                val linksRef = ref.profileV3Links()
                if (published) db.runTransaction { transaction ->
                    transaction.get(ref)
                    val links = transaction.get(linksRef)
                    transaction.delete(ref)
                    transaction.syncProfileV3Links(links, emptyMap())
                    Unit
                }.addOnCompleteListener { task ->
                    busy = false
                    if (task.isSuccessful) { published = false; message = "Apresentação retirada da área pública." }
                    else message = "Não foi possível retirar a apresentação."
                } else {
                    val privateRef = db.collection("profiles").document(uid)
                    val v3Ref = db.document("users/$uid/private/profile_v3")
                    val preferencesRef = db.document("users/$uid/private/preferences")
                    db.runTransaction { transaction ->
                        val privateDoc = transaction.get(privateRef)
                        val v3Doc = transaction.get(v3Ref)
                        transaction.get(preferencesRef)
                        transaction.get(ref)
                        val links = transaction.get(linksRef)
                        val joined = privateDoc.getTimestamp("createdAt")
                            ?: throw IllegalStateException("Data do perfil público inválida")
                        val storedName = privateDoc.getString("displayName").orEmpty()
                        require(storedName.length in 2..35) {
                            "Não foi possível validar seu cadastro."
                        }
                        val values = mutableMapOf<String, Any>(
                            "displayName" to storedName,
                            "bio" to privateDoc.getString("bio").orEmpty(),
                            "joinedAt" to joined,
                            "updatedAt" to FieldValue.serverTimestamp()
                        )
                        val draft = ProfileV3Policy.data(v3Doc)
                        values.putAll(ProfileV3Policy.projection(draft))
                        transaction.set(ref, values)
                        val ids = if (draft.consentAccepted) draft.interestProjection("postId") else emptyMap()
                        transaction.syncProfileV3Links(links, ids)
                        true
                    }.addOnCompleteListener { result ->
                        busy = false
                        if (result.isSuccessful) {
                            published = true
                            message = "Apresentação publicada."
                        } else if (result.exception?.message?.contains("Data do perfil") == true) {
                            message = "Não foi possível validar seu cadastro."
                        } else {
                            message = "Publicação indisponível até a aprovação das regras."
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
