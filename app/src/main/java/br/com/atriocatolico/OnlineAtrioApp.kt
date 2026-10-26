package br.com.atriocatolico

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.UserProfileChangeRequest
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.FieldValue
import java.util.concurrent.TimeUnit

/**
 * O modo conectado só é exibido se um google-services.json válido estiver instalado.
 * Nenhuma chave nem projeto Firebase é embutido no repositório de exemplo.
 */
@Composable
internal fun OnlineAtrioApp(activity: androidx.activity.ComponentActivity) {
    val auth = remember { FirebaseAuth.getInstance() }
    val db = remember { FirebaseFirestore.getInstance() }
    var signedUser by remember { mutableStateOf(auth.currentUser) }

    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { signedUser = it.currentUser }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }

    AtrioTheme {
        val user = signedUser
        if (user == null) {
            OnlineAuthScreen(auth = auth, db = db)
        } else {
            key(user.uid) { OnlineUserScreen(auth = auth, db = db, user = user) }
        }
        // Keep session state outside the login branch and user key.
        OpeningVideo(activity, authenticated = user != null)
    }
}

@Composable
private fun OnlineAuthScreen(auth: FirebaseAuth, db: FirebaseFirestore) {
    var registering by remember { mutableStateOf(false) }
    var displayName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var resetInfo by remember { mutableStateOf("") }

    Column(
        Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Wine, Color(0xFF8B4B5A))))
            .statusBarsPadding().verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 26.dp)
    ) {
        Text("✝", fontFamily = FontFamily.Serif, fontSize = 52.sp, color = Gold)
        Text("Átrio Católico", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold,
            fontSize = 33.sp, color = Color.White)
        Spacer(Modifier.height(10.dp))
        Text("Um lugar para aprender e compartilhar a fé.", color = Color(0xFFF7E9EB), fontSize = 15.sp)
        Spacer(Modifier.height(26.dp))
        Card(colors = CardDefaults.cardColors(containerColor = Paper), shape = RoundedCornerShape(20.dp)) {
            Column(Modifier.padding(20.dp)) {
                Text(if (registering) "Criar conta" else "Entrar na comunidade",
                    fontSize = 22.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
                Spacer(Modifier.height(14.dp))
                if (registering) {
                    OutlinedTextField(displayName, { if (it.length <= 35) displayName = it },
                        modifier = Modifier.fillMaxWidth(), label = { Text("Nome público") }, singleLine = true)
                    Spacer(Modifier.height(10.dp))
                }
                OutlinedTextField(email, { email = it.take(150) }, modifier = Modifier.fillMaxWidth(),
                    label = { Text("E-mail") }, singleLine = true)
                Spacer(Modifier.height(10.dp))
                OutlinedTextField(password, { password = it.take(128) }, modifier = Modifier.fillMaxWidth(),
                    label = { Text("Senha (mínimo 6 caracteres)") }, singleLine = true,
                    visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                if (error.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
                }
                if (resetInfo.isNotBlank()) {
                    Spacer(Modifier.height(8.dp))
                    Text(resetInfo, color = Wine, fontSize = 12.sp)
                }
                Spacer(Modifier.height(16.dp))
                Button(
                    modifier = Modifier.fillMaxWidth(), enabled = !busy && email.contains('@') &&
                        password.length >= 6 && (!registering || displayName.trim().length in 2..35),
                    onClick = {
                        busy = true; error = ""; resetInfo = ""
                        if (registering) {
                            val publicName = displayName.trim()
                            auth.createUserWithEmailAndPassword(email.trim(), password)
                                .addOnSuccessListener { result ->
                                    val created = result.user
                                    if (created == null) {
                                        busy = false; error = "Não foi possível concluir o cadastro."
                                    } else {
                                        db.collection("profiles").document(created.uid).set(mapOf(
                                            "displayName" to publicName,
                                            "createdAt" to FieldValue.serverTimestamp()
                                        )).addOnSuccessListener {
                                            val update = UserProfileChangeRequest.Builder()
                                                .setDisplayName(publicName).build()
                                            created.updateProfile(update)
                                            busy = false
                                        }.addOnFailureListener { failure ->
                                            busy = false
                                            error = "Conta criada, mas o perfil não foi salvo: ${failure.localizedMessage}. Você pode concluir o perfil na próxima tela."
                                        }
                                    }
                                }.addOnFailureListener { failure ->
                                    busy = false; error = failure.localizedMessage ?: "Erro ao cadastrar."
                                }
                        } else {
                            auth.signInWithEmailAndPassword(email.trim(), password)
                                .addOnCompleteListener { task ->
                                    busy = false
                                    if (!task.isSuccessful) error = "Não foi possível entrar. Confira as credenciais."
                                }
                        }
                    }
                ) { Text(if (busy) "Aguarde..." else if (registering) "Criar conta" else "Entrar") }
                Spacer(Modifier.height(6.dp))
                TextButton(onClick = { registering = !registering; error = ""; resetInfo = "" }, modifier = Modifier.fillMaxWidth()) {
                    Text(if (registering) "Já tenho conta" else "Ainda não tenho conta")
                }
                if (!registering) {
                    TextButton(onClick = {
                        if (!email.contains('@')) {
                            error = "Informe seu e-mail para recuperar a senha."
                        } else {
                            error = ""
                            auth.sendPasswordResetEmail(email.trim()).addOnCompleteListener {
                                resetInfo = if (it.isSuccessful)
                                    "Se o endereço estiver cadastrado, você receberá as instruções por e-mail."
                                else "Não foi possível solicitar a recuperação agora."
                            }
                        }
                    }, modifier = Modifier.fillMaxWidth()) { Text("Esqueci minha senha") }
                }
                Text("Cadastro por e-mail · Discussões compartilhadas · Respeito em primeiro lugar",
                    fontSize = 11.sp, color = Muted, lineHeight = 16.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth())
            }
        }
    }
}

@Composable
private fun OnlineUserScreen(auth: FirebaseAuth, db: FirebaseFirestore, user: FirebaseUser) {
    val uid = user.uid
    var name by remember(uid) { mutableStateOf<String?>(null) }
    var biography by remember(uid) { mutableStateOf("") }
    var profileLoading by remember(uid) { mutableStateOf(true) }
    var error by remember(uid) { mutableStateOf("") }
    val context = LocalContext.current
    LaunchedEffect(uid) {
        PushRegistry.refreshIfEnabled(context, uid, db)
        BackgroundNoticeScheduler.sync(context, uid)
    }
    var isAdmin by remember(uid) { mutableStateOf(false) }
    var moderationOpen by remember(uid) { mutableStateOf(false) }
    var clergyReviewOpen by remember(uid) { mutableStateOf(false) }
    var founderUid by remember(uid) { mutableStateOf("") }
    DisposableEffect(db, uid) {
        val registration = db.document("app_config/founder").addSnapshotListener { snapshot, failure ->
            founderUid = if (failure == null) snapshot?.getString("uid").orEmpty() else ""
        }
        onDispose { registration.remove() }
    }
    DisposableEffect(db, uid) {
        var active = true
        val registration = db.collection("admins").document(uid).addSnapshotListener { snapshot, failure ->
            if (active) {
                isAdmin = failure == null && snapshot?.getBoolean("enabled") == true
                if (!isAdmin) { moderationOpen = false; clergyReviewOpen = false }
            }
        }
        onDispose { active = false; registration.remove() }
    }

    DisposableEffect(uid) {
        val registration = db.collection("profiles").document(uid).addSnapshotListener { snapshot, failure ->
            profileLoading = false
            if (failure != null) error = "Erro ao ler perfil: ${failure.localizedMessage}"
            else {
                name = snapshot?.getString("displayName")
                biography = snapshot?.getString("bio").orEmpty()
            }
        }
        onDispose { registration.remove() }
    }

    if (profileLoading) {
        Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
    } else if (name.isNullOrBlank()) {
        var newName by remember(uid) { mutableStateOf(user.displayName.orEmpty()) }
        var saving by remember(uid) { mutableStateOf(false) }
        Column(Modifier.fillMaxSize().padding(24.dp), verticalArrangement = Arrangement.Center) {
            SectionTitle("Concluir seu perfil")
            Spacer(Modifier.height(8.dp))
            Text("Escolha o nome que aparecerá em suas discussões.", color = Muted)
            Spacer(Modifier.height(15.dp))
            OutlinedTextField(newName, { if (it.length <= 35) newName = it },
                label = { Text("Nome público") }, modifier = Modifier.fillMaxWidth())
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            Spacer(Modifier.height(12.dp))
            Button(enabled = !saving && newName.trim().length >= 2, onClick = {
                saving = true
                db.collection("profiles").document(uid).set(mapOf(
                    "displayName" to newName.trim(), "createdAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { task ->
                    saving = false
                    if (!task.isSuccessful) error = task.exception?.localizedMessage ?: "Não foi possível salvar."
                }
            }, modifier = Modifier.fillMaxWidth()) { Text("Começar") }
            TextButton(onClick = { BackgroundNoticeScheduler.disable(context, uid); PushRegistry.deactivate(context, uid, db); auth.signOut() }) { Text("Sair desta conta") }
        }
    } else {
        CompositionLocalProvider(LocalFounderUid provides founderUid) {
        OnlineCommunity(db = db, uid = uid, name = name!!, email = user.email.orEmpty(),
            biography = biography,
            visible = !(isAdmin && (moderationOpen || clergyReviewOpen)),
            onModeration = if (isAdmin) ({ moderationOpen = true }) else null,
            onClergyReview = if (isAdmin) ({ clergyReviewOpen = true }) else null,
            onSignOut = { BackgroundNoticeScheduler.disable(context, uid); PushRegistry.deactivate(context, uid, db); auth.signOut() })
        if (moderationOpen && isAdmin) ModerationScreen(db, uid, onBack = { moderationOpen = false })
        else if (clergyReviewOpen && isAdmin) ClergyBadgeReviewScreen(db, uid, onBack = { clergyReviewOpen = false })
        if (error.isNotBlank()) {
            // Erros são comunicados sem impedir que o usuário continue a navegar.
            LaunchedEffect(error) { Toast.makeText(context, error, Toast.LENGTH_LONG).show(); error = "" }
        }
        }
    }
}

@Composable
private fun OnlineCommunity(
    db: FirebaseFirestore, uid: String, name: String, email: String, biography: String,
    visible: Boolean, onSignOut: () -> Unit, onModeration: (() -> Unit)?,
    onClergyReview: (() -> Unit)?
) {
    val context = LocalContext.current
    var sourcePosts by remember(uid) { mutableStateOf<List<Post>>(emptyList()) }
    var likedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    val notificationAdmin = onModeration != null && onClergyReview != null
    val inbox = rememberNotificationInbox(db, uid, notificationAdmin)
    var noticeBadgesOpen by remember(uid) { mutableStateOf(false) }
    var returnToNotices by remember(uid) { mutableStateOf(false) }
    var noticesOpen by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf("") }
    var tab by remember { mutableStateOf(Tab.HOME) }
    var filter by remember { mutableStateOf("Todos") }
    var search by remember { mutableStateOf("") }
    var searchOpen by remember { mutableStateOf(false) }
    var detailId by remember { mutableStateOf<String?>(null) }
    var detailReplies by remember(uid, detailId) { mutableStateOf<List<Reply>>(emptyList()) }
    var reportPost by remember { mutableStateOf<String?>(null) }
    var reportReply by remember(uid) { mutableStateOf<ReplyReportTarget?>(null) }
    var editingPostId by remember(uid) { mutableStateOf<String?>(null) }
    var deletingPostId by remember(uid) { mutableStateOf<String?>(null) }
    var deletingReplyId by remember(uid) { mutableStateOf<String?>(null) }
    var mutationBusy by remember(uid) { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }
    var feedLimit by remember(uid) { mutableStateOf(30) }
    var feedLoading by remember(uid) { mutableStateOf(true) }
    var feedMore by remember(uid) { mutableStateOf(false) }
    var feedError by remember(uid) { mutableStateOf(false) }
    var feedRetry by remember(uid) { mutableStateOf(0) }
    var replyLimit by remember(uid, detailId) { mutableStateOf(30) }
    var repliesLoading by remember(uid, detailId) { mutableStateOf(true) }
    var repliesMore by remember(uid, detailId) { mutableStateOf(false) }
    var repliesError by remember(uid, detailId) { mutableStateOf(false) }
    var repliesRetry by remember(uid, detailId) { mutableStateOf(0) }
    var openedPost by remember(uid, detailId) { mutableStateOf<Post?>(null) }
    var detailLoading by remember(uid, detailId) { mutableStateOf(true) }
    var detailError by remember(uid, detailId) { mutableStateOf(false) }
    var detailRetry by remember(uid, detailId) { mutableStateOf(0) }
    var savedOrder by remember(uid) { mutableStateOf<List<String>>(emptyList()) }
    var savedLimit by remember(uid) { mutableStateOf(30) }
    var savedPosts by remember(uid) { mutableStateOf<Map<String, Post>>(emptyMap()) }
    var savedPending by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savedFailures by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savesLoading by remember(uid) { mutableStateOf(true) }
    var savesError by remember(uid) { mutableStateOf(false) }
    var savedRetry by remember(uid) { mutableStateOf(0) }

    DisposableEffect(db, uid, feedLimit, feedRetry) {
        var active = true
        feedLoading = true
        feedError = false
        val feed = db.collection("posts").orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(feedLimit.toLong() + 1).addSnapshotListener { data, failure ->
                if (active) {
                    feedLoading = false
                    feedError = failure != null
                    if (failure != null) message = "Não foi possível carregar o fórum: ${failure.localizedMessage}"
                    else {
                        feedMore = (data?.size() ?: 0) > feedLimit
                        sourcePosts = data?.documents?.take(feedLimit)?.mapNotNull { it.toAtrioPost(uid) } ?: emptyList()
                    }
                }
            }
        onDispose { active = false; feed.remove() }
    }
    DisposableEffect(db, uid, savedRetry) {
        savesLoading = true
        savesError = false
        val likes = db.collection("users").document(uid).collection("likedPosts")
            .addSnapshotListener { data, failure ->
                if (failure != null) message = "Curtidas indisponíveis: ${failure.localizedMessage}"
                else likedIds = data?.documents?.map { it.id }?.toSet() ?: emptySet()
            }
        val saves = db.collection("users").document(uid).collection("savedPosts")
            .orderBy("createdAt", Query.Direction.DESCENDING).addSnapshotListener { data, failure ->
                savesLoading = false
                savesError = failure != null
                if (failure != null) message = "Salvos indisponíveis: ${failure.localizedMessage}"
                else {
                    savedOrder = data?.documents?.map { it.id } ?: emptyList()
                    savedIds = savedOrder.toSet()
                }
            }
        onDispose { likes.remove(); saves.remove() }
    }
    // Os salvos carregam os documentos por ID, sem depender do feed.
    val visibleSavedIds = if (tab == Tab.SAVED && detailId == null && !noticesOpen)
        savedOrder.take(savedLimit) else emptyList()
    DisposableEffect(db, uid, visibleSavedIds, savedRetry) {
        var active = true
        savedPosts = emptyMap()
        savedPending = visibleSavedIds.toSet()
        savedFailures = emptySet()
        val registrations = visibleSavedIds.map { id ->
            db.collection("posts").document(id).addSnapshotListener { snapshot, failure ->
                if (active) {
                    savedPending = savedPending - id
                    if (failure != null) savedFailures = savedFailures + id
                    else {
                        savedFailures = savedFailures - id
                        val post = snapshot?.toAtrioPost(uid)
                        savedPosts = if (post == null) savedPosts - id else savedPosts + (id to post)
                    }
                }
            }
        }
        onDispose { active = false; registrations.forEach { it.remove() } }
    }
    DisposableEffect(db, uid, detailId, detailRetry) {
        var active = true
        detailLoading = true
        detailError = false
        val registration = detailId?.let { id ->
            db.collection("posts").document(id).addSnapshotListener { snapshot, failure ->
                if (active) {
                    detailLoading = false
                    detailError = failure != null
                    openedPost = if (failure == null) snapshot?.toAtrioPost(uid) else null
                }
            }
        }
        onDispose { active = false; registration?.remove() }
    }
    DisposableEffect(db, uid, detailId, replyLimit, repliesRetry) {
        var active = true
        repliesLoading = true
        repliesError = false
        val registration = detailId?.let { id ->
            db.collection("posts").document(id).collection("replies")
                .orderBy("createdAt", Query.Direction.ASCENDING).limit(replyLimit.toLong() + 1)
                .addSnapshotListener { data, failure ->
                    if (active) {
                        repliesLoading = false
                        repliesError = failure != null
                        if (failure != null) message = "Respostas indisponíveis: ${failure.localizedMessage}"
                        else {
                            repliesMore = (data?.size() ?: 0) > replyLimit
                            detailReplies = data?.documents?.take(replyLimit)?.map {
                                Reply(author = it.getString("authorName") ?: "Membro",
                                    message = it.getString("body") ?: "", id = it.id,
                                    mine = it.getString("uid") == uid,
                                    ownerUid = it.getString("uid").orEmpty())
                            } ?: emptyList()
                        }
                    }
                }
        }
        onDispose { active = false; registration?.remove() }
    }
    // Usuários que já participavam antes desta atualização passam a receber
    // novos avisos ao reabrir uma discussão da qual são autores/comentaristas.
    LaunchedEffect(uid, detailId, openedPost?.ownerUid, detailReplies.any { it.mine }) {
        val id = detailId
        if (id != null && id == openedPost?.id &&
            (openedPost?.ownerUid == uid || detailReplies.any { it.mine }))
            ThreadPushSubscriptions.track(context, uid, id)
    }
    val posts = sourcePosts.map { it.copy(liked = it.id in likedIds, saved = it.id in savedIds) }
    val allPosts = (sourcePosts + savedPosts.values + listOfNotNull(openedPost))
        .associateBy { it.id }.values.map { it.copy(liked = it.id in likedIds, saved = it.id in savedIds) }
    val savedDisplay = savedOrder.take(savedLimit).mapNotNull { id ->
        savedPosts[id]?.copy(liked = id in likedIds, saved = id in savedIds)
    }
    fun navigate(destination: Tab) {
        tab = destination; detailId = null; noticesOpen = false
        noticeBadgesOpen = false; returnToNotices = false
        filter = "Todos"; search = ""; searchOpen = false
    }
    fun toggle(kind: String, id: String, currentlyActive: Boolean) {
        val ref = db.collection("users").document(uid).collection(kind).document(id)
        val request = if (currentlyActive) ref.delete() else ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
        request.addOnFailureListener { message = it.localizedMessage ?: "Não foi possível atualizar." }
    }
    fun publish(title: String, body: String, category: String) {
        if (working) return
        working = true
        db.collection("posts").add(mapOf(
            "uid" to uid, "authorName" to name, "title" to title,
            "body" to body, "category" to category,
            "createdAt" to FieldValue.serverTimestamp()
        )).addOnCompleteListener { result ->
            working = false
            if (result.isSuccessful) {
                result.result?.id?.let { ThreadPushSubscriptions.track(context, uid, it) }
                navigate(Tab.HOME)
                Toast.makeText(context, "Discussão publicada!", Toast.LENGTH_SHORT).show()
            } else message = result.exception?.localizedMessage ?: "Não foi possível publicar."
        }
    }
    fun reply(id: String, body: String, done: (Boolean) -> Unit) {
        val post = openedPost?.takeIf { it.id == id }
        if (post == null) {
            message = "Discussão indisponível. Atualize o fórum e tente novamente."
            done(false)
            return
        }
        // Uma resposta e sua notificação são gravadas atomicamente.
        val replyRef = db.collection("posts").document(id).collection("replies").document()
        val batch = db.batch()
        batch.set(replyRef, mapOf(
            "uid" to uid, "authorName" to name, "body" to body,
            "createdAt" to FieldValue.serverTimestamp()
        ))
        if (post.ownerUid.isNotBlank() && post.ownerUid != uid) {
            val noticeRef = db.collection("users").document(post.ownerUid)
                .collection("notifications").document(replyRef.id)
            batch.set(noticeRef, mapOf(
                "postId" to id,
                "replyId" to replyRef.id,
                "actorUid" to uid,
                "actorName" to name,
                "read" to false,
                "createdAt" to FieldValue.serverTimestamp()
            ))
        }
        batch.commit().addOnCompleteListener { result ->
            if (result.isSuccessful) {
                ThreadPushSubscriptions.track(context, uid, id)
                // Inclui respostas feitas pelo próprio autor da discussão:
                // os demais participantes também precisam receber o evento.
                InstantPushRelay.reply(id, replyRef.id)
            }
            done(result.isSuccessful)
            if (!result.isSuccessful) {
                message = result.exception?.localizedMessage ?: "Não foi possível responder. Confira as regras."
            }
        }
    }
    fun closeNoticeDestination() {
        if (detailId != null || noticeBadgesOpen) {
            detailId = null
            noticeBadgesOpen = false
            noticesOpen = returnToNotices
            returnToNotices = false
        } else noticesOpen = false
    }
    // Preserve the central state while the separate admin panel is displayed.
    if (!visible) return
    BackHandler(enabled = detailId != null || noticesOpen || noticeBadgesOpen) { closeNoticeDestination() }

    Scaffold(containerColor = Paper, topBar = {
        AtrioTopBar(
            details = detailId != null || noticesOpen || noticeBadgesOpen,
            detailsTitle = if (noticeBadgesOpen) "Meus selos" else if (noticesOpen) "Notificações" else "Discussão",
            unreadCount = inbox.groups(notificationAdmin).count { it.unread },
            onBack = ::closeNoticeDestination,
            onSearch = { val open = !searchOpen; navigate(Tab.HOME); searchOpen = open },
            onNotification = { detailId = null; noticeBadgesOpen = false; returnToNotices = false; noticesOpen = !noticesOpen; searchOpen = false }
        )
    }, bottomBar = { AtrioBottomBar(selected = tab, onSelect = ::navigate) }) { inset ->
        Box(Modifier.padding(inset)) {
            val detail = openedPost?.copy(liked = detailId in likedIds, saved = detailId in savedIds)
            if (noticeBadgesOpen) {
                LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
                    verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    item { MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true) }
                    item { Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { BadgeSettings(uid) } }
                }
            } else if (noticesOpen) {
                NotificationCenter(inbox, notificationAdmin, posts.associate { it.id to it.title },
                    onOpen = { notice ->
                        when (notice.kind) {
                            NoticeKind.REPLY -> {
                                noticesOpen = false; returnToNotices = true; detailId = notice.target
                            }
                            NoticeKind.REVIEW -> {
                                noticesOpen = false; returnToNotices = true; noticeBadgesOpen = true
                            }
                            NoticeKind.REPORTS -> onModeration?.invoke()
                            NoticeKind.REQUESTS -> onClergyReview?.invoke()
                        }
                    })
            } else if (detailId != null && detail == null) {
                if (detailLoading) Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                    CircularProgressIndicator()
                } else EmptyState("📖", if (detailError) "Não foi possível abrir" else "Discussão removida",
                    if (detailError) "Confira sua conexão e tente novamente." else "Esta publicação não está mais disponível.",
                    if (detailError) "Tentar novamente" else "Voltar",
                    { if (detailError) detailRetry++ else closeNoticeDestination() })
            } else if (detail != null) {
                DetailScreen(detail.copy(replies = detailReplies), name,
                    onLike = { toggle("likedPosts", detail.id, detail.liked) },
                    onSave = { toggle("savedPosts", detail.id, detail.saved) },
                    onReply = { body, done -> reply(detail.id, body, done) },
                    onReport = { reportPost = detail.id },
                    onEdit = if (detail.mine) ({ editingPostId = detail.id }) else null,
                    onDelete = if (detail.mine) ({ deletingPostId = detail.id }) else null,
                    onDeleteReply = { deletingReplyId = it },
                    onReportReply = { reply ->
                        reportReply = ReplyReportTarget(detail.id, reply.id, reply.author, reply.message)
                    },
                    repliesFooter = {
                        LoadMore(repliesLoading, repliesMore, repliesError, "Carregar mais respostas") {
                            if (repliesError) repliesRetry++ else replyLimit += 30
                        }
                    }
                )
            } else when (tab) {
                Tab.HOME -> HomeScreen(name, posts, filter, search, searchOpen,
                    onSearch = { search = it }, onFilter = { filter = it },
                    onCreate = { navigate(Tab.PUBLISH) }, onForums = { navigate(Tab.COMMUNITIES) },
                    onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } },
                    footer = {
                        LoadMore(feedLoading, feedMore, feedError, "Carregar mais publicações") {
                            if (feedError) feedRetry++ else feedLimit += 30
                        }
                    })
                Tab.COMMUNITIES -> CommunityScreen(posts) { category -> navigate(Tab.HOME); filter = category }
                Tab.PUBLISH -> PublishScreen { title, body, category -> publish(title, body, category) }
                Tab.SAVED -> SavedScreen(savedDisplay,
                    onDiscover = { navigate(Tab.HOME) }, onOpen = { detailId = it },
                    onLike = { id -> allPosts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> allPosts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } },
                    loading = savesLoading || savedPending.isNotEmpty(),
                    footer = {
                        LoadMore(savesLoading || savedPending.isNotEmpty(), savedOrder.size > savedLimit,
                            savesError || savedFailures.isNotEmpty(), "Carregar mais salvos") {
                            if (savesError || savedFailures.isNotEmpty()) savedRetry++ else savedLimit += 30
                        }
                        if (savedPending.isEmpty() && savedDisplay.size < visibleSavedIds.size && savedFailures.isEmpty() && !savesError)
                            Text("Algumas publicações salvas foram removidas.", color = Muted, fontSize = 12.sp)
                    })
                Tab.PROFILE -> OnlineProfileScreen(db, uid, name, email, biography, posts,
                    publicationsFooter = {
                        LoadMore(feedLoading, feedMore, feedError, "Buscar mais publicações") {
                            if (feedError) feedRetry++ else feedLimit += 30
                        }
                    },
                    onSignOut = onSignOut, onModeration = onModeration,
                    onClergyReview = onClergyReview,
                    onCreate = { navigate(Tab.PUBLISH) }, onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } })
            }
        }
    }
    // A autoria é verificada também nas regras do Firestore, não apenas nos botões.
    val editablePost = allPosts.firstOrNull { it.id == editingPostId && it.mine }
    if (editablePost != null) {
        var editedTitle by remember(editablePost.id) { mutableStateOf(editablePost.title) }
        var editedBody by remember(editablePost.id) { mutableStateOf(editablePost.body) }
        AlertDialog(
            onDismissRequest = { if (!mutationBusy) editingPostId = null },
            title = { Text("Editar minha discussão") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    OutlinedTextField(
                        editedTitle, { editedTitle = it.take(120) },
                        label = { Text("Título") }, modifier = Modifier.fillMaxWidth()
                    )
                    OutlinedTextField(
                        editedBody, { editedBody = it.take(1200) },
                        label = { Text("Texto") }, modifier = Modifier.fillMaxWidth(),
                        minLines = 3, maxLines = 7
                    )
                    Text("A categoria e a autoria não podem ser alteradas.", fontSize = 12.sp, color = Muted)
                }
            },
            confirmButton = {
                TextButton(
                    enabled = !mutationBusy && editedTitle.trim().length in 5..120 &&
                        editedBody.trim().length in 5..1200,
                    onClick = {
                        mutationBusy = true
                        db.collection("posts").document(editablePost.id).update(
                            mapOf("title" to editedTitle.trim(), "body" to editedBody.trim())
                        ).addOnCompleteListener { result ->
                            mutationBusy = false
                            if (result.isSuccessful) {
                                editingPostId = null
                                Toast.makeText(context, "Discussão atualizada!", Toast.LENGTH_SHORT).show()
                            } else message = result.exception?.localizedMessage ?: "Não foi possível editar. Confira as regras."
                        }
                    }
                ) { Text(if (mutationBusy) "Salvando..." else "Salvar") }
            },
            dismissButton = {
                TextButton(enabled = !mutationBusy, onClick = { editingPostId = null }) { Text("Cancelar") }
            }
        )
    }
    if (deletingPostId != null) {
        val postId = deletingPostId!!
        // Se a publicação sumir enquanto o diálogo estiver aberto, o servidor ainda valida o proprietário.
        AlertDialog(
            onDismissRequest = { if (!mutationBusy) deletingPostId = null },
            title = { Text("Excluir discussão?") },
            text = { Text("A publicação desaparecerá do fórum. Não será possível desfazer. " +
                "As respostas já enviadas poderão permanecer armazenadas até uma limpeza administrativa.") },
            confirmButton = {
                TextButton(enabled = !mutationBusy, onClick = {
                    mutationBusy = true
                    db.collection("posts").document(postId).delete().addOnCompleteListener { result ->
                        mutationBusy = false
                        if (result.isSuccessful) {
                            detailId = null
                            deletingPostId = null
                            Toast.makeText(context, "Discussão excluída do fórum.", Toast.LENGTH_SHORT).show()
                        } else message = result.exception?.localizedMessage ?: "Não foi possível excluir. Confira as regras."
                    }
                }) { Text(if (mutationBusy) "Excluindo..." else "Excluir", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(enabled = !mutationBusy, onClick = { deletingPostId = null }) { Text("Cancelar") }
            }
        )
    }
    if (deletingReplyId != null && detailId != null) {
        val replyId = deletingReplyId!!
        val postId = detailId!!
        AlertDialog(
            onDismissRequest = { if (!mutationBusy) deletingReplyId = null },
            title = { Text("Excluir resposta?") },
            text = { Text("Sua resposta será excluída permanentemente.") },
            confirmButton = {
                TextButton(enabled = !mutationBusy, onClick = {
                    mutationBusy = true
                    db.collection("posts").document(postId).collection("replies").document(replyId)
                        .delete().addOnCompleteListener { result ->
                            mutationBusy = false
                            if (result.isSuccessful) {
                                deletingReplyId = null
                                Toast.makeText(context, "Resposta excluída!", Toast.LENGTH_SHORT).show()
                            } else message = result.exception?.localizedMessage ?: "Não foi possível excluir resposta."
                        }
                }) { Text(if (mutationBusy) "Excluindo..." else "Excluir", color = MaterialTheme.colorScheme.error) }
            },
            dismissButton = {
                TextButton(enabled = !mutationBusy, onClick = { deletingReplyId = null }) { Text("Cancelar") }
            }
        )
    }
    reportReply?.let { target ->
        key(target.postId, target.replyId) {
            ReplyReportDialog(db, uid, target,
                onClose = { reportReply = null },
                onSuccess = { reportReply = null; message = "Denúncia da resposta enviada para análise." })
        }
    }
    if (reportPost != null) {
        var reason by remember { mutableStateOf("") }
        val id = reportPost!!
        AlertDialog(onDismissRequest = { reportPost = null }, title = { Text("Denunciar discussão") },
            text = { Column {
                Text("Por que esta discussão deve ser analisada?", fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(reason, { reason = it.take(300) },
                    label = { Text("Motivo da denúncia") }, modifier = Modifier.fillMaxWidth())
                Text("A denúncia será enviada para análise. Não remove a publicação automaticamente.",
                    fontSize = 11.sp, color = Muted)
            } },
            confirmButton = { TextButton(enabled = reason.trim().length >= 5, onClick = {
                db.collection("reports").add(mapOf(
                    "postId" to id, "reporterUid" to uid,
                    "reason" to reason.trim(), "createdAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { result ->
                    if (result.isSuccessful) result.result?.id?.let { InstantPushRelay.report(it) }
                    message = if (result.isSuccessful) "Denúncia enviada para análise da moderação." else
                        result.exception?.localizedMessage ?: "Falha ao enviar denúncia."
                }
                reportPost = null
            }) { Text("Enviar") } },
            dismissButton = { TextButton(onClick = { reportPost = null }) { Text("Cancelar") } })
    }
    if (message.isNotBlank()) {
        AlertDialog(onDismissRequest = { message = "" }, title = { Text("Átrio Católico") },
            text = { Text(message) }, confirmButton = { TextButton(onClick = { message = "" }) { Text("Entendi") } })
    }
}


private fun timestampLabel(timestamp: Timestamp?): String {
    if (timestamp == null) return "agora"
    val elapsed = (System.currentTimeMillis() - timestamp.toDate().time).coerceAtLeast(0)
    return when {
        elapsed < TimeUnit.MINUTES.toMillis(2) -> "agora"
        elapsed < TimeUnit.HOURS.toMillis(1) -> "há ${TimeUnit.MILLISECONDS.toMinutes(elapsed)} min"
        elapsed < TimeUnit.DAYS.toMillis(1) -> "há ${TimeUnit.MILLISECONDS.toHours(elapsed)} h"
        else -> "há ${TimeUnit.MILLISECONDS.toDays(elapsed)} dias"
    }
}

private fun DocumentSnapshot.toAtrioPost(uid: String): Post? {
    if (!exists()) return null
    val title = getString("title") ?: return null
    return Post(id = id, author = getString("authorName") ?: "Membro",
        title = title, body = getString("body").orEmpty(),
        category = getString("category") ?: "Vida espiritual",
        age = timestampLabel(getTimestamp("createdAt")),
        mine = getString("uid") == uid, remote = true, ownerUid = getString("uid").orEmpty())
}

@Composable
private fun LoadMore(loading: Boolean, more: Boolean, failed: Boolean, label: String, action: () -> Unit) {
    if (loading || more || failed) {
        OutlinedButton(onClick = action, enabled = !loading, modifier = Modifier.fillMaxWidth()) {
            Text(if (loading) "Carregando..." else if (failed) "Tentar novamente" else label)
        }
    }
}

private data class ReplyReportTarget(
    val postId: String, val replyId: String, val author: String, val body: String
)

@Composable
private fun ReplyReportDialog(
    db: FirebaseFirestore, uid: String, target: ReplyReportTarget,
    onClose: () -> Unit, onSuccess: () -> Unit
) {
    var reason by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Denunciar resposta") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Resposta de ${target.author}", color = Wine)
                Text(target.body, fontSize = 13.sp)
                OutlinedTextField(reason, { reason = it.take(300) }, enabled = !busy,
                    label = { Text("Motivo da denúncia") }, minLines = 2,
                    modifier = Modifier.fillMaxWidth())
                Text("A moderação analisará esta resposta. O envio não a remove automaticamente.", fontSize = 12.sp, color = Muted)
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && reason.trim().length in 5..300, onClick = {
                busy = true
                failure = ""
                db.collection("reports").add(mapOf(
                    "postId" to target.postId, "replyId" to target.replyId,
                    "reporterUid" to uid, "reason" to reason.trim(),
                    "createdAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { result ->
                    busy = false
                    if (result.isSuccessful) {
                        result.result?.id?.let { InstantPushRelay.report(it) }
                        onSuccess()
                    }
                    else failure = "Não foi possível enviar. Confira a conexão e tente novamente. " +
                        "A resposta ou a discussão pode ter sido removida."
                }
            }) { Text(if (busy) "Enviando..." else "Enviar denúncia") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Cancelar") } }
    )
}


