package br.com.atriocatolico

import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Opt-in explicito. Nenhuma permissao e pedida ao abrir o app;
 * sem backend emissor a ativacao prepara recebimento, nao envio automatico.
 */
@Composable
internal fun PushSettings(uid: String, db: FirebaseFirestore) {
    val context = LocalContext.current
    var active by remember(uid) { mutableStateOf(PushRegistry.enabled(context, uid)) }
    var busy by remember(uid) { mutableStateOf(false) }
    var feedback by remember(uid) { mutableStateOf("") }
    var backgroundEnabled by remember(uid) { mutableStateOf(BackgroundNoticeScheduler.enabled(context, uid)) }
    var diagnosticsOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var permissionForBackground by remember(uid) { mutableStateOf(false) }
    var lastRelayStatus by remember(uid) { mutableStateOf(InstantPushRelay.lastStatus(context, uid)) }

    fun turnOn() {
        busy = true
        feedback = "Registrando este aparelho..."
        PushRegistry.enable(context, uid, db) { ok, issue ->
            busy = false
            active = ok
            feedback = if (ok) {
                "Este aparelho foi cadastrado para receber avisos."
            } else pushRegistrationMessage(issue)
        }
    }

    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) {
            if (permissionForBackground) {
                BackgroundNoticeScheduler.enable(context, uid)
                backgroundEnabled = BackgroundNoticeScheduler.enabled(context, uid)
                feedback = if (backgroundEnabled) "Verificação em segundo plano ativada."
                    else "Não foi possível ativar a verificação. Confira sua conta."
            } else turnOn()
        } else feedback = "Permissão não concedida. Você pode continuar usando o Átrio normalmente."
        permissionForBackground = false
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Avisos neste aparelho", color = Wine, style = MaterialTheme.typography.titleMedium)
            Text("Receba avisos mesmo quando o Átrio não estiver aberto. " +
                "O cadastro do aparelho não confirma a entrega: ela também depende da conexão e das configurações do Android.",
                color = Muted, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(if (active) "Dispositivo cadastrado" else "Desativado", fontSize = 14.sp, modifier = Modifier.weight(1f).padding(end = 12.dp))
                Switch(modifier = Modifier.semantics { contentDescription = "Receber avisos neste aparelho" }, checked = active, enabled = !busy, onCheckedChange = { enabled ->
                    feedback = ""
                    if (enabled) {
                        if (Build.VERSION.SDK_INT >= 33 &&
                            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                            != PackageManager.PERMISSION_GRANTED) {
                            requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                        } else turnOn()
                    } else {
                        PushRegistry.deactivate(context, uid, db)
                        active = false
                        feedback = "Avisos desativados neste aparelho."
                    }
                })
            }
            if (busy) LinearProgressIndicator(modifier = Modifier.fillMaxWidth())
            if (feedback.isNotBlank()) Text(feedback, color = Wine, fontSize = 14.sp,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            HorizontalDivider()
            Text("Verificação em segundo plano", color = Wine,
                style = MaterialTheme.typography.titleMedium)
            Text("Consulta novos avisos periodicamente, mesmo sem o Átrio aberto na tela. " +
                "Intervalo aproximado de 30 minutos; o Android pode atrasar ou impedir a " +
                "execução se o aplicativo for forçado a parar. Usa leituras da franquia Firestore.",
                fontSize = 12.sp, color = Muted)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween, verticalAlignment = Alignment.CenterVertically) {
                Text(if (backgroundEnabled) "Verificação ativada" else "Desativada", fontSize = 14.sp, modifier = Modifier.weight(1f).padding(end = 12.dp))
                Switch(modifier = Modifier.semantics { contentDescription = "Verificação periódica em segundo plano" }, checked = backgroundEnabled, onCheckedChange = { newValue ->
                    feedback = ""
                    if (!newValue) {
                        BackgroundNoticeScheduler.disable(context, uid)
                        backgroundEnabled = false
                        feedback = "Verificação em segundo plano desativada."
                    } else if (Build.VERSION.SDK_INT >= 33 &&
                        context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                        != PackageManager.PERMISSION_GRANTED) {
                        permissionForBackground = true
                        requestPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
                    } else {
                        BackgroundNoticeScheduler.enable(context, uid)
                        backgroundEnabled = BackgroundNoticeScheduler.enabled(context, uid)
                        feedback = if (backgroundEnabled) "Verificação em segundo plano ativada."
                            else "Não foi possível ativar. Confira sua conta."
                    }
                })
            }
            Text("Esta verificação é complementar ao push e respeita as categorias " +
                "habilitadas na central de notificações.",
                fontSize = 11.sp, color = Muted)
            OutlinedButton(onClick = { diagnosticsOpen = !diagnosticsOpen }, modifier = Modifier.fillMaxWidth()) {
                Text(if (diagnosticsOpen) "Ocultar diagnóstico avançado" else "Diagnóstico avançado")
            }
            if (diagnosticsOpen) {
            if (active) {
                TextButton(onClick = {
                    FirebaseMessaging.getInstance().token.addOnCompleteListener { task ->
                        if (task.isSuccessful) {
                            val token = task.result.orEmpty()
                            if (token.isNotBlank()) {
                                val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE)
                                    as ClipboardManager
                                clipboard.setPrimaryClip(ClipData.newPlainText("Token FCM de teste", token))
                                feedback = "Token copiado. Use apenas no Console Firebase; não compartilhe publicamente."
                            }
                        } else feedback = "Não foi possível consultar o token de teste."
                    }
                }) { Text("Copiar token para teste no Firebase") }
                Text("O token identifica este aparelho como destino de mensagens, não a sua " +
                    "identidade. Mantenha-o privado.", fontSize = 11.sp, color = Muted)
            }
            HorizontalDivider()
            Text("Última tentativa de envio", color = Wine,
                style = MaterialTheme.typography.titleMedium)
            Text("Veja a resposta do Cloudflare no aparelho que publicou uma resposta. " +
                "Esse registro não confirma recebimento no outro celular. Consultar não envia avisos extras.",
                fontSize = 12.sp, color = Muted)
            Text(lastRelayStatus, fontSize = 12.sp, color = Wine)
            OutlinedButton(onClick = {
                lastRelayStatus = InstantPushRelay.lastStatus(context, uid)
            }, modifier = Modifier.fillMaxWidth()) { Text("Atualizar diagnóstico do Push") }
            }
        }
    }
}
