package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
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

    @Test fun manualRefreshIsAvailableAfterRequestWithoutReopeningIt() {
        for (state in listOf(
            DeletionRequestState.REQUESTED,
            DeletionRequestState.PROCESSING,
            DeletionRequestState.COMPLETION_REPORTED,
            DeletionRequestState.REVIEW_REQUIRED
        )) {
            assertEquals("Atualizar andamento", deletionRequestRefreshLabel(state))
        }
        for (state in listOf(DeletionRequestState.ERROR,
                             DeletionRequestState.INDETERMINATE)) {
            assertEquals("Tentar novamente", deletionRequestRefreshLabel(state))
        }
        assertEquals(null, deletionRequestRefreshLabel(DeletionRequestState.CHECKING))
        assertEquals(null, deletionRequestRefreshLabel(DeletionRequestState.NOT_REQUESTED))
    }

    @Test fun administrativeDeletionQueueRequiresSameLiveSessionAndGeneration() {
        val trusted = { epoch: Int, liveEpoch: Int, sameUid: Boolean,
                        cache: Boolean, pending: Boolean, docs: Boolean ->
            trustedAdminDeletionQueueResponse(
                expectedEpoch = epoch, currentEpoch = liveEpoch,
                sameSession = sameUid, fromCache = cache,
                pendingWrites = pending, allDocumentsTrusted = docs
            )
        }
        assertTrue(trusted(3, 3, true, false, false, true))
        assertFalse(trusted(3, 4, true, false, false, true))
        assertFalse(trusted(3, 3, false, false, false, true))
        assertFalse(trusted(3, 3, true, true, false, true))
        assertFalse(trusted(3, 3, true, false, true, true))
        assertFalse(trusted(3, 3, true, false, false, false))
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
