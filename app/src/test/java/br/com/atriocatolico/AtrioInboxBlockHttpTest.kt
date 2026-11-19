package br.com.atriocatolico

import kotlinx.coroutines.runBlocking
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.Assert.*
import org.junit.Test

class AtrioInboxBlockHttpTest {
    @Test fun authenticatedReadBlockRetryAndUnblockUsePublishedContract() = runBlocking {
        MockWebServer().use { host ->
            val route = "/v1/qa/conversations/blocks/"
            val service = AtrioInboxBlockHttp({ "qa-id-token" }, host.url(route).toUrl())
            val blocks = AtrioManagedBlocks({ true }, service)
            host.enqueue(ok("""{"blocked":false}""", "\"initial\""))
            host.enqueue(MockResponse().setResponseCode(503).setBody("""{"error":"block_unavailable"}"""))
            host.enqueue(ok(commit(true, true), "\"v-blocked\""))
            host.enqueue(ok(commit(false, false), "\"v-unblocked\""))

            blocks.refresh("miguel")
            blocks.submit("miguel")
            assertEquals(AtrioManagedBlocks.Phase.Pending, blocks.operation("miguel")?.phase)
            assertEquals(false, blocks.confirmed("miguel")?.blocked)
            blocks.submit("miguel")
            assertEquals(AtrioManagedBlocks.Phase.Committed, blocks.operation("miguel")?.phase)
            assertEquals(true, blocks.confirmed("miguel")?.blocked)
            blocks.submit("miguel")
            assertEquals(false, blocks.confirmed("miguel")?.blocked)

            val requests = List(4) { host.takeRequest() }
            assertEquals(listOf("GET", "PUT", "PUT", "DELETE"), requests.map { it.method })
            requests.forEach {
                assertEquals(route + "miguel", it.path)
                assertEquals("Bearer qa-id-token", it.getHeader("Authorization"))
                assertEquals(0L, it.bodySize)
            }
            val firstKey = requests[1].getHeader("Idempotency-Key")
            assertNotNull(firstKey)
            assertEquals(firstKey, requests[2].getHeader("Idempotency-Key"))
            assertNotEquals(firstKey, requests[3].getHeader("Idempotency-Key"))
            assertEquals(listOf(null, "\"initial\"", "\"initial\"", "\"v-blocked\""),
                requests.map { it.getHeader("If-Match") })
        }
    }

    @Test fun invalidCommitRemainsPendingAndVersionConflictRemainsDistinct() = runBlocking {
        MockWebServer().use { host ->
            val service = AtrioInboxBlockHttp({ "qa-token" }, host.url("/blocks/").toUrl())
            val intent = AtrioBlockIntent("qa-operation-key", "miguel", true, "\"initial\"")
            host.enqueue(ok(commit(false, true), "\"v-qa\""))
            host.enqueue(ok(commit(true, true), "v-without-quotes"))
            host.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"block_state_changed"}"""))
            host.enqueue(MockResponse().setResponseCode(409).setBody("""{"error":"block_operation_conflict"}"""))
            host.enqueue(MockResponse().setResponseCode(403))
            assertEquals(AtrioBlockReply.Pending, service.submit(intent))
            assertEquals(AtrioBlockReply.Pending, service.submit(intent))
            assertEquals(AtrioBlockReply.StateChanged, service.submit(intent))
            assertEquals(AtrioBlockReply.Rejected, service.submit(intent))
            assertEquals(AtrioBlockReply.Rejected, service.submit(intent))
        }
    }

    private fun ok(body: String, tag: String): MockResponse = MockResponse()
        .setHeader("ETag", tag).setBody(body)

    private fun commit(requested: Boolean, blocked: Boolean): String =
        """{"committed":true,"replayed":false,"requestedBlocked":$requested,"blocked":$blocked}"""
}
