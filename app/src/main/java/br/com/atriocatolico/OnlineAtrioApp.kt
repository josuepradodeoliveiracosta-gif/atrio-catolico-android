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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.contentType
import androidx.compose.ui.semantics.semantics
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.material.icons.outlined.Visibility
import androidx.compose.material.icons.outlined.VisibilityOff
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.UserProfileChangeRequest
import androidx.compose.ui.graphics.asImageBitmap
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.FieldValue
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.launch

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
            key(user.uid) {
                // A exigencia e definida pelo Firebase de forma administrativa,
                // sem confiar em um atributo que o usuario possa gravar no perfil.
                var verificationRequired by remember(user.uid) { mutableStateOf(false) }
                var verifiedThisSession by remember(user.uid) {
                    mutableStateOf(user.isEmailVerified)
                }
                DisposableEffect(db, user.uid) {
                    val policy = db.document("app_config/email_verification")
                        .addSnapshotListener { snapshot, failure ->
                            verificationRequired = failure == null &&
                                snapshot?.getBoolean("enabled") == true &&
                                snapshot.getString("version") == "2026-11-v1"
                        }
                    onDispose { policy.remove() }
                }
                if (verificationRequired && !verifiedThisSession) {
                    MandatoryEmailVerificationGate(
                        uid = user.uid,
                        onVerified = { verifiedThisSession = true },
                        onSignOut = { auth.signOut() }
                    )
                } else {
                    OnlineUserScreen(auth = auth, db = db, user = user)
                }
            }
        }
        // Keep session state outside the login branch and user key.
        // O laboratório isolado de instrumentação não deve abrir vídeo,
        // cujo ciclo de vida atrapalharia os toques no Android virtual.
        // O projeto oficial mantém a abertura normal (inclusive em builds debug).
        if (!(BuildConfig.DEBUG &&
                com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")) {
            OpeningVideo(activity, authenticated = user != null)
        }
    }
}

