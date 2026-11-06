package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class RegistrationOptionalPolicyTest {
    @Test fun choicesStartOptional() {
        assertTrue(RegistrationOptionalPolicy.valid(emptyList(), "", "", ""))
        assertFalse(RegistrationOptionalPolicy.hasSensitive(emptyList(), "", ""))
    }

    @Test fun religiousInterestNeedsSpecificConsent() {
        assertTrue(RegistrationOptionalPolicy.hasSensitive(listOf("Oração"), "", ""))
        assertTrue(RegistrationOptionalPolicy.hasSensitive(emptyList(), "Padre/Diácono", ""))
        assertTrue(RegistrationOptionalPolicy.hasSensitive(emptyList(), "", "Paróquia"))
    }

    @Test fun participationIsSelfDeclarationNotRole() {
        assertTrue(RegistrationOptionalPolicy.valid(
            listOf("Formação", "Comunidade"), "Padre/Diácono", "Cidade", "Paróquia"))
        assertFalse(RegistrationOptionalPolicy.valid(emptyList(), "Fundador", "", ""))
        assertFalse(RegistrationOptionalPolicy.valid(emptyList(), "Administrador", "", ""))
    }

    @Test fun onlyWhitelistedUniqueInterestsAccepted() {
        assertFalse(RegistrationOptionalPolicy.valid(listOf("Superpoder"), "", "", ""))
        assertFalse(RegistrationOptionalPolicy.valid(listOf("Oração", "Oração"), "", "", ""))
        assertTrue(RegistrationOptionalPolicy.valid(listOf("Notícias católicas"), "", "", ""))
    }

    @Test fun textSizeAndControlCharactersRejected() {
        assertFalse(RegistrationOptionalPolicy.valid(emptyList(), "", "X".repeat(81), ""))
        assertFalse(RegistrationOptionalPolicy.valid(emptyList(), "", "", "X".repeat(81)))
        assertFalse(RegistrationOptionalPolicy.valid(emptyList(), "", "A\nB", ""))
    }
}
