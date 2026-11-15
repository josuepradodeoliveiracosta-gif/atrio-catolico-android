package br.com.atriocatolico

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import com.google.firebase.FirebaseApp
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source

/** Predicado testavel sem iniciar Firebase ou solicitar rede. */
internal fun perfilQaIdentityAllowed(
    packageId: String,
    buildApplicationId: String,
    projectId: String?,
    firebaseApplicationId: String?
): Boolean = packageId == "br.com.atriocatolico.perfilqa" &&
    buildApplicationId == "br.com.atriocatolico.perfilqa" &&
    projectId == "atrio-catolico-qa-perfil" &&
    firebaseApplicationId == "1:492511505084:android:17949b85935e25aedb7eb9"

/**
 * Activity exclusivamente registrada pelo Manifest da variante perfilQa.
 * Nao inicia OnlineAtrioApp, cadastro, comunidade, push ou Conversas.
 * O projeto e o pacote precisam corresponder mesmo se o gate Gradle falhar.
 */
class PerfilQaActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val app = FirebaseApp.getApps(this).singleOrNull()
        val authorized = app?.name == FirebaseApp.DEFAULT_APP_NAME &&
            perfilQaIdentityAllowed(
                packageName, BuildConfig.APPLICATION_ID,
                app?.options?.projectId, app?.options?.applicationId
            )
        setContent {
            AtrioTheme {
                if (authorized && app != null) {
                    PerfilQaPilotApp(FirebaseAuth.getInstance(app),
                        FirebaseFirestore.getInstance(app))
                } else {
                    Surface(Modifier.fillMaxSize()) {
                        Text(
                            "Perfil QA bloqueado: configuração e identidade do aplicativo não conferem.",
                            modifier = Modifier.padding(24.dp)
                                .testTag("perfilqa-config-blocked")
                                .semantics { liveRegion = LiveRegionMode.Assertive }
                        )
                    }
                }
            }
        }
    }
}

internal sealed interface PerfilQaScreenState {
    data object Checking : PerfilQaScreenState
    data class Login(val working: Boolean = false, val error: String? = null) :
        PerfilQaScreenState
    data class Ready(
        val uid: String,
        val email: String,
        val displayName: String,
        val bio: String,
        val createdAt: Timestamp,
        val history: Boolean = false,
        val working: Boolean = false,
        val message: String? = null
    ) : PerfilQaScreenState
}

/**
 * Controlador de menor privilegio. Usa apenas Auth, profiles/{uid} e
 * public_profiles/{uid} SOMENTE no salvamento para preservar opt-in atomico.
 * As consultas ao historico sao responsabilidade de ProfileDiscussionHistory.
 */
