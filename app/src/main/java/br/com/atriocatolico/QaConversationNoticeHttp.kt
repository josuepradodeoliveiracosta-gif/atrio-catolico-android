package br.com.atriocatolico

import java.io.IOException
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URI
import java.net.URISyntaxException
import java.net.URL
import javax.net.ssl.HttpsURLConnection

internal class QaConversationNoticeHttp private constructor(private val endpoint: URI) {
    companion object {
        private const val MAX_BODY_CHARS = 4_096
        private val topLevelDomain = Regex("[a-z]{2,63}")

        fun https(origin: String): QaConversationNoticeHttp? {
            val host = parseUri(origin)?.host ?: return null
            if (origin != "https://$host" || host != host.lowercase() ||
                !topLevelDomain.matches(host.substringAfterLast('.', "")) ||
                host.endsWith(".local") || host.endsWith(".localhost") ||
                host == "atrio-push.atrio-catolico.workers.dev"
            ) return null
            return QaConversationNoticeHttp(URI("$origin/notice"))
        }

        fun loopback(url: String): QaConversationNoticeHttp? {
            val allowed = URI("http", null, "127.0.0.1", 8092, "/notice", null, null)
            return parseUri(url)?.takeIf { it == allowed }?.let(::QaConversationNoticeHttp)
        }

        private fun parseUri(value: String): URI? = try {
            URI(value)
        } catch (_: URISyntaxException) {
            null
        }
    }

    fun read(
        token: String,
        open: (URL) -> HttpURLConnection = { it.openConnection(Proxy.NO_PROXY) as HttpURLConnection }
    ): String? = try {
        val connection = open(endpoint.toURL())
        try {
            // A conexão HTTPS usa a validação de certificado e host do Android.
            if (parseUri(connection.url.toExternalForm()) != endpoint ||
                (endpoint.scheme == "https" && connection !is HttpsURLConnection)
            ) null else readBody(connection, token)
        } finally {
            connection.disconnect()
        }
    } catch (_: IOException) {
        null
    }

    private fun readBody(connection: HttpURLConnection, token: String): String? {
        connection.instanceFollowRedirects = false
        connection.useCaches = false
        connection.requestMethod = "GET"
        connection.connectTimeout = 2_000
        connection.readTimeout = 9_000
        connection.setRequestProperty("Accept", "application/json")
        connection.setRequestProperty("Cache-Control", "no-store")
        connection.setRequestProperty("Authorization", "Bearer $token")
        if (connection.responseCode != HttpURLConnection.HTTP_OK) return null
        return connection.inputStream.bufferedReader(Charsets.UTF_8).use { reader ->
            val buffer = CharArray(MAX_BODY_CHARS + 1)
            var length = 0
            while (length < buffer.size) {
                val count = reader.read(buffer, length, buffer.size - length)
                if (count == -1) break
                length += count
            }
            if (length <= MAX_BODY_CHARS) String(buffer, 0, length) else null
        }
    }
}
