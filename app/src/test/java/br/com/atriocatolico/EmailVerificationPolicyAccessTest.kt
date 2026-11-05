package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** O gate da comunidade deve falhar fechado para e-mail não confirmado. */
class EmailVerificationPolicyAccessTest {
    @Test fun contaNaoVerificadaPermaneceBloqueadaEmCarregamentoFalhaEObrigatoriedade() {
        val denied = listOf(
            EmailVerificationPolicyAccess.CHECKING,
            EmailVerificationPolicyAccess.UNAVAILABLE,
            EmailVerificationPolicyAccess.REQUIRED
        )
        denied.forEach { state ->
            assertFalse("Estado $state nao pode abrir a comunidade",
                canEnterAtrioCommunity(false, state))
        }
    }

    @Test fun politicaConfirmadaComoOpcionalPermiteEntrar() {
        assertTrue(canEnterAtrioCommunity(false, EmailVerificationPolicyAccess.OPTIONAL))
        assertEquals(
            EmailVerificationPolicyAccess.OPTIONAL,
            emailVerificationPolicyFromServer(null, null)
        )
        assertEquals(
            EmailVerificationPolicyAccess.OPTIONAL,
            emailVerificationPolicyFromServer(false, "2026-11-v1")
        )
        assertEquals(
            EmailVerificationPolicyAccess.OPTIONAL,
            emailVerificationPolicyFromServer(true, "outra-versao")
        )
    }

    @Test fun politicaAtivaExigeTokenRealDeEmailConfirmado() {
        assertEquals(
            EmailVerificationPolicyAccess.REQUIRED,
            emailVerificationPolicyFromServer(true, "2026-11-v1")
        )
        assertFalse(canEnterAtrioCommunity(false, EmailVerificationPolicyAccess.REQUIRED))
        assertTrue(canEnterAtrioCommunity(true, EmailVerificationPolicyAccess.REQUIRED))
    }

    @Test fun contaVerificadaNaoFicaBloqueadaPorFalhaDeLeitura() {
        EmailVerificationPolicyAccess.values().forEach { state ->
            assertTrue("E-mail ja verificado deve conseguir entrar no estado $state",
                canEnterAtrioCommunity(true, state))
        }
    }
}
