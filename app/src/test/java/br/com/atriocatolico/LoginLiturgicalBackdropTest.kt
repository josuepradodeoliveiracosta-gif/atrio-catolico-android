package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season
import java.time.LocalDate
import org.junit.Assert.*
import org.junit.Test

class LoginLiturgicalBackdropTest {
    @Test fun allSixThemesAndFallback() {
        val expected = mapOf(
            Season.ADVENT to "advento",
            Season.CHRISTMAS to "natal",
            Season.ORDINARY to "tempo_comum",
            Season.LENT to "quaresma",
            Season.TRIDUUM to "triduo_pascal",
            Season.EASTER to "pascoa")
        expected.forEach { (season, name) ->
            assertEquals("login-vitrais/login_vitral_${name}.webp", loginVitralAssetName(season))
        }
        assertEquals(loginVitralAssetName(Season.ORDINARY), loginVitralAssetName(Season.ATRIO))
        assertEquals(6, expected.keys.map(::loginVitralPreviewResource).toSet().size)
        assertEquals(loginVitralPreviewResource(Season.ORDINARY), loginVitralPreviewResource(Season.ATRIO))
    }

    @Test fun calendarDatesUseExistingCivilCalendarAndNotFeastColor() {
        val dates = mapOf(
            "2026-11-28" to "tempo_comum", "2026-11-29" to "advento",
            "2026-12-25" to "natal", "2027-01-01" to "natal",
            "2027-01-11" to "tempo_comum", "2027-02-10" to "quaresma",
            "2027-03-21" to "quaresma", "2027-03-25" to "quaresma",
            "2027-03-26" to "triduo_pascal", "2027-03-27" to "triduo_pascal",
            "2027-03-28" to "pascoa", "2027-05-16" to "pascoa",
            "2027-05-17" to "tempo_comum")
        dates.forEach { (date, name) ->
            val day = LiturgicalCalendarBR.day(LocalDate.parse(date))
            assertEquals("login-vitrais/login_vitral_${name}.webp", loginVitralAssetName(day.season))
        }
    }

    @Test fun previewIsRestrictedToQaGeral() {
        assertTrue(loginVitraisEnabled("qaGeral"))
        listOf("release", "debug", "chatQa", "perfilQa", "otaPilot", "").forEach {
            assertFalse(loginVitraisEnabled(it))
        }
    }
}
