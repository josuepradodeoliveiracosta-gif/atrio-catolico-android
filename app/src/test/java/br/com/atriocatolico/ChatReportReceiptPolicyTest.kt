package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatReportReceiptPolicyTest {
    private fun receipt(
        fromCache: Boolean = false,
        pendingWrites: Boolean = false,
        reporterUid: String? = "reporter",
        expectedReporterUid: String = "reporter",
        conversationId: String? = "room",
        expectedConversationId: String = "room",
        messageId: String? = "message",
        expectedMessageId: String = "message"
    ): Boolean = ChatReportReceiptPolicy.matchesConfirmedOwnReport(
        fromCache,pendingWrites,reporterUid,expectedReporterUid,
        conversationId,expectedConversationId,messageId,expectedMessageId)

    @Test fun freshExactOwnReportCanBeRecognized() {
        assertTrue(receipt())
    }
    @Test fun cacheOrPendingWriteCannotBeMistakenForServerReceipt() {
        assertFalse(receipt(fromCache=true))
        assertFalse(receipt(pendingWrites=true))
    }
    @Test fun differentReporterConversationOrMessageCannotBeClaimed() {
        assertFalse(receipt(reporterUid="other"))
        assertFalse(receipt(conversationId="another-room"))
        assertFalse(receipt(messageId="another-message"))
        assertFalse(receipt(reporterUid=null))
    }
    @Test fun missingExpectedIdentityNeverConfirmsAReceipt() {
        assertFalse(receipt(expectedReporterUid=""))
        assertFalse(receipt(expectedConversationId=""))
        assertFalse(receipt(expectedMessageId=""))
    }
}
