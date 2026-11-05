package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RegistrationPolicyTest {
    private val name = "Maria da Silva"
    private val email = "maria@example.com"

    @Test fun newAccountsRequireFifteenCharactersAndConfirmation() {
        assertEquals("Use pelo menos 15 caracteres.",
            RegistrationPolicy.passwordProblem("Senha123!", email, name))
        assertNull(RegistrationPolicy.passwordProblem("Caminho do vento no bosque", email, name))
        assertTrue(RegistrationPolicy.ready(name, email, "Caminho do vento no bosque",
            "Caminho do vento no bosque", true))
        assertFalse(RegistrationPolicy.ready(name, email, "Caminho do vento no bosque",
            "Caminho do vento", true))
        assertFalse(RegistrationPolicy.ready(name, email, "Caminho do vento no bosque",
            "Caminho do vento no bosque", false))
    }

    @Test fun emailNameAndObviousPasswordsAreRejected() {
        assertFalse(RegistrationPolicy.validEmail("usuario@"))
        assertFalse(RegistrationPolicy.validEmail("usuario sem email"))
        assertTrue(RegistrationPolicy.validEmail(email))
        assertFalse(RegistrationPolicy.validName(" "))
        assertNull(RegistrationPolicy.passwordProblem("Palavras raras e memoráveis", email, name))
        assertTrue(RegistrationPolicy.passwordProblem("aaaaaaaaaaaaaaa", email, name) != null)
        assertTrue(RegistrationPolicy.passwordProblem("passwordpassword", email, name) != null)
        assertTrue(RegistrationPolicy.passwordProblem("maria2026XXXXX!XY", email, name) != null)
    }

    @Test fun neverSilentlyTrimOrRequireSymbolMix() {
        val pass = " quatro palavras com espaços "
        assertNull(RegistrationPolicy.passwordProblem(pass, email, name))
        assertNull(RegistrationPolicy.passwordProblem("sócomletrasmuitolongas", email, name))
        assertEquals("As senhas não coincidem.",
            RegistrationPolicy.confirmProblem(pass, pass.trim()))
        assertEquals("Use até 128 caracteres.",
            RegistrationPolicy.passwordProblem("x".repeat(129), email, name))
    }
}
