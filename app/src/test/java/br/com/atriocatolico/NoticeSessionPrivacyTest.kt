package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class NoticeSessionPrivacyTest {
    @Test fun unavailableBlockFilterHidesContentUntilServerConfirmsIt() {
        fun canShow(ids: Set<String>, cached: Boolean, pending: Boolean, ownSession: Boolean): Boolean {
            val confirmed = ids.takeIf { NoticePrivacyPolicy.serverConfirmed(cached, pending, ownSession) }
            return canShowWithBlockedMembers(confirmed, "miguel")
        }
        assertFalse(canShow(emptySet(), cached = true, pending = false, ownSession = true))
        assertFalse(canShow(emptySet(), cached = false, pending = true, ownSession = true))
        assertFalse(canShow(emptySet(), cached = false, pending = false, ownSession = false))
        assertFalse(canShow(setOf("miguel"), cached = false, pending = false, ownSession = true))
        assertTrue(canShow(emptySet(), cached = false, pending = false, ownSession = true))
        assertFalse(canShowWithBlockedMembers(null, "miguel"))
        assertFalse(canShowWithBlockedMembers(setOf("miguel"), ""))
    }

    @Test fun delayedSuccessAfterAccountSwitchCannotSubmitNextBatch() {
        val original = Any()
        var session: Any? = original
        val submitted = mutableListOf<List<Int>>()
        val callbacks = mutableListOf<(Boolean) -> Unit>()
        val results = mutableListOf<Boolean>()
        runNoticeBatches(listOf(listOf(1), listOf(2)), { session === original }, { chunk, complete ->
            submitted += chunk
            callbacks += complete
        }, { results += it })

        session = Any() // B.
        session = Any() // A volta com uma nova sessão, mesmo UID.
        callbacks.single()(true)
        assertEquals(listOf(listOf(1)), submitted)
        assertTrue(results.isEmpty())
    }

    @Test fun delayedFailureAfterLogoutDoesNotPublishFeedback() {
        var current = true
        var callback: ((Boolean) -> Unit)? = null
        val results = mutableListOf<Boolean>()
        runNoticeBatches(listOf(listOf("aviso")), { current },
            { _, complete -> callback = complete }, { results += it })
        current = false
        requireNotNull(callback)(false)
        assertTrue(results.isEmpty())
    }

    @Test fun currentSessionCompletesAllBatchesAndFinishesOnce() {
        val submitted = mutableListOf<List<Int>>()
        val callbacks = mutableListOf<(Boolean) -> Unit>()
        val results = mutableListOf<Boolean>()
        runNoticeBatches(listOf(listOf(1, 2), listOf(3)), { true }, { chunk, complete ->
            submitted += chunk
            callbacks += complete
        }, { results += it })
        callbacks.first()(true)
        assertEquals(listOf(listOf(1, 2), listOf(3)), submitted)
        assertTrue(results.isEmpty())
        callbacks.last()(true)
        assertEquals(listOf(true), results)
    }
}
