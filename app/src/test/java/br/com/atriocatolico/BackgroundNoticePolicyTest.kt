package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class BackgroundNoticePolicyTest {
    @Test fun startsFromEnrollmentAndNeverReplaysOldItems() {
        assertEquals(1000L, BackgroundNoticePolicy.cutoff(1000L, 0L))
        assertFalse(BackgroundNoticePolicy.isNew(999L, 1000L, 5000L))
        assertTrue(BackgroundNoticePolicy.isNew(1001L, 1000L, 5000L))
    }

    @Test fun overlapsPreviousScanToAvoidRaceWithServerTimestamps() {
        val checkedAt = 3600000L
        assertEquals(checkedAt - 300000L,
            BackgroundNoticePolicy.cutoff(1000L, checkedAt))
        assertEquals(checkedAt,
            BackgroundNoticePolicy.cutoff(checkedAt, checkedAt))
    }

    @Test fun futureAndInvalidItemsCannotTriggerNotifications() {
        assertFalse(BackgroundNoticePolicy.isNew(90000L, 1000L, 10000L))
        assertFalse(BackgroundNoticePolicy.isNew(0L, 1000L, 10000L))
        assertTrue(BackgroundNoticePolicy.isNew(10000L, 1000L, 10000L))
    }

    @Test fun legacyReportsArePendingUntilReviewed() {
        assertTrue(BackgroundNoticePolicy.isPending(null))
        assertTrue(BackgroundNoticePolicy.isPending("pending"))
        assertFalse(BackgroundNoticePolicy.isPending("dismissed"))
        assertFalse(BackgroundNoticePolicy.isPending("removed"))
    }

    @Test fun onlyFinalClergyDecisionsTriggerOutcomeNotice() {
        assertTrue(BackgroundNoticePolicy.reviewStatus("approved"))
        assertTrue(BackgroundNoticePolicy.reviewStatus("rejected"))
        assertTrue(BackgroundNoticePolicy.reviewStatus("dismissed"))
        assertFalse(BackgroundNoticePolicy.reviewStatus("pending"))
        assertFalse(BackgroundNoticePolicy.reviewStatus(null))
    }

    @Test fun mostRecentIdentifiersSurviveCappedDeduplication() {
        val old = (0 until 510).map { "old:$it" }.toSet()
        val seen = BackgroundNoticePolicy.boundedSeen(old, listOf("new:1", "new:2"))
        assertEquals(500, seen.size)
        assertTrue(seen.contains("new:1"))
        assertTrue(seen.contains("new:2"))
    }

    @Test fun maintainsConservativeCadenceAndQuerySize() {
        assertEquals(30L, BackgroundNoticePolicy.REPEAT_MINUTES)
        assertTrue(BackgroundNoticePolicy.REPEAT_MINUTES >= 15)
        assertTrue(BackgroundNoticePolicy.MAX_DOCS <= 25)
    }
}
