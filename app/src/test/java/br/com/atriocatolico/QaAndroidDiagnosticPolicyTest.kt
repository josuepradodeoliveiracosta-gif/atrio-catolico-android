package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class QaAndroidDiagnosticPolicyTest {
    @Test fun onlyIsolatedQaPackagesAllowed() {
        assertEquals("perfil_qa", QaAndroidDiagnosticPolicy.environment("perfilQa", "br.com.atriocatolico.perfilqa"))
        assertEquals("chat_qa", QaAndroidDiagnosticPolicy.environment("chatQa", "br.com.atriocatolico.chatqa"))
        assertEquals("qa_geral", QaAndroidDiagnosticPolicy.environment("qaGeral", "br.com.atriocatolico.qageral.celular"))
        assertEquals("qa_geral", QaAndroidDiagnosticPolicy.environment("qaGeral", "br.com.atriocatolico.qageral"))
        for (type in listOf("release", "debug", "otaPilot", "perfilQa", "chatQa", "qaGeral"))
            assertNull(QaAndroidDiagnosticPolicy.environment(type, "br.com.atriocatolico"))
        assertNull(QaAndroidDiagnosticPolicy.environment("perfilQa", "br.com.atriocatolico.chatqa"))
    }
    @Test fun projectIsolation() {
        assertTrue(QaAndroidDiagnosticPolicy.approvedProject("perfil_qa", "atrio-catolico-qa-perfil"))
        assertTrue(QaAndroidDiagnosticPolicy.approvedProject("chat_qa", "atrio-catolico-qa-geral"))
        assertTrue(QaAndroidDiagnosticPolicy.approvedProject("qa_geral", "atrio-catolico-qa-general"))
        for (env in listOf("perfil_qa", "chat_qa", "qa_geral", "production")) {
            assertFalse(QaAndroidDiagnosticPolicy.approvedProject(env, "atrio-catolico"))
            assertFalse(QaAndroidDiagnosticPolicy.approvedProject(env, null))
        }
        assertFalse(QaAndroidDiagnosticPolicy.approvedProject("chat_qa", "atrio-catolico-qa-general"))
    }
    @Test fun heapBounds() {
        assertEquals(50, QaAndroidDiagnosticPolicy.heapPercent(50, 100))
        assertEquals(0, QaAndroidDiagnosticPolicy.heapPercent(0, 100))
        assertEquals(100, QaAndroidDiagnosticPolicy.heapPercent(100, 100))
        assertNull(QaAndroidDiagnosticPolicy.heapPercent(-1, 100))
        assertNull(QaAndroidDiagnosticPolicy.heapPercent(101, 100))
        assertNull(QaAndroidDiagnosticPolicy.heapPercent(0, 0))
    }
    @Test fun openingBounded() {
        assertEquals(50L, QaAndroidDiagnosticPolicy.openingMillis(100, 150))
        assertNull(QaAndroidDiagnosticPolicy.openingMillis(100, 99))
        assertNull(QaAndroidDiagnosticPolicy.openingMillis(0, 120_001))
    }
    @Test fun exitsBounded() {
        val summary = QaAndroidDiagnosticPolicy.exits(listOf(
            QaAndroidDiagnosticPolicy.Exit.CRASH, QaAndroidDiagnosticPolicy.Exit.OTHER,
            QaAndroidDiagnosticPolicy.Exit.ANR, QaAndroidDiagnosticPolicy.Exit.OTHER,
            QaAndroidDiagnosticPolicy.Exit.CRASH, QaAndroidDiagnosticPolicy.Exit.CRASH))
        assertEquals(QaAndroidDiagnosticPolicy.ExitSummary(5, 2, 1), summary)
        assertEquals(QaAndroidDiagnosticPolicy.ExitSummary(0, 0, 0), QaAndroidDiagnosticPolicy.exits(emptyList()))
    }
}
