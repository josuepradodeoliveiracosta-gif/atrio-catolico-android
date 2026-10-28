package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PushRegistrationDiagnosticTest {
    @Test fun tokenProblemsIdentifyStageOne() {
        for (problem in listOf(
            PushRegistrationProblem.TOKEN_UNAVAILABLE,
            PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE,
            PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE,
            PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH
        )) assertTrue(pushRegistrationMessage(problem).startsWith("Etapa 1/3"))
    }

    @Test fun firestoreProblemsIdentifyStageTwo() {
        for (problem in listOf(
            PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED,
            PushRegistrationProblem.FIRESTORE_UNAVAILABLE,
            PushRegistrationProblem.FIRESTORE_WRITE_FAILED
        )) {
            val message = pushRegistrationMessage(problem)
            assertTrue(message.startsWith("Etapa 2/3"))
            assertTrue(message.contains("token FCM obtido"))
        }
    }

    @Test fun topicProblemIdentifiesThirdStageNotTokenOrFirestoreFailure() {
        val message = pushRegistrationMessage(PushRegistrationProblem.TOPIC_SUBSCRIPTION_FAILED)
        assertTrue(message.startsWith("Etapa 3/3"))
        assertTrue(message.contains("registrado no Firestore"))
        assertTrue(message.contains("comunicados"))
    }

    @Test fun sessionAndUnexpectedStateHaveNeutralFeedback() {
        assertTrue(pushRegistrationMessage(PushRegistrationProblem.SESSION_CHANGED).contains("sessão"))
        assertTrue(pushRegistrationMessage(null).contains("interrompido"))
    }

    @Test fun allMessagesExcludeRawSensitiveValues() {
        for (problem in PushRegistrationProblem.entries) {
            val message = pushRegistrationMessage(problem)
            assertFalse(message.isBlank())
            assertFalse(message.contains("Bearer "))
            assertFalse(message.contains("AIza"))
            assertFalse(message.contains("projects/"))
            assertFalse(message.contains("https://"))
        }
        assertEquals(9, PushRegistrationProblem.entries.size)
    }
}
