package br.com.atriocatolico

import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.async
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.launch
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Test

class AtrioManagedBlocksTest {
    private val initial = AtrioBlockState(false, "\"initial\"")
    private val blocked = AtrioBlockState(true, "\"v-confirmed\"")

    @Test fun maintenanceKeepsBlockPendingAndRetryReusesKeyAndTagUntilServerConfirms() = runBlocking {
        val requests = mutableListOf<AtrioBlockIntent>()
        val blocks = controller { intent ->
            requests += intent
            if (requests.size == 1) AtrioBlockReply.Pending else AtrioBlockReply.Committed(blocked)
        }

        blocks.refresh("miguel")
        blocks.submit("miguel")
        assertEquals(AtrioManagedBlocks.Phase.Pending, blocks.operation("miguel")?.phase)
        assertEquals(initial, blocks.confirmed("miguel"))
        assertEquals(setOf("miguel"), blocks.hiddenPeers())

        blocks.submit("miguel")
        assertEquals(requests[0], requests[1])
        assertEquals(initial.etag, requests[0].etag)
        assertEquals(AtrioManagedBlocks.Phase.Committed, blocks.operation("miguel")?.phase)
        assertEquals(blocked, blocks.confirmed("miguel"))
    }

    @Test fun inboxUsesObservedBlockListAfterTheConfirmedChangePropagates() = runBlocking {
        val blocks = controller { AtrioBlockReply.Committed(blocked) }
        blocks.refresh("miguel")
        blocks.submit("miguel")
        assertEquals(setOf("miguel"), blocks.hiddenPeers())
        blocks.observeBlockList(setOf("miguel"))
        blocks.observeBlockList(emptySet())
        assertTrue(blocks.hiddenPeers().isEmpty())
    }

    @Test fun rejectedUnblockAndFailedRefreshRequireReadingAgain() = runBlocking {
        var state: AtrioBlockState? = blocked
        val blocks = controller(read = { state }) { intent ->
            assertFalse(intent.block)
            state = null
            AtrioBlockReply.Rejected
        }
        blocks.refresh("miguel")
        blocks.submit("miguel")
        assertEquals(AtrioManagedBlocks.Phase.Rejected, blocks.operation("miguel")?.phase)
        assertNull(blocks.confirmed("miguel"))
    }

    @Test fun staleTagReloadsOwnStateWithoutAutomaticallyIssuingANewCommand() = runBlocking {
        var state = initial
        val requests = mutableListOf<AtrioBlockIntent>()
        val blocks = controller(read = { state }) {
            requests += it
            state = blocked
            if (requests.size == 1) AtrioBlockReply.StateChanged else AtrioBlockReply.Committed(initial)
        }
        blocks.refresh("miguel")
        blocks.submit("miguel")
        assertEquals(1, requests.size)
        assertEquals(AtrioManagedBlocks.Phase.StateChanged, blocks.operation("miguel")?.phase)
        assertEquals(blocked, blocks.confirmed("miguel"))
        blocks.submit("miguel")
        assertFalse(requests.last().block)
        assertEquals(blocked.etag, requests.last().etag)
        assertNotEquals(requests.first().operationId, requests.last().operationId)
    }

    @Test fun replayUsesCurrentStateEvenWhenItDiffersFromConfirmedIntention() = runBlocking {
        val current = AtrioBlockState(false, "\"v-later\"")
        val blocks = controller { AtrioBlockReply.Committed(current) }
        blocks.refresh("miguel")
        blocks.submit("miguel")
        assertTrue(blocks.operation("miguel")!!.intent.block)
        assertEquals(current, blocks.confirmed("miguel"))
        assertTrue(blocks.hiddenPeers().isEmpty())
    }

    @Test fun lateConfirmationFromPreviousSessionIsDiscarded() = runBlocking {
        var sameSession = true
        val started = CompletableDeferred<Unit>()
        val reply = CompletableDeferred<AtrioBlockReply>()
        val blocks = controller(sameSession = { sameSession }) {
            started.complete(Unit)
            reply.await()
        }
        blocks.refresh("miguel")
        val load = async { blocks.submit("miguel") }
        started.await()
        sameSession = false
        reply.complete(AtrioBlockReply.Committed(blocked))
        load.await()
        assertNull(blocks.operation("miguel"))
        assertNull(blocks.confirmed("miguel"))
        assertTrue(blocks.hiddenPeers().isEmpty())
    }

    @Test fun leavingScreenWithRequestInFlightPreservesKeyForRetry() = runBlocking {
        val requests = mutableListOf<AtrioBlockIntent>()
        val started = CompletableDeferred<Unit>()
        val unanswered = CompletableDeferred<AtrioBlockReply>()
        val blocks = controller {
            requests += it
            if (requests.size == 1) {
                started.complete(Unit)
                unanswered.await()
            } else AtrioBlockReply.Committed(blocked)
        }
        blocks.refresh("miguel")
        val load = launch { blocks.submit("miguel") }
        started.await()
        load.cancelAndJoin()
        assertEquals(AtrioManagedBlocks.Phase.Pending, blocks.operation("miguel")?.phase)
        blocks.submit("miguel")
        assertEquals(requests[0], requests[1])
    }

    private fun controller(
        sameSession: () -> Boolean = { true },
        read: () -> AtrioBlockState? = { initial },
        submit: suspend (AtrioBlockIntent) -> AtrioBlockReply
    ) = AtrioManagedBlocks(sameSession, object : AtrioManagedBlockService {
        override suspend fun read(peerUid: String) = read()
        override suspend fun submit(intent: AtrioBlockIntent) = submit(intent)
    })
}
