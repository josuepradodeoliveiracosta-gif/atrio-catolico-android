package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

/** A UI só pode anunciar solicitação registrada após confirmação remota válida. */
class AccountDeletionRequestStateTest {
    @Test fun absentRequestIsEligibleForConfirmationOnly() {
        assertEquals(DeletionRequestState.NOT_REQUESTED,
            verifiedDeletionRequestState(false, null, null, false))
    }

    @Test fun serverConfirmedAndroidAndWebRequestsAreRecognized() {
        for (source in listOf("android", "web")) {
            assertEquals(DeletionRequestState.REQUESTED,
                verifiedDeletionRequestState(true, "requested", source, true))
        }
    }

    @Test fun subsequentAdministrativeStatesAreNeverMistakenForDeletionProof() {
        assertEquals(DeletionRequestState.PROCESSING,
            verifiedDeletionRequestState(true, "processing", "android", true))
        assertEquals(DeletionRequestState.COMPLETION_REPORTED,
            verifiedDeletionRequestState(true, "completed", "web", true))
        assertEquals(DeletionRequestState.REVIEW_REQUIRED,
            verifiedDeletionRequestState(true, "rejected", "android", true))
        assertEquals(DeletionRequestState.INDETERMINATE,
            verifiedDeletionRequestState(true, "completed", "invalid", true))
        assertEquals(DeletionRequestState.INDETERMINATE,
            verifiedDeletionRequestState(true, "processing", "web", false))
    }

    @Test fun incompleteOrUnrecognizedRecordsCannotBeTreatedAsReceivedOrAbsent() {
        for (state in listOf("", "unknown", "canceled", "processing-unknown")) {
            assertEquals(DeletionRequestState.INDETERMINATE,
                verifiedDeletionRequestState(true, state, "android", true))
        }
        assertEquals(DeletionRequestState.INDETERMINATE,
            verifiedDeletionRequestState(true, "requested", null, true))
        assertEquals(DeletionRequestState.INDETERMINATE,
            verifiedDeletionRequestState(true, "requested", "untrusted", true))
        assertEquals(DeletionRequestState.INDETERMINATE,
            verifiedDeletionRequestState(true, "requested", "android", false))
    }
}
