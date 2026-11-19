package br.com.atriocatolico

import okhttp3.mockwebserver.Dispatcher
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import okhttp3.mockwebserver.RecordedRequest
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.*
import org.junit.Test

class AtrioInboxDiscoveryTest {
    private val server = MockWebServer()
    private val path = "/v1/qa/conversations/inbox"
    private val client by lazy { AtrioInboxDiscovery(server.url(path).toUrl()) }

    @After fun stopServer() = server.shutdown()

    @Test fun followsNewCursorsToLastPageAndSendsOnlyBearer() {
        respond { request ->
            when (request.path) {
                "$path?limit=20" -> reply(200, page(1..20, "opaque+1/="))
                "$path?limit=20&cursor=opaque%2B1%2F%3D" ->
                    reply(200, page(21..40, "opaque_2"))
                "$path?limit=20&cursor=opaque_2" -> reply(200, page(41..43, null))
                else -> reply(400)
            }
        }

        val first = client.fetch("clara", "qa-token", null) as AtrioInboxResult.Page
        val second = client.fetch("clara", "qa-token", first.nextCursor) as AtrioInboxResult.Page
        val last = client.fetch("clara", "qa-token", second.nextCursor) as AtrioInboxResult.Page

        assertEquals((1..43).map { "peer" + it.toString().padStart(2, '0') },
            (first.items + second.items + last.items).map { it.peerUid })
        assertNull(last.nextCursor)
        val requests = List(3) { server.takeRequest() }
        assertEquals(listOf("$path?limit=20", "$path?limit=20&cursor=opaque%2B1%2F%3D",
            "$path?limit=20&cursor=opaque_2"), requests.map { it.path })
        assertTrue(requests.all {
            it.getHeader("Authorization") == "Bearer qa-token" &&
                it.getHeader("Cache-Control") == "no-store"
        })
    }

    @Test fun distinguishesConfirmedEmptyUnavailableDeniedAndInvalidResponses() {
        respond { request ->
            when (request.getHeader("Authorization")) {
                "Bearer empty" -> reply(200, """{"items":[],"nextCursor":null}""")
                "Bearer missing" -> reply(200, """{"items":[]}""")
                "Bearer bad-peer" -> reply(200, page(1..1, null).replace("clara__", "lucia__"))
                "Bearer denied" -> reply(403)
                "Bearer redirect" -> reply(302).setHeader("Location", "$path?limit=20")
                else -> reply(503, """{"error":"inbox_unavailable"}""")
            }
        }

        assertEquals(AtrioInboxResult.Page(emptyList(), null), client.fetch("clara", "empty", null))
        for (token in listOf("offline", "missing", "bad-peer", "redirect")) {
            assertEquals(token, AtrioInboxResult.Unavailable, client.fetch("clara", token, null))
        }
        assertEquals(AtrioInboxResult.Denied, client.fetch("clara", "denied", null))
    }

    @Test fun invalidatedCursorClearsTrailAndReplacesPageFromFirstRequest() {
        server.enqueue(reply(200, page(1..20, "old1")))
        server.enqueue(reply(200, page(21..40, "old2")))
        server.enqueue(reply(409, """{"error":"inbox_restart_required"}"""))
        server.enqueue(reply(200, page(41..43, null)))
        server.start()

        val first = client.fetch("clara", "qa-token", null) as AtrioInboxResult.Page
        val second = client.fetch("clara", "qa-token", first.nextCursor) as AtrioInboxResult.Page
        val old = AtrioInboxPaging(listOf(null, first.nextCursor, second.nextCursor), second)
        val restart = client.fetch("clara", "qa-token", old.cursor)
        assertEquals(AtrioInboxResult.RestartRequired, restart)
        val reset = old.receive(restart)
        assertEquals(listOf<String?>(null), reset.cursors)
        assertNull(reset.result)
        val replaced = reset.receive(client.fetch("clara", "qa-token", reset.cursor))
        val fresh = replaced.result as AtrioInboxResult.Page
        assertEquals(listOf("peer41", "peer42", "peer43"), fresh.items.map { it.peerUid })
        assertEquals(listOf("$path?limit=20", "$path?limit=20&cursor=old1",
            "$path?limit=20&cursor=old2", "$path?limit=20"),
            List(4) { server.takeRequest().path })
    }

    @Test fun onlyRecognizedConflictOnContinuationRestarts() {
        respond { request ->
            val code = if (request.getHeader("Authorization") == "Bearer qa-token")
                "inbox_restart_required" else "conflict"
            reply(409, """{"error":"$code"}""")
        }

        assertEquals(AtrioInboxResult.Unavailable, client.fetch("clara", "qa-token", null))
        assertEquals(AtrioInboxResult.Unavailable, client.fetch("clara", "unknown", "old"))
        assertEquals(AtrioInboxResult.RestartRequired, client.fetch("clara", "qa-token", "old"))
    }

    @Test fun dropsLateRestartAfterSessionChange() = runBlocking {
        var current = true
        val load = client.load("clara", "old", { current }, getToken = { "old-token" },
            request = { _, _, _ ->
                current = false
                AtrioInboxResult.RestartRequired
            })
        assertNull(load)
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
        respond {
            val row = entry(1).replace("clara__peer01", "peer01__clara")
            reply(200, """{"items":[$row,$row],"nextCursor":null}""")
        }

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

    private fun respond(handler: (RecordedRequest) -> MockResponse) {
        server.dispatcher = object : Dispatcher() {
            override fun dispatch(request: RecordedRequest): MockResponse = handler(request)
        }
        server.start()
    }

    private fun reply(code: Int, json: String = "{}"): MockResponse =
        MockResponse().setResponseCode(code).setBody(json)
}
