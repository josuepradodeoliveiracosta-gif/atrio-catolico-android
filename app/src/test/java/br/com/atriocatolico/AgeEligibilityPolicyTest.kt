package br.com.atriocatolico

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AgeEligibilityPolicyTest {
    private val today = LocalDate.of(2026, 11, 20)

    @Test
    fun requiresAdultAgeAndExplicitConfirmation() {
        assertEquals(
            AgeEligibilityDecision.CONFIRMATION_REQUIRED,
            AgeEligibilityPolicy.decision("20/11/2008", false, today),
        )
        assertEquals(
            AgeEligibilityDecision.ELIGIBLE,
            AgeEligibilityPolicy.decision("20/11/2008", true, today),
        )
        assertEquals(
            AgeEligibilityDecision.UNDER_18,
            AgeEligibilityPolicy.decision("21/11/2008", true, today),
        )
    }

    @Test
    fun rejectsInvalidAndFutureDates() {
        assertNull(AgeEligibilityPolicy.parseBirthDate("31/02/2000"))
        assertNull(AgeEligibilityPolicy.parseBirthDate("29/02/2023"))
        assertEquals(
            AgeEligibilityDecision.INVALID_DATE,
            AgeEligibilityPolicy.decision("21/11/2026", true, today),
        )
        assertEquals(
            AgeEligibilityDecision.INVALID_DATE,
            AgeEligibilityPolicy.decision("not-a-date", true, today),
        )
    }

    @Test
    fun leapDayRequiresTheEighteenthBirthday() {
        assertFalse(AgeEligibilityPolicy.decision(
            "29/02/2008", true, LocalDate.of(2026, 2, 28),
        ) == AgeEligibilityDecision.ELIGIBLE)
        assertTrue(AgeEligibilityPolicy.decision(
            "29/02/2008", true, LocalDate.of(2026, 3, 1),
        ) == AgeEligibilityDecision.ELIGIBLE)
    }

    @Test
    fun dateInputIsNormalizedWithoutChangingItsDigits() {
        assertEquals("20/11/2008", AgeEligibilityPolicy.formatBirthDateInput("20112008"))
        assertEquals("20/11/2008", AgeEligibilityPolicy.formatBirthDateInput("20/11/2008"))
        assertEquals("20/11", AgeEligibilityPolicy.formatBirthDateInput("20-11"))
    }
}
