package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileV3PolicyTest {
    @Test
    fun optionalFieldsAndInterestsArePrivateByDefault() {
        val publicFields = ProfileV3Policy.projection(
            ProfileV3Draft(
                saint = "Santa Teresinha",
                devotionPhrase = "Fazer o simples com amor.",
                ageBand = "25–34",
                maritalStatus = "Casado(a)",
                publicInterests = listOf("Oração")
            )
        )
        assertTrue(publicFields.isEmpty())
    }

    @Test
    fun projectionContainsOnlyIndividuallySelectedFields() {
        val publicFields = ProfileV3Policy.projection(
            ProfileV3Draft(
                saint = "Santa Teresinha",
                devotionPhrase = "Fazer o simples com amor.",
                ageBand = "25–34",
                maritalStatus = "Casado(a)",
                visibleFields = setOf("saint", "ageBand"),
                publicInterests = listOf("Oração")
            )
        )
        assertEquals(
            mapOf(
                "saint" to "Santa Teresinha",
                "devotionPhrase" to "Fazer o simples com amor.",
                "ageBand" to "25–34",
                "interests" to listOf("Oração")
            ),
            publicFields
        )
        assertFalse(publicFields.containsKey("maritalStatus"))
        assertFalse(publicFields.containsKey("dateOfBirth"))
    }

    @Test
    fun ageChoicesAreRangesAndNeverCollectBirthDateOrExactAge() {
        assertEquals(listOf("18–24", "25–34", "35–44", "45–54", "55+"),
            ProfileV3Policy.ageBands)
        assertFalse(ProfileV3Policy.ageBands.contains("34"))
        assertFalse(ProfileV3Policy.ageBands.contains("1994-02-03"))
    }
}
