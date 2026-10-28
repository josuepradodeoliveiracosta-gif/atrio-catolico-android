package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class PushRegistrationDiagnosticTest {
    @Test fun tokenFailureAlwaysReportsStageOne() {
        for (issue in listOf(
            PushRegistrationProblem.TOKEN_UNAVAILABLE, PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE,
            PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE, PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH
        )) assertTrue(pushRegistrationMessage(issue).startsWith("Etapa 1/2"))
    }
    @Test fun firestoreFailureAlwaysReportsStageTwo() {
        for (issue in listOf(
            PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED, PushRegistrationProblem.FIRESTORE_UNAVAILABLE,
            PushRegistrationProblem.FIRESTORE_WRITE_FAILED
        )) {
            val result = pushRegistrationMessage(issue)
            assertTrue(result.startsWith("Etapa 2/2"))
            assertTrue(result.contains("token FCM obtido"))
        }
    }
    @Test fun neverExposeCredentialsInFeedback() {
        for (issue in PushRegistrationProblem.entries) {
            val result = pushRegistrationMessage(issue)
            assertFalse(result.isBlank())
            assertFalse(result.contains("Bearer "))
            assertFalse(result.contains("AIza"))
            assertFalse(result.contains("https://"))
            assertFalse(result.contains("projects/"))
        }
    }
    @Test fun neutralFeedbackAvailable() {
        assertTrue(pushRegistrationMessage(PushRegistrationProblem.SESSION_CHANGED).contains("sessão"))
        assertTrue(pushRegistrationMessage(null).contains("interrompido"))
        assertEquals(8, PushRegistrationProblem.entries.size)
    }
}
