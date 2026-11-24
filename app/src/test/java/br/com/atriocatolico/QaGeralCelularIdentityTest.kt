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

    @Test
    fun aceitaSomenteAIdentidadeFuncionalDoNovoPacote() {
        val project = "atrio-catolico-qa-general"
        val expectedAppId = "1:835727158563:android:0000000000000000000000"
        val legacyAppId = "1:835727158563:android:618218ab4be326d75cb096"
        assertTrue(qaGeralCelularFunctionalMatches(qaPackage, project, expectedAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches("br.com.atriocatolico.qageral", project, expectedAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, project, legacyAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, "atrio-catolico", expectedAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, fixtureProject, fixtureAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, null, expectedAppId, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, project, null, expectedAppId))
        assertFalse(qaGeralCelularFunctionalMatches(qaPackage, project, "", ""))
    }

    @Test
    fun metadadosDoBuildFuncionalCasamComOValidadorDoApp() {
        val requested = System.getenv("ATRIO_QA_GERAL_CELULAR_FUNCIONAL") == "1"
        assertEquals(requested, BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL)
        if (requested) {
            assertTrue(BuildConfig.ATRIO_QA_GERAL_REMOTE)
            assertFalse(BuildConfig.ATRIO_QA_GERAL_CELULAR_FICTICIO)
            assertFalse(BuildConfig.ATRIO_QA_GERAL_PUSH)
            assertTrue(
                qaGeralCelularFunctionalMatches(
                    BuildConfig.APPLICATION_ID, BuildConfig.ATRIO_QA_GERAL_PROJECT_ID, BuildConfig.ATRIO_QA_GERAL_APP_ID,
                    System.getenv("ATRIO_QA_GERAL_CELULAR_APP_ID").orEmpty()
                )
            )
        }
    }

    @Test
    fun aRodadaFisicaSoUsaIdentidadeRegistradaETls() {
        val project = "atrio-catolico-qa-general"
        val registeredAppId = "1:835727158563:android:4258e81cc0ccc4df5cb096"
        val host = "firestore.googleapis.com"
        assertTrue(qaGeralCelularRoundMatches(qaPackage, project, registeredAppId, host, true))
        assertFalse(qaGeralCelularRoundMatches(qaPackage, project,
            "1:835727158563:android:0000000000000000000000", host, true))
        assertFalse(qaGeralCelularRoundMatches(qaPackage, project, registeredAppId, host, false))
        assertFalse(qaGeralCelularRoundMatches(qaPackage, project, registeredAppId, "127.0.0.1:8089", true))
        assertFalse(qaGeralCelularRoundMatches(qaPackage, "atrio-catolico", registeredAppId, host, true))
        assertFalse(qaGeralCelularRoundMatches("br.com.atriocatolico", project, registeredAppId, host, true))
        if (System.getenv("ATRIO_QA_GERAL_CELULAR_RODADA_FIXTURE") == "1") {
            assertFalse(BuildConfig.ATRIO_QA_GERAL_CELULAR_RODADA)
        }
    }

    @Test
    fun cadastroPushFisicoSoAceitaAsDuasContasDeTesteVerificadas() {
        assertTrue(qaGeralPushIdentityMatches(
            "qa-nav-alice", "alice.navegacao@qa.invalid", true
        ))
        assertTrue(qaGeralPushIdentityMatches(
            "qa-nav-bob", "bob.navegacao@qa.invalid", true
        ))
        assertFalse(qaGeralPushIdentityMatches(
            "qa-nav-alice", "bob.navegacao@qa.invalid", true
        ))
        assertFalse(qaGeralPushIdentityMatches(
            "qa-nav-alice", "alice.navegacao@qa.invalid", false
        ))
        assertFalse(qaGeralPushIdentityMatches(
            "conta-de-fora", "pessoa@example.invalid", true
        ))
        assertFalse(qaGeralPushIdentityMatches(
            "qa-nav-bob", null, true
        ))
    }
}
