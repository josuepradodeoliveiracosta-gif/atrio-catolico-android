package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UserReportsReviewPolicyTest {
    private fun allowed(
        activeUid: String? = "founder",
        adminUid: String = "founder",
        reportId: String = "qa-synthetic-report",
        reportStatus: String? = "pending",
        visibleAndPending: Boolean = true,
        explicitlyConfirmed: Boolean = true,
        busy: Boolean = false
    ): Boolean = UserReportsReviewPolicy.canRegisterReview(
        activeUid,adminUid,reportId,reportStatus,
        visibleAndPending,explicitlyConfirmed,busy
    )

    @Test fun confirmedVisiblePendingReportMayRequestServerUpdate() {
        assertTrue(allowed())
    }

    @Test fun noReviewCanBeRequestedWithoutExplicitConfirmation() {
        assertFalse(allowed(explicitlyConfirmed = false))
    }

    @Test fun changedSessionOrEmptyIdentityAlwaysFails() {
        assertFalse(allowed(activeUid = "another"))
        assertFalse(allowed(activeUid = null))
        assertFalse(allowed(adminUid = ""))
        assertFalse(allowed(reportId = ""))
    }

    @Test fun reviewedUnknownOrHiddenReportCannotBeUpdated() {
        assertFalse(allowed(reportStatus = "reviewed"))
        assertFalse(allowed(reportStatus = "discarded"))
        assertFalse(allowed(reportStatus = null))
        assertFalse(allowed(visibleAndPending = false))
    }

    @Test fun asyncCallbackCanUpdateOnlyOriginalLiveSessionAndPage() {
        fun allowedAsync(
            activeUid: String? = "founder",
            sameAuthenticatedUser: Boolean = true,
            panelAttached: Boolean = true,
            samePageGeneration: Boolean = true,
            expectedUid: String = "founder"
        ) = UserReportsReviewPolicy.acceptsAsyncResult(
            expectedUid, activeUid, sameAuthenticatedUser,
            panelAttached, samePageGeneration
        )
        assertTrue(allowedAsync())
        assertFalse(allowedAsync(activeUid = "another"))
        assertFalse(allowedAsync(activeUid = null))
        assertFalse(allowedAsync(sameAuthenticatedUser = false))
        assertFalse(allowedAsync(panelAttached = false))
        assertFalse(allowedAsync(samePageGeneration = false))
        assertFalse(allowedAsync(expectedUid = ""))
        assertFalse(allowedAsync(expectedUid = "", activeUid = ""))
    }

    @Test fun inFlightOrFailedPageCannotSubmitReview() {
        assertFalse(allowed(busy = true))
    }
}
