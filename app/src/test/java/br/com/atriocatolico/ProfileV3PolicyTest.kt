package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ProfileV3PolicyTest {
    @Test
    fun projectionRequiresConsentEvenWithSelectedFieldsAndInterests() {
        val publicFields = ProfileV3Policy.projection(
            ProfileV3Draft(
                saint = "Santa Teresinha",
                devotionPhrase = "Fazer o simples com amor.",
                ageBand = "25–34",
                maritalStatus = "Casado(a)",
                visibleFields = setOf("saint", "ageBand", "maritalStatus"),
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
                publicInterests = listOf("Oração"),
                consentAccepted = true
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
    fun questionLengthUsesUnicodeCodePointsAfterTrimming() {
        val limit = "🕊".repeat(140)
        assertEquals(limit, " \u00A0$limit\uFEFF ".profileV3Question())
        assertEquals(140, " $limit ".profileV3QuestionLength())
        assertEquals(141, "${limit}á".profileV3QuestionLength())
        assertEquals(0, " \u00A0\uFEFF ".profileV3QuestionLength())
    }

    @Test
    fun projectionOmitsHiddenDetailsAndKeepsPostIdsOutOfThePublicProfile() {
        val draft = ProfileV3Draft(
            publicInterests = listOf("Oração", "Formação"), consentAccepted = true,
            interestDetails = mapOf(
                "oracao" to ProfileV3InterestDetail("  Qual hábito ajuda?  ", "discussion_1"),
                "formacao" to ProfileV3InterestDetail(" ", "discussion_2"),
                "comunidade" to ProfileV3InterestDetail("Oculta", "discussion_3")
            )
        )
        assertEquals(mapOf("oracao" to "Qual hábito ajuda?"),
            ProfileV3Policy.projection(draft)["interestQuestions"])
        assertEquals(setOf("interests", "interestQuestions"), ProfileV3Policy.projection(draft).keys)
        assertEquals(mapOf("oracao" to "discussion_1", "formacao" to "discussion_2"),
            draft.interestProjection("postId"))
        assertEquals(emptyMap<String, Any>(), ProfileV3Policy.projection(draft.copy(consentAccepted = false)))
    }

    @Test
    fun ageChoicesAreRangesAndNeverCollectBirthDateOrExactAge() {
        assertEquals(listOf("18–24", "25–34", "35–44", "45–54", "55+"),
            ProfileV3Policy.ageBands)
        assertFalse(ProfileV3Policy.ageBands.contains("34"))
        assertFalse(ProfileV3Policy.ageBands.contains("1994-02-03"))
    }
}
