package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

/** Regressões da apresentação de respostas sem rede, relógio real ou Firebase. */
class DiscussionDetailPolicyTest {
    private val now = 1_800_000_000_000L

    @Test fun ageLabelForRecentReplies() {
        assertEquals("agora", replyAgeLabel(now, now))
        assertEquals("há 1 min", replyAgeLabel(now - 60_000, now))
        assertEquals("há 59 min", replyAgeLabel(now - 59 * 60_000, now))
        assertEquals("há 1 h", replyAgeLabel(now - 60 * 60_000, now))
        assertEquals("há 23 h", replyAgeLabel(now - 23 * 60 * 60_000, now))
    }

    @Test fun ageLabelForDaysAndWeeks() {
        assertEquals("há 1 d", replyAgeLabel(now - 24 * 60 * 60_000, now))
        assertEquals("há 6 d", replyAgeLabel(now - 6 * 24 * 60 * 60_000, now))
        assertEquals("há 1 sem", replyAgeLabel(now - 7 * 24 * 60 * 60_000, now))
        assertEquals("há 3 sem", replyAgeLabel(now - 21 * 24 * 60 * 60_000L, now))
    }

    @Test fun unknownOrFutureTimestampIsHidden() {
        assertEquals("", replyAgeLabel(0L, now))
        assertEquals("", replyAgeLabel(-1L, now))
        assertEquals("", replyAgeLabel(now + 10_000L, now))
    }
}
