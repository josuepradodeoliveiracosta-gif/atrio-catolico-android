package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Assert.*
import org.junit.Test
import kotlin.math.pow

class ParticipationVitralPolicyTest {
    private val expected = mapOf(
        Season.ADVENT to "advento",
        Season.CHRISTMAS to "natal",
        Season.ORDINARY to "tempo_comum",
        Season.LENT to "quaresma",
        Season.TRIDUUM to "triduo_pascal",
        Season.EASTER to "pascoa",
    )

    @Test fun sixDistinctAssetsAndSameApprovedPalette() {
        val paths = mutableSetOf<String>()
        for ((season, name) in expected) {
            val welcome = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season))
            val participation = requireNotNull(ParticipationVitralPolicy.resolve("qaGeral", season))
            assertEquals("participacao-vitrais/participacao_vitral_${name}.webp", participation.assetName)
            assertEquals(welcome.copy(assetName = participation.assetName), participation)
            assertTrue(paths.add(participation.assetName))
        }
        assertEquals(6, paths.size)
    }

    @Test fun unknownSeasonAndOtherBuildsKeepDefault() {
        assertNull(ParticipationVitralPolicy.resolve("qaGeral", null))
        assertNull(ParticipationVitralPolicy.resolve("qaGeral", Season.ATRIO))
        for (build in listOf("release", "debug", "perfilQa", "chatQa", "otaPilot", "")) {
            for (season in Season.values()) assertNull(ParticipationVitralPolicy.resolve(build, season))
        }
    }

    @Test fun solidPairsMeetContrastTargetsForAllChoices() {
        for (season in expected.keys) {
            val p = requireNotNull(ParticipationVitralPolicy.resolve("qaGeral", season))
            assertTrue(contrast(p.title, p.readingSurface) >= 4.5)
            assertTrue(contrast(p.primary, p.onPrimary) >= 4.5)
            assertTrue(contrast(p.pressed, p.onPrimary) >= 4.5)
            assertTrue(contrast(p.outerFocus, p.readingSurface) >= 3.0)
            assertTrue(contrast(p.innerFocus, p.primary) >= 3.0)
        }
    }

    @Test fun readingGeometryKeepsOrnamentsAndCentersContent() {
        for (season in expected.keys) {
            val region = requireNotNull(ParticipationVitralPolicy.readingRegion(season))
            val normal = region.vertical(1800, 600, 16)
            assertEquals(1800, normal.total)
            assertTrue(normal.contentTop >= normal.top + 16)
            assertEquals(normal.middle / 2f,
                normal.contentTop - normal.top + 300f, 1f)
            val enlarged = region.vertical(1800, 1400, 16)
            assertEquals(normal.top, enlarged.top)
            assertEquals(normal.bottom, enlarged.bottom)
            assertEquals(1432, enlarged.middle)
            assertEquals(enlarged.top + 16, enlarged.contentTop)
            assertTrue(enlarged.total > normal.total)
        }
        assertNull(ParticipationVitralPolicy.readingRegion(Season.ATRIO))
    }

    private fun contrast(a: Long, b: Long): Double {
        fun lum(c: Long): Double {
            fun channel(shift: Int): Double {
                val x = ((c shr shift) and 255L).toDouble() / 255.0
                return if (x <= 0.04045) x / 12.92 else ((x + 0.055) / 1.055).pow(2.4)
            }
            return 0.2126 * channel(16) + 0.7152 * channel(8) + 0.0722 * channel(0)
        }
        return (maxOf(lum(a), lum(b)) + 0.05) / (minOf(lum(a), lum(b)) + 0.05)
    }
}
