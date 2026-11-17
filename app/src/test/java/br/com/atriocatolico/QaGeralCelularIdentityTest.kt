package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class QaGeralCelularIdentityTest {
    private val qaPackage = "br.com.atriocatolico.qageral.celular"
    private val fixtureProject = "atrio-catolico-qa-geral-ficticio"
    private val fixtureAppId = "1:000000000000:android:0000000000000000000000"

    @Test
    fun aceitaIdentidadeFicticiaExata() {
        assertTrue(qaGeralCelularFixtureMatches(qaPackage, fixtureProject, fixtureAppId))
    }

    @Test
    fun rejeitaDivergenciaEmCadaCampo() {
        assertFalse(qaGeralCelularFixtureMatches("$qaPackage.outro", fixtureProject, fixtureAppId))
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, "$fixtureProject-outro", fixtureAppId))
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, fixtureProject, fixtureAppId.dropLast(1) + "1"))
    }

    @Test
    fun rejeitaProducaoInclusiveComPacoteDoQaCelular() {
        val productionAppFixture = "1:111111111111:android:1111111111111111111111"
        assertFalse(qaGeralCelularFixtureMatches("br.com.atriocatolico", "atrio-catolico", productionAppFixture))
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, "atrio-catolico", productionAppFixture))
    }

    @Test
    fun rejeitaQaAnteriorInclusiveComPacoteDoQaCelular() {
        val oldQaProject = "atrio-catolico-qa-general"
        val oldQaAppId = "1:835727158563:android:618218ab4be326d75cb096"
        assertFalse(qaGeralCelularFixtureMatches("br.com.atriocatolico.qageral", oldQaProject, oldQaAppId))
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, oldQaProject, oldQaAppId))
    }

    @Test
    fun rejeitaOpcoesFirebaseAusentes() {
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, null, fixtureAppId))
        assertFalse(qaGeralCelularFixtureMatches(qaPackage, fixtureProject, null))
    }

    @Test
    fun metadadosDoBuildFicticioCasamComOValidadorDoApp() {
        val fixtureRequested = System.getenv("ATRIO_QA_GERAL_CELULAR_FICTICIO") == "1"
        assertEquals(fixtureRequested, BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO)
        if (fixtureRequested) {
            assertTrue(BuildConfig.ATRIO_QA_GERAL_REMOTE)
            assertFalse(BuildConfig.ATRIO_QA_GERAL_PUSH)
            assertTrue(
                qaGeralCelularFixtureMatches(
                    BuildConfig.APPLICATION_ID, BuildConfig.ATRIO_QA_GERAL_PROJECT_ID, BuildConfig.ATRIO_QA_GERAL_APP_ID
                )
            )
        }
    }
}
