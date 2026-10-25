package br.com.atriocatolico

import android.widget.Toast
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
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.FieldValue
import java.util.concurrent.TimeUnit

/**
 * O modo conectado só é exibido se um google-services.json válido estiver instalado.
 * Nenhuma chave nem projeto Firebase é embutido no repositório de exemplo.
 */
@Composable
internal fun OnlineAtrioApp() {
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
            OnlineUserScreen(auth = auth, db = db, user = user)
        }
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
    var profileLoading by remember(uid) { mutableStateOf(true) }
    var error by remember(uid) { mutableStateOf("") }
    val context = LocalContext.current

    DisposableEffect(uid) {
        val registration = db.collection("profiles").document(uid).addSnapshotListener { snapshot, failure ->
            profileLoading = false
            if (failure != null) error = "Erro ao ler perfil: ${failure.localizedMessage}"
            else name = snapshot?.getString("displayName")
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
            TextButton(onClick = { auth.signOut() }) { Text("Sair desta conta") }
        }
    } else {
        OnlineCommunity(db = db, uid = uid, name = name!!, email = user.email.orEmpty(),
            onSignOut = { auth.signOut() }, onProfileChange = { replacement ->
                db.collection("profiles").document(uid).update("displayName", replacement.trim())
                    .addOnFailureListener { error = it.localizedMessage ?: "Falha ao atualizar nome" }
            })
        if (error.isNotBlank()) {
            // Erros são comunicados sem impedir que o usuário continue a navegar.
            LaunchedEffect(error) { Toast.makeText(context, error, Toast.LENGTH_LONG).show(); error = "" }
        }
    }
}

