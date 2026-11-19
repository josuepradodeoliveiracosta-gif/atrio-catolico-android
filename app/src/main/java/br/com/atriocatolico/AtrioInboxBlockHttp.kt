package br.com.atriocatolico

import java.io.IOException
import java.io.InputStream
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

internal data class AtrioBlockState(val blocked: Boolean, val etag: String)
internal data class AtrioBlockIntent(
    val operationId: String, val peerUid: String, val block: Boolean, val etag: String
)

internal sealed interface AtrioBlockReply {
    data class Committed(val state: AtrioBlockState) : AtrioBlockReply
    data object Pending : AtrioBlockReply
    data object StateChanged : AtrioBlockReply
    data object Rejected : AtrioBlockReply
}

internal interface AtrioManagedBlockService {
    suspend fun read(peerUid: String): AtrioBlockState?
    suspend fun submit(intent: AtrioBlockIntent): AtrioBlockReply
}

internal class AtrioInboxBlockHttp(
    private val token: suspend () -> String?,
    private val baseUrl: URL = URL("http://127.0.0.1:8091/v1/qa/conversations/blocks/")
) : AtrioManagedBlockService {
    override suspend fun read(peerUid: String): AtrioBlockState? =
        request(peerUid, intent = null)?.takeIf { it.status == 200 }?.state()

    override suspend fun submit(intent: AtrioBlockIntent): AtrioBlockReply {
        val response = request(intent.peerUid, intent) ?: return AtrioBlockReply.Pending
        return when (response.status) {
            200 -> {
                val state = response.state()
                if (state != null && response.body?.opt("committed") == true &&
                    response.body.opt("requestedBlocked") == intent.block
                ) AtrioBlockReply.Committed(state) else AtrioBlockReply.Pending
            }
            409 -> if (response.body?.opt("error") == "block_state_changed")
                AtrioBlockReply.StateChanged else AtrioBlockReply.Rejected
            408, 429, in 500..599 -> AtrioBlockReply.Pending
            in 400..499 -> AtrioBlockReply.Rejected
            else -> AtrioBlockReply.Pending
        }
    }

    private suspend fun request(peerUid: String, intent: AtrioBlockIntent?): Response? {
        if (!peerPattern.matches(peerUid)) return Response(400)
        val idToken = token()?.takeIf { it.isNotBlank() } ?: return null
        return withContext(Dispatchers.IO) {
            var connection: HttpURLConnection? = null
            try {
                val call = (URL(baseUrl, peerUid).openConnection(Proxy.NO_PROXY) as HttpURLConnection)
                    .also { connection = it }
                call.instanceFollowRedirects = false
                call.useCaches = false
                call.connectTimeout = 4_000
                call.readTimeout = 5_000
                call.requestMethod = when (intent?.block) {
                    null -> "GET"
                    true -> "PUT"
                    false -> "DELETE"
                }
                call.setRequestProperty("Authorization", "Bearer $idToken")
                call.setRequestProperty("Accept", "application/json")
                call.setRequestProperty("Cache-Control", "no-store")
                if (intent != null) {
                    call.setRequestProperty("If-Match", intent.etag)
                    call.setRequestProperty("Idempotency-Key", intent.operationId)
                }
                val status = call.responseCode
                val body = when (status) {
                    200 -> readBlockJson(call.inputStream)
                    409 -> readBlockJson(call.errorStream)
                    else -> null
                }
                Response(status, call.getHeaderField("ETag"), body)
            } catch (_: IOException) {
                null
            } catch (_: JSONException) {
                null
            } finally {
                connection?.disconnect()
            }
        }
    }

    private data class Response(val status: Int, val etag: String? = null, val body: JSONObject? = null) {
        fun state(): AtrioBlockState? {
            val blocked = body?.opt("blocked") as? Boolean ?: return null
            val currentTag = etag?.takeIf(etagPattern::matches) ?: return null
            return AtrioBlockState(blocked, currentTag)
        }
    }

    private companion object {
        val peerPattern = Regex("^[A-Za-z0-9_-]{1,128}$")
        val etagPattern = Regex("^\"(?:initial|v-[A-Za-z0-9_-]{1,128})\"$")
    }
}

private fun readBlockJson(stream: InputStream?): JSONObject? = stream?.bufferedReader(Charsets.UTF_8)?.use { body ->
    val buffer = CharArray(1024)
    val json = StringBuilder()
    while (true) {
        val count = body.read(buffer)
        if (count == -1) break
        if (json.length + count > 8_192) return null
        json.append(buffer, 0, count)
    }
    JSONObject(json.toString())
}
