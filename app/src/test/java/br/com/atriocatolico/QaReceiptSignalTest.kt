package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class QaReceiptSignalTest {
    @Test fun preservaLimitesTemporaisDaRodada44() {
        val sent = 100000L
        assertNull(qaReceiptSignalProblem(true, 60, sent, sent))
        assertNull(qaReceiptSignalProblem(true, 60, sent, sent + 60000))
        assertEquals(QaReceiptStage.CLOCK_FUTURE, qaReceiptSignalProblem(true, 60, sent, sent - 1))
        assertEquals(QaReceiptStage.EXPIRED, qaReceiptSignalProblem(true, 60, sent, sent + 60001))
        assertEquals(QaReceiptStage.TTL_REJECTED, qaReceiptSignalProblem(true, 0, sent, sent))
        assertEquals(QaReceiptStage.TTL_REJECTED, qaReceiptSignalProblem(true, 61, sent, sent))
        assertEquals(QaReceiptStage.SENT_TIME_MISSING, qaReceiptSignalProblem(true, 60, 0, sent))
        assertEquals(QaReceiptStage.PAYLOAD_REJECTED, qaReceiptSignalProblem(false, 60, sent, sent))
    }
}
