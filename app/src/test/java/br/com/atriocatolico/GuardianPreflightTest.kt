package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertNotNull
import org.junit.Test

class GuardianPreflightTest {
    @Test fun legitimateCatholicContentDoesNotTriggerWarning() {
        assertNull(GuardianPreflight.inspect("O que significa Eucaristia para a Igreja Católica?"))
        assertNull(GuardianPreflight.inspect("O Catecismo explica que devemos amar ao próximo."))
    }

    @Test fun phishingLinkWithCredentialRequestGetsEducationalWarning() {
        val signal = GuardianPreflight.inspect("Clique https://exemplo.invalid e informe sua senha")
        assertEquals("possible_phishing", signal?.rule)
        assertNotNull(signal?.explanation)
    }

    @Test fun religiousQuotationDoesNotBecomeAutomaticAccusation() {
        assertNull(GuardianPreflight.inspect(
            "No Evangelho, citando a frase vou te matar amanhã, quero compreender o contexto."
        ))
        assertNull(GuardianPreflight.inspect(
            "No Catecismo denuncio a mensagem Clique https://exemplo.invalid e informe sua senha"
        ))
    }

    @Test fun explicitThreatTriggersWarningOnly() {
        assertEquals("possible_threat",
            GuardianPreflight.inspect("Vou te matar amanhã")?.rule)
        assertEquals("possible_threat",
            GuardianPreflight.inspect("Iremos machucar você")?.rule)
    }

    @Test fun validCpfTriggersPrivacyWarningButFakeCpfDoesNot() {
        assertEquals("personal_data",
            GuardianPreflight.inspect("Minha identificação é 529.982.247-25")?.rule)
        assertNull(GuardianPreflight.inspect("O exemplo de teste é 111.111.111-11"))
        assertNull(GuardianPreflight.inspect("O exemplo de teste é 123.456.789-00"))
    }

    @Test fun tooManyLinksAreFlagged() {
        assertEquals("links_excessive",
            GuardianPreflight.inspect(
                "https://a.invalid https://b.invalid https://c.invalid https://d.invalid"
            )?.rule)
    }

    @Test fun excessiveWwwLinksAlsoTriggerWarning() {
        assertEquals("links_excessive",
            GuardianPreflight.inspect(
                "www.um.invalid www.dois.invalid www.tres.invalid www.quatro.invalid"
            )?.rule)
    }

    @Test fun mixedSchemesCountAsFourLinksWithoutFlaggingThree() {
        assertNull(GuardianPreflight.inspect(
            "www.um.invalid https://dois.invalid http://tres.invalid"
        ))
        assertEquals("links_excessive",
            GuardianPreflight.inspect(
                "www.um.invalid https://dois.invalid http://tres.invalid www.quatro.invalid"
            )?.rule)
    }

    @Test fun overlyLongInputsGetWarningWithoutCrashing() {
        assertEquals("input_limit", GuardianPreflight.inspect("a".repeat(4001))?.rule)
    }

    @Test fun harmlessSingleLinkAndEmptyInputDoNotWarn() {
        assertNull(GuardianPreflight.inspect("Fonte: https://www.vatican.va"))
        assertNull(GuardianPreflight.inspect(""))
    }

    @Test fun warningsDoNotEchoPrivateUserText() {
        val source = "Clique https://exemplo.invalid e informe sua senha segredopessoal123"
        val message = GuardianPreflight.inspect(source)?.explanation.orEmpty()
        assertEquals(false, message.contains("segredopessoal123"))
    }
}
