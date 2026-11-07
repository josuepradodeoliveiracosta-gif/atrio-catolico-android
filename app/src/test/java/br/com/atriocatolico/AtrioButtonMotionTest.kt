package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

class AtrioButtonMotionTest {
    @Test fun pressingEnabledButtonGentlyCompresses() {
        assertEquals(0.97f, atrioPressTargetScale(true, true, false), 0.0001f)
        assertEquals(1f, atrioPressTargetScale(false, true, false), 0.0001f)
    }

    @Test fun disabledButtonDoesNotCompress() {
        assertEquals(1f, atrioPressTargetScale(true, false, false), 0.0001f)
    }

    @Test fun reducedMotionAlwaysStaysStill() {
        assertEquals(1f, atrioPressTargetScale(true, true, true), 0.0001f)
    }
}
