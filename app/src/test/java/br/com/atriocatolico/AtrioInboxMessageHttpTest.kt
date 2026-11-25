package br.com.atriocatolico

import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test

class AtrioInboxMessageHttpTest {
    @Test fun maintenanceAndTimeoutResendOriginalRoutesBodiesAndKeys() = runBlocking {
        MockWebServer().use { host ->
            val client = AtrioInboxMessageHttp({ "qa-id-token" }, host.url("/v1/qa/conversations/").toUrl(),
                readTimeoutMs = 250)
            val messages = AtrioManagedMessages({ true }, client::submit)
            host.enqueue(MockResponse().setResponseCode(503))
            host.enqueue(ok("clara__miguel", "contact-message"))
            host.enqueue(ok("clara__miguel", "later").setHeadersDelay(1, TimeUnit.SECONDS))
            host.enqueue(ok("clara__miguel", "later"))

            messages.edit("miguel", "  Paz e bem!  ")
            assertEquals(AtrioMessageReply.Pending, messages.send("miguel", "clara__miguel", "miguel", null))
            assertEquals("  Paz e bem!  ", messages.draft("miguel").text)
            val first = messages.draft("miguel").intent
            messages.edit("miguel", "Outro texto")
            assertEquals(AtrioMessageReply.Committed("contact-message"),
                messages.send("miguel", "clara__miguel", null, "other"))
            assertEquals(first, messages.draft("miguel").intent)
            assertEquals("", messages.draft("miguel").text)

            messages.edit("miguel", "Resposta")
            assertEquals(AtrioMessageReply.Pending,
                messages.send("miguel", "clara__miguel", null, "contact-message"))
            assertEquals("Resposta", messages.draft("miguel").text)
            assertEquals(AtrioMessageReply.Committed("later"),
                messages.send("miguel", "clara__miguel", null, null))
            assertEquals("", messages.draft("miguel").text)

            val requests = List(4) { requireNotNull(host.takeRequest(2, TimeUnit.SECONDS)) }
            requests.forEach {
                assertEquals("POST", it.method)
                assertEquals("Bearer qa-id-token", it.getHeader("Authorization"))
                assertEquals("application/json; charset=utf-8", it.getHeader("Content-Type"))
            }
            assertEquals(listOf("/requests/miguel", "/requests/miguel",
                "/chats/clara__miguel/messages", "/chats/clara__miguel/messages"),
                requests.map { it.path?.removePrefix("/v1/qa/conversations") })
            val keys = requests.map { it.getHeader("Idempotency-Key") }
            assertNotNull(keys[0])
            assertEquals(keys[0], keys[1])
            assertNotEquals(keys[1], keys[2])
            assertEquals(keys[2], keys[3])
            val bodies = requests.map { it.body.readUtf8() }
            assertEquals(bodies[0], bodies[1])
            assertEquals("Paz e bem!", JSONObject(bodies[0]).getString("text"))
            assertFalse(JSONObject(bodies[0]).has("replyToId"))
            assertEquals(bodies[2], bodies[3])
            assertEquals("contact-message", JSONObject(bodies[2]).getString("replyToId"))
        }
    }

