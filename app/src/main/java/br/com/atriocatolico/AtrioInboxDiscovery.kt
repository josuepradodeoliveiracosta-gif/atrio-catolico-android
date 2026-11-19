package br.com.atriocatolico

import java.io.InputStream
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.net.URLEncoder
import org.json.JSONException
import org.json.JSONObject

internal data class AtrioInboxEntry(
    val chatId: String,
    val peerUid: String,
    val status: String,
    val preview: String,
    val updatedAtMs: Long,
    val unreadCount: Int
)

internal sealed interface AtrioInboxResult {
    data class Page(val items: List<AtrioInboxEntry>, val nextCursor: String?) : AtrioInboxResult
    data object Unavailable : AtrioInboxResult
    data object Denied : AtrioInboxResult
    data object RestartRequired : AtrioInboxResult
}

/** A UI mantém apenas a página visível e os cursores do percurso atual. */
internal data class AtrioInboxPaging(
    val cursors: List<String?> = listOf(null),
    val result: AtrioInboxResult? = null
) {
    val cursor: String? get() = cursors.last()

    fun receive(response: AtrioInboxResult): AtrioInboxPaging =
        if (response == AtrioInboxResult.RestartRequired) AtrioInboxPaging()
        else copy(result = response)
}

internal class AtrioInboxDiscovery(
    private val endpoint: URL = URL("http://127.0.0.1:8091/v1/qa/conversations/inbox")
) {
    suspend fun load(
        owner: String,
        cursor: String?,
        sameSession: () -> Boolean,
        getToken: suspend () -> String?,
        request: suspend (String, String, String?) -> AtrioInboxResult = ::fetch
    ): AtrioInboxResult? {
        if (!sameSession()) return null
        val token = getToken()
        if (!sameSession()) return null
        if (token.isNullOrBlank()) return AtrioInboxResult.Denied
        val result = request(owner, token, cursor)
        return result.takeIf { sameSession() }
    }

    fun fetch(owner: String, token: String, cursor: String?): AtrioInboxResult {
        val query = "?limit=$PAGE_SIZE" +
            (cursor?.let { "&cursor=" + URLEncoder.encode(it, "UTF-8") } ?: "")
        var connection: HttpURLConnection? = null
        return try {
            val request = (URL(endpoint.toExternalForm() + query)
                .openConnection(Proxy.NO_PROXY) as HttpURLConnection).also { connection = it }
            request.instanceFollowRedirects = false
            request.useCaches = false
            request.connectTimeout = 4_000
            request.readTimeout = 5_000
            request.setRequestProperty("Authorization", "Bearer $token")
            request.setRequestProperty("Accept", "application/json")
            request.setRequestProperty("Cache-Control", "no-store")
            when (request.responseCode) {
                200 -> readJson(request.inputStream)?.let { parsePage(owner, cursor, it) }
                    ?: AtrioInboxResult.Unavailable
                403 -> AtrioInboxResult.Denied
                409 -> if (cursor != null &&
                    readJson(request.errorStream)?.opt("error") == "inbox_restart_required"
                ) AtrioInboxResult.RestartRequired else AtrioInboxResult.Unavailable
                else -> AtrioInboxResult.Unavailable
            }
        } catch (_: java.io.IOException) {
            AtrioInboxResult.Unavailable
        } catch (_: JSONException) {
            AtrioInboxResult.Unavailable
        } finally {
            connection?.disconnect()
        }
    }

    private fun readJson(stream: InputStream?): JSONObject? =
        stream?.bufferedReader(Charsets.UTF_8)?.use { body ->
            val buffer = CharArray(4096)
            val json = StringBuilder()
            while (true) {
                val count = body.read(buffer)
                if (count == -1) break
                if (json.length + count > MAX_RESPONSE_CHARS) return null
                json.append(buffer, 0, count)
            }
            JSONObject(json.toString())
        }

    private fun parsePage(owner: String, cursor: String?, json: JSONObject): AtrioInboxResult {
        val items = json.getJSONArray("items")
        val next = json.get("nextCursor")
        if (items.length() > PAGE_SIZE ||
            (next != JSONObject.NULL &&
                (next !is String || next.isBlank() || next == cursor || items.length() != PAGE_SIZE))
        ) return AtrioInboxResult.Unavailable
        val entries = LinkedHashMap<String, AtrioInboxEntry>()
        for (index in 0 until items.length()) {
            val item = items.getJSONObject(index)
            val chat = item.get("chatId") as? String ?: return AtrioInboxResult.Unavailable
            val peer = item.get("peerUid") as? String ?: return AtrioInboxResult.Unavailable
            val status = item.get("status") as? String ?: return AtrioInboxResult.Unavailable
            val preview = item.get("lastPreview") as? String ?: return AtrioInboxResult.Unavailable
            val whenUpdated = item.get("updatedAtMs") as? Number
                ?: return AtrioInboxResult.Unavailable
            val unread = item.get("unreadCount") as? Number ?: return AtrioInboxResult.Unavailable
            if (!AtrioPeerInboxPolicy.entryMatches(owner, peer, chat, owner, peer, status, preview) ||
                whenUpdated.toDouble() != whenUpdated.toLong().toDouble() || whenUpdated.toLong() < 0 ||
                unread.toDouble() != unread.toLong().toDouble() || unread.toLong() < 0
            ) return AtrioInboxResult.Unavailable
            entries[chat] = AtrioInboxEntry(chat, peer, status, preview, whenUpdated.toLong(),
                unread.toLong().coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
        }
        return AtrioInboxResult.Page(entries.values.toList(), next as? String)
    }

    private companion object {
        const val PAGE_SIZE = 20
        const val MAX_RESPONSE_CHARS = 256 * 1024
    }
}
