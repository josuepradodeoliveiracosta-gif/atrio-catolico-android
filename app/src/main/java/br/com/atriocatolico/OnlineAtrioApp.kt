package br.com.atriocatolico

import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountCircle
import androidx.compose.material.icons.outlined.Logout
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.saveable.rememberSaveableStateHolder
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.autofill.ContentType
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
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
import com.google.firebase.firestore.MetadataChanges
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
    // Escopo local: somente contas NOVAS criadas neste fluxo de cadastro V2.
    // Nunca impor onboarding retroativamente aos UIDs existentes.
    val registrationPrefs = remember(activity) {
        activity.getSharedPreferences("atrio-registration-v2", android.content.Context.MODE_PRIVATE)
    }
    var registrationStarted by rememberSaveable { mutableStateOf(false) }
    var pendingRegistrationUid by remember {
        mutableStateOf(registrationPrefs.getString("pendingUid", null))
    }

    DisposableEffect(auth) {
        val listener = FirebaseAuth.AuthStateListener { signedUser = it.currentUser }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }

    AtrioTheme {
        val user = signedUser
        if (user == null) {
            OnlineAuthScreen(auth = auth, db = db,
                onRegistrationStarted = { registrationStarted = true },
                onRegistrationCreated = { uid ->
                    pendingRegistrationUid = uid
                    registrationPrefs.edit().putString("pendingUid", uid).apply()
                },
                onRegistrationFailed = { registrationStarted = false })
        } else {
            key(user.uid) {
                // Seguranca de entrada: o cliente deve conhecer a politica do
                // servidor antes de apresentar a comunidade a uma conta nao verificada.
                // O cache local e erros de rede NUNCA equivalem a enabled=false.
                var verificationPolicy by remember(user.uid) {
                    mutableStateOf(EmailVerificationPolicyAccess.CHECKING)
                }
                var policyRetry by remember(user.uid) { mutableIntStateOf(0) }
                var verifiedThisSession by remember(user.uid) {
                    mutableStateOf(user.isEmailVerified)
                }
                // Ao entrar em outro aparelho, recuperar a pendência de uma
                // conta V2 já provisionada. Contas antigas sem documento
                // continuam seguindo a política de migração existente.
                var remoteSignupPending by remember(user.uid) { mutableStateOf(false) }
                DisposableEffect(db, user.uid, verifiedThisSession) {
                    var active = true
                    if (!verifiedThisSession) {
                        db.document("users/${user.uid}/private/account")
                            .get(com.google.firebase.firestore.Source.SERVER)
                            .addOnCompleteListener { task ->
                                if (active && task.isSuccessful) {
                                    remoteSignupPending =
                                        task.result?.getString("onboardingStatus") == "pending_email"
                                }
                            }
                    } else remoteSignupPending = false
                    onDispose { active = false }
                }
                DisposableEffect(db, user.uid, policyRetry) {
                    verificationPolicy = EmailVerificationPolicyAccess.CHECKING
                    val policy = db.document("app_config/email_verification")
                        // INCLUDE: sem dados novos, a transicao cache -> servidor
                        // so gera evento quando mudancas de metadata sao observadas.
                        .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
                            verificationPolicy = when {
                                failure != null || snapshot == null ->
                                    EmailVerificationPolicyAccess.UNAVAILABLE
                                snapshot.metadata.isFromCache ->
                                    EmailVerificationPolicyAccess.CHECKING
                                else -> emailVerificationPolicyFromServer(
                                    snapshot.getBoolean("enabled"),
                                    snapshot.getString("version")
                                )
                            }
                        }
                    onDispose { policy.remove() }
                }
                val onGateSignOut: () -> Unit = {
                    registrationStarted = false
                    BackgroundNoticeScheduler.disable(activity, user.uid)
                    PushRegistry.deactivate(activity, user.uid, db)
                    auth.signOut()
                }
                val isolatedQa = BuildConfig.DEBUG &&
                    com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
                // A suíte legada do Firebase Emulator testa os bots sem exigir
                // link de e-mail real. O fluxo novo é validado separadamente.
                val justRegistered = !isolatedQa &&
                    (registrationStarted || pendingRegistrationUid == user.uid ||
                        remoteSignupPending)
                // Uma conta recém-criada nunca salta a verificação por um
                // switch administrativo ainda em fase de migração.
                if (justRegistered && verifiedThisSession) {
                    RegistrationOnboardingScreen(db, user.uid, onFinish = {
                        db.document("users/${user.uid}/private/account")
                            .update(mapOf(
                                "onboardingStatus" to "complete",
                                "updatedAt" to FieldValue.serverTimestamp()
                            ))
                        registrationStarted = false
                        pendingRegistrationUid = null
                        registrationPrefs.edit().remove("pendingUid").apply()
                    })
                } else if (justRegistered && !verifiedThisSession) {
                    MandatoryEmailVerificationGate(
                        uid = user.uid,
                        onVerified = { verifiedThisSession = true },
                        onSignOut = onGateSignOut
                    )
                } else if (canEnterAtrioCommunity(verifiedThisSession, verificationPolicy)) {
                    OnlineUserScreen(auth = auth, db = db, user = user)
                } else if (verificationPolicy == EmailVerificationPolicyAccess.REQUIRED) {
                    MandatoryEmailVerificationGate(
                        uid = user.uid,
                        onVerified = { verifiedThisSession = true },
                        onSignOut = onGateSignOut
                    )
                } else {
                    EmailVerificationPolicyStatusScreen(
                        unavailable = verificationPolicy == EmailVerificationPolicyAccess.UNAVAILABLE,
                        onRetry = { policyRetry++ },
                        onSignOut = onGateSignOut
                    )
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
private fun OnlineAuthScreen(
    auth: FirebaseAuth, db: FirebaseFirestore,
    onRegistrationStarted: () -> Unit = {},
    onRegistrationCreated: (String) -> Unit = {},
    onRegistrationFailed: () -> Unit = {}
) {
    val isIsolatedQa = BuildConfig.DEBUG &&
        com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
    var entranceChosen by rememberSaveable { mutableStateOf(isIsolatedQa) }
    var registering by remember { mutableStateOf(false) }
    var displayName by remember { mutableStateOf("") }
    var email by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var confirmation by remember { mutableStateOf("") }
    var acceptedRules by remember { mutableStateOf(false) }
    var acceptedTerms by remember { mutableStateOf(false) }
    var acknowledgedPrivacy by remember { mutableStateOf(false) }
    var legalDocument by remember { mutableStateOf("") }
    var showRules by remember { mutableStateOf(false) }
    var showPassword by remember { mutableStateOf(false) }
    var showConfirmation by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    var resetInfo by remember { mutableStateOf("") }
    BackHandler(enabled = entranceChosen && !isIsolatedQa && !busy) {
        entranceChosen = false
        error = ""
    }

    if (!entranceChosen) {
        RegistrationWelcomeScreen(
            onCreate = { registering = true; entranceChosen = true },
            onLogin = { registering = false; entranceChosen = true }
        )
        return
    }

    val emailValid = RegistrationPolicy.validEmail(email)
    val passwordIssue = if (registering && password.isNotEmpty())
        RegistrationPolicy.passwordProblem(password, email, displayName) else null
    val confirmationIssue = if (registering && confirmation.isNotEmpty())
        RegistrationPolicy.confirmProblem(password, confirmation) else null
    val ready = if (registering) {
        RegistrationPolicy.ready(displayName, email, password, confirmation,
            acceptedRules && (isIsolatedQa || (acceptedTerms && acknowledgedPrivacy)))
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
                Text(if (registering) "Criar sua conta" else "Entrar na comunidade",
                    fontSize = 22.sp, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
                if (registering) Text(
                    "Passo 1 de 3 · Depois você confirmará seu e-mail. A personalização é opcional.",
                    fontSize = AtrioType.secondary, color = Muted
                )
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
                        Text("Li e aceito as Regras da Comunidade.", fontSize = AtrioType.secondary)
                    }
                    TextButton(onClick = { showRules = true }, enabled = !busy,
                        modifier = Modifier.testTag("atrio-auth-read-rules")) {
                        Text("Ler as Regras da Comunidade")
                    }
                    // Documentos legais devem ser aprovados antes do Release.
                    // A prévia serve ao teste do fluxo, não é declaração de
                    // conformidade LGPD nem substitui parecer jurídico.
                    TextButton(
                        onClick = { legalDocument = "terms" },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-auth-read-terms")
                    ) { Text("Ler condições de uso (prévia)") }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = acceptedTerms,
                            onCheckedChange = { acceptedTerms = it },
                            enabled = !busy, modifier = Modifier.testTag("atrio-auth-terms"))
                        Text("Li e concordo com as condições de uso apresentadas.",
                            fontSize = AtrioType.secondary)
                    }
                    TextButton(
                        onClick = { legalDocument = "privacy" },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-auth-read-privacy")
                    ) { Text("Ler informações de privacidade (prévia)") }
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Checkbox(checked = acknowledgedPrivacy,
                            onCheckedChange = { acknowledgedPrivacy = it },
                            enabled = !busy, modifier = Modifier.testTag("atrio-auth-privacy"))
                        Text("Li as informações de privacidade.", fontSize = AtrioType.secondary)
                    }
                    Text("As políticas completas, retenção de dados e bases legais ainda requerem " +
                        "revisão antes do lançamento oficial. Preferências religiosas serão opcionais.",
                        fontSize = AtrioType.secondary, color = Muted, lineHeight = AtrioType.secondaryLine)
                }
                if (error.isNotBlank()) {
                    Text(error, modifier = Modifier.testTag("atrio-auth-error"),
                        color = MaterialTheme.colorScheme.error, fontSize = AtrioType.secondary)
                }
                if (resetInfo.isNotBlank()) Text(resetInfo, color = Wine, fontSize = AtrioType.secondary)
                Button(
                    modifier = Modifier.fillMaxWidth().testTag("atrio-auth-submit"),
                    enabled = !busy && ready,
                    onClick = {
                        busy = true
                        error = ""
                        resetInfo = ""
                        if (registering) {
                            val publicName = displayName.trim()
                            onRegistrationStarted()
                            auth.createUserWithEmailAndPassword(email.trim(), password)
                                .addOnSuccessListener { result ->
                                    val created = result.user
                                    if (created == null) {
                                        onRegistrationFailed()
                                        busy = false
                                        error = "Não foi possível concluir o cadastro. Tente novamente."
                                    } else {
                                        // Diagnóstico exclusivo do Firebase Emulator: não
                                        // registrar UID, e-mail, nome, token ou senha.
                                        if (isIsolatedQa) android.util.Log.i(
                                            "AtrioQaProfile", "auth_signup_callback_received"
                                        )
                                        onRegistrationCreated(created.uid)
                                        // Registro mínimo no esquema V2; as Rules novas
                                        // precisam de deploy separado antes de produção.
                                        db.document("users/${created.uid}/private/account")
                                            .set(mapOf(
                                                "onboardingStatus" to "pending_email",
                                                "profileVersion" to 2,
                                                "noticesOptIn" to false,
                                                "communityUpdates" to false,
                                                "updatedAt" to FieldValue.serverTimestamp()
                                            ))
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
                                        if (isIsolatedQa) android.util.Log.i(
                                            "AtrioQaProfile", "profile_write_requested"
                                        )
                                        db.collection("profiles").document(created.uid).set(mapOf(
                                            "displayName" to publicName,
                                            "createdAt" to FieldValue.serverTimestamp()
                                        )).addOnSuccessListener {
                                            // Task.set concluída: resposta do servidor
                                            // emulado, não apenas snapshot do cache.
                                            if (isIsolatedQa) android.util.Log.i(
                                                "AtrioQaProfile", "profile_write_acknowledged"
                                            )
                                            val update = UserProfileChangeRequest.Builder()
                                                .setDisplayName(publicName).build()
                                            created.updateProfile(update)
                                            busy = false
                                        }.addOnFailureListener { failure ->
                                            if (isIsolatedQa) {
                                                val code = (failure as?
                                                    com.google.firebase.firestore.FirebaseFirestoreException)
                                                    ?.code?.name ?: failure.javaClass.simpleName
                                                android.util.Log.w(
                                                    "AtrioQaProfile", "profile_write_rejected:$code"
                                                )
                                            }
                                            busy = false
                                            error = "Sua conta foi criada, mas o perfil ainda não foi salvo. " +
                                                "Conclua o perfil após entrar novamente."
                                        }
                                    }
                                }.addOnFailureListener { failure ->
                                    onRegistrationFailed()
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
                    acceptedTerms = false
                    acknowledgedPrivacy = false
                    legalDocument = ""
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
                    fontSize = AtrioType.secondary, color = Muted, lineHeight = AtrioType.secondaryLine, textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth())
            }
        }
    }
    if (legalDocument.isNotEmpty()) {
        AlertDialog(
            onDismissRequest = { legalDocument = "" },
            title = {
                Text(if (legalDocument == "terms") "Condições de uso — prévia"
                    else "Privacidade — prévia")
            },
            text = {
                Column(Modifier.verticalScroll(rememberScrollState())) {
                    Text(
                        if (legalDocument == "terms")
                            "O Átrio Católico é uma comunidade de diálogo respeitoso. " +
                                "Não publique conteúdo ilegal, dados privados de terceiros, " +
                                "fraudes, ameaças ou material discriminatório. " +
                                "Conteúdo e participantes podem ser denunciados e revisados " +
                                "pela moderação. O uso não concede cargo religioso ou administrativo. " +
                                "Este resumo necessita de revisão jurídica antes de um Release oficial."
                        else
                            "O cadastro utiliza Firebase Authentication e Firestore para " +
                                "manter e proteger a conta. Nome de exibição e e-mail são necessários; " +
                                "interesses, identificação religiosa, paróquia e cidade são opcionais " +
                                "e privados por padrão. A pessoa pode corrigir ou apagar essas " +
                                "preferências no perfil. Há um canal interno de solicitação de " +
                                "exclusão de conta, atendida pela administração. Os períodos de " +
                                "retenção, bases legais e a política completa devem ser revisados " +
                                "antes de publicar o aplicativo.",
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = { legalDocument = "" }) { Text("Fechar") }
            }
        )
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
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error, fontSize = AtrioType.secondary)
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
    var publishSuccessVisible by remember(uid) { mutableStateOf(false) }
    var sourcePosts by remember(uid) { mutableStateOf<List<Post>>(emptyList()) }
    val blockedMembers = rememberBlockedMembers(db, uid)
    var likedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var savedIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var pendingSaveIds by remember(uid) { mutableStateOf<Set<String>>(emptySet()) }
    var saveOverrides by remember(uid) { mutableStateOf<Map<String, Boolean>>(emptyMap()) }
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
    var tab by rememberSaveable(uid) { mutableStateOf(Tab.HOME) }
    var filter by rememberSaveable(uid) { mutableStateOf("Todos") }
    var search by rememberSaveable(uid) { mutableStateOf("") }
    var searchOpen by rememberSaveable(uid) { mutableStateOf(false) }
    // Preservar rascunho ao alternar abas, sem guardar estado de outra conta.
    // A chave muda após publicação bem-sucedida, começando um formulário limpo.
    val draftStateHolder = rememberSaveableStateHolder()
    var publishDraftEpoch by rememberSaveable(uid) { mutableIntStateOf(0) }
    // O estado de rolagem vive fora da tela Início para sobreviver à troca de abas.
    val homeListState = rememberLazyListState()
    var detailId by remember { mutableStateOf<String?>(null) }
    var publicProfileTarget by remember(uid) { mutableStateOf<PublicMemberTarget?>(null) }
    var conversationsOpen by remember(uid) { mutableStateOf(false) }
    var conversationTarget by remember(uid) { mutableStateOf<PublicMemberTarget?>(null) }
    var notificationChatId by remember(uid) { mutableStateOf<String?>(null) }
    var notificationGroupId by remember(uid) { mutableStateOf<String?>(null) }
    var shareDiscussion by remember(uid) { mutableStateOf<Pair<String, String>?>(null) }
    val incomingChat = AtrioChatNavigation.requested
    LaunchedEffect(uid, incomingChat) {
        if (incomingChat != null) {
            if (incomingChat.uid == uid) {
                notificationChatId = incomingChat.chatId
                conversationTarget = null
                conversationsOpen = true
            }
            AtrioChatNavigation.consume()
        }
    }
    val incomingGroup=AtrioGroupNavigation.requested
    LaunchedEffect(uid,incomingGroup) {
        if(incomingGroup!=null) {
            if(incomingGroup.uid==uid) {
                notificationGroupId=incomingGroup.groupId
                notificationChatId=null
                conversationTarget=null
                conversationsOpen=true
            }
            AtrioGroupNavigation.consume()
        }
    }
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
    var replyNewestFirst by remember(uid, detailId) { mutableStateOf(false) }
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

    // Gravações sequenciais por discussão. A última intenção vence; em erro
    // o marcador volta ao último estado confirmado. Nenhum backend novo.
    val saveCoordinator = remember(db, uid) {
        AtrioSaveIntentCoordinator(
            write = { id, shouldSave, done ->
                val ref = db.collection("users").document(uid)
                    .collection("savedPosts").document(id)
                val task = if (shouldSave)
                    ref.set(mapOf("createdAt" to FieldValue.serverTimestamp()))
                else ref.delete()
                task.addOnCompleteListener { done(it.isSuccessful) }
            },
            onState = { id, isSaved, pending ->
                saveOverrides = if (pending) saveOverrides + (id to isSaved)
                    else saveOverrides - id
                pendingSaveIds = if (pending) pendingSaveIds + id else pendingSaveIds - id
                if (!pending) {
                    savedIds = if (isSaved) savedIds + id else savedIds - id
                }
            },
            onFailure = { message = "Não foi possível atualizar os salvos. Tente novamente." }
        )
    }

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
    DisposableEffect(db, uid, detailId, replyLimit, repliesRetry, replyNewestFirst) {
        var active = true
        repliesLoading = true
        repliesError = false
        val registration = detailId?.let { id ->
            db.collection("posts").document(id).collection("replies")
                .orderBy("createdAt", if (replyNewestFirst) Query.Direction.DESCENDING else Query.Direction.ASCENDING)
                .limit(replyLimit.toLong() + 1)
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
                                    mentionUid = it.getString("mentionUid").orEmpty(),
                                    createdAtMillis = it.getTimestamp("createdAt")?.toDate()?.time ?: 0L)
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
        .map {
            it.copy(liked = it.id in likedIds,
                saved = saveOverrides[it.id] ?: (it.id in savedIds),
                savePending = it.id in pendingSaveIds)
        }
    val allPosts = (sourcePosts + savedPosts.values + listOfNotNull(openedPost))
        .filter { it.ownerUid !in blockedMembers }
        .associateBy { it.id }.values.map {
            it.copy(liked = it.id in likedIds,
                saved = saveOverrides[it.id] ?: (it.id in savedIds),
                savePending = it.id in pendingSaveIds)
        }
    val savedDisplay = savedOrder.take(savedLimit).mapNotNull { id ->
        savedPosts[id]?.takeUnless { it.ownerUid in blockedMembers }
            ?.copy(liked = id in likedIds,
                saved = saveOverrides[id] ?: (id in savedIds),
                savePending = id in pendingSaveIds)
    }
    fun navigate(destination: Tab) {
        if (BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11") {
            android.util.Log.d("AtrioQaNavigation", "request_${destination.name}_from_${tab.name}")
        }
        tab = destination; detailId = null; noticesOpen = false
        conversationsOpen = false; conversationTarget = null; notificationChatId = null
        shareDiscussion = null
        publicProfileTarget = null; profilePostOpen = false; previousDetailId = null
        guardiaoAppealsOpen = false
        noticeBadgesOpen = false; returnToNotices = false
        // Não apagar a busca ou o filtro ao alternar abas. O usuário volta
        // ao contexto em que estava lendo.
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
    var lastPublishFingerprint by rememberSaveable(uid) { mutableStateOf("") }
    var lastPublishId by rememberSaveable(uid) { mutableStateOf("") }
    fun publish(title: String, body: String, category: String) {
        if (!canPublishWithCurrentSession()) return
        val qaLab = BuildConfig.DEBUG &&
            com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
        if (working) {
            if (qaLab) android.util.Log.d("AtrioQaPublish", "ignored_busy")
            return
        }
        // Mesma tentativa lógica mantém o mesmo ID mesmo depois de erro/rotação.
        // Se o Firestore gravar e a resposta de rede se perder, a nova tentativa
        // não criará uma segunda publicação.
        val fingerprint = listOf(title.trim(), body.trim(), category).joinToString("\u001f")
        val id = if (fingerprint == lastPublishFingerprint && lastPublishId.isNotBlank()) {
            lastPublishId
        } else {
            java.util.UUID.randomUUID().toString().also {
                lastPublishFingerprint = fingerprint
                lastPublishId = it
            }
        }
        val ref = db.collection("posts").document(id)
        fun completeAccepted() {
            working = false
            lastPublishFingerprint = ""
            lastPublishId = ""
            draftStateHolder.removeState("$uid:publish:$publishDraftEpoch")
            publishDraftEpoch++
            // Após publicar, mostrar o novo tópico no feed sem ocultá-lo por
            // um filtro ou pesquisa anteriores.
            filter = "Todos"
            search = ""
            searchOpen = false
            navigate(Tab.HOME)
            // Feedback visual somente após confirmação do servidor, sem atrasar o retorno.
            publishSuccessVisible = true
            if (!qaLab) {
                ThreadPushSubscriptions.track(context, uid, id)
                InstantPushRelay.moderatePost(id)
            }
        }
        if (qaLab) android.util.Log.d("AtrioQaPublish", "submit_dispatched")
        working = true

        // Se este ID já foi gravado numa tentativa anterior, reconciliar
        // primeiro. Nunca sobrescrever uma discussão publicada.
        ref.get(com.google.firebase.firestore.Source.SERVER).addOnCompleteListener { previous ->
            if (!previous.isSuccessful) {
                // Não enfileirar gravação offline por tempo indefinido.
                // O ID da tentativa e todos os campos permanecem no rascunho.
                working = false
                message = "Sem conexão com o servidor. Seu rascunho está preservado; tente novamente."
                return@addOnCompleteListener
            }
            if (previous.result?.exists() == true) {
                val data = previous.result
                if (data?.getString("uid") == uid &&
                    data?.getString("title") == title &&
                    data?.getString("body") == body &&
                    data?.getString("category") == category) completeAccepted()
                else {
                    working = false
                    message = "Não foi possível confirmar a publicação. Tente novamente."
                }
                return@addOnCompleteListener
            }
            ref.set(mapOf(
                "uid" to uid, "authorName" to name, "title" to title,
                "body" to body, "category" to category,
                "createdAt" to FieldValue.serverTimestamp()
            )).addOnCompleteListener { result ->
                if (qaLab) android.util.Log.d("AtrioQaPublish",
                    if (result.isSuccessful) "commit_ok" else "commit_failed")
                if (result.isSuccessful) {
                    completeAccepted()
                } else {
                    // Falha de resposta pode ocorrer depois do commit remoto.
                    // Conferir pelo mesmo ID antes de oferecer nova tentativa.
                    ref.get(com.google.firebase.firestore.Source.SERVER)
                        .addOnCompleteListener { lookup ->
                            val alreadyWritten = lookup.result
                            if (lookup.isSuccessful && alreadyWritten?.exists() == true &&
                                alreadyWritten?.getString("uid") == uid &&
                                alreadyWritten?.getString("title") == title &&
                                alreadyWritten?.getString("body") == body &&
                                alreadyWritten?.getString("category") == category) {
                                completeAccepted()
                            } else {
                                working = false
                                message = if (emailVerificationRequired &&
                                    FirebaseAuth.getInstance().currentUser?.isEmailVerified != true)
                                    "Confirme seu e-mail em Meu perfil antes de publicar."
                                else "Não foi possível confirmar a publicação. O rascunho foi mantido; tente novamente."
                            }
                        }
                }
            }
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
        val replyActorUid = uid
        val replyActorName = name
        if (replyActorUid.isBlank() || FirebaseAuth.getInstance().currentUser?.uid != replyActorUid) {
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
                if (uid != replyActorUid || FirebaseAuth.getInstance().currentUser?.uid != replyActorUid) {
                    message = "A sessão mudou. Reabra a discussão e tente novamente."
                    done(false)
                    return@addOnCompleteListener
                }
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
                    "uid" to replyActorUid, "authorName" to replyActorName, "body" to body,
                    "createdAt" to FieldValue.serverTimestamp()
                )
                if (target != null && advancedEngagement &&
                    target.id.isNotBlank() && target.ownerUid.isNotBlank()) {
                    replyData["replyToId"] = target.id
                    replyData["replyToUid"] = target.ownerUid
                }
                if (mention != null && advancedEngagement && mention.uid != replyActorUid) {
                    replyData["mentionUid"] = mention.uid
                    if (mention.sourceReplyId.isNotBlank()) {
                        replyData["mentionReplyId"] = mention.sourceReplyId
                    }
                }
                batch.set(replyRef, replyData)
                val ownerNoticeQueued = ownerUid != replyActorUid
                if (ownerNoticeQueued) {
                    val noticeRef = db.collection("users").document(ownerUid)
                        .collection("notifications").document(replyRef.id)
                    val notice = mutableMapOf<String, Any>(
                        "postId" to id,
                        "replyId" to replyRef.id,
                        "actorUid" to replyActorUid,
                        "actorName" to replyActorName,
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
                    target.ownerUid != replyActorUid && target.ownerUid != ownerUid) {
                    val noticeRef = db.collection("users").document(target.ownerUid)
                        .collection("notifications").document(replyRef.id)
                    batch.set(noticeRef, mapOf(
                        "postId" to id, "replyId" to replyRef.id,
                        "actorUid" to replyActorUid, "actorName" to replyActorName,
                        "replyToId" to target.id,
                        "read" to false,
                        "createdAt" to FieldValue.serverTimestamp()
                    ))
                }
                // Uma menção explícita no tópico pode enviar um aviso privado
                // ao participante, com UID verificado pelas regras do Firestore.
                if (advancedEngagement && mention != null &&
                    mention.uid != replyActorUid && mention.uid != ownerUid &&
                    mention.uid != target?.ownerUid) {
                    val noticeRef = db.collection("users").document(mention.uid)
                        .collection("notifications").document(replyRef.id)
                    val mentionNotice = mutableMapOf<String, Any>(
                        "postId" to id, "replyId" to replyRef.id,
                        "actorUid" to replyActorUid, "actorName" to replyActorName,
                        "mentionUid" to mention.uid, "read" to false,
                        "createdAt" to FieldValue.serverTimestamp()
                    )
                    if (mention.sourceReplyId.isNotBlank()) {
                        mentionNotice["mentionReplyId"] = mention.sourceReplyId
                    }
                    batch.set(noticeRef, mentionNotice)
                }
                // Diagnóstico estritamente local: somente Firebase Emulator + Debug.
                // Nunca registrar UID, nome, corpo ou notificações privadas.
                val qaLab = BuildConfig.DEBUG &&
                    com.google.firebase.FirebaseApp.getInstance().options.projectId == "demo-atrio-v11"
                if (qaLab) android.util.Log.i("AtrioReplyQA",
                    "operation=${replyRef.id} ownerNoticeQueued=$ownerNoticeQueued " +
                        "authUnchanged=${FirebaseAuth.getInstance().currentUser?.uid == replyActorUid}")
                // Resposta e notificações continuam atômicas.
                batch.commit().addOnCompleteListener { result ->
                    if (qaLab) android.util.Log.i("AtrioReplyQA",
                        "operation=${replyRef.id} batchSucceeded=${result.isSuccessful} " +
                            "ownerNoticeQueued=$ownerNoticeQueued " +
                            "authUnchanged=${FirebaseAuth.getInstance().currentUser?.uid == replyActorUid}")
                    // Confirmar imediatamente o resultado para a interface.
                    // Inscrições FCM e relay não devem bloquear o botão Responder.
                    if (!result.isSuccessful) {
                        message = if (emailVerificationRequired &&
                            FirebaseAuth.getInstance().currentUser?.isEmailVerified != true)
                            "Confirme seu e-mail em Meu perfil antes de responder."
                            else "Não foi possível responder. Confira a conexão e as regras."
                    }
                    done(result.isSuccessful)
                    if (result.isSuccessful && !qaLab) {
                        ThreadPushSubscriptions.track(context, replyActorUid, id)
                        InstantPushRelay.reply(id, replyRef.id)
                        InstantPushRelay.moderateReply(id, replyRef.id)
                    }
                }
            }
    }
    fun closeNoticeDestination() {
        if (conversationsOpen) {
            conversationsOpen = false
            conversationTarget = null
            notificationChatId = null
            shareDiscussion = null
        } else if (profilePostOpen && publicProfileTarget != null) {
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
    val reduceMotion = AtrioMotion.reduced()
    LaunchedEffect(publishSuccessVisible) {
        if (publishSuccessVisible) {
            kotlinx.coroutines.delay(2400L)
            publishSuccessVisible = false
        }
    }
    BackHandler(enabled = conversationsOpen || publicProfileTarget != null || detailId != null || noticesOpen || noticeBadgesOpen || guardiaoAppealsOpen) { closeNoticeDestination() }

    Scaffold(containerColor = Paper, snackbarHost = { SnackbarHost(otaSnackbar) }, topBar = {
        AtrioTopBar(
            details = conversationsOpen || publicProfileTarget != null || detailId != null || noticesOpen || noticeBadgesOpen || guardiaoAppealsOpen,
            detailsTitle = if (conversationsOpen) "Conversas"
                else if (publicProfileTarget != null && !profilePostOpen) "Perfil público"
                else if (guardiaoAppealsOpen) "Minhas revisões" else if (noticeBadgesOpen) "Meus selos"
                else if (noticesOpen) "Notificações" else "Discussão",
            unreadCount = inbox.groups(notificationAdmin).count { it.unread },
            profileMode = tab == Tab.PROFILE,
            onBack = ::closeNoticeDestination,
            onSearch = { val open = !searchOpen; navigate(Tab.HOME); searchOpen = open },
            onNotification = {
                publicProfileTarget = null; profilePostOpen = false; previousDetailId = null
                detailId = null; noticeBadgesOpen = false; returnToNotices = false
                conversationsOpen = false; conversationTarget = null; notificationChatId = null
        shareDiscussion = null
                noticesOpen = !noticesOpen; searchOpen = false
            }
        )
    }, bottomBar = { if (!conversationsOpen) AtrioBottomBar(selected = tab, onSelect = ::navigate) }) { inset ->
        Box(Modifier.padding(inset)) {
            val detail = openedPost?.takeUnless { it.ownerUid in blockedMembers }
                ?.copy(liked = detailId in likedIds,
                    saved = saveOverrides[detailId] ?: (detailId in savedIds),
                    savePending = detailId in pendingSaveIds)
            if (conversationsOpen) {
                AtrioConversationsScreen(db, uid,
                    onBack = {
                        conversationsOpen = false
                        conversationTarget = null
                        notificationChatId = null
                        notificationGroupId = null
                        shareDiscussion = null
                    },
                    initialPeer = conversationTarget,
                    initialChatId = notificationChatId,
                    initialGroupId = notificationGroupId,
                    initialSharePost = shareDiscussion,
                    onOpenDiscussion = { postId ->
                        shareDiscussion = null
                        conversationsOpen = false
                        conversationTarget = null
                        notificationChatId = null
                        publicProfileTarget = null
                        profilePostOpen = false
                        detailId = postId
                    })
            } else if (publicProfileTarget != null && !profilePostOpen) {
                PublicMemberProfileScreen(
                    db = db, target = publicProfileTarget!!, viewerUid = uid,
                    onBack = ::closeNoticeDestination,
                    onConverse = {
                        conversationTarget = publicProfileTarget
                        notificationChatId = null
                        notificationGroupId = null
                        shareDiscussion = null
                        conversationsOpen = true
                    },
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
                    onSave = { saveCoordinator.toggle(detail.id, detail.saved) },
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
                    onShareAsMessage = {
                        shareDiscussion = detail.id to detail.title
                        conversationTarget = null
                        notificationChatId = null
                        conversationsOpen = true
                    },
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
                    },
                    moreReplies = repliesMore,
                    repliesLoading = repliesLoading,
                    newestFirst = replyNewestFirst,
                    onReplySortChange = { newest ->
                        if (newest != replyNewestFirst) {
                            replyNewestFirst = newest
                            replyLimit = 30
                            detailReplies = emptyList()
                        }
                    }
                )
            } else when (tab) {
                Tab.HOME -> HomeScreen(name, posts, filter, search, searchOpen,
                    onSearch = { search = it; otaScope.launch { homeListState.scrollToItem(0) } },
                    onFilter = { filter = it; otaScope.launch { homeListState.scrollToItem(0) } },
                    loading = feedLoading, loadError = feedError,
                    onRetry = { feedRetry++ }, listState = homeListState,
                    onCreate = { navigate(Tab.PUBLISH) }, onForums = { navigate(Tab.COMMUNITIES) },
                    onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { saveCoordinator.toggle(id, it.saved) } },
                    onOpenProfile = ::openMemberProfile,
                    footer = {
                        LoadMore(feedLoading, feedMore, feedError, "Carregar mais publicações") {
                            if (feedError) feedRetry++ else feedLimit += 30
                        }
                    })
                Tab.COMMUNITIES -> CommunityScreen(posts) { category -> navigate(Tab.HOME); filter = category }
                Tab.PUBLISH -> draftStateHolder.SaveableStateProvider("$uid:publish:$publishDraftEpoch") {
                    PublishScreen(publishing = working) { title, body, category ->
                        confirmGuardianBeforeSend(title + "\n" + body) {
                            publish(title, body, category)
                        }
                    }
                }
                Tab.SAVED -> SavedScreen(savedDisplay,
                    onDiscover = { navigate(Tab.HOME) }, onOpen = { detailId = it },
                    onLike = { id -> allPosts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> allPosts.firstOrNull { it.id == id }?.let { saveCoordinator.toggle(id, it.saved) } },
                    loading = savesLoading || savedPending.isNotEmpty(),
                    loadError = savesError || savedFailures.isNotEmpty(),
                    onRetry = { savedRetry++ },
                    onOpenProfile = ::openMemberProfile,
                    footer = {
                        LoadMore(savesLoading || savedPending.isNotEmpty(), savedOrder.size > savedLimit,
                            savesError || savedFailures.isNotEmpty(), "Carregar mais salvos") {
                            if (savesError || savedFailures.isNotEmpty()) savedRetry++ else savedLimit += 30
                        }
                        if (savedPending.isEmpty() && savedDisplay.size < visibleSavedIds.size && savedFailures.isEmpty() && !savesError)
                            Text("Algumas publicações salvas foram removidas.", color = Muted, fontSize = AtrioType.secondary)
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
                    onConversations = {
                        conversationTarget = null
                        notificationChatId = null
                        notificationGroupId = null
                        shareDiscussion = null
                        conversationsOpen = true
                    },
                    onReviews = { guardiaoAppealsOpen = true },
                    onCreate = { navigate(Tab.PUBLISH) }, onOpen = { detailId = it },
                    onLike = { id -> posts.firstOrNull { it.id == id }?.let { toggle("likedPosts", id, it.liked) } },
                    onSave = { id -> posts.firstOrNull { it.id == id }?.let { saveCoordinator.toggle(id, it.saved) } })
                }
            }
            AnimatedVisibility(
                visible = publishSuccessVisible,
                modifier = Modifier.align(Alignment.TopCenter).padding(top = 12.dp),
                enter = fadeIn(if (reduceMotion) snap() else tween(AtrioMotion.PUBLISH_MS)),
                exit = fadeOut(if (reduceMotion) snap() else tween(AtrioMotion.PUBLISH_MS))
            ) {
                Surface(
                    color = Wine, shape = RoundedCornerShape(16.dp),
                    shadowElevation = 5.dp
                ) {
                    Text(
                        "Discussão publicada!",
                        color = Color.White,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 14.dp)
                            .semantics { liveRegion = LiveRegionMode.Polite },
                        fontWeight = FontWeight.SemiBold, fontSize = 14.sp
                    )
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
                    Text("A categoria e a autoria não podem ser alteradas.", fontSize = AtrioType.secondary, color = Muted)
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
                Text("Por que esta discussão deve ser analisada?", fontSize = AtrioType.secondary)
                Spacer(Modifier.height(8.dp))
                OutlinedTextField(reason, { reason = it.take(300) },
                    label = { Text("Motivo da denúncia") },
                     modifier = Modifier.fillMaxWidth().testTag("atrio-report-post-reason"))
                Text("A denúncia será enviada para análise. Não remove a publicação automaticamente.",
                    fontSize = AtrioType.secondary, color = Muted)
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
                Text(target.body, fontSize = AtrioType.secondary)
                OutlinedTextField(reason, { reason = it.take(300) }, enabled = !busy,
                    label = { Text("Motivo da denúncia") }, minLines = 2,
                    modifier = Modifier.fillMaxWidth())
                Text("A moderação analisará esta resposta. O envio não a remove automaticamente.", fontSize = AtrioType.secondary, color = Muted)
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error, fontSize = AtrioType.secondary)
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


