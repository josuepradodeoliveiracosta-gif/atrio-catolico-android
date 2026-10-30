package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

/** Production source classes compiled into a separate no-network APK. */
class GuardianLabCoreTest {
    @Test fun phishingLinkIsWarned() {
        assertEquals("possible_phishing",
            GuardianPreflight.inspect("Clique https://exemplo.invalid e informe sua senha")?.rule)
    }
    @Test fun legitimatePrayerIsPreserved() {
        assertNull(GuardianPreflight.inspect("A paz esteja convosco. Rezemos pela comunidade."))
    }
    @Test fun excessLinksAreWarned() {
        val links = "https://a.invalid https://b.invalid https://c.invalid https://d.invalid"
        assertEquals("links_excessive", GuardianPreflight.inspect(links)?.rule)
    }
    @Test fun oversizedInputIsWarned() {
        assertEquals("input_limit", GuardianPreflight.inspect("x".repeat(4001))?.rule)
    }
    @Test fun sessionChecksRejectOtherUsers() {
        assertTrue(GuardianUiPolicy.sameSession("qa", "qa"))
        assertFalse(GuardianUiPolicy.sameSession("qa", "other"))
        assertFalse(GuardianUiPolicy.canReview("qa", "other", "held",
            true, false, "Revisão humana.", true))
    }
}
