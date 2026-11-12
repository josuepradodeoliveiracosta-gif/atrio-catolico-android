package br.com.atriocatolico

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Test

class ChatAgeRegistrationPrecheckTest {
    private val today = LocalDate.of(2026, 11, 10)

    @Test fun birthdayExactlyEighteenIsOnlyLocalDeclaration() {
        assertEquals(ChatAgeRegistrationPrecheck.Assessment.DECLARED_18_PLUS,
            ChatAgeRegistrationPrecheck.assess("10/11/2008", today))
        assertEquals(ChatAgeRegistrationPrecheck.Assessment.DECLARED_UNDER_18,
            ChatAgeRegistrationPrecheck.assess("11/11/2008", today))
    }

    @Test fun absentAndInvalidDatesNeverConfirmAge() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals(ChatAgeRegistrationPrecheck.Assessment.NOT_PROVIDED, p.assess("", today))
        for (date in listOf("31/02/2000", "29/02/2007", "11/11/2030",
                "2008-11-10", "0/0/2008", "10/11/200", "abc")) {
            assertEquals(date, ChatAgeRegistrationPrecheck.Assessment.INVALID_DATE, p.assess(date, today))
        }
    }

    @Test fun formatterDoesNotStoreOrTransmitBirthdate() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals("10/11/2008", p.formatInput("10112008"))
        assertEquals("10/11/2008", p.formatInput("10/11/2008"))
        assertEquals("10/11/2008", p.formatInput("10abc11-2008!"))
        assertEquals("10/11", p.formatInput("1011"))
    }

    @Test fun leapDayIsConservativeOnNonLeapYear() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals(ChatAgeRegistrationPrecheck.Assessment.DECLARED_UNDER_18,
            p.assess("29/02/2008", LocalDate.of(2026, 2, 28)))
        assertEquals(ChatAgeRegistrationPrecheck.Assessment.DECLARED_18_PLUS,
            p.assess("29/02/2008", LocalDate.of(2026, 3, 1)))
    }

    @Test fun minorityNeverBecomesServerProof() {
        val p = ChatAgeRegistrationPrecheck
        for (age in 1..17) {
            val birth = today.minusYears(age.toLong()).plusDays(1)
            val formatted = birth.format(java.time.format.DateTimeFormatter.ofPattern("dd/MM/uuuu"))
            assertEquals("age $age", ChatAgeRegistrationPrecheck.Assessment.DECLARED_UNDER_18,
                p.assess(formatted, today))
        }
    }

    @Test fun ageAndDeclarationMustAgreeBeforeEligibility() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals(18, p.declaredAge("10/11/2008", today))
        assertEquals(17, p.declaredAge("11/11/2008", today))
        assertEquals(null, p.declaredAge("31/02/2000", today))
        assertEquals(null, p.declaredAge("", today))
        assertEquals(false, p.canRequestChatAccess("10/11/2008", false, today))
        assertEquals(true, p.canRequestChatAccess("10/11/2008", true, today))
        assertEquals(false, p.canRequestChatAccess("11/11/2008", true, today))
        assertEquals(false, p.canRequestChatAccess("31/02/2000", true, today))
        assertEquals(false, p.canRequestChatAccess("", true, today))
        assertEquals(false, p.canRequestChatAccess("11/11/2030", true, today))
    }

    @Test fun previousCheckboxIsNotValidAfterBirthDateChanges() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals(true, p.canRequestChatAccess("10/11/2008", true, today))
        for (changed in listOf("", "10/11/2010", "29/02/2007", "99/99/2000")) {
            assertEquals(false, p.canRequestChatAccess(changed, true, today))
        }
    }

    @Test fun exactlyEighteenTodayButNotYesterday() {
        val p = ChatAgeRegistrationPrecheck
        assertEquals(false, p.canRequestChatAccess(
            "10/11/2008", true, LocalDate.of(2026,11,9)))
        assertEquals(true, p.canRequestChatAccess(
            "10/11/2008", true, LocalDate.of(2026,11,10)))
    }
}
