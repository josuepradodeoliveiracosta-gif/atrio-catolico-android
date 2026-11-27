package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Test

class WelcomeVitralLoaderTest {
    @Test fun samplesOnlyWhenBothDimensionsRemainSufficient() {
        assertEquals(1, welcomeVitralSampleSize(790, 1800, 790, 1800))
        assertEquals(1, welcomeVitralSampleSize(790, 1800, 400, 800))
        assertEquals(2, welcomeVitralSampleSize(790, 1800, 360, 800))
        assertEquals(4, welcomeVitralSampleSize(790, 1800, 190, 440))
        assertEquals(1, welcomeVitralSampleSize(790, 1800, 1080, 2400))
        assertEquals(1, welcomeVitralSampleSize(790, 1800, 100, 1000))
    }
    @Test(expected = IllegalArgumentException::class)
    fun rejectsInvalidDimensions() {
        welcomeVitralSampleSize(790, 1800, 0, 800)
    }
}