@Composable
private fun OnlineCommunity(
    db: FirebaseFirestore, uid: String, name: String, email: String,
    onSignOut: () -> Unit, onProfileChange: (String) -> Unit
) {
    val context = LocalContext.current
    var sourcePosts by remember(uid) { mutableStateOf<List<Post>>(emptyList()) }
    var likedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var message by remember(uid) { mutableStateOf("") }
    var tab by remember { mutableStateOf(Tab.HOME) }
    var filter by remember { mutableStateOf("Todos") }
    var search by remember { mutableStateOf("") }
    var searchOpen by remember { mutableStateOf(false) }
    var detailId by remember { mutableStateOf<String?>(null) }
    var detailReplies by remember { mutableStateOf<List<Reply>>(emptyList()) }
    var reportPost by remember { mutableStateOf<String?>(null) }
    var renameOpen by remember { mutableStateOf(false) }
    var working by remember { mutableStateOf(false) }

    DisposableEffect(db, uid) {
        val feed = db.collection("posts").orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(100).addSnapshotListener { data, failure ->
                if (failure != null) message = "Não foi possível carregar o fórum: ${failure.localizedMessage}"
                else sourcePosts = data?.documents?.mapNotNull { item ->
                    val title = item.getString("title") ?: return@mapNotNull null
                    Post(
                        id = item.id, author = item.getString("authorName") ?: "Membro",
                        title = title, body = item.getString("body") ?: "",
                        category = item.getString("category") ?: "Vida espiritual",
                        age = timestampLabel(item.getTimestamp("createdAt")),
                        mine = item.getString("uid") == uid, remote = true
                    )
                } ?: emptyList()
            }
        val likes = db.collection("users").document(uid).collection("likedPosts")
            .addSnapshotListener { data, failure ->
                if (failure != null) message = "Curtidas indisponíveis: ${failure.localizedMessage}"
                else likedIds = data?.documents?.map { it.id }?.toSet() ?: emptySet()
            }
        val saves = db.collection("users").document(uid).collection("savedPosts")
            .addSnapshotListener { data, failure ->
                if (failure != null) message = "Salvos indisponíveis: ${failure.localizedMessage}"
                else savedIds = data?.documents?.map { it.id }?.toSet() ?: emptySet()
            }
        onDispose { feed.remove(); likes.remove(); saves.remove() }
    }
    DisposableEffect(db, detailId) {
        val id = detailId
        detailReplies = emptyList()
        val registration = if (id == null) null else
            db.collection("posts").document(id).collection("replies")
                .orderBy("createdAt", Query.Direction.ASCENDING).limit(100)
                .addSnapshotListener { data, failure ->
                    if (failure != null) message = "Respostas indisponíveis: ${failure.localizedMessage}"
                    else detailReplies = data?.documents?.map {
                        Reply(it.getString("authorName") ?: "Membro", it.getString("body") ?: "")
                    } ?: emptyList()
                }
        onDispose { registration?.remove() }
    }
    val posts = sourcePosts.map { it.copy(liked = it.id in likedIds, saved = it.id in savedIds) }
    fun navigate(destination: Tab) {
        tab = destination; detailId = null; filter = "Todos"; search = ""; searchOpen = false
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
                navigate(Tab.HOME)
                Toast.makeText(context, "Discussão publicada!", Toast.LENGTH_SHORT).show()
            } else message = result.exception?.localizedMessage ?: "Não foi possível publicar."
        }
    }
    fun reply(id: String, body: String) {
        db.collection("posts").document(id).collection("replies").add(mapOf(
            "uid" to uid, "authorName" to name, "body" to body,
            "createdAt" to FieldValue.serverTimestamp()
        )).addOnFailureListener { message = it.localizedMessage ?: "Não foi possível responder." }
    }

    Scaffold(containerColor = Paper, topBar = {
        AtrioTopBar(details = detailId != null, onBack = { detailId = null },
            onSearch = { val open = !searchOpen; navigate(Tab.HOME); searchOpen = open },
            onNotification = { Toast.makeText(context, "Notificações chegarão em uma próxima versão.", Toast.LENGTH_SHORT).show() })
    }, bottomBar = { AtrioBottomBar(selected = tab, onSelect = ::navigate) }) { inset ->
        Box(Modifier.padding(inset)) {
            val detail = posts.firstOrNull { it.id == detailId }
            if (detail != null) {
                DetailScreen(detail.copy(replies = detailReplies), name,
                    onLike = { toggle("likedPosts", detail.id, detail.liked) },
                    onSave = { toggle("savedPosts", detail.id, detail.saved) },
                    onReply = { reply(detail.id, it) },
                    onReport = { reportPost = detail.id }
                )
            } else when (tab) {
                Tab.HOME -> HomeScreen(name, posts, filter, search, searchOpen,
                    onSearch = { search = it }, onFilter = { filter = it },
                    onCreate = { navigate(Tab.PUBLISH) }, onForums = { navigate(Tab.COMMUNITIES) },
                    onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } })
                Tab.COMMUNITIES -> CommunityScreen(posts) { category -> navigate(Tab.HOME); filter = category }
                Tab.PUBLISH -> PublishScreen { title, body, category -> publish(title, body, category) }
                Tab.SAVED -> SavedScreen(posts.filter { it.saved },
                    onDiscover = { navigate(Tab.HOME) }, onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } })
                Tab.PROFILE -> OnlineProfileScreen(name, email, posts,
                    onRename = { renameOpen = true }, onSignOut = onSignOut,
                    onCreate = { navigate(Tab.PUBLISH) }, onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } })
            }
        }
    }
    if (renameOpen) {
        var edited by remember { mutableStateOf(name) }
        AlertDialog(onDismissRequest = { renameOpen = false }, title = { Text("Editar nome público") },
            text = { OutlinedTextField(edited, { if (it.length <= 35) edited = it }, label = { Text("Nome") }) },
            confirmButton = { TextButton(enabled = edited.trim().length >= 2,
                onClick = { onProfileChange(edited.trim()); renameOpen = false }) { Text("Salvar") } },
            dismissButton = { TextButton(onClick = { renameOpen = false }) { Text("Cancelar") } })
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
                    message = if (result.isSuccessful) "Denúncia registrada para futura análise." else
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

@Composable
private fun OnlineProfileScreen(
    name: String, email: String, posts: List<Post>, onRename: () -> Unit,
    onSignOut: () -> Unit, onCreate: () -> Unit, onOpen: (String) -> Unit,
    onLike: (String) -> Unit, onSave: (String) -> Unit
) {
    val mine = posts.filter { it.mine }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)) {
        item {
            Column(Modifier.fillMaxWidth().padding(vertical = 20.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Icon(Icons.Outlined.AccountCircle, contentDescription = null,
                    modifier = Modifier.size(72.dp), tint = Wine)
                Text(name, fontFamily = FontFamily.Serif, fontSize = 23.sp, fontWeight = FontWeight.Bold)
                Text(email, fontSize = 12.sp, color = Muted)
                Spacer(Modifier.height(10.dp))
                OutlinedButton(onClick = onRename) { Text("Editar nome") }
            }
        }
        item { SectionTitle("Minhas publicações") }
        if (mine.isEmpty()) item {
            EmptyState("✍️", "Comece uma conversa", "Sua primeira discussão estará aqui.",
                "Criar discussão", onCreate)
        }
        items(mine, key = { it.id }) { DiscussionCard(it, onOpen, onLike, onSave) }
        item {
            Text("Versão de testes: os dados são compartilhados pela internet. " +
                "Nunca publique informações pessoais sensíveis.", fontSize = 12.sp,
                color = Muted, lineHeight = 18.sp)
            OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) {
                Icon(Icons.Outlined.Logout, contentDescription = null)
                Spacer(Modifier.width(8.dp))
                Text("Sair da conta")
            }
        }
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
