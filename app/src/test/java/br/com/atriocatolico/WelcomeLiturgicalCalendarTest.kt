package br.com.atriocatolico

import java.time.LocalDate
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WelcomeLiturgicalCalendarTest {
    private fun date(value: String): LocalDate = LocalDate.parse(value)

    @Test fun pascoaEAdventoConferemComDatasConhecidas() {
        assertEquals(date("2026-04-05"), WelcomeLiturgicalCalendar.easterSunday(2026))
        assertEquals(date("2027-03-28"), WelcomeLiturgicalCalendar.easterSunday(2027))
        assertEquals(date("2028-04-16"), WelcomeLiturgicalCalendar.easterSunday(2028))
        assertEquals(date("2026-11-29"), WelcomeLiturgicalCalendar.firstAdventSunday(2026))
        assertEquals(date("2027-11-28"), WelcomeLiturgicalCalendar.firstAdventSunday(2027))
        assertEquals(date("2028-12-03"), WelcomeLiturgicalCalendar.firstAdventSunday(2028))
    }

    @Test fun batismoSegueRegraBrasileiraDaEpifaniaTransferida() {
        assertEquals(date("2024-01-07"), WelcomeLiturgicalCalendar.epiphanySunday(2024))
        assertEquals(date("2024-01-08"), WelcomeLiturgicalCalendar.baptismOfTheLord(2024))
        assertEquals(date("2023-01-08"), WelcomeLiturgicalCalendar.epiphanySunday(2023))
        assertEquals(date("2023-01-09"), WelcomeLiturgicalCalendar.baptismOfTheLord(2023))
        assertEquals(date("2026-01-11"), WelcomeLiturgicalCalendar.baptismOfTheLord(2026))
    }

    @Test fun transicoesDosTempos2026PreservamFronteiras() {
        assertEquals(WelcomeSeason.CHRISTMAS, WelcomeLiturgicalCalendar.day(date("2026-01-11")).season)
        assertEquals(WelcomeSeason.ORDINARY, WelcomeLiturgicalCalendar.day(date("2026-01-12")).season)
        assertEquals(WelcomeSeason.ORDINARY, WelcomeLiturgicalCalendar.day(date("2026-02-17")).season)
        assertEquals(WelcomeSeason.LENT, WelcomeLiturgicalCalendar.day(date("2026-02-18")).season)
        assertEquals(WelcomeSeason.LENT, WelcomeLiturgicalCalendar.day(date("2026-04-02")).season)
        assertEquals(WelcomeSeason.TRIDUUM, WelcomeLiturgicalCalendar.day(date("2026-04-03")).season)
        assertEquals(WelcomeSeason.TRIDUUM, WelcomeLiturgicalCalendar.day(date("2026-04-04")).season)
        assertEquals(WelcomeSeason.EASTER, WelcomeLiturgicalCalendar.day(date("2026-04-05")).season)
        assertEquals(WelcomeSeason.EASTER, WelcomeLiturgicalCalendar.day(date("2026-05-24")).season)
        assertEquals(WelcomeSeason.ORDINARY, WelcomeLiturgicalCalendar.day(date("2026-05-25")).season)
        assertEquals(WelcomeSeason.ORDINARY, WelcomeLiturgicalCalendar.day(date("2026-11-28")).season)
        assertEquals(WelcomeSeason.ADVENT, WelcomeLiturgicalCalendar.day(date("2026-11-29")).season)
        assertEquals(WelcomeSeason.ADVENT, WelcomeLiturgicalCalendar.day(date("2026-12-24")).season)
        assertEquals(WelcomeSeason.CHRISTMAS, WelcomeLiturgicalCalendar.day(date("2026-12-25")).season)
        assertEquals(WelcomeSeason.CHRISTMAS, WelcomeLiturgicalCalendar.day(date("2027-01-01")).season)
    }

    @Test fun celebracoesMovidasRecebemAcentosProprios() {
        val cases = listOf(
            Triple("2026-02-18", WelcomeObservance.ASH_WEDNESDAY, WelcomeLiturgicalColor.PURPLE),
            Triple("2026-03-15", WelcomeObservance.LAETARE, WelcomeLiturgicalColor.ROSE),
            Triple("2026-03-29", WelcomeObservance.PALM_SUNDAY, WelcomeLiturgicalColor.RED),
            Triple("2026-04-02", WelcomeObservance.HOLY_THURSDAY, WelcomeLiturgicalColor.WHITE),
            Triple("2026-04-03", WelcomeObservance.GOOD_FRIDAY, WelcomeLiturgicalColor.RED),
            Triple("2026-04-04", WelcomeObservance.HOLY_SATURDAY, WelcomeLiturgicalColor.NEUTRAL),
            Triple("2026-04-05", WelcomeObservance.EASTER_SUNDAY, WelcomeLiturgicalColor.WHITE),
            Triple("2026-05-24", WelcomeObservance.PENTECOST, WelcomeLiturgicalColor.RED),
            Triple("2026-12-13", WelcomeObservance.GAUDETE, WelcomeLiturgicalColor.ROSE),
            Triple("2026-12-25", WelcomeObservance.CHRISTMAS_DAY, WelcomeLiturgicalColor.WHITE)
        )
        cases.forEach { (day, celebration, color) ->
            val actual = WelcomeLiturgicalCalendar.day(date(day))
            assertEquals("Celebração em $day", celebration, actual.observance)
            assertEquals("Cor em $day", color, actual.color)
        }
    }

    @Test fun excecaoValidadaAlteraCorSemApagarTempoLiturgico() {
        val day = date("2026-06-04")
        val base = WelcomeLiturgicalCalendar.resolve(day)
        assertEquals(WelcomeSeason.ORDINARY, base.day.season)
        assertNull(base.verifiedException)
        assertEquals(WelcomeLiturgicalColor.GREEN, base.effectiveColor)

        val override = WelcomeVerifiedException(WelcomeLiturgicalColor.WHITE, "Celebração validada")
        val withOverride = WelcomeLiturgicalCalendar.resolve(day, mapOf(day to override))
        assertEquals(WelcomeSeason.ORDINARY, withOverride.day.season)
        assertEquals(WelcomeLiturgicalColor.WHITE, withOverride.effectiveColor)
        assertEquals("Celebração validada", withOverride.verifiedException?.title)
    }
}
