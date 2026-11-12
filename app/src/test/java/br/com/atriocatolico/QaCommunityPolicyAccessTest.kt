package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

class QaCommunityPolicyAccessTest {
    private fun decide(
        enabled: Boolean?, version: String?,
        fromCache: Boolean = false, hasError: Boolean = false
    ) = qaCommunityPolicyFromServer(enabled, version, fromCache, hasError)

    @Test fun signedInQaRequiresPublishedPolicyFromServer() {
        assertEquals(
            QaCommunityPolicyAccess.REQUIRED,
            decide(true, CommunityRulesPolicy.VERSION)
        )
    }

    @Test fun missingPolicyAndDisabledOrOldVersionBlockAccess() {
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE, decide(null, null))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE, decide(false, CommunityRulesPolicy.VERSION))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE, decide(true, "wrong-version"))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE, decide(true, null))
    }

    @Test fun acceptedOnlyWhenUidConsentIsServerAcknowledged() {
        val current = CommunityRulesPolicy.VERSION
        assertEquals(true, qaCommunityConsentFromServer(current, true, false, false, false))
        assertEquals(false, qaCommunityConsentFromServer(null, true, false, false, false))
        assertEquals(false, qaCommunityConsentFromServer("wrong-version", true, false, false, false))
    }

    @Test fun cachedOrPendingOrFailedConsentCannotUnlockQa() {
        val current = CommunityRulesPolicy.VERSION
        assertEquals(false, qaCommunityConsentFromServer(current, true, true, false, false))
        assertEquals(false, qaCommunityConsentFromServer(current, true, false, true, false))
        assertEquals(false, qaCommunityConsentFromServer(current, true, false, false, true))
        assertEquals(false, qaCommunityConsentFromServer(current, true, true, true, true))
    }

    @Test fun cachedPolicyCannotUnlockQAAndErrorCannotBypassRules() {
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(true, CommunityRulesPolicy.VERSION, fromCache = true))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(true, CommunityRulesPolicy.VERSION, hasError = true))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(null, null, fromCache = true, hasError = true))
    }

    @Test fun consentMissingAcceptedAtMustNotUnlockQa() {
        assertEquals(false, qaCommunityConsentFromServer(
            CommunityRulesPolicy.VERSION, false, false, false, false))
        assertEquals(true, qaCommunityConsentFromServer(
            CommunityRulesPolicy.VERSION, true, false, false, false))
    }
}