internal class PerfilQaController(
    private val auth: FirebaseAuth,
    private val db: FirebaseFirestore
) {
    var state by mutableStateOf<PerfilQaScreenState>(PerfilQaScreenState.Checking)
        private set
    private var generation = 0
    private var closed = false

    fun start() = verify(auth.currentUser)

    fun login(email: String, password: String) {
        if (state !is PerfilQaScreenState.Login ||
            (state as PerfilQaScreenState.Login).working) return
        if (email.isBlank() || password.isBlank()) {
            state = PerfilQaScreenState.Login(error = "Informe o e-mail e a senha da conta de teste.")
            return
        }
        val seq = ++generation
        state = PerfilQaScreenState.Login(working = true)
        auth.signInWithEmailAndPassword(email.trim(), password).addOnCompleteListener { task ->
            if (!active(seq)) return@addOnCompleteListener
            if (!task.isSuccessful) {
                auth.signOut()
                state = PerfilQaScreenState.Login(error = "Não foi possível entrar na conta de teste.")
            } else {
                verify(task.result?.user)
            }
        }
    }

    private fun verify(user: FirebaseUser?) {
        val seq = ++generation
        state = PerfilQaScreenState.Checking
        if (user == null) {
            state = PerfilQaScreenState.Login()
            return
        }
        val uid = user.uid
        // A sessao armazenada nao prova e-mail verificado: forcar reload e token.
        user.reload().addOnCompleteListener { refreshed ->
            if (!active(seq)) return@addOnCompleteListener
            val current = auth.currentUser
            if (!refreshed.isSuccessful || current == null || current.uid != uid) {
                reject("Não foi possível verificar a sessão de teste.")
                return@addOnCompleteListener
            }
            current.getIdToken(true).addOnCompleteListener token@{ token ->
                if (!active(seq)) return@token
                if (!token.isSuccessful || auth.currentUser?.uid != uid ||
                    current.isEmailVerified != true ||
                    token.result?.claims?.get("email_verified") != true) {
                    reject("Confirme o e-mail da conta de teste antes de acessar o perfil.")
                    return@token
                }
                db.collection("profiles").document(uid).get(Source.SERVER)
                    .addOnCompleteListener profile@{ loaded ->
                        if (!active(seq)) return@profile
                        if (!loaded.isSuccessful) {
                            reject("Não foi possível consultar o perfil de teste.")
                            return@profile
                        }
                        val document = loaded.result
                        val createdAt = document?.getTimestamp("createdAt")
                        val name = document?.getString("displayName").orEmpty()
                        if (!loaded.isSuccessful || document?.exists() != true ||
                            createdAt == null || name.isBlank() ||
                            auth.currentUser?.uid != uid) {
                            reject("Perfil de teste indisponível. Solicite provisionamento autorizado.")
                            return@profile
                        }
                        state = PerfilQaScreenState.Ready(
                            uid = uid, email = current.email.orEmpty(),
                            displayName = name, bio = document.getString("bio").orEmpty(),
                            createdAt = createdAt
                        )
                    }
            }
        }
    }

    private fun reject(message: String) {
        generation++
        auth.signOut()
        state = PerfilQaScreenState.Login(error = message)
    }

    private fun active(seq: Int) = !closed && generation == seq

    private fun ownerSession(uid: String): Boolean =
        auth.currentUser?.uid == uid && auth.currentUser?.isEmailVerified == true

    fun showHistory() {
        val ready = state as? PerfilQaScreenState.Ready ?: return
        if (!ownerSession(ready.uid) || ready.working) {
            reject("Sessão não verificada. Entre novamente.")
        } else {
            state = ready.copy(history = true, message = null)
        }
    }

    fun backToProfile() {
        val ready = state as? PerfilQaScreenState.Ready ?: return
        state = ready.copy(history = false)
    }

    fun saveProfile(nameInput: String, bioInput: String, onSuccess: () -> Unit) {
        val ready = state as? PerfilQaScreenState.Ready ?: return
        if (ready.working || ready.history || !ownerSession(ready.uid)) {
            reject("Sessão não verificada. Entre novamente.")
            return
        }
        val name = nameInput.trim()
        val bio = bioInput.trim()
        if (name.length !in 2..35 || bio.length > 180) {
            state = ready.copy(message = "Nome: 2 a 35 caracteres; apresentação: até 180.")
            return
        }
        val currentUser = auth.currentUser ?: run {
            reject("Sessão não verificada. Entre novamente.")
            return
        }
        val seq = ++generation
        state = ready.copy(working = true, message = null)
        currentUser.getIdToken(true).addOnCompleteListener token@{ token ->
            if (!active(seq)) return@token
            if (!token.isSuccessful || token.result?.claims?.get("email_verified") != true ||
                !ownerSession(ready.uid)) {
                reject("A verificação da conta expirou. Entre novamente.")
                return@token
            }
            val privateRef = db.collection("profiles").document(ready.uid)
            val publicRef = db.collection("public_profiles").document(ready.uid)
            // Leitura do proprio opt-in APENAS ao editar. Se negar, nao escrever.
            publicRef.get(Source.SERVER).addOnCompleteListener public@{ publicResult ->
                if (!active(seq)) return@public
                if (!publicResult.isSuccessful || !ownerSession(ready.uid)) {
                    state = ready.copy(message = "Não foi possível conferir a apresentação pública.")
                    return@public
                }
                val batch = db.batch()
                batch.update(privateRef, mapOf("displayName" to name, "bio" to bio))
                if (publicResult.result?.exists() == true) {
                    batch.set(publicRef, mapOf(
                        "displayName" to name,
                        "bio" to bio,
                        "joinedAt" to ready.createdAt,
                        "updatedAt" to FieldValue.serverTimestamp()
                    ))
                }
                batch.commit().addOnCompleteListener saved@{ saved ->
                    if (!active(seq)) return@saved
                    if (saved.isSuccessful && ownerSession(ready.uid)) {
                        state = ready.copy(displayName = name, bio = bio,
                            working = false, message = "Perfil de teste atualizado.")
                        onSuccess()
                    } else {
                        state = ready.copy(message = "Não foi possível salvar. Nenhuma publicação foi criada.")
                    }
                }
            }
        }
    }

    fun signOut() {
        generation++
        auth.signOut()
        state = PerfilQaScreenState.Login()
    }

    fun close() {
        closed = true
        generation++
    }
}

@Composable
internal fun PerfilQaPilotApp(auth: FirebaseAuth, db: FirebaseFirestore) {
    val controller = remember(auth, db) { PerfilQaController(auth, db) }
    LaunchedEffect(controller) { controller.start() }
    DisposableEffect(controller) { onDispose { controller.close() } }
    val ready = controller.state as? PerfilQaScreenState.Ready
    BackHandler(enabled = ready?.history == true) { controller.backToProfile() }
    PerfilQaPilotContent(
        state = controller.state,
        onLogin = controller::login,
        onSignOut = controller::signOut,
        onShowHistory = controller::showHistory,
        onBack = controller::backToProfile,
        onSave = controller::saveProfile,
        history = { ready ->
            ProfileDiscussionHistory(
                db = db, uid = ready.uid,
                onBack = controller::backToProfile,
                onOpen = null // Nenhuma navegacao para respostas/UGC.
            )
        }
    )
}