    @Test fun writeConflictsAreDistinctFromInboxRestartAndRequireReconciliation() = runBlocking {
        MockWebServer().use { host ->
            val client = AtrioInboxMessageHttp({ "qa-id-token" }, host.url("/v1/qa/conversations/").toUrl())
            val inbox = AtrioInboxDiscovery(host.url("/v1/qa/conversations/inbox").toUrl())
            val messages = AtrioManagedMessages({ true }, client::submit)
            host.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"conversation_exists"}"""))
            host.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"inbox_restart_required"}"""))
            host.enqueue(ok("miguel__clara", "after-reconcile"))

            messages.edit("miguel", "Rascunho")
            assertEquals(AtrioMessageReply.Conflict("conversation_exists"),
                messages.send("miguel", "clara__miguel", "miguel", null))
            val old = messages.draft("miguel").intent
            assertTrue(messages.draft("miguel").requiresRoomRefresh)
            assertEquals("Rascunho", messages.draft("miguel").text)
            assertNull(messages.send("miguel", "clara__miguel", "miguel", null))
            assertEquals(AtrioInboxResult.RestartRequired, inbox.fetch("clara", "qa-id-token", "opaque"))
            assertEquals(old, messages.draft("miguel").intent)
            messages.reconcile("miguel")
            assertEquals(AtrioMessageReply.Committed("after-reconcile"),
                messages.send("miguel", "miguel__clara", null, null))
            assertNotEquals(old?.key, messages.draft("miguel").intent?.key)
            assertEquals(3, host.requestCount)
        }
    }

    @Test fun onlyValidatedCommitClearsDraftAndRateLimitRetainsText() = runBlocking {
        MockWebServer().use { host ->
            val client = AtrioInboxMessageHttp({ "qa-id-token" }, host.url("/v1/qa/conversations/").toUrl())
            val messages = AtrioManagedMessages({ true }, client::submit)
            host.enqueue(ok("other__peer", "wrong-target"))
            host.enqueue(MockResponse().setResponseCode(429).setHeader("Retry-After", "3"))
            messages.edit("miguel", "Rascunho")
            assertEquals(AtrioMessageReply.Pending,
                messages.send("miguel", "clara__miguel", null, null))
            assertEquals(AtrioMessageReply.RateLimited(3),
                messages.send("miguel", "clara__miguel", null, null))
            assertNull(messages.send("miguel", "clara__miguel", null, null))
            assertEquals("Rascunho", messages.draft("miguel").text)
            assertEquals(2, host.requestCount)
        }
    }

    @Test fun decisionRetryPreservesIntentAndRequiresMatchingCommit() = runBlocking {
        MockWebServer().use { host ->
            val client = AtrioInboxMessageHttp({ "qa-id-token" }, host.url("/v1/qa/conversations/").toUrl())
            var current = true
            val messages = AtrioManagedMessages({ current }, client::submit, client::submitDecision)
            val chat = "clara__miguel"
            host.enqueue(MockResponse().setResponseCode(503))
            host.enqueue(MockResponse().setBody("""{"committed":true,"chatId":"other","status":"accepted"}"""))
            host.enqueue(MockResponse().setBody("""{"committed":true,"chatId":"clara__miguel","status":"accepted"}"""))
            assertEquals(AtrioDecisionReply.Pending, messages.decide(chat, "accepted"))
            assertNull(messages.decide(chat, "declined"))
            assertEquals(AtrioDecisionReply.Pending, messages.decide(chat, "accepted"))
            assertEquals(AtrioDecisionReply.Committed, messages.decide(chat, "accepted"))
            assertNull(messages.decide(chat, "declined"))
            current = false
            assertNull(messages.decide(chat, "accepted"))
            assertNull(messages.decision(chat))
            val requests = List(3) { requireNotNull(host.takeRequest(2, TimeUnit.SECONDS)) }
            assertEquals(3, host.requestCount)
            assertEquals(1, requests.map { it.getHeader("Idempotency-Key") }.toSet().size)
            requests.forEach {
                assertEquals("/v1/qa/conversations/chats/$chat/decision", it.path)
                assertEquals("POST", it.method)
                assertEquals("Bearer qa-id-token", it.getHeader("Authorization"))
                assertEquals("accepted", JSONObject(it.body.readUtf8()).getString("status"))
            }
        }
    }

    @Test fun inboxTransportIsPinnedToLoopbackOrExactQaHttps() {
        fun remote(origin: String = QA_GERAL_PUSH_RELAY_URL, project: String = "atrio-catolico-qa-general",
                   host: String = "firestore.googleapis.com", ssl: Boolean = true,
                   round: Boolean = true, enabled: Boolean = true) =
            atrioInboxBaseFor(enabled, true, round, project, host, ssl, origin)
        assertEquals("http://127.0.0.1:8091/v1/qa/conversations/",
            atrioInboxBaseFor(true, false, false, "demo-atrio-v11", "127.0.0.1:8089", false, "")?.toExternalForm())
        assertEquals("$QA_GERAL_PUSH_RELAY_URL/v1/qa/conversations/", remote()?.toExternalForm())
        assertNull(remote(origin = "https://atrio-push.atrio-catolico.workers.dev"))
        assertNull(remote(origin = "$QA_GERAL_PUSH_RELAY_URL/"))
        assertNull(remote(origin = "http://127.0.0.1:8091"))
        assertNull(remote(origin = "$QA_GERAL_PUSH_RELAY_URL.example.invalid"))
        assertNull(remote(project = "atrio-catolico"))
        assertNull(remote(host = "127.0.0.1:8089"))
        assertNull(remote(ssl = false))
        assertNull(remote(round = false))
        assertNull(remote(enabled = false))
        assertNull(atrioInboxBaseFor(true, false, false, "atrio-catolico-qa-general",
            "127.0.0.1:8089", false, ""))
    }

    private fun ok(chatId: String, messageId: String) = MockResponse().setBody(
        """{"committed":true,"replayed":false,"chatId":"$chatId","messageId":"$messageId"}"""
    )
}
