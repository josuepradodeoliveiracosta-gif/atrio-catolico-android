package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Nenhum teste inicia Firebase ou contata o projeto QA remoto. */
class PerfilQaIdentityTest {
    private val pkg = "br.com.atriocatolico.perfilqa"
    private val project = "atrio-catolico-qa-perfil"
    private val app = "1:492511505084:android:17949b85935e25aedb7eb9"

    @Test fun acceptsOnlyExactQaIdentity() {
        assertTrue(perfilQaIdentityAllowed(pkg, pkg, project, app))
    }

    @Test fun deniesProductionPackageAndProject() {
        assertFalse(perfilQaIdentityAllowed("br.com.atriocatolico", pkg, project, app))
        assertFalse(perfilQaIdentityAllowed(pkg, "br.com.atriocatolico", project, app))
        assertFalse(perfilQaIdentityAllowed(pkg, pkg, "atrio-catolico", app))
    }

    @Test fun deniesChatQaIdentity() {
        assertFalse(perfilQaIdentityAllowed("br.com.atriocatolico.chatqa", pkg, project, app))
        assertFalse(perfilQaIdentityAllowed(pkg, pkg, "atrio-catolico-qa-geral", app))
    }

    @Test fun deniesMissingOrForeignFirebaseApplication() {
        assertFalse(perfilQaIdentityAllowed(pkg, pkg, project, null))
        assertFalse(perfilQaIdentityAllowed(pkg, pkg, project,
            "1:492511505084:android:app-id-de-outro-projeto"))
        assertFalse(perfilQaIdentityAllowed(pkg, pkg, null, app))
    }
}
