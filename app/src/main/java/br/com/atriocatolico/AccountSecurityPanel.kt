package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.sp
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Portal de entrada para contas sem e-mail verificado.
 * So aparece quando a politica admin-only de verificacao estiver ativa.
 * Manter reenvio, atualizacao de token e saida acessiveis sem entrar no forum.
 */
@Composable
internal fun MandatoryEmailVerificationGate(
    uid: String, onVerified: () -> Unit, onSignOut: () -> Unit
) {
    Column(
        Modifier.fillMaxSize().background(Wine)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 36.dp)
            .testTag("atrio-email-verification-gate"),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text("Átrio Católico", color = Gold, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Card(colors = CardDefaults.cardColors(containerColor = Paper)) {
            Column(
                Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    "Confirmação de e-mail obrigatória",
                    style = MaterialTheme.typography.titleLarge,
                    modifier = Modifier.testTag("atrio-email-verification-required-title")
                )
                Text(
                    "Para entrar na comunidade, confirme o endereço usado no cadastro. " +
                        "Abra o link recebido e depois volte a esta tela."
                )
                EmailVerificationPanel(uid = uid, onVerified = onVerified)
                OutlinedButton(
                    onClick = onSignOut,
                    modifier = Modifier.fillMaxWidth().testTag("atrio-email-verification-signout")
                ) { Text("Sair da conta") }
            }
        }
    }
}

/**
 * Enquanto o Firestore nao confirma a politica diretamente do servidor,
 * nao exibimos a comunidade para contas com e-mail ainda nao confirmado.
 * Uma falha de rede nunca libera o acesso por acidente.
 */
@Composable
internal fun EmailVerificationPolicyStatusScreen(
    unavailable: Boolean, onRetry: () -> Unit, onSignOut: () -> Unit
) {
    Column(
        Modifier.fillMaxSize().background(Wine)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 36.dp)
            .testTag("atrio-email-policy-pending"),
        verticalArrangement = Arrangement.spacedBy(18.dp)
    ) {
        Text("Átrio Católico", color = Gold, fontSize = 30.sp, fontWeight = FontWeight.Bold)
        Card(colors = CardDefaults.cardColors(containerColor = Paper)) {
            Column(
                Modifier.fillMaxWidth().padding(20.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    if (unavailable) "Não foi possível verificar o acesso"
                    else "Verificando sua conta",
                    style = MaterialTheme.typography.titleLarge
                )
                if (unavailable) {
                    Text(
                        "Não conseguimos consultar as regras de confirmação de e-mail. " +
                            "Confira a conexão e tente novamente. Sua conta permanece protegida."
                    )
                    OutlinedButton(
                        onClick = onRetry,
                        modifier = Modifier.fillMaxWidth().testTag("atrio-email-policy-retry")
                    ) { Text("Tentar novamente") }
                } else {
                    Text("Consultando as regras de acesso com segurança...")
                    CircularProgressIndicator(
                        modifier = Modifier.testTag("atrio-email-policy-loading")
                    )
                }
                OutlinedButton(
                    onClick = onSignOut,
                    modifier = Modifier.fillMaxWidth().testTag("atrio-email-policy-signout")
                ) { Text("Sair da conta") }
            }
        }
    }
}

