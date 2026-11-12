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
 
    @Test fun chatQaFalhaFechadoSemPoliticaDeEmailAtiva() {
        for ((enabled, version) in listOf(
            Pair(null, null), Pair(false, "2026-11-v1"),
            Pair(true, "outdated"), Pair(null, "2026-11-v1")
        )) {
            assertEquals(EmailVerificationPolicyAccess.UNAVAILABLE,
                qaEmailVerificationPolicyFromServer(enabled, version))
        }
        assertEquals(EmailVerificationPolicyAccess.REQUIRED,
            qaEmailVerificationPolicyFromServer(true, "2026-11-v1"))
        assertFalse(canEnterQaAtrioCommunity(false, EmailVerificationPolicyAccess.REQUIRED))
        assertTrue(canEnterQaAtrioCommunity(true, EmailVerificationPolicyAccess.REQUIRED))
        for (state in listOf(EmailVerificationPolicyAccess.OPTIONAL,
                EmailVerificationPolicyAccess.CHECKING,
                EmailVerificationPolicyAccess.UNAVAILABLE)) {
            assertFalse(canEnterQaAtrioCommunity(true, state))
            assertFalse(canEnterQaAtrioCommunity(false, state))
        }
        // A variante de produção conserva a decisão pré-existente.
        assertTrue(canEnterAtrioCommunity(true, EmailVerificationPolicyAccess.UNAVAILABLE))
        assertTrue(canEnterAtrioCommunity(false, EmailVerificationPolicyAccess.OPTIONAL))
    }
}
