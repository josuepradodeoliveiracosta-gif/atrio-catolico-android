package br.com.atriocatolico

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AtrioManagedBlocksTest {
    @Test fun maintenanceKeepsBlockPendingAndRetryReusesKeyUntilServerConfirms() = runBlocking {
        val requests = mutableListOf<AtrioBlockIntent>()
        val blocks = AtrioManagedBlocks({ true }) { intent ->
            requests += intent
            if (requests.size == 1) AtrioBlockReply.Pending else AtrioBlockReply.Committed
        }

        blocks.submit("miguel", fromServer = false)
        assertEquals(AtrioManagedBlocks.Phase.Pending, blocks.operation("miguel")?.phase)
        assertEquals(false, blocks.confirmed("miguel", fromServer = false))
        assertEquals(setOf("miguel"), blocks.hiddenPeers())

        blocks.submit("miguel", fromServer = false)
        assertEquals(requests[0], requests[1])
        assertEquals(AtrioManagedBlocks.Phase.Committed, blocks.operation("miguel")?.phase)
        assertEquals(true, blocks.confirmed("miguel", fromServer = false))
        blocks.observe("miguel", fromServer = true)
        assertEquals(false, blocks.confirmed("miguel", fromServer = false))
    }

    @Test fun rejectedUnblockDoesNotReplaceConfirmedBlock() = runBlocking {
        val blocks = AtrioManagedBlocks({ true }) { intent ->
            assertFalse(intent.block)
            AtrioBlockReply.Rejected
        }
        blocks.submit("miguel", fromServer = true)
        assertEquals(AtrioManagedBlocks.Phase.Rejected, blocks.operation("miguel")?.phase)
        assertEquals(true, blocks.confirmed("miguel", fromServer = true))
    }

    @Test fun lateConfirmationFromPreviousSessionIsDiscarded() = runBlocking {
        var sameSession = true
        val started = CompletableDeferred<Unit>()
        val reply = CompletableDeferred<AtrioBlockReply>()
        val blocks = AtrioManagedBlocks({ sameSession }) {
            started.complete(Unit)
            reply.await()
        }
        val load = async { blocks.submit("miguel", fromServer = false) }
        started.await()
        sameSession = false
        reply.complete(AtrioBlockReply.Committed)
        load.await()
        assertNull(blocks.operation("miguel"))
        assertNull(blocks.confirmed("miguel", fromServer = false))
        assertTrue(blocks.hiddenPeers().isEmpty())
    }

    @Test fun leavingScreenWithRequestInFlightPreservesKeyForRetry() = runBlocking {
        val requests = mutableListOf<AtrioBlockIntent>()
        val started = CompletableDeferred<Unit>()
        val unanswered = CompletableDeferred<AtrioBlockReply>()
        val blocks = AtrioManagedBlocks({ true }) {
            requests += it
            if (requests.size == 1) {
                started.complete(Unit)
                unanswered.await()
            } else AtrioBlockReply.Committed
        }
        val load = launch { blocks.submit("miguel", fromServer = false) }
        started.await()
        load.cancelAndJoin()
        assertEquals(AtrioManagedBlocks.Phase.Pending, blocks.operation("miguel")?.phase)
        blocks.submit("miguel", fromServer = false)
        assertEquals(requests[0], requests[1])
    }
}
