package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OpeningVideoCoverTest {
    @Test fun portraitFillsTallAndSquareScreens() {
        assertCover(1080, 1920, 720, 1280)
        assertCover(1080, 2520, 720, 1280)
        assertCover(1080, 1080, 720, 1280)
    }

    @Test fun landscapeFillsWideAndTabletScreens() {
        assertCover(2400, 1080, 1024, 576)
        assertCover(1600, 1200, 1024, 576)
    }

    @Test fun waitsForValidDimensionsBeforeScaling() {
        assertEquals(1f to 1f, openingCoverScale(0, 100, 720, 1280))
        assertEquals(1f to 1f, openingCoverScale(100, 100, 0, 0))
    }

    private fun assertCover(w: Int, h: Int, videoW: Int, videoH: Int) {
        val (scaleX, scaleY) = openingCoverScale(w, h, videoW, videoH)
        assertTrue("Neither dimension should leave margins", scaleX >= 1f && scaleY >= 1f)
        assertEquals("Only one dimension should be cropped", 1f, minOf(scaleX, scaleY), 0.0001f)
        assertEquals("The video aspect ratio must be preserved",
            videoW.toFloat() / videoH, (w * scaleX) / (h * scaleY), 0.0001f)
    }
}
