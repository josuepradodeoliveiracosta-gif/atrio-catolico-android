package br.com.atriocatolico

import com.sun.net.httpserver.HttpExchange
import com.sun.net.httpserver.HttpServer
import java.net.InetSocketAddress
import java.net.URL
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class AtrioInboxDiscoveryTest {
    private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
    private val path = "/v1/qa/conversations/inbox"
    private val client = AtrioInboxDiscovery(URL("http://127.0.0.1:${server.address.port}$path"))

    @After fun stopServer() = server.stop(0)

    @Test fun followsNewCursorsToLastPageAndSendsOnlyBearer() {
        val requests = mutableListOf<Triple<String, String?, String?>>()
        server.createContext(path) { exchange ->
            val query = exchange.requestURI.rawQuery
            requests.add(Triple(query, exchange.requestHeaders.getFirst("Authorization"),
                exchange.requestHeaders.getFirst("Cache-Control")))
            when (query) {
                "limit=20" -> exchange.reply(200, page(1..20, "opaque+1/="))
                "limit=20&cursor=opaque%2B1%2F%3D" ->
                    exchange.reply(200, page(21..40, "opaque_2"))
                "limit=20&cursor=opaque_2" -> exchange.reply(200, page(41..43, null))
                else -> exchange.reply(400)
            }
        }
        server.start()

        val first = client.fetch("clara", "qa-token", null) as AtrioInboxResult.Page
        val second = client.fetch("clara", "qa-token", first.nextCursor) as AtrioInboxResult.Page
        val last = client.fetch("clara", "qa-token", second.nextCursor) as AtrioInboxResult.Page

        assertEquals((1..43).map { "peer" + it.toString().padStart(2, '0') },
            (first.items + second.items + last.items).map { it.peerUid })
        assertNull(last.nextCursor)
        assertEquals(listOf("limit=20", "limit=20&cursor=opaque%2B1%2F%3D",
            "limit=20&cursor=opaque_2"), requests.map { it.first })
        assertTrue(requests.all { it.second == "Bearer qa-token" && it.third == "no-store" })
    }

    @Test fun distinguishesConfirmedEmptyUnavailableDeniedAndInvalidResponses() {
        server.createContext(path) { exchange ->
            when (exchange.requestHeaders.getFirst("Authorization")) {
                "Bearer empty" -> exchange.reply(200, """{"items":[],"nextCursor":null}""")
                "Bearer missing" -> exchange.reply(200, """{"items":[]}""")
                "Bearer bad-peer" -> exchange.reply(200, page(1..1, null).replace("clara__", "lucia__"))
                "Bearer denied" -> exchange.reply(403)
                "Bearer redirect" -> {
                    exchange.responseHeaders.add("Location", "$path?limit=20")
                    exchange.reply(302)
                }
                else -> exchange.reply(503, """{"error":"inbox_unavailable"}""")
            }
        }
        server.start()

        assertEquals(AtrioInboxResult.Page(emptyList(), null), client.fetch("clara", "empty", null))
        for (token in listOf("offline", "missing", "bad-peer", "redirect")) {
            assertEquals(token, AtrioInboxResult.Unavailable, client.fetch("clara", token, null))
        }
        assertEquals(AtrioInboxResult.Denied, client.fetch("clara", "denied", null))
    }

    @Test fun dropsLatePageEvenAfterReloginWithSameUid() = runBlocking {
        val oldSession = Any()
        var activeSession = oldSession
        val requestStarted = CompletableDeferred<Unit>()
        val pausedResponse = CompletableDeferred<AtrioInboxResult>()
        val load = async {
            client.load("clara", "old-cursor", { activeSession === oldSession },
                getToken = { "old-token" },
                request = { _, _, _ -> requestStarted.complete(Unit); pausedResponse.await() })
        }
        requestStarted.await()
        activeSession = Any()
        pausedResponse.complete(AtrioInboxResult.Page(
            listOf(AtrioInboxEntry("clara__miguel", "miguel", "accepted", "Privada", 1, 0)),
            "old-next"))
        assertNull(load.await())
    }

    @Test fun sessionChangedDuringTokenFetchNeverSendsRequest() = runBlocking {
        var current = true
        val result = client.load("clara", null, { current },
            getToken = {
                current = false
                "old-token"
            }, request = { _, _, _ -> error("Unexpected request") })
        assertNull(result)
    }

    @Test fun acceptsBothIdOrdersAndDeduplicatesPageByChatId() {
        server.createContext(path) { exchange ->
            val row = entry(1).replace("clara__peer01", "peer01__clara")
            exchange.reply(200, """{"items":[$row,$row],"nextCursor":null}""")
        }
        server.start()

        val page = client.fetch("clara", "qa-token", null) as AtrioInboxResult.Page
        assertEquals(listOf("peer01__clara"), page.items.map { it.chatId })
        assertTrue(AtrioPeerInboxPolicy.roomMatches("clara", "peer01__clara",
            "clara", "peer01", "accepted"))
    }

    private fun entry(index: Int): String {
        val peer = "peer" + index.toString().padStart(2, '0')
        return """{"chatId":"clara__${peer}","peerUid":"$peer","status":"accepted","lastPreview":"Teste",
            "updatedAtMs":1730000000000,"unreadCount":0,"lastSenderUid":"clara"}"""
    }

    private fun page(range: IntRange, cursor: String?): String {
        val items = range.joinToString(",", transform = ::entry)
        val nextCursor = cursor?.let { "\"$it\"" } ?: "null"
        return """{"items":[$items],"nextCursor":$nextCursor}"""
    }

    private fun HttpExchange.reply(code: Int, json: String = "{}") {
        val data = json.toByteArray(Charsets.UTF_8)
        sendResponseHeaders(code, data.size.toLong())
        responseBody.use { it.write(data) }
    }
}
