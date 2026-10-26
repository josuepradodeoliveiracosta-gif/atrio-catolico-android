package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.Executors
import android.os.Handler
import android.os.Looper

/** Botões são conveniência: somente o Worker valida fundador e administrador. */
private object TestBotProvisionRelay {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())
    fun create(done: (String) -> Unit) {
        val actor = FirebaseAuth.getInstance().currentUser
        val origin = BuildConfig.PUSH_RELAY_URL
        if (actor == null ||
            !origin.matches(Regex("^https://[a-zA-Z0-9-]+\\.[a-zA-Z0-9-]+\\.workers\\.dev$"))) {
            done("unavailable")
            return
        }
        actor.getIdToken(false).addOnCompleteListener { tokenTask ->
            val token = if (tokenTask.isSuccessful) tokenTask.result?.token else null
            if (token.isNullOrBlank() ||
                FirebaseAuth.getInstance().currentUser?.uid != actor.uid) {
                done("unauthorized")
                return@addOnCompleteListener
            }
            executor.execute {
                val status = try {
                    val connection = URL("$origin/test-bots/provision").openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "POST"
                        connection.instanceFollowRedirects = false
                        connection.connectTimeout = 5000
                        connection.readTimeout = 20000
                        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.doOutput = true
                        connection.outputStream.use { output ->
                            output.write(JSONObject().put("confirm","create_three_test_bots_v1")
                                .toString().toByteArray(Charsets.UTF_8))
                        }
                        val stream = if (connection.responseCode < 400)
                            connection.inputStream else connection.errorStream
                        val response = stream?.bufferedReader()
                            ?.use { it.readText().take(300) }.orEmpty()
                        JSONObject(response).optString("status", "unavailable")
                    } finally {
                        connection.disconnect()
                    }
                } catch (_: Exception) { "unavailable" }
                main.post {
                    if (FirebaseAuth.getInstance().currentUser?.uid == actor.uid) done(status)
                    else done("unauthorized")
                }
            }
        }
    }
}

@Composable
internal fun AdminTestBotsPanel() {
    var confirm by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var feedback by remember { mutableStateOf("") }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Bots de teste", style = MaterialTheme.typography.titleMedium, color = Wine)
            Text("Crie três identidades automáticas reais no Firebase (sem login humano), " +
                "com nomes e selo BOT DE TESTE. Elas publicarão uma discussão simulada e três respostas. " +
                "A comunidade poderá ver essa conversa, identificada como simulação.",
                style = MaterialTheme.typography.bodySmall)
            OutlinedButton(enabled = !busy, onClick = { confirm = true },
                modifier = Modifier.fillMaxWidth()) {
                Text(if (busy) "Criando contas..." else "Criar três bots e simular conversa")
            }
            if (feedback.isNotBlank())
                Text(feedback, style = MaterialTheme.typography.bodySmall)
        }
    }
    if (confirm) AlertDialog(onDismissRequest = { if (!busy) confirm = false },
        title = { Text("Criar três bots oficiais de teste?") },
        text = { Text("Serão criadas Clara, Miguel e Lúcia (BOT DE TESTE). " +
            "Os perfis não terão senha nem acesso administrativo. " +
            "Será publicada uma conversa de demonstração visível aos usuários. " +
            "Executar novamente não duplicará a simulação.") },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                busy = true
                TestBotProvisionRelay.create { status ->
                    busy = false
                    confirm = false
                    feedback = when (status) {
                        "test_bots_created" -> "Três bots criados e conversa simulada publicada."
                        "test_bots_existing" -> "Os três bots e a simulação já estavam cadastrados."
                        "test_bots_disabled" -> "A criação de bots está desativada no servidor."
                        "bot_identity_unavailable" -> "O Firebase recusou criar ou validar as contas bot. Confira permissões do serviço."
                        "bot_seed_unavailable" -> "Não foi possível completar o cadastro. Nenhum sucesso foi confirmado."
                        "test_id_conflict" -> "Conflito com uma discussão existente. O sistema não a sobrescreveu."
                        "founder_only", "unauthorized" -> "Somente a conta fundadora administradora pode executar."
                        else -> "Falha ao processar. Confira a conexão ou os logs do servidor."
                    }
                }
            }) { Text(if (busy) "Criando..." else "Confirmar criação") }
        },
        dismissButton = {
            TextButton(enabled = !busy,onClick = { confirm = false }) { Text("Cancelar") }
        })
}