/** Visual puro: testes de Compose nao precisam iniciar Auth ou Firebase remoto. */
@Composable
internal fun PerfilQaPilotContent(
    state: PerfilQaScreenState,
    onLogin: (String, String) -> Unit,
    onSignOut: () -> Unit,
    onShowHistory: () -> Unit,
    onBack: () -> Unit,
    onSave: (String, String, () -> Unit) -> Unit,
    history: @Composable (PerfilQaScreenState.Ready) -> Unit
) {
    when (state) {
        PerfilQaScreenState.Checking -> Column(
            Modifier.fillMaxSize().padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            Text("Perfil QA · acesso restrito", style = MaterialTheme.typography.headlineSmall,
                modifier = Modifier.semantics { heading() })
            CircularProgressIndicator(Modifier.testTag("perfilqa-verifying"))
            Text("Verificando conta e e-mail de teste.")
        }
        is PerfilQaScreenState.Login -> {
            var email by remember { mutableStateOf("") }
            var password by remember { mutableStateOf("") }
            Column(
                Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(24.dp),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                Text("Perfil QA · acesso restrito",
                    style = MaterialTheme.typography.headlineSmall,
                    modifier = Modifier.semantics { heading() })
                Text("Somente contas de teste já autorizadas. Não há cadastro neste piloto.")
                OutlinedTextField(
                    value = email, onValueChange = { email = it },
                    label = { Text("E-mail da conta de teste") },
                    singleLine = true, enabled = !state.working,
                    modifier = Modifier.fillMaxWidth().testTag("perfilqa-email")
                )
                OutlinedTextField(
                    value = password, onValueChange = { password = it },
                    label = { Text("Senha") },
                    singleLine = true, enabled = !state.working,
                    visualTransformation = PasswordVisualTransformation(),
                    modifier = Modifier.fillMaxWidth().testTag("perfilqa-password")
                )
                Button(
                    onClick = { onLogin(email, password); password = "" },
                    enabled = !state.working,
                    modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                        .testTag("perfilqa-login")
                ) { Text(if (state.working) "Verificando..." else "Entrar na conta de teste") }
                state.error?.let {
                    Text(it, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("perfilqa-login-error")
                            .semantics { liveRegion = LiveRegionMode.Polite })
                }
            }
        }
        is PerfilQaScreenState.Ready -> {
            if (state.history) {
                history(state)
            } else {
                var editing by remember(state.uid) { mutableStateOf(false) }
                var name by remember(state.uid, state.displayName) {
                    mutableStateOf(state.displayName)
                }
                var bio by remember(state.uid, state.bio) { mutableStateOf(state.bio) }
                LazyColumn(
                    modifier = Modifier.fillMaxSize().testTag("perfilqa-profile"),
                    contentPadding = PaddingValues(20.dp),
                    verticalArrangement = Arrangement.spacedBy(14.dp)
                ) {
                    item {
                        Text("Meu perfil de teste",
                            style = MaterialTheme.typography.headlineSmall,
                            modifier = Modifier.semantics { heading() })
                        Text("Ambiente QA isolado · recursos comunitários indisponíveis",
                            style = MaterialTheme.typography.bodySmall)
                    }
                    item {
                        Text(state.email, style = MaterialTheme.typography.bodyMedium)
                        if (editing) {
                            OutlinedTextField(
                                value = name, onValueChange = { name = it.take(35) },
                                label = { Text("Nome de exibição") },
                                modifier = Modifier.fillMaxWidth().testTag("perfilqa-name"),
                                singleLine = true, enabled = !state.working
                            )
                            OutlinedTextField(
                                value = bio, onValueChange = { bio = it.take(180) },
                                label = { Text("Apresentação privada") },
                                modifier = Modifier.fillMaxWidth().testTag("perfilqa-bio"),
                                enabled = !state.working, minLines = 3
                            )
                            Button(
                                onClick = {
                                    onSave(name, bio) { editing = false }
                                },
                                enabled = !state.working,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                    .testTag("perfilqa-save")
                            ) { Text("Salvar perfil") }
                            TextButton(onClick = { editing = false },
                                enabled = !state.working,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)) {
                                Text("Cancelar edição")
                            }
                        } else {
                            Text(state.displayName,
                                style = MaterialTheme.typography.titleLarge)
                            Text(state.bio.ifBlank { "Sem apresentação cadastrada." })
                            OutlinedButton(
                                onClick = { editing = true },
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                    .testTag("perfilqa-edit")
                            ) { Text("Editar meu perfil") }
                        }
                    }
                    item {
                        OutlinedButton(
                            onClick = onShowHistory,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("perfilqa-history-open")
                        ) { Text("Minhas discussões") }
                    }
                    state.message?.let { message ->
                        item {
                            Text(message, modifier = Modifier.testTag("perfilqa-message")
                                .semantics { liveRegion = LiveRegionMode.Polite })
                        }
                    }
                    item {
                        TextButton(
                            onClick = onSignOut,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("perfilqa-signout")
                        ) { Text("Sair da conta de teste") }
                    }
                }
            }
        }
    }
}
