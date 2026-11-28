package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.pow

class PreAuthGlassPolicyTest {
    private fun channel(c: Long, shift: Int) = ((c shr shift) and 255L).toDouble()
    private fun blend(tint: Long, behind: Long): Long {
        val alpha = channel(tint, 24) / 255.0
        var result = 0xFF000000L
        for (shift in listOf(16, 8, 0)) {
            val v = (channel(tint, shift) * alpha + channel(behind, shift) * (1-alpha)).toInt()
            result = result or (v.toLong() shl shift)
        }
        return result
    }
    private fun lum(c: Long): Double {
        fun linear(shift: Int): Double {
            val x = channel(c, shift)/255.0
            return if (x <= .04045) x/12.92 else ((x+.055)/1.055).pow(2.4)
        }
        return .2126*linear(16)+.7152*linear(8)+.0722*linear(0)
    }
    private fun contrast(a: Long,b: Long) = (maxOf(lum(a),lum(b))+.05)/(minOf(lum(a),lum(b))+.05)
    @Test fun modalTintReadableEvenWithoutWindowDimming() {
        val tint = PreAuthGlassPolicy.modalSurface()
        assertEquals(214L, tint shr 24)
        for (behind in listOf(0xFF000000L, 0xFFFFFFFFL)) {
            val surface = blend(tint, behind)
            assertTrue(contrast(PreAuthGlassPolicy.MODAL_TITLE, surface) >= 4.5)
            assertTrue(contrast(PreAuthGlassPolicy.MODAL_BODY, surface) >= 4.5)
            assertTrue(contrast(PreAuthGlassPolicy.MODAL_OUTLINE, surface) >= 3.0)
        }
    }
    @Test fun blurRequiresAndroid12AndHardwareAndOptIn() {
        for (sdk in 26..30) assertFalse(PreAuthGlassPolicy.canBlur(sdk, true))
        for (sdk in 31..35) {
            assertTrue(PreAuthGlassPolicy.canBlur(sdk, true))
            assertFalse(PreAuthGlassPolicy.canBlur(sdk, false))
            assertFalse(PreAuthGlassPolicy.canBlur(sdk, true, false))
        }
        assertEquals(12, PreAuthGlassPolicy.BLUR_RADIUS_DP)
    }
    @Test fun lightTintKeepsSixPalettesReadableEvenAgainstBlack() {
        val seasons = listOf(Season.ADVENT, Season.CHRISTMAS, Season.ORDINARY,
            Season.LENT, Season.TRIDUUM, Season.EASTER)
        for (season in seasons) {
            val p = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season))
            val tint = PreAuthGlassPolicy.lightSurface(p.readingSurface)
            assertEquals(214L, tint shr 24)
            for (behind in listOf(0xFF000000L,0xFFFFFFFFL,0xFF234538L)) {
                val surface = blend(tint,behind)
                assertTrue("title: $season", contrast(p.accent,surface)>=4.5)
                assertTrue("body: $season", contrast(p.body,surface)>=4.5)
                assertTrue("primary: $season", contrast(p.onPrimary,p.primary)>=4.5)
                assertTrue("pressed: $season", contrast(p.onPrimary,p.pressed)>=4.5)
            }
        }
    }
    @Test fun darkTintPreservesRegistrationContrastOverExistingScrim() {
        val tint = PreAuthGlassPolicy.darkSurface(0xFF211922)
        assertEquals(153L, tint shr 24)
        // Black 65% scrim limits any backdrop channel to 90 or less.
        for (behind in listOf(0xFF000000L,0xFF5A5A5AL)) {
            val surface = blend(tint,behind)
            for (ink in listOf(0xFFFFE4AAL,0xFFFFF5E6L,0xFFFFB4ABL))
                assertTrue(contrast(ink,surface)>=4.5)
            assertTrue(contrast(0xFFD9B97BL,surface)>=3.0)
        }
    }
}
