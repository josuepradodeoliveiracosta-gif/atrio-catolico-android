package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season
import java.time.LocalDate
import java.time.ZonedDateTime
import kotlin.math.pow
import org.junit.Assert.*
import org.junit.Test

class WelcomeVitralPolicyTest {
    private val expected = mapOf(
        Season.ADVENT to ("advento" to 0xFF54266EL),
        Season.CHRISTMAS to ("natal" to 0xFF214477L),
        Season.ORDINARY to ("tempo_comum" to 0xFF235438L),
        Season.LENT to ("quaresma" to 0xFF62405FL),
        Season.TRIDUUM to ("triduo_pascal" to 0xFF7B2639L),
        Season.EASTER to ("pascoa" to 0xFF745014L),
    )

    @Test fun mapsExactlyTheSixReferenceThemesAndKeepsDefaultSeparate() {
        for ((season, pair) in expected) {
            val actual = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season))
            assertEquals("boas-vindas-vitrais/boas_vindas_vitral_${pair.first}.webp", actual.assetName)
            assertEquals(pair.second, actual.accent)
        }
        assertEquals(6, expected.keys.map { WelcomeVitralPolicy.resolve("qaGeral", it)?.assetName }.toSet().size)
        assertNull(WelcomeVitralPolicy.resolve("qaGeral", Season.ATRIO))
        assertNull(WelcomeVitralPolicy.resolve("qaGeral", null))
        for (build in listOf("release", "debug", "perfilQa", "chatQa", "otaPilot", "")) {
            for (season in Season.values()) assertNull(WelcomeVitralPolicy.resolve(build, season))
        }
    }

    @Test fun consumesExistingCalendarAndDoesNotSubstituteFeastColor() {
        val dates = mapOf(
            "2026-11-28" to Season.ORDINARY, "2026-11-29" to Season.ADVENT,
            "2026-12-25" to Season.CHRISTMAS, "2027-01-01" to Season.CHRISTMAS,
            "2027-01-11" to Season.ORDINARY, "2027-02-10" to Season.LENT,
            "2027-03-21" to Season.LENT, "2027-03-25" to Season.LENT,
            "2027-03-26" to Season.TRIDUUM, "2027-03-28" to Season.EASTER,
            "2027-05-16" to Season.EASTER, "2027-05-17" to Season.ORDINARY,
        )
        for ((date, season) in dates) {
            val day = LiturgicalCalendarBR.day(LocalDate.parse(date))
            assertEquals(WelcomeVitralPolicy.resolve("qaGeral", season),
                WelcomeVitralPolicy.resolve("qaGeral", day.season))
        }
        val boundary = ZonedDateTime.parse("2027-03-28T00:00:00-03:00[America/Fortaleza]")
        val before = boundary.minusSeconds(1)
        assertEquals(boundary, LiturgicalCalendarBR.nextChange(before))
        assertEquals(Season.TRIDUUM, LiturgicalCalendarBR.day(before.toLocalDate()).season)
        assertEquals(Season.EASTER, LiturgicalCalendarBR.day(boundary.toLocalDate()).season)
    }

    @Test fun provisionalSolidColorPairsMeetContrastTargets() {
        for (season in expected.keys) {
            val p = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season))
            assertTrue(contrast(p.title, p.readingSurface) >= 4.5)
            assertTrue(contrast(p.body, p.readingSurface) >= 4.5)
            assertTrue(contrast(p.primary, p.onPrimary) >= 4.5)
            assertTrue(contrast(p.pressed, p.onPrimary) >= 4.5)
            assertTrue(contrast(p.secondaryLabel, p.readingSurface) >= 4.5)
            assertTrue(contrast(p.secondaryOutline, p.readingSurface) >= 3.0)
            assertTrue(contrast(p.outerFocus, p.readingSurface) >= 3.0)
            assertTrue(contrast(p.innerFocus, p.primary) >= 3.0)
        }
    }

    private fun contrast(a: Long, b: Long): Double {
        fun luminance(color: Long): Double {
            fun channel(shift: Int): Double {
                val x = ((color shr shift) and 255L).toDouble() / 255.0
                return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }
        val x = luminance(a)
        val y = luminance(b)
        return (maxOf(x, y) + 0.05) / (minOf(x, y) + 0.05)
    }
}