@Composable
private fun OnlineAuthScreen(auth: FirebaseAuth, db: FirebaseFirestore) {
    var registering by remember { mutableStateOf(false) }
    var displayName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var acceptedRules by remember { mutableStateOf(false) }
    var showRules by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var showConfirmation by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var resetInfo by remember { mutableStateOf("") }

    val emailValid = RegistrationPolicy.validEmail(email)
    val passwordIssue = if (registering && password.isNotEmpty())
        RegistrationPolicy.passwordProblem(password, email, displayName) else null
    val confirmationIssue = if (registering && confirmation.isNotEmpty())
        RegistrationPolicy.confirmProblem(password, confirmation) else null
    val ready = if (registering) {
        RegistrationPolicy.ready(displayName, email, password, confirmation, acceptedRules)
    } else emailValid && password.length >= 6 // Não bloquear senhas antigas no login.

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
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text(if (registering) "Criar conta" else "Entrar na comunidade",
                    fontSize = 22.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
                if (registering) {
                    OutlinedTextField(displayName, { displayName = it.take(35) },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-auth-name"),
                        label = { Text("Nome público") }, singleLine = true, enabled = !busy,
                        isError = displayName.isNotBlank() && !RegistrationPolicy.validName(displayName),
                        supportingText = { Text("De 2 a 35 caracteres. Será exibido nas publicações.") },
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Next))
                }
                OutlinedTextField(email, { email = it.take(150) },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-auth-email")
                        .semantics { contentType = ContentType.EmailAddress },
                    label = { Text("E-mail") }, singleLine = true, enabled = !busy,
                    isError = email.isNotBlank() && !emailValid,
                    supportingText = if (email.isNotBlank() && !emailValid) {
                        { Text("Confira o formato do e-mail.") }
                    } else null,
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next))
                OutlinedTextField(password, { password = it.take(RegistrationPolicy.MAX_PASSWORD) },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-auth-password")
                        .semantics {
                            contentType = if (registering) ContentType.NewPassword else ContentType.Password
                        },
                    label = { Text(if (registering) "Senha (15 caracteres ou mais)" else "Senha") },
                    singleLine = true, enabled = !busy, isError = passwordIssue != null,
                    visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password,
                        imeAction = if (registering) ImeAction.Next else ImeAction.Done),
                    trailingIcon = {
                        IconButton(onClick = { showPassword = !showPassword }, enabled = !busy) {
                            Icon(if (showPassword) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                contentDescription = if (showPassword) "Ocultar senha" else "Mostrar senha")
                        }
                    },
                    supportingText = if (registering) {
                        { Text(passwordIssue ?: "Use uma frase-senha ou um gerenciador. " +
                            password.length + "/128 caracteres.") }
                    } else null)
                if (registering) {
                    OutlinedTextField(confirmation, { confirmation = it.take(RegistrationPolicy.MAX_PASSWORD) },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-auth-confirm")
                            .semantics { contentType = ContentType.NewPassword },
                        label = { Text("Confirmar senha") }, singleLine = true, enabled = !busy,
                        isError = confirmationIssue != null,
                        visualTransformation = if (showConfirmation) VisualTransformation.None else PasswordVisualTransformation(),
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Done),
                        trailingIcon = {
                            IconButton(onClick = { showConfirmation = !showConfirmation }, enabled = !busy) {
                                Icon(if (showConfirmation) Icons.Outlined.VisibilityOff else Icons.Outlined.Visibility,
                                    contentDescription = if (showConfirmation) "Ocultar confirmação" else "Mostrar confirmação")
                            }
                        },
                        supportingText = if (confirmationIssue != null) {
                            { Text(confirmationIssue) }
                        } else null)
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = acceptedRules,
                            onCheckedChange = { acceptedRules = it },
                            modifier = Modifier.testTag("atrio-auth-rules"),
                            enabled = !busy)
                        Text("Li e aceito as Regras da Comunidade.", fontSize = 13.sp)
                    }
                    TextButton(onClick = { showRules = true }, enabled = !busy,
                        modifier = Modifier.testTag("atrio-auth-read-rules")) {
                        Text("Ler as Regras da Comunidade")
                    }
                    Text("O cadastro utiliza Firebase Authentication. Antes da publicação na Google Play, " +
                        "serão disponibilizados Termos de Uso, Política de Privacidade e solicitação de exclusão de conta. " +
                        "O aceite acima refere-se somente às Regras da Comunidade.",
                        fontSize = 11.sp, color = Muted, lineHeight = 15.sp)
                }
                if (error.isNotBlank()) {
                    Text(error, modifier = Modifier.testTag("atrio-auth-error"),
                        color = MaterialTheme.colorScheme.error, fontSize = 13.sp)
                }
                if (resetInfo.isNotBlank()) Text(resetInfo, color = Wine, fontSize = 13.sp)
                Button(
                    modifier = Modifier.fillMaxWidth().testTag("atrio-auth-submit"),
                    enabled = !busy && ready,
                    onClick = {
                        busy = true
                        error = ""
                        resetInfo = ""
                        if (registering) {
                            val publicName = displayName.trim()
                            auth.createUserWithEmailAndPassword(email.trim(), password)
                                .addOnSuccessListener { result ->
                                    val created = result.user
                                    if (created == null) {
                                        busy = false
                                        error = "Não foi possível concluir o cadastro. Tente novamente."
                                    } else {
                                        // E-mail enviado após a criação. O backend deve ser configurado
                                        // para impedir UGC não verificado antes de ativar exigência global.
                                        created.sendEmailVerification().addOnFailureListener {
                                            android.util.Log.w("AtrioAuth", "email_verification_delivery_failed")
                                        }
                                        // A aceitação do cadastro é guardada na conta,
                                        // para não obrigar o mesmo usuário a aceitar outra vez.
                                        db.collection("community_consents").document(created.uid)
                                            .set(mapOf(
                                                "version" to CommunityRulesPolicy.VERSION,
                                                "acceptedAt" to FieldValue.serverTimestamp()
                                            )).addOnFailureListener {
                                                android.util.Log.w("AtrioAuth", "community_consent_write_failed")
                                            }
                                        db.collection("profiles").document(created.uid).set(mapOf(
                                            "displayName" to publicName,
                                            "createdAt" to FieldValue.serverTimestamp()
                                        )).addOnSuccessListener {
                                            val update = UserProfileChangeRequest.Builder()
                                                .setDisplayName(publicName).build()
                                            created.updateProfile(update)
                                            busy = false
                                        }.addOnFailureListener {
                                            busy = false
                                            error = "Sua conta foi criada, mas o perfil ainda não foi salvo. " +
                                                "Conclua o perfil após entrar novamente."
                                        }
                                    }
                                }.addOnFailureListener { failure ->
                                    busy = false
                                    error = registrationErrorMessage(failure)
                                }
                        } else {
                            auth.signInWithEmailAndPassword(email.trim(), password)
                                .addOnCompleteListener { task ->
                                    busy = false
                                    if (!task.isSuccessful) {
                                        error = "Não foi possível entrar. Confira o e-mail e a senha."
                                    }
                                }
                        }
                    }
                ) { Text(if (busy) "Aguarde..." else if (registering) "Criar minha conta" else "Entrar") }
                TextButton(onClick = {
                    registering = !registering
                    password = ""
                    confirmation = ""
                    acceptedRules = false
                    error = ""
                    resetInfo = ""
                    showPassword = false
                    showConfirmation = false
                }, enabled = !busy, modifier = Modifier.fillMaxWidth().testTag("atrio-auth-toggle")) {
                    Text(if (registering) "Já tenho conta" else "Ainda não tenho conta")
                }
                if (!registering) {
                    TextButton(onClick = {
                        if (!emailValid) {
                            error = "Informe um e-mail válido para recuperar a senha."
                        } else {
                            error = ""
                            auth.sendPasswordResetEmail(email.trim()).addOnCompleteListener {
                                resetInfo = if (it.isSuccessful)
                                    "Se o endereço estiver cadastrado, você receberá instruções por e-mail."
                                else "Não foi possível solicitar a recuperação agora."
                            }
                        }
                    }, enabled = !busy, modifier = Modifier.fillMaxWidth()) {
                        Text("Esqueci minha senha")
                    }
                }
                Text("Cadastro por e-mail · Discussões compartilhadas · Respeito em primeiro lugar",
                    fontSize = 11.sp, color = Muted, lineHeight = 16.sp, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth())
            }
        }
    }
    if (showRules) {
        AlertDialog(
            onDismissRequest = { showRules = false },
            title = { Text("Regras da Comunidade") },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text("O Átrio Católico é um espaço para diálogo respeitoso sobre a fé. " +
                        "Não são permitidos assédio, ameaças, discursos de ódio, exploração sexual, " +
                        "exposição de dados privados, fraudes, spam ou divulgação de conteúdo ilegal. " +
                        "É proibido se passar por padres, diáconos, moderadores ou administradores. " +
                        "Publicações e respostas podem ser denunciadas e moderadas. " +
                        "Não compartilhe informações sensíveis de outras pessoas.",
                        style = MaterialTheme.typography.bodyMedium)
                }
            },
            confirmButton = {
                TextButton(onClick = { showRules = false }) { Text("Entendi") }
            }
        )
    }
}

