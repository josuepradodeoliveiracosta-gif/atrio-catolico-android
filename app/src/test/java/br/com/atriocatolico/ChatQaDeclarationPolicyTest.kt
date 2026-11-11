package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatQaDeclarationPolicyTest {
    private val now = 1_700_000_000_000L
    @Test fun validRecordFromServerOnlyIsShownAsEligible() {
        assertTrue(QaChatDeclarationPolicy.eligible("declared_18_plus",18L,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
    }
    @Test fun wrongStatusMissingFieldsAndOldVersionNeverUnlockUi() {
        assertFalse(QaChatDeclarationPolicy.eligible(null,18L,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
        assertFalse(QaChatDeclarationPolicy.eligible("revoked",18L,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
        assertFalse(QaChatDeclarationPolicy.eligible("eligible",18L,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
        assertFalse(QaChatDeclarationPolicy.eligible("declared_18_plus",17L,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
        assertFalse(QaChatDeclarationPolicy.eligible("declared_18_plus",null,
            QaChatDeclarationPolicy.VERSION,now+1000L,now))
        assertFalse(QaChatDeclarationPolicy.eligible("declared_18_plus",18L,
            "2026-11-18plus-qa-v1",now+1000L,now))
    }
    @Test fun expirationAndMissingTimestampDoNotUnlockUi() {
        for(expiry in listOf<Long?>(null,now,now-1L,0L)) {
            assertFalse(QaChatDeclarationPolicy.eligible("declared_18_plus",18L,
                QaChatDeclarationPolicy.VERSION,expiry,now))
        }
    }
}
