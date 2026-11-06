package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class AtrioSaveIntentCoordinatorTest {
    @Test
    fun repeatedTapPreservesLastIntentDespiteLateResponses() {
        val sent = mutableListOf<Pair<String, Boolean>>()
        val callbacks = mutableListOf<(Boolean) -> Unit>()
        val states = mutableListOf<Triple<String, Boolean, Boolean>>()
        val queue = AtrioSaveIntentCoordinator(
            { id, save, done -> sent += id to save; callbacks += done },
            { id, saved, pending -> states += Triple(id, saved, pending) },
            { error("Unexpected failure for $it") }
        )
        queue.toggle("p1", false)
        queue.toggle("p1", false)
        queue.toggle("p1", false)
        assertEquals(listOf("p1" to true), sent)
        callbacks.removeAt(0)(true)
        assertEquals(Triple("p1", true, false), states.last())
        assertEquals(1, sent.size)
    }

    @Test
    fun queuedRemovalRunsAfterSavingAndWins() {
        val operations = mutableListOf<Pair<Boolean, (Boolean) -> Unit>>()
        val states = mutableListOf<Pair<Boolean, Boolean>>()
        val queue = AtrioSaveIntentCoordinator(
            { _, save, done -> operations += save to done },
            { _, saved, pending -> states += saved to pending },
            { error("Unexpected failure for $it") }
        )
        queue.toggle("post", false)
        queue.toggle("post", false)
        assertEquals(1, operations.size)
        operations[0].second(true)
        assertEquals(2, operations.size)
        assertEquals(false, operations[1].first)
        operations[1].second(true)
        assertEquals(false to false, states.last())
    }

    @Test
    fun failureRevertsToConfirmedStateAndAllowsRetry() {
        val callbacks = mutableListOf<(Boolean) -> Unit>()
        val states = mutableListOf<Pair<Boolean, Boolean>>()
        var errors = 0
        val queue = AtrioSaveIntentCoordinator(
            { _, _, done -> callbacks += done },
            { _, saved, pending -> states += saved to pending },
            { errors++ }
        )
        queue.toggle("post", false)
        callbacks.removeAt(0)(false)
        assertEquals(false to false, states.last())
        assertEquals(1, errors)
        queue.toggle("post", false)
        callbacks.removeAt(0)(true)
        assertEquals(true to false, states.last())
    }

    @Test
    fun differentItemsDoNotBlockEachOther() {
        val sent = mutableListOf<String>()
        val queue = AtrioSaveIntentCoordinator(
            { id, _, _ -> sent += id },
            { _, _, _ -> },
            { }
        )
        queue.toggle("a", false)
        queue.toggle("b", false)
        assertEquals(listOf("a", "b"), sent)
        assertTrue(sent.distinct().size == 2)
    }
}
