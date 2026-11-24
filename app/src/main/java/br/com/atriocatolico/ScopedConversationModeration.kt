package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.FilterChip
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import java.io.ByteArrayOutputStream
import java.net.URL
import java.time.Instant
import java.util.concurrent.TimeUnit
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONObject

// Item 13 / #445: somente dados devolvidos pelo serviço por CASO.
// Não consultar chat_reports, chat_group_reports, salas ou mensagens pelo APK.
internal data class ScopedCaseEvidence(
    val caseId: String,
    val channel: String,
    val reason: String,
    val excerpt: String,
    val reportedAt: String
)
internal sealed interface ScopedCaseResult {
    data class Available(val evidence: ScopedCaseEvidence) : ScopedCaseResult
    data object Unavailable : ScopedCaseResult
    data object Closed : ScopedCaseResult
    data object Error : ScopedCaseResult
}
internal fun interface ScopedCaseGateway {
    suspend fun open(uid: String, channel: String, caseId: String): ScopedCaseResult
}
internal fun validScopedCaseId(value: String): Boolean =
    value.length in 1..530 && value.all { it.isLetterOrDigit() && it.code < 128 || it == '_' || it == '-' }

internal fun decodeScopedCaseResponse(body: String, expectedChannel: String, expectedId: String): ScopedCaseResult {
    return try {
        val response = JSONObject(body)
        if (response.keys().asSequence().toSet() != setOf("status", "case") ||
            response.optString("status") != "available") return ScopedCaseResult.Error
        val data = response.getJSONObject("case")
        if (data.keys().asSequence().toSet() !=
            setOf("caseId", "channel", "reason", "excerpt", "reportedAt")) return ScopedCaseResult.Error
        val caseId = data.getString("caseId")
        val channel = data.getString("channel")
        val reason = data.getString("reason")
        val excerpt = data.getString("excerpt")
        val reportedAt = data.getString("reportedAt")
        if (caseId != expectedId || channel != expectedChannel ||
            reason.length !in 5..300 || excerpt.length !in 1..1500 ||
            reportedAt.length !in 20..40) return ScopedCaseResult.Error
        Instant.parse(reportedAt)
        ScopedCaseResult.Available(ScopedCaseEvidence(caseId, channel, reason, excerpt, reportedAt))
    } catch (_: Exception) {
        ScopedCaseResult.Error
    }
}

/** Porta HTTPS restrita ao loopback em QA isolado, fechada por padrão em TODOS os builds. */
internal class QaScopedCaseHttpGateway(private val origin: String) : ScopedCaseGateway {
    override suspend fun open(uid: String, channel: String, caseId: String): ScopedCaseResult =
        withContext(Dispatchers.IO) {
            if (!BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT || BuildConfig.ATRIO_QA_GERAL_REMOTE ||
                origin != "https://127.0.0.1:8095") return@withContext ScopedCaseResult.Closed
            if (channel !in setOf("direct", "group") || !validScopedCaseId(caseId))
                return@withContext ScopedCaseResult.Error
            val auth = FirebaseAuth.getInstance()
            val account = auth.currentUser?.takeIf { it.uid == uid }
                ?: return@withContext ScopedCaseResult.Unavailable
            try {
                // Token atualizado; o backend ainda verifica checkRevoked=true e a atribuição.
                val token = Tasks.await(account.getIdToken(true), 8, TimeUnit.SECONDS).token
                    ?.takeIf { it.isNotBlank() } ?: return@withContext ScopedCaseResult.Unavailable
                if (auth.currentUser?.uid != uid) return@withContext ScopedCaseResult.Unavailable
                val connection = URL(origin + "/v1/qa/conversations/moderation/case")
                    .openConnection() as HttpsURLConnection
                try {
                    connection.requestMethod = "POST"
                    connection.instanceFollowRedirects = false
                    connection.useCaches = false
                    connection.connectTimeout = 4_000
                    connection.readTimeout = 4_000
                    connection.doOutput = true
                    connection.setRequestProperty("Content-Type", "application/json")
                    connection.setRequestProperty("Accept", "application/json")
                    connection.setRequestProperty("Cache-Control", "no-store")
                    connection.setRequestProperty("Authorization", "Bearer " + token)
                    val request = JSONObject().put("channel", channel).put("caseId", caseId)
                        .toString().toByteArray(Charsets.UTF_8)
                    connection.outputStream.use { it.write(request) }
                    val response = when (connection.responseCode) {
                        200 -> {
                            if (!connection.contentType.orEmpty().lowercase().startsWith("application/json"))
                                ScopedCaseResult.Error
                            else connection.inputStream.use { stream ->
                                val output = ByteArrayOutputStream()
                                val buffer = ByteArray(1024)
                                while (true) {
                                    val n = stream.read(buffer)
                                    if (n < 0) break
                                    output.write(buffer, 0, n)
                                    if (output.size() > 8192) return@withContext ScopedCaseResult.Error
                                }
                                decodeScopedCaseResponse(output.toString("UTF-8"), channel, caseId)
                            }
                        }
                        404 -> ScopedCaseResult.Unavailable
                        503 -> ScopedCaseResult.Closed
                        else -> ScopedCaseResult.Error
                    }
                    if (auth.currentUser?.uid != uid) ScopedCaseResult.Unavailable else response
                } finally {
                    connection.disconnect()
                }
            } catch (c: CancellationException) {
                throw c
            } catch (_: Exception) {
                // Sem imprimir token, UID, resposta sensível ou mensagem de exceção.
                ScopedCaseResult.Error
            }
        }
}

