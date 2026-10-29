package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/**
 * O controle no app é apenas conveniência: o Cloudflare verifica, de novo,
 * Firebase Auth + admins/{uid}.enabled + app_config/founder.uid.
 */
@Composable
internal fun AdminBroadcastPanel() {
    var title by remember { mutableStateOf("") }
    var message by remember { mutableStateOf("") }
    var confirm by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    val validTitle = title.trim().length in 5..60 &&
        title.trim() == title && title.none { it.isISOControl() }
    val validBody = message.trim().length in 10..180 &&
        message.trim() == message && message.none { it.isISOControl() }

    Card(modifier = Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Notificações gerais", style = MaterialTheme.typography.titleMedium, color = Wine)
            Text("Envie um comunicado aos aparelhos inscritos e com avisos ativados. " +
                "A entrega depende do FCM e pode sofrer atrasos.",
                color = Muted, fontSize = 12.sp)
            OutlinedTextField(title, { title = it.take(60); feedback = "" },
                label = { Text("Título") }, supportingText = { Text("${title.length}/60") },
                singleLine = true, modifier = Modifier.fillMaxWidth(), enabled = !sending)
            OutlinedTextField(message, { message = it.take(180); feedback = "" },
                label = { Text("Mensagem") }, supportingText = { Text("${message.length}/180") },
                minLines = 3, maxLines = 5, modifier = Modifier.fillMaxWidth(), enabled = !sending)
            Button(
                enabled = !sending && validTitle && validBody,
                onClick = { confirm = true }, modifier = Modifier.fillMaxWidth()
            ) { Text(if (sending) "Enviando..." else "Enviar notificação para todos") }
            if (feedback.isNotBlank()) Text(feedback, color = Wine, fontSize = 12.sp)
        }
    }

    if (confirm) AlertDialog(
        onDismissRequest = { if (!sending) confirm = false },
        title = { Text("Confirmar envio geral?") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Todos os aparelhos inscritos poderão receber este comunicado.")
                Text("Título: $title", style = MaterialTheme.typography.titleSmall)
                Text(message)
                Text("O envio não poderá ser cancelado após aceitação pelo FCM.",
                    color = Muted, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(enabled = !sending && validTitle && validBody,
                onClick = {
                    sending = true
                    AdminBroadcastRelay.send(title, message) { response ->
                        sending = false
                        confirm = false
                        feedback = when (response) {
                            "accepted_by_fcm" -> {
                                title = ""
                                message = ""
                                "Comunicado aceito pelo FCM. Isso não garante entrega a todos os aparelhos."
                            }
                            "broadcast_cooldown" -> "Aguarde: é permitido um comunicado por hora."
                            "broadcast_disabled" -> "O envio geral ainda não foi habilitado no servidor."
                            "forbidden", "unauthorized" ->
                                "Ação recusada. Confirme sua sessão e sua permissão de fundador."
                            else -> "Não foi possível enviar. Confira a conexão ou tente mais tarde."
                        }
                    }
                }) { Text(if (sending) "Enviando..." else "Confirmar envio") }
        },
        dismissButton = {
            TextButton(enabled = !sending, onClick = { confirm = false }) { Text("Cancelar") }
        }
    )
}