private fun registrationErrorMessage(failure: Exception): String {
    val code = (failure as? com.google.firebase.auth.FirebaseAuthException)?.errorCode.orEmpty()
    return when (code) {
        "ERROR_EMAIL_ALREADY_IN_USE" -> "Este e-mail já possui uma conta. Tente entrar ou recuperar a senha."
        "ERROR_INVALID_EMAIL" -> "Informe um endereço de e-mail válido."
        "ERROR_WEAK_PASSWORD" -> "A senha foi recusada pela política do Firebase. Escolha outra."
        "ERROR_NETWORK_REQUEST_FAILED" -> "Sem conexão. Verifique a internet e tente novamente."
        "ERROR_TOO_MANY_REQUESTS" -> "Muitas tentativas. Aguarde antes de tentar novamente."
        else -> "Não foi possível criar a conta. Verifique a conexão e tente novamente."
    }
}

@Composable
private fun OnlineUserScreen(auth: FirebaseAuth, db: FirebaseFirestore, user: FirebaseUser) {
    val uid = user.uid
    // Rollout seguro: o novo portão só liga APÓS implantar as regras Firestore
    // e aprovar explicitamente app_config/community_rules pelo Console.
    // Sem configuração publicada (ou em erro/offline), não bloquear contas.
    var rulesGateEnabled by remember(uid) { mutableStateOf(false) }
    var consentLoaded by remember(uid) { mutableStateOf(false) }
    var consentReadFailed by remember(uid) { mutableStateOf(false) }
    var consentAccepted by remember(uid) { mutableStateOf(false) }
    DisposableEffect(db, uid) {
        val feature = db.document("app_config/community_rules")
            .addSnapshotListener { snapshot, failure ->
                rulesGateEnabled = failure == null &&
                    snapshot?.getBoolean("enabled") == true &&
                    snapshot.getString("version") == CommunityRulesPolicy.VERSION
            }
        val acceptance = db.collection("community_consents").document(uid)
            .addSnapshotListener { snapshot, failure ->
                consentLoaded = true // Erro também libera a tela de saída, nunca spinner eterno.
                consentReadFailed = failure != null
                consentAccepted = failure == null &&
                    snapshot?.getString("version") == CommunityRulesPolicy.VERSION
            }
        onDispose { feature.remove(); acceptance.remove() }
    }
    if (rulesGateEnabled && !consentAccepted) {
        CommunityRulesGate(db, uid, loaded = consentLoaded, loadError = consentReadFailed)
        return
    }
    // Firebase Auth mantém displayName entre logins: ele evita que o
    // usuário fique preso no carregamento enquanto o listener do perfil
    // reconecta após logout/login da mesma conta.
    val authName = user.displayName?.trim().orEmpty().takeIf { it.isNotBlank() }
    var name by remember(uid) { mutableStateOf<String?>(authName) }
    var biography by remember(uid) { mutableStateOf("") }
    var profileLoading by remember(uid) { mutableStateOf(authName == null) }
    var error by remember(uid) { mutableStateOf("") }
    val context = LocalContext.current
    var photoRevision by remember(uid) { mutableIntStateOf(0) }
    val localPhoto = remember(uid, photoRevision) {
        ProfilePhotoStore.load(context, uid)?.asImageBitmap()
    }
    LaunchedEffect(uid) {
        val isolatedQa = BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
        if (!isolatedQa) {
            PushRegistry.refreshIfEnabled(context, uid, db)
            BackgroundNoticeScheduler.sync(context, uid)
        }
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

    DisposableEffect(db, uid) {
        var active = true
        val profile = db.collection("profiles").document(uid)
        fun showProfile(snapshot: DocumentSnapshot?) {
            if (!active) return
            profileLoading = false
            if (snapshot?.exists() == true) {
                val found = snapshot.getString("displayName")?.trim().orEmpty()
                if (found.isNotBlank()) {
                    name = found
                    biography = snapshot.getString("bio").orEmpty()
                    error = ""
                }
            }
            // Não apagar o nome após receber um snapshot temporariamente
            // vazio: a restauração do cache pode anteceder a resposta remota.
        }
        val registration = profile.addSnapshotListener { snapshot, failure ->
            if (!active) return@addSnapshotListener
            if (failure != null) {
                error = "Erro ao sincronizar perfil. Verifique sua conexão."
                // Não ficar no spinner infinito nem derrubar sessão autenticada.
                if (name != null) profileLoading = false
            } else {
                showProfile(snapshot)
            }
        }
        // Caminho independente do listener em reconexões/logout/login.
        // A leitura direta completa a inicialização se não houver snapshot.
        profile.get(com.google.firebase.firestore.Source.SERVER)
            .addOnCompleteListener { result ->
                if (!active) return@addOnCompleteListener
                if (result.isSuccessful) showProfile(result.result)
                else if (name == null) {
                    profileLoading = false
                    error = "Não foi possível carregar seu perfil. Tente novamente."
                }
            }
        onDispose { active = false; registration.remove() }
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
        CompositionLocalProvider(
            LocalFounderUid provides founderUid,
            LocalProfileAvatar provides LocalAvatarState(uid, localPhoto),
            LocalAvatarFirestore provides db
        ) {
        OnlineCommunity(db = db, uid = uid, name = name!!, email = user.email.orEmpty(),
            biography = biography, onPhotoChanged = { photoRevision++ },
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
    onPhotoChanged: () -> Unit,
    visible: Boolean, onSignOut: () -> Unit, onModeration: (() -> Unit)?,
    onClergyReview: (() -> Unit)?
) {
    val context = LocalContext.current
    val ota = rememberOtaUpdateController()
    val otaScope = rememberCoroutineScope()
    val otaSnackbar = remember { SnackbarHostState() }
    var lastAnnouncedOtaVersion by remember { mutableStateOf<String?>(null) }
    var sourcePosts by remember(uid) { mutableStateOf<List<Post>>(emptyList()) }
    val blockedMembers = rememberBlockedMembers(db, uid)
    var likedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    val notificationAdmin = onModeration != null && onClergyReview != null
    val advancedEngagement = rememberAdvancedEngagementEnabled(db, uid)
    val inbox = rememberNotificationInbox(db, uid, notificationAdmin)
    var noticeBadgesOpen by remember(uid) { mutableStateOf(false) }
    var guardiaoAppealsOpen by remember(uid) { mutableStateOf(false) }
    var returnToNotices by remember(uid) { mutableStateOf(false) }
    var noticesOpen by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf("") }
    var emailVerificationRequired by remember(uid) { mutableStateOf(false) }
    DisposableEffect(db, uid) {
        val listener = db.document("app_config/email_verification")
            .addSnapshotListener { snapshot, failure ->
                // Sem ativacao explicita, apenas o servidor decide; contas
                // antigas nao devem ser bloqueadas pela interface.
                emailVerificationRequired = failure == null &&
                    snapshot?.getBoolean("enabled") == true &&
                    snapshot.getString("version") == "2026-11-v1"
            }
        onDispose { listener.remove() }
    }
    var tab by remember { mutableStateOf(Tab.HOME) }
    var filter by remember { mutableStateOf("Todos") }
    var search by remember { mutableStateOf("") }
    var searchOpen by remember { mutableStateOf(false) }
    var detailId by remember { mutableStateOf<String?>(null) }
    var publicProfileTarget by remember(uid) { mutableStateOf<PublicMemberTarget?>(null) }
    var profilePostOpen by remember(uid) { mutableStateOf(false) }
    var previousDetailId by remember(uid) { mutableStateOf<String?>(null) }
    var detailReplies by remember(uid, detailId) { mutableStateOf<List<Reply>>(emptyList()) }
    var reportPost by remember { mutableStateOf<String?>(null) }
    var reportReply by remember(uid) { mutableStateOf<ReplyReportTarget?>(null) }
    var editingPostId by remember(uid) { mutableStateOf<String?>(null) }
    var deletingPostId by remember(uid) { mutableStateOf<String?>(null) }
    var deletingReplyId by remember(uid) { mutableStateOf<String?>(null) }
    var mutationBusy by remember(uid) { mutableStateOf(false) }
    // Orientação preventiva, sem enviar texto à rede nem aplicar sanções.
    var guardianWarning by remember(uid) { mutableStateOf<GuardianPreflight.Warning?>(null) }
    var guardianPendingSend by remember(uid) { mutableStateOf<(() -> Unit)?>(null) }
    var guardianPendingCancel by remember(uid) { mutableStateOf<(() -> Unit)?>(null) }
    fun confirmGuardianBeforeSend(
        text: String,
        onCancel: () -> Unit = {},
        submit: () -> Unit
    ) {
        val alert = GuardianPreflight.inspect(text)
        if (alert == null) submit()
        else if (guardianPendingSend == null) {
            guardianWarning = alert
            guardianPendingSend = submit
            guardianPendingCancel = onCancel
        } else {
            // Não prender o botão Responder se outro aviso já está aberto.
            onCancel()
        }
    }
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
    var followedRevision by remember(uid) { mutableIntStateOf(0) }
    val syncedFollow = rememberSyncedFollowedDiscussions(db, uid, advancedEngagement)
    val followedIds = if (advancedEngagement) syncedFollow.ids
        else remember(uid, followedRevision) { LocalFollowedDiscussions.ids(context, uid) }
    var followBusy by remember(uid, detailId) { mutableStateOf(false) }

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
                                    ownerUid = it.getString("uid").orEmpty(),
                                    replyToId = it.getString("replyToId").orEmpty(),
                                    replyToUid = it.getString("replyToUid").orEmpty(),
                                    mentionUid = it.getString("mentionUid").orEmpty())
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
    val posts = sourcePosts.filter { it.ownerUid !in blockedMembers }
        .map { it.copy(liked = it.id in likedIds, saved = it.id in savedIds) }
    val allPosts = (sourcePosts + savedPosts.values + listOfNotNull(openedPost))
        .filter { it.ownerUid !in blockedMembers }
        .associateBy { it.id }.values.map { it.copy(liked = it.id in likedIds, saved = it.id in savedIds) }
    val savedDisplay = savedOrder.take(savedLimit).mapNotNull { id ->
        savedPosts[id]?.takeUnless { it.ownerUid in blockedMembers }
            ?.copy(liked = id in likedIds, saved = id in savedIds)
    }
    fun navigate(destination: Tab) {
        if (BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11") {
            android.util.Log.d("AtrioQaNavigation", "request_${destination.name}_from_${tab.name}")
        }
        tab = destination; detailId = null; noticesOpen = false
        publicProfileTarget = null; profilePostOpen = false; previousDetailId = null
        guardiaoAppealsOpen = false
        noticeBadgesOpen = false; returnToNotices = false
        filter = "Todos"; search = ""; searchOpen = false
    }
    LaunchedEffect(ota.status) {
        val result = ota.status
        if (result is OtaCheckStatus.Available && result.version != lastAnnouncedOtaVersion) {
            lastAnnouncedOtaVersion = result.version
            val choice = otaSnackbar.showSnackbar(
                message = "Nova versão do Átrio: ${result.version}. Consulte as novidades no Perfil.",
                actionLabel = "Ver",
                duration = SnackbarDuration.Long
            )
            if (choice == SnackbarResult.ActionPerformed) navigate(Tab.PROFILE)
        }
    }
    fun openMemberProfile(memberUid: String, publishedName: String) {
        if (memberUid.isBlank()) return
        if (memberUid == uid) {
            navigate(Tab.PROFILE)
        } else {
            if (publicProfileTarget == null) previousDetailId = detailId
            publicProfileTarget = PublicMemberTarget(memberUid, publishedName)
            profilePostOpen = false
        }
    }
    LaunchedEffect(tab, detailId, noticesOpen, noticeBadgesOpen, guardiaoAppealsOpen) {
        if (BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11") {
            android.util.Log.d("AtrioQaNavigation",
                "visible_tab=${tab.name}_detail=${detailId != null}_notices=$noticesOpen" +
                    "_badges=${noticeBadgesOpen}_appeals=$guardiaoAppealsOpen")
        }
    }
    fun toggle(kind: String, id: String, currentlyActive: Boolean) {
        val ref = db.collection("users").document(uid).collection(kind).document(id)
        val request = if (currentlyActive) ref.delete() else ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
        request.addOnFailureListener { message = it.localizedMessage ?: "Não foi possível atualizar." }
    }
    fun canPublishWithCurrentSession(): Boolean {
        val current = FirebaseAuth.getInstance().currentUser
        if (current?.uid != uid) {
            message = "Sua sessão mudou. Entre novamente."
            return false
        }
        if (emailVerificationRequired && !current.isEmailVerified) {
            message = "Confirme seu e-mail para publicar ou responder. Abra Meu perfil, " +
                "use Reenviar confirmação e depois Já confirmei meu e-mail."
            return false
        }
        return true
    }
    fun publish(title: String, body: String, category: String) {
        if (!canPublishWithCurrentSession()) return
        // Diagnóstico somente no laboratório Android com Firebase emulado:
        // não registrar conteúdo de publicação nem dados pessoais.
        val qaLab = BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
        if (working) {
            if (qaLab) android.util.Log.d("AtrioQaPublish", "ignored_busy")
            return
        }
        if (qaLab) android.util.Log.d("AtrioQaPublish", "submit_dispatched")
        working = true
        db.collection("posts").add(mapOf(
            "uid" to uid, "authorName" to name, "title" to title,
            "body" to body, "category" to category,
            "createdAt" to FieldValue.serverTimestamp()
        )).addOnCompleteListener { result ->
            working = false
            if (qaLab) android.util.Log.d("AtrioQaPublish",
                if (result.isSuccessful) "commit_ok" else "commit_failed_" +
                    ((result.exception as? com.google.firebase.firestore.FirebaseFirestoreException)
                        ?.code?.name ?: result.exception?.javaClass?.simpleName ?: "unknown"))
            if (result.isSuccessful) {
                // O retorno à interface não deve depender de FCM/Push.
                // Em especial, nenhum serviço externo pode travar a navegação
                // depois de a publicação já ter sido aceita pelo Firestore.
                navigate(Tab.HOME)
                Toast.makeText(context, "Discussão publicada!", Toast.LENGTH_SHORT).show()
                if (!qaLab) result.result?.id?.let {
                    ThreadPushSubscriptions.track(context, uid, it)
                    InstantPushRelay.moderatePost(it)
                }
            } else message = if (emailVerificationRequired &&
                FirebaseAuth.getInstance().currentUser?.isEmailVerified != true)
                "Confirme seu e-mail em Meu perfil antes de publicar."
                else "Não foi possível publicar. Confira a conexão e as regras da comunidade."
        }
    }
    fun reply(
        id: String, body: String, done: (Boolean) -> Unit,
        target: Reply? = null, mention: MentionCandidate? = null
    ) {
        if (!canPublishWithCurrentSession()) {
            done(false)
            return
        }
        if (openedPost?.id != id) {
            message = "Discussão indisponível. Atualize o fórum e tente novamente."
            done(false)
            return
        }
        // O destinatário é obtido do documento canônico no servidor, não do
        // estado da tela, que pode estar atrasado durante troca de contas.
        // Não publicar silenciosamente uma resposta sem o aviso obrigatório.
        db.collection("posts").document(id).get(com.google.firebase.firestore.Source.SERVER)
            .addOnCompleteListener { parentResult ->
                val parent = if (parentResult.isSuccessful) parentResult.result else null
                val ownerUid = if (parent?.exists() == true)
                    parent.getString("uid").orEmpty() else ""
                if (ownerUid.isBlank()) {
                    message = "Não foi possível confirmar o autor da discussão. Tente novamente."
                    done(false)
                    return@addOnCompleteListener
                }
                val replyRef = db.collection("posts").document(id)
                    .collection("replies").document()
                val batch = db.batch()
                val replyData = mutableMapOf<String, Any>(
                    "uid" to uid, "authorName" to name, "body" to body,
                    "createdAt" to FieldValue.serverTimestamp()
                )
                if (target != null && advancedEngagement &&
                    target.id.isNotBlank() && target.ownerUid.isNotBlank()) {
                    replyData["replyToId"] = target.id
                    replyData["replyToUid"] = target.ownerUid
                }
                if (mention != null && advancedEngagement && mention.uid != uid) {
                    replyData["mentionUid"] = mention.uid
                    if (mention.sourceReplyId.isNotBlank()) {
                        replyData["mentionReplyId"] = mention.sourceReplyId
                    }
                }
                batch.set(replyRef, replyData)
                if (ownerUid != uid) {
                    val noticeRef = db.collection("users").document(ownerUid)
                        .collection("notifications").document(replyRef.id)
                    val notice = mutableMapOf<String, Any>(
                        "postId" to id,
                        "replyId" to replyRef.id,
                        "actorUid" to uid,
                        "actorName" to name,
                        "read" to false,
                        "createdAt" to FieldValue.serverTimestamp()
                    )
                    // Quando o autor da discussão também é o autor citado,
                    // evitar dois avisos e identificar a resposta como direta.
                    if (advancedEngagement && target != null &&
                        target.ownerUid == ownerUid && target.id.isNotBlank()) {
                        notice["replyToId"] = target.id
                    }
                    if (advancedEngagement && mention?.uid == ownerUid) {
                        notice["mentionUid"] = ownerUid
                        if (mention.sourceReplyId.isNotBlank()) {
                            notice["mentionReplyId"] = mention.sourceReplyId
                        }
                    }
                    batch.set(noticeRef, notice)
                }
                // O destinatário da resposta direta pode ser distinto do autor
                // da discussão. Backend valida o alvo real e a escrita atômica.
                if (advancedEngagement && target != null &&
                    target.id.isNotBlank() && target.ownerUid.isNotBlank() &&
                    target.ownerUid != uid && target.ownerUid != ownerUid) {
                    val noticeRef = db.collection("users").document(target.ownerUid)
                        .collection("notifications").document(replyRef.id)
                    batch.set(noticeRef, mapOf(
                        "postId" to id, "replyId" to replyRef.id,
                        "actorUid" to uid, "actorName" to name,
                        "replyToId" to target.id,
                        "read" to false,
                        "createdAt" to FieldValue.serverTimestamp()
                    ))
                }
                // Uma menção explícita no tópico pode enviar um aviso privado
                // ao participante, com UID verificado pelas regras do Firestore.
                if (advancedEngagement && mention != null &&
                    mention.uid != uid && mention.uid != ownerUid &&
                    mention.uid != target?.ownerUid) {
                    val noticeRef = db.collection("users").document(mention.uid)
                        .collection("notifications").document(replyRef.id)
                    val mentionNotice = mutableMapOf<String, Any>(
                        "postId" to id, "replyId" to replyRef.id,
                        "actorUid" to uid, "actorName" to name,
                        "mentionUid" to mention.uid, "read" to false,
                        "createdAt" to FieldValue.serverTimestamp()
                    )
                    if (mention.sourceReplyId.isNotBlank()) {
                        mentionNotice["mentionReplyId"] = mention.sourceReplyId
                    }
                    batch.set(noticeRef, mentionNotice)
                }
                // Resposta e notificações continuam atômicas.
                batch.commit().addOnCompleteListener { result ->
                    // Confirmar imediatamente o resultado para a interface.
                    // Inscrições FCM e relay não devem bloquear o botão Responder.
                    if (!result.isSuccessful) {
                        message = if (emailVerificationRequired &&
                            FirebaseAuth.getInstance().currentUser?.isEmailVerified != true)
                            "Confirme seu e-mail em Meu perfil antes de responder."
                            else "Não foi possível responder. Confira a conexão e as regras."
                    }
                    done(result.isSuccessful)
                    val qaLab = BuildConfig.DEBUG &&
                        com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
                    if (result.isSuccessful && !qaLab) {
                        ThreadPushSubscriptions.track(context, uid, id)
                        InstantPushRelay.reply(id, replyRef.id)
                        InstantPushRelay.moderateReply(id, replyRef.id)
                    }
                }
            }
    }
    fun closeNoticeDestination() {
        if (profilePostOpen && publicProfileTarget != null) {
            profilePostOpen = false
            detailId = previousDetailId
        } else if (publicProfileTarget != null) {
            publicProfileTarget = null
            previousDetailId = null
        } else if (guardiaoAppealsOpen) {
            guardiaoAppealsOpen = false
        } else if (detailId != null || noticeBadgesOpen) {
            detailId = null
            noticeBadgesOpen = false
            noticesOpen = returnToNotices
            returnToNotices = false
        } else noticesOpen = false
    }
    // Preserve the central state while the separate admin panel is displayed.
    if (!visible) return
    BackHandler(enabled = publicProfileTarget != null || detailId != null || noticesOpen || noticeBadgesOpen || guardiaoAppealsOpen) { closeNoticeDestination() }

    Scaffold(containerColor = Paper, snackbarHost = { SnackbarHost(otaSnackbar) }, topBar = {
        AtrioTopBar(
            details = publicProfileTarget != null || detailId != null || noticesOpen || noticeBadgesOpen || guardiaoAppealsOpen,
            detailsTitle = if (publicProfileTarget != null && !profilePostOpen) "Perfil público"
                else if (guardiaoAppealsOpen) "Minhas revisões" else if (noticeBadgesOpen) "Meus selos"
                else if (noticesOpen) "Notificações" else "Discussão",
            unreadCount = inbox.groups(notificationAdmin).count { it.unread },
            onBack = ::closeNoticeDestination,
            onSearch = { val open = !searchOpen; navigate(Tab.HOME); searchOpen = open },
            onNotification = {
                publicProfileTarget = null; profilePostOpen = false; previousDetailId = null
                detailId = null; noticeBadgesOpen = false; returnToNotices = false
                noticesOpen = !noticesOpen; searchOpen = false
            }
        )
    }, bottomBar = { AtrioBottomBar(selected = tab, onSelect = ::navigate) }) { inset ->
        Box(Modifier.padding(inset)) {
            val detail = openedPost?.takeUnless { it.ownerUid in blockedMembers }
                ?.copy(liked = detailId in likedIds, saved = detailId in savedIds)
            if (publicProfileTarget != null && !profilePostOpen) {
                PublicMemberProfileScreen(
                    db = db, target = publicProfileTarget!!, viewerUid = uid,
                    onBack = ::closeNoticeDestination,
                    onOpenDiscussion = { postId -> profilePostOpen = true; detailId = postId }
                )
            } else if (guardiaoAppealsOpen) {
                GuardiaoAppealsScreen(db, uid)
            } else if (noticeBadgesOpen) {
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
                DetailScreen(detail.copy(replies = detailReplies.filter { it.ownerUid !in blockedMembers }), name,
                    onLike = { toggle("likedPosts", detail.id, detail.liked) },
                    onSave = { toggle("savedPosts", detail.id, detail.saved) },
                    onReply = { body, done ->
                        confirmGuardianBeforeSend(body, onCancel = { done(false) }) {
                            reply(detail.id, body, done)
                        }
                    },
                    onDirectReply = if (advancedEngagement) ({ body, target, done ->
                        confirmGuardianBeforeSend(body, onCancel = { done(false) }) {
                            reply(detail.id, body, done, target)
                        }
                    }) else null,
                    currentUid = uid,
                    onMentionReply = if (advancedEngagement) ({ body, participant, done ->
                        confirmGuardianBeforeSend(body, onCancel = { done(false) }) {
                            reply(detail.id, body, done, mention = participant)
                        }
                    }) else null,
                    reactionsEnabled = advancedEngagement,
                    reactionContent = { item, requested, dismiss ->
                        if (advancedEngagement)
                            ReplyReactionBar(db, uid, detail.id, item.id, requested, dismiss)
                    },
                    followed = detail.id in followedIds,
                    followBusy = followBusy || (advancedEngagement && syncedFollow.loading),
                    followIsSynced = advancedEngagement,
                    onFollow = {
                        if (advancedEngagement) {
                            if (!followBusy && !syncedFollow.loading && !syncedFollow.failed) {
                                followBusy = true
                                SyncedFollowedDiscussions.change(
                                    db, uid, detail.id, detail.id in followedIds
                                ) { ok ->
                                    followBusy = false
                                    if (!ok) message = "Não foi possível atualizar o acompanhamento."
                                }
                            } else if (syncedFollow.failed) {
                                message = "Não foi possível carregar seus acompanhamentos."
                            }
                        } else {
                            runCatching {
                                LocalFollowedDiscussions.toggle(context, uid, detail.id)
                            }.onSuccess { followedRevision++ }
                                .onFailure { message = it.message ?: "Não foi possível acompanhar." }
                        }
                    },
                    onReport = { reportPost = detail.id },
                    onEdit = if (detail.mine) ({ editingPostId = detail.id }) else null,
                    onDelete = if (detail.mine) ({ deletingPostId = detail.id }) else null,
                    onDeleteReply = { deletingReplyId = it },
                    onReportReply = { reply ->
                        reportReply = ReplyReportTarget(detail.id, reply.id, reply.author, reply.message)
                    },
                    onOpenProfile = ::openMemberProfile,
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
                    onOpenProfile = ::openMemberProfile,
                    footer = {
                        LoadMore(feedLoading, feedMore, feedError, "Carregar mais publicações") {
                            if (feedError) feedRetry++ else feedLimit += 30
                        }
                    })
                Tab.COMMUNITIES -> CommunityScreen(posts) { category -> navigate(Tab.HOME); filter = category }
                Tab.PUBLISH -> PublishScreen { title, body, category ->
                    confirmGuardianBeforeSend(title + "\n" + body) {
                        publish(title, body, category)
                    }
                }
                Tab.SAVED -> SavedScreen(savedDisplay,
                    onDiscover = { navigate(Tab.HOME) }, onOpen = { detailId = it },
                    onLike = { id -> allPosts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> allPosts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } },
                    loading = savesLoading || savedPending.isNotEmpty(),
                    onOpenProfile = ::openMemberProfile,
                    footer = {
                        LoadMore(savesLoading || savedPending.isNotEmpty(), savedOrder.size > savedLimit,
                            savesError || savedFailures.isNotEmpty(), "Carregar mais salvos") {
                            if (savesError || savedFailures.isNotEmpty()) savedRetry++ else savedLimit += 30
                        }
                        if (savedPending.isEmpty() && savedDisplay.size < visibleSavedIds.size && savedFailures.isEmpty() && !savesError)
                            Text("Algumas publicações salvas foram removidas.", color = Muted, fontSize = 12.sp)
                    })
                Tab.PROFILE -> {
                    OnlineProfileScreen(db, uid, name, email, biography, posts,
                    publicationsFooter = {
                        LoadMore(feedLoading, feedMore, feedError, "Buscar mais publicações") {
                            if (feedError) feedRetry++ else feedLimit += 30
                        }
                    },
                    onSignOut = onSignOut, onModeration = onModeration,
                    onClergyReview = onClergyReview,
                    onSavedPosts = { navigate(Tab.SAVED) },
                    followedRevision = followedRevision, savedCount = savedOrder.size,
                    followedRemoteEnabled = advancedEngagement,
                    followedRemoteIds = syncedFollow.ids,
                    followedRemoteLoading = syncedFollow.loading,
                    followedRemoteFailed = syncedFollow.failed,
                    onPhotoChanged = onPhotoChanged,
                    otaStatus = ota.status,
                    onRefreshUpdates = { otaScope.launch { ota.refresh() } },
                    otaDownload = ota.downloadState,
                    otaInstallMessage = ota.installMessage,
                    onDownloadUpdate = { offer -> otaScope.launch { ota.download(offer) } },
                    onCancelUpdateDownload = { ota.cancelDownload() },
                    onInstallUpdate = { otaScope.launch { ota.install() } },
                    onNotifications = { noticesOpen = true; returnToNotices = false },
                    onReviews = { guardiaoAppealsOpen = true },
                    onCreate = { navigate(Tab.PUBLISH) }, onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { toggle("savedPosts", id, it.saved) } })
                }
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
                        confirmGuardianBeforeSend(editedTitle + "\n" + editedBody) {
                            mutationBusy = true
                            db.collection("posts").document(editablePost.id).update(
                                mapOf("title" to editedTitle.trim(), "body" to editedBody.trim(),
                                    "updatedAt" to FieldValue.serverTimestamp())
                            ).addOnCompleteListener { result ->
                                mutationBusy = false
                                if (result.isSuccessful) {
                                    editingPostId = null
                                    Toast.makeText(context, "Discussão atualizada!", Toast.LENGTH_SHORT).show()
                                } else message = result.exception?.localizedMessage ?: "Não foi possível editar. Confira as regras."
                            }
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
        var sendingReport by remember(reportPost) { mutableStateOf(false) }
        val id = reportPost!!
        AlertDialog(onDismissRequest = { reportPost = null }, title = { Text("Denunciar discussão") },
            text = { Column {
                Text("Por que esta discussão deve ser analisada?", fontSize = 13.sp)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(reason, { reason = it.take(300) },
                    label = { Text("Motivo da denúncia") },
                     modifier = Modifier.fillMaxWidth().testTag("atrio-report-post-reason"))
                Text("A denúncia será enviada para análise. Não remove a publicação automaticamente.",
                    fontSize = 11.sp, color = Muted)
            } },
            confirmButton = { TextButton(enabled = !sendingReport && reason.trim().length >= 5, onClick = {
                sendingReport = true
                val reportId = ReportDocumentIds.post(uid, id)
                db.collection("reports").document(reportId).set(mapOf(
                    "postId" to id, "reporterUid" to uid,
                    "reason" to reason.trim(), "createdAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { result ->
                    sendingReport = false
                    if (result.isSuccessful) InstantPushRelay.report(reportId)
                    message = if (result.isSuccessful) "Denúncia enviada para análise da moderação." else
                        "Não foi possível enviar. Talvez você já tenha denunciado esta discussão, ou ela não esteja mais disponível."
                    if (result.isSuccessful) reportPost = null
                }
            }, modifier = Modifier.testTag("atrio-report-post-submit")) { Text("Enviar") } },
            dismissButton = { TextButton(onClick = { reportPost = null }) { Text("Cancelar") } })
    }
    if (guardianWarning != null) {
        fun dismissGuardianWarning(confirmed: Boolean) {
            val approved = guardianPendingSend
            val canceled = guardianPendingCancel
            guardianWarning = null
            guardianPendingSend = null
            guardianPendingCancel = null
            if (confirmed) approved?.invoke() else canceled?.invoke()
        }
        AlertDialog(
            onDismissRequest = { dismissGuardianWarning(false) },
            title = { Text("Aviso preventivo — Átrio Guardião") },
            text = { Text(guardianWarning!!.explanation + "\n\n" +
                "Esta é uma orientação automática local, não uma punição. " +
                "Você pode revisar o texto ou continuar por sua responsabilidade.") },
            confirmButton = { TextButton(onClick = { dismissGuardianWarning(true) },
                modifier = Modifier.testTag("atrio-guardian-continue")) {
                Text("Publicar mesmo assim")
            } },
            dismissButton = { TextButton(onClick = { dismissGuardianWarning(false) },
                modifier = Modifier.testTag("atrio-guardian-revise")) {
                Text("Revisar texto")
            } }
        )
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
                val reportId = ReportDocumentIds.reply(uid, target.postId, target.replyId)
                db.collection("reports").document(reportId).set(mapOf(
                    "postId" to target.postId, "replyId" to target.replyId,
                    "reporterUid" to uid, "reason" to reason.trim(),
                    "createdAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { result ->
                    busy = false
                    if (result.isSuccessful) {
                        InstantPushRelay.report(reportId)
                        onSuccess()
                    }
                    else failure = "Não foi possível enviar. Talvez você já tenha denunciado esta resposta, " +
                        "ou ela não esteja mais disponível."
                }
            }) { Text(if (busy) "Enviando..." else "Enviar denúncia") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Cancelar") } }
    )
}


