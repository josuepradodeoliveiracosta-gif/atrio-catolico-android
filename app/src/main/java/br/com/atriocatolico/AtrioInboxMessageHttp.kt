package br.com.atriocatolico

import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

internal data class AtrioMessageIntent(
    val key: String,
    val chatId: String,
    val firstPeer: String?,
    val text: String,
    val replyToId: String?
)

internal sealed interface AtrioMessageReply {
    data class Committed(val messageId: String) : AtrioMessageReply
    data class Conflict(val code: String?) : AtrioMessageReply
    data class Rejected(val code: String?) : AtrioMessageReply
    data class RateLimited(val seconds: Long?) : AtrioMessageReply
    data object Pending : AtrioMessageReply
}

internal class AtrioInboxMessageHttp(
    private val token: suspend () -> String?,
    private val baseUrl: URL = URL("http://127.0.0.1:8091/v1/qa/conversations/"),
    private val readTimeoutMs: Int = 5_000
) {
    suspend fun submit(intent: AtrioMessageIntent): AtrioMessageReply {
        val target = intent.firstPeer ?: intent.chatId
        val allowed = if (intent.firstPeer == null) chatPattern else idPattern
        if (!allowed.matches(target)) return AtrioMessageReply.Rejected("invalid_request")
        val route = if (intent.firstPeer == null) "chats/$target/messages" else "requests/$target"
        val bearer = token()?.takeIf { it.isNotBlank() } ?: return AtrioMessageReply.Pending
        val payload = JSONObject().put("text", intent.text).apply {
            intent.replyToId?.let { put("replyToId", it) }
        }.toString().toByteArray(Charsets.UTF_8)

        return withContext(Dispatchers.IO) {
            var connection: HttpURLConnection? = null
            try {
                val call = (URL(baseUrl, route).openConnection(Proxy.NO_PROXY) as HttpURLConnection)
                    .also { connection = it }
                call.instanceFollowRedirects = false
                call.useCaches = false
                call.connectTimeout = 4_000
                call.readTimeout = readTimeoutMs
                call.requestMethod = "POST"
                call.doOutput = true
                call.setFixedLengthStreamingMode(payload.size)
                call.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                call.setRequestProperty("Accept", "application/json")
                call.setRequestProperty("Authorization", "Bearer $bearer")
                call.setRequestProperty("Idempotency-Key", intent.key)
                call.setRequestProperty("Cache-Control", "no-store")
                call.outputStream.use { it.write(payload) }
                when (call.responseCode) {
                    200 -> parseCommit(readInboxJson(call.inputStream), intent)
                    409 -> AtrioMessageReply.Conflict(readInboxJson(call.errorStream)?.optString("error"))
                    429 -> AtrioMessageReply.RateLimited(
                        call.getHeaderField("Retry-After")?.toLongOrNull()?.takeIf { it > 0 }?.coerceAtMost(60)
                    )
                    408, in 500..599 -> AtrioMessageReply.Pending
                    403 -> AtrioMessageReply.Rejected("conversation_unavailable")
                    in 400..499 -> AtrioMessageReply.Rejected(readInboxJson(call.errorStream)?.optString("error"))
                    else -> AtrioMessageReply.Pending
                }
            } catch (_: IOException) {
                AtrioMessageReply.Pending
            } catch (_: JSONException) {
                AtrioMessageReply.Pending
            } finally {
                connection?.disconnect()
            }
        }
    }

    private fun parseCommit(body: JSONObject?, intent: AtrioMessageIntent): AtrioMessageReply {
        val messageId = body?.opt("messageId") as? String
        return if (body?.opt("committed") == true && body.opt("chatId") == intent.chatId &&
            messageId != null && idPattern.matches(messageId)
        ) AtrioMessageReply.Committed(messageId) else AtrioMessageReply.Pending
    }

    private companion object {
        val idPattern = Regex("^[A-Za-z0-9_-]{1,128}$")
        val chatPattern = Regex("^[A-Za-z0-9_-]{1,260}$")
    }
}
