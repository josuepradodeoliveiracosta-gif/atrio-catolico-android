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

    @Test fun cachedPolicyCannotUnlockQAAndErrorCannotBypassRules() {
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(true, CommunityRulesPolicy.VERSION, fromCache = true))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(true, CommunityRulesPolicy.VERSION, hasError = true))
        assertEquals(QaCommunityPolicyAccess.UNAVAILABLE,
            decide(null, null, fromCache = true, hasError = true))
    }
}
