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
    @Test fun rodada46AceitaApenasPequenaDivergenciaFutura() {
        val sent = 100_000L
        for (skew in listOf(0L, 1L, 681L, 796L, 1_999L, 2_000L)) {
            assertNull(qaReceiptSignalProblem(true, 60, sent, sent - skew, true))
        }
        for (skew in listOf(2_001L, 60_000L)) {
            assertEquals(QaReceiptStage.CLOCK_FUTURE,
                qaReceiptSignalProblem(true, 60, sent, sent - skew, true))
        }
        assertEquals(QaReceiptStage.CLOCK_FUTURE,
            qaReceiptSignalProblem(true, 60, Long.MAX_VALUE, 1L, true))
        assertEquals(QaReceiptStage.CLOCK_FUTURE,
            qaReceiptSignalProblem(true, 60, sent, Long.MIN_VALUE, true))
    }

    @Test fun rodada46PreservaFormatoTtlEExpiracaoEmAmbasAsValidacoes() {
        val sent = 100_000L
        assertNull(qaReceiptSignalProblem(true, 60, sent, sent + 60_000, true))
        assertEquals(QaReceiptStage.EXPIRED,
            qaReceiptSignalProblem(true, 60, sent, sent + 60_001, true))
        assertNull(qaReceiptSignalProblem(true, 1, sent, sent + 1_000, true))
        assertEquals(QaReceiptStage.EXPIRED,
            qaReceiptSignalProblem(true, 1, sent, sent + 1_001, true))
        assertEquals(QaReceiptStage.TTL_REJECTED,
            qaReceiptSignalProblem(true, 0, sent, sent - 700, true))
        assertEquals(QaReceiptStage.TTL_REJECTED,
            qaReceiptSignalProblem(true, 61, sent, sent - 700, true))
        assertEquals(QaReceiptStage.SENT_TIME_MISSING,
            qaReceiptSignalProblem(true, 60, 0L, sent, true))
        assertEquals(QaReceiptStage.PAYLOAD_REJECTED,
            qaReceiptSignalProblem(false, 60, sent, sent - 700, true))
    }
}