/**
 * O serviço da #445 NÃO oferece listagem de atribuições nem ações de decisão.
 * Aqui o caso é informado explicitamente em QA; o backend valida a atribuição
 * a cada consulta. Nenhuma prova é salva em disco ou cache.
 */
@Composable
internal fun ScopedConversationModerationPanel(
    uid: String,
    observedUid: String?,
    enabled: Boolean,
    gateway: ScopedCaseGateway
) {
    var channel by remember(uid) { mutableStateOf("direct") }
    var caseId by remember(uid) { mutableStateOf("") }
    var current by remember(uid) { mutableStateOf<ScopedCaseResult?>(null) }
    var loading by remember(uid) { mutableStateOf(false) }
    var requestSerial by remember(uid) { mutableIntStateOf(0) }
    val latestUid = rememberUpdatedState(observedUid)
    val scope = rememberCoroutineScope()
    val sessionValid = uid.isNotEmpty() && uid == observedUid

    LaunchedEffect(uid, observedUid, enabled) {
        requestSerial++
        caseId = ""
        current = null
        loading = false
    }

    if (!enabled) return
    Card(Modifier.fillMaxWidth().testTag("scoped-case-panel")) {
        Column(Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Denúncias de conversas · QA", style = MaterialTheme.typography.titleMedium)
            Text("Somente atendimento de caso previamente atribuído. " +
                "Não há acesso ao histórico ou à lista geral de denúncias.",
                style = MaterialTheme.typography.bodySmall)
            if (!sessionValid) {
                Text("Sessão alterada. A prova foi retirada da tela.",
                    modifier = Modifier.testTag("scoped-case-session-lost"))
                return@Column
            }
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(channel == "direct", onClick = {
                    channel = "direct"; requestSerial++; current = null; loading = false
                }, label = { Text("Conversa direta") }, modifier = Modifier.testTag("scoped-case-direct"))
                FilterChip(channel == "group", onClick = {
                    channel = "group"; requestSerial++; current = null; loading = false
                }, label = { Text("Grupo") }, modifier = Modifier.testTag("scoped-case-group"))
            }
            OutlinedTextField(
                value = caseId, onValueChange = { value ->
                    caseId = value.filter { it.code < 128 && (it.isLetterOrDigit() || it == '_' || it == '-') }
                        .take(530)
                    requestSerial++; current = null; loading = false
                },
                label = { Text("Referência do caso atribuído") },
                singleLine = true,
                modifier = Modifier.fillMaxWidth().testTag("scoped-case-id")
            )
            Button(
                enabled = !loading && validScopedCaseId(caseId),
                onClick = {
                    val wantedId = caseId
                    val wantedChannel = channel
                    val serial = ++requestSerial
                    loading = true
                    current = null // Nunca manter trecho antigo durante revalidação.
                    scope.launch {
                        val response = try {
                            gateway.open(uid, wantedChannel, wantedId)
                        } catch (c: CancellationException) {
                            throw c
                        } catch (_: Exception) {
                            ScopedCaseResult.Error
                        }
                        if (serial == requestSerial && latestUid.value == uid) {
                            loading = false
                            current = if (response is ScopedCaseResult.Available &&
                                response.evidence.caseId == wantedId &&
                                response.evidence.channel == wantedChannel) response
                            else if (response is ScopedCaseResult.Available) ScopedCaseResult.Error
                            else response
                            if (current !is ScopedCaseResult.Available) caseId = ""
                        }
                    }
                },
                modifier = Modifier.testTag("scoped-case-open")
            ) { Text(if (loading) "Conferindo acesso…" else "Consultar caso atribuído") }
            OutlinedButton(onClick = {
                requestSerial++; current = null; caseId = ""; loading = false
            }, modifier = Modifier.testTag("scoped-case-clear")) {
                Text("Limpar prova e encerrar")
            }
            when (val result = current) {
                is ScopedCaseResult.Available -> Column(
                    modifier = Modifier.fillMaxWidth().testTag("scoped-case-evidence"),
                    verticalArrangement = Arrangement.spacedBy(6.dp)
                ) {
                    Text(if (result.evidence.channel == "direct") "Conversa direta" else "Grupo")
                    Text("Motivo: " + result.evidence.reason)
                    Text("Trecho denunciado", style = MaterialTheme.typography.titleSmall)
                    Text(result.evidence.excerpt, modifier = Modifier.testTag("scoped-case-excerpt"))
                    Text("Registrada em: " + result.evidence.reportedAt)
                    Text("A prova exibida não concede acesso à conversa nem a outras mensagens.",
                        style = MaterialTheme.typography.bodySmall)
                }
                ScopedCaseResult.Unavailable -> Text(
                    "Denúncia indisponível. O acesso pode ter expirado ou sido revogado.",
                    modifier = Modifier.testTag("scoped-case-unavailable")
                )
                ScopedCaseResult.Closed -> Text(
                    "Atendimento indisponível neste ambiente. Nenhum dado foi mantido.",
                    modifier = Modifier.testTag("scoped-case-closed")
                )
                ScopedCaseResult.Error -> Text(
                    "Não foi possível consultar. Verifique a conexão e tente novamente.",
                    modifier = Modifier.testTag("scoped-case-error")
                )
                else -> Unit
            }
        }
    }
}
