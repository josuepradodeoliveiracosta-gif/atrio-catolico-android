package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.Timestamp
import com.google.firebase.firestore.FirebaseFirestore
import java.time.LocalDate
import java.util.Date

/**
 * Apenas apresentação no Chat QA. O Firestore Rules continua sendo a
 * autoridade. Data de nascimento nunca é gravada nem salva entre telas.
 */
internal enum class QaChatDeclarationState {
    CHECKING, MISSING, ALLOWED, INVALID, UNAVAILABLE
}

internal object QaChatDeclarationPolicy {
    const val VERSION = "2026-11-selfdecl-qa-v1"
    fun eligible(
        status: String?, minimumAge: Long?, policyVersion: String?,
        expiresAtMillis: Long?, nowMillis: Long
    ): Boolean = status == "declared_18_plus" &&
        minimumAge == 18L && policyVersion == VERSION &&
        expiresAtMillis != null && expiresAtMillis > nowMillis
}

@Composable
internal fun ChatQaDeclarationRecoveryPanel(
    db: FirebaseFirestore,
    uid: String,
    state: QaChatDeclarationState,
    onRecheck: () -> Unit,
    onBack: () -> Unit
) {
    // remember, NÃO rememberSaveable: não persistir nascimento ou checkbox.
    var birthDate by remember(uid) { mutableStateOf("") }
    var adultDeclaration by remember(uid) { mutableStateOf(false) }
    var busy by remember(uid) { mutableStateOf(false) }
    var error by remember(uid) { mutableStateOf("") }
    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState())
            .padding(24.dp).testTag("atrio-chat-qa-recovery"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Acesso ao chat em homologação",
            style = MaterialTheme.typography.titleLarge, color = Wine)
        when (state) {
            QaChatDeclarationState.CHECKING ->
                Text("Conferindo a declaração no servidor. Aguarde.", color = Muted)
            QaChatDeclarationState.UNAVAILABLE -> {
                Text("Não conseguimos confirmar a declaração no servidor. " +
                    "Confira sua conexão. O chat permanece bloqueado.", color = Ink)
                OutlinedButton(onClick = onRecheck, enabled = !busy,
                    modifier = Modifier.testTag("atrio-chat-qa-check-again")) {
                    Text("Consultar novamente")
                }
            }
            QaChatDeclarationState.INVALID ->
                Text("A declaração anterior está inválida, vencida ou revogada. " +
                    "Não é possível substituí-la pelo aplicativo. " +
                    "O chat permanece bloqueado.", color = Ink)
            QaChatDeclarationState.MISSING -> {
                Text("A conta existe, mas sua declaração de maioridade não " +
                    "foi registrada. Para solicitar acesso ao chat, confirme " +
                    "novamente. É opcional e não afeta o restante do Átrio.",
                    color = Ink)
                ChatAgeRegistrationPrecheckPanel(
                    birthDate = birthDate,
                    onBirthDateChange = {
                        birthDate = it
                        adultDeclaration = false
                        error = ""
                    },
                    declared18Plus = adultDeclaration,
                    onDeclarationChange = {
                        adultDeclaration = ChatAgeRegistrationPrecheck.canRequestChatAccess(
                            birthDate, it, LocalDate.now())
                        error = ""
                    }
                )
                if (error.isNotBlank()) {
                    Text(error, color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.testTag("atrio-chat-qa-retry-error"))
                }
                Button(
                    enabled = !busy && ChatAgeRegistrationPrecheck.canRequestChatAccess(
                        birthDate, adultDeclaration, LocalDate.now()),
                    modifier = Modifier.fillMaxWidth().testTag("atrio-chat-qa-redeclare"),
                    onClick = {
                        // Validação novamente no instante do clique, sem confiar
                        // no estado visual anterior da checkbox.
                        if (!ChatAgeRegistrationPrecheck.canRequestChatAccess(
                                birthDate, adultDeclaration, LocalDate.now())) return@Button
                        if (com.google.firebase.auth.FirebaseAuth.getInstance()
                                .currentUser?.uid != uid) {
                            error = "Sessão alterada. Entre novamente."
                            return@Button
                        }
                        busy = true
                        error = ""
                        val expiry = Timestamp(Date(
                            System.currentTimeMillis() + 364L * 24L * 60L * 60L * 1000L))
                        db.document("users/${uid}/chatAgeEligibility/current")
                            .set(mapOf(
                                "status" to "declared_18_plus",
                                "minimumAge" to 18,
                                "policyVersion" to QaChatDeclarationPolicy.VERSION,
                                "reviewExpiresAt" to expiry
                            )).addOnCompleteListener { task ->
                                busy = false
                                // Não presumir acesso por conclusão local: sempre
                                // consultar o servidor outra vez, inclusive após
                                // falha (outra escrita pode ter chegado primeiro).
                                if (task.isSuccessful) {
                                    birthDate = ""
                                    adultDeclaration = false
                                    onRecheck()
                                } else {
                                    error = "Não foi possível registrar sua declaração. " +
                                        "Confira a conexão e tente consultar novamente."
                                }
                            }
                    }
                ) { Text(if (busy) "Registrando..." else "Confirmar declaração 18+") }
                OutlinedButton(onClick = onRecheck, enabled = !busy,
                    modifier = Modifier.testTag("atrio-chat-qa-reload")) {
                    Text("Verificar registro no servidor")
                }
            }
            QaChatDeclarationState.ALLOWED ->
                Text("Declaração registrada. O servidor decidirá as demais permissões.")
        }
        OutlinedButton(onClick = onBack, enabled = !busy) { Text("Voltar") }
        Text("A data informada é usada apenas nesta tela, não é enviada nem " +
            "comprova a idade. O acesso depende das regras e da política QA.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}
