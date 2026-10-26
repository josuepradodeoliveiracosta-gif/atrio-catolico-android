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

    fun turnOn() {
        busy = true
        feedback = "Registrando este aparelho..."
        PushRegistry.enable(context, uid, db) { ok ->
            busy = false
            active = ok
            feedback = if (ok) "Este aparelho foi cadastrado para receber avisos."
                else "Não foi possível registrar o aparelho. Confira sua conexão e as regras do Firebase."
        }
    }

    val requestPermission = rememberLauncherForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { granted ->
        if (granted) turnOn()
        else feedback = "Permissão não concedida. Você pode continuar usando o Átrio normalmente."
    }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Avisos no celular", color = Wine, style = MaterialTheme.typography.titleMedium)
            Text("Ative voluntariamente notificações fora do aplicativo. " +
                "O envio automático exige um serviço emissor confiável que ainda não foi ativado.",
                color = Muted, fontSize = 12.sp)
            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                Text(if (active) "Dispositivo cadastrado" else "Desativado", fontSize = 14.sp)
                Switch(checked = active, enabled = !busy, onCheckedChange = { enabled ->
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
            if (feedback.isNotBlank()) Text(feedback, color = Wine, fontSize = 12.sp)
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
        }
    }
}