/** A verificação enviada na inscrição é revalidada pelo servidor quando solicitada. */
@Composable
internal fun EmailVerificationPanel(uid: String, onVerified: (() -> Unit)? = null) {
    val auth = remember { FirebaseAuth.getInstance() }
    var verified by remember(uid) { mutableStateOf(auth.currentUser?.isEmailVerified == true) }
    var busy by remember(uid) { mutableStateOf(false) }
    var info by remember(uid) { mutableStateOf("") }
    if (verified) return

    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("E-mail ainda não confirmado",
            style = androidx.compose.material3.MaterialTheme.typography.titleSmall)
        Text("Para proteger sua conta, confirme o endereço pelo link enviado ao cadastrar. " +
            "Se não o encontrou, solicite um novo link.")
        OutlinedButton(
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag("atrio-auth-resend-verification"),
            onClick = {
                val user = auth.currentUser
                if (user == null || user.uid != uid) {
                    info = "Sua sessão mudou. Entre novamente."
                } else {
                    busy = true
                    user.sendEmailVerification().addOnCompleteListener { task ->
                        busy = false
                        info = if (task.isSuccessful) "Enviamos um link de confirmação."
                            else "Não foi possível enviar o link. Tente novamente."
                    }
                }
            }
        ) { Text("Reenviar confirmação") }
        TextButton(
            enabled = !busy,
            modifier = Modifier.fillMaxWidth().testTag("atrio-auth-check-verification"),
            onClick = {
                val user = auth.currentUser
                if (user == null || user.uid != uid) {
                    info = "Sua sessão mudou. Entre novamente."
                } else {
                    busy = true
                    user.reload().addOnCompleteListener { reload ->
                        if (!reload.isSuccessful || auth.currentUser?.uid != uid ||
                            auth.currentUser?.isEmailVerified != true) {
                            busy = false
                            verified = false
                            info = "Ainda não foi possível confirmar. Confira o link no e-mail."
                        } else {
                            // As regras Firestore conferem o claim no ID token,
                            // portanto nao basta mudar apenas o estado visual.
                            user.getIdToken(true).addOnCompleteListener { token ->
                                busy = false
                                verified = token.isSuccessful &&
                                    token.result?.claims?.get("email_verified") == true &&
                                    auth.currentUser?.uid == uid &&
                                    auth.currentUser?.isEmailVerified == true
                                info = if (verified) "E-mail confirmado. Você já pode publicar."
                                    else "O e-mail foi confirmado, mas a sessão não foi atualizada. Tente novamente."
                                if (verified) onVerified?.invoke()
                            }
                        }
                    }
                }
            }
        ) { Text("Já confirmei meu e-mail") }
        if (info.isNotBlank()) Text(info,
            style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
    }
}

/**
 * Somente REGISTRA uma solicitação privada para tratamento administrativo.
 * Não apagar a conta Firebase aqui: apagar Auth antes de eliminar todas as
 * subcoleções deixaria dados órfãos e seria incompatível com a Google Play.
 * A exclusão final exige backend auditado e processo externo de solicitação.
 */
@Composable
internal fun AccountDeletionRequestPanel(db: FirebaseFirestore, uid: String) {
    var pending by remember(uid) { mutableStateOf(false) }
    var loading by remember(uid) { mutableStateOf(true) }
    var confirm by remember(uid) { mutableStateOf(false) }
    var busy by remember(uid) { mutableStateOf(false) }
    var info by remember(uid) { mutableStateOf("") }
    val request = remember(db, uid) { db.collection("account_deletion_requests").document(uid) }

    LaunchedEffect(db, uid) {
        request.get().addOnCompleteListener { result ->
            loading = false
            if (result.isSuccessful) {
                pending = result.result?.exists() == true
            } else info = "Não foi possível consultar a solicitação. Verifique a conexão."
        }
    }

    if (pending) {
        Text("Solicitação de exclusão registrada. A exclusão efetiva de conta e dados " +
            "depende do atendimento administrativo.",
            style = androidx.compose.material3.MaterialTheme.typography.bodySmall)
    } else {
        OutlinedButton(
            onClick = { confirm = true },
            enabled = !busy && !loading,
            modifier = Modifier.fillMaxWidth().testTag("atrio-account-deletion-request")
        ) { Text("Solicitar exclusão da conta e dos dados") }
    }
    if (info.isNotBlank()) Text(info,
        style = androidx.compose.material3.MaterialTheme.typography.bodySmall)

    if (confirm) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirm = false },
            title = { Text("Solicitar exclusão da conta?") },
            text = {
                Text("Esta ação registra uma solicitação para a administração. " +
                    "A conta e os dados NÃO serão apagados imediatamente. " +
                    "Você poderá continuar acessando o Átrio até a conclusão do processo. " +
                    "A exclusão completa exige atendimento e verificação dos dados associados.")
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    modifier = Modifier.testTag("atrio-account-deletion-confirm"),
                    onClick = {
                        busy = true
                        request.set(mapOf(
                            "status" to "pending",
                            "requestedAt" to FieldValue.serverTimestamp()
                        )).addOnCompleteListener { task ->
                            busy = false
                            confirm = false
                            if (task.isSuccessful) {
                                pending = true
                                info = "Solicitação registrada para análise."
                            } else info = "Não foi possível registrar. Confira a internet ou tente novamente."
                        }
                    }
                ) { Text(if (busy) "Registrando..." else "Confirmar solicitação") }
            },
            dismissButton = {
                TextButton(onClick = { confirm = false }, enabled = !busy) { Text("Cancelar") }
            }
        )
    }
}
