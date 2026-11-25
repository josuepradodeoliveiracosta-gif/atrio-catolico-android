package br.com.atriocatolico

import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import java.net.Proxy
import java.net.URL
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlin.coroutines.resume
import kotlinx.coroutines.withContext
import kotlinx.coroutines.CancellationException
import org.json.JSONObject

/** Disparo explícito de homologação, somente após publicação administrativa.
 * O Worker valida mensagem, destinatário, admissão, pendência e deduplicação.
 */
internal object AtrioSimpleDirectPush {
    private val id = Regex("^[A-Za-z0-9_-]{1,128}$")
    fun payload(chatId: String, messageId: String): String? =
        if (chatId == AtrioSimpleDirectQa.CHAT_ID && id.matches(messageId))
            JSONObject().put("type", "chat_message").put("chatId", chatId)
                .put("messageId", messageId).toString() else null
    fun outcome(http: Int, status: String): String = when {
        http == 202 && status == "accepted_by_fcm" ->
            "FCM aceitou; chegada ao celular ainda não confirmada."
        status == "no_devices_or_duplicate" -> "Sem dispositivo elegível ou evento já reservado."
        status == "ignored" || status == "authorization_interrupted" ->
            "Evento não autorizado. Confira pendência, admissões e bloqueios."
        else -> "Push não confirmado (HTTP $http)."
    }
}

internal suspend fun sendSimpleDirectQaEvent(
    db: FirebaseFirestore, actor: FirebaseUser, chatId: String, messageId: String
): String {
    val auth = FirebaseAuth.getInstance(db.app)
    val payload = AtrioSimpleDirectPush.payload(chatId, messageId)
        ?: return "Evento inválido."
    if (auth.currentUser !== actor || !atrioSimpleDirectIdentity(db, actor) ||
        BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_ORIGIN != QA_GERAL_PUSH_RELAY_URL)
        return "Sessão QA inválida."
    return try {
        val token = suspendCancellableCoroutine<String?> { continuation ->
            actor.getIdToken(false).addOnCompleteListener { task ->
                if (continuation.isActive) continuation.resume(
                    if (task.isSuccessful) task.result?.token else null)
            }
        } ?: return "Sessão não autenticada."
        withContext(Dispatchers.IO) {
            if (auth.currentUser !== actor) return@withContext "Sessão alterada."
            val connection = URL("$QA_GERAL_PUSH_RELAY_URL/event")
                .openConnection(Proxy.NO_PROXY) as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.requestMethod = "POST"
                connection.connectTimeout = 5000
                connection.readTimeout = 10000
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.doOutput = true
                if (auth.currentUser !== actor) return@withContext "Sessão alterada."
                connection.outputStream.use { it.write(payload.toByteArray(Charsets.UTF_8)) }
                val http = connection.responseCode
                val body = (if (http < 400) connection.inputStream else connection.errorStream)
                    ?.bufferedReader()?.use { reader ->
                        val buffer = CharArray(1025)
                        var n = 0
                        while (n < buffer.size) {
                            val count = reader.read(buffer, n, buffer.size - n)
                            if (count == -1) break
                            n += count
                        }
                        if (n <= 1024) String(buffer, 0, n) else ""
                    }.orEmpty()
                val status = runCatching { JSONObject(body).optString("status") }.getOrDefault("")
                AtrioSimpleDirectPush.outcome(http, status)
            } finally { connection.disconnect() }
        }
    } catch (e: CancellationException) { throw e }
      catch (_: Exception) { "Push não confirmado: falha de comunicação." }
}
