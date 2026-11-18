package br.com.atriocatolico

import java.time.DayOfWeek
import java.time.LocalDate
import java.time.temporal.TemporalAdjusters

/**
 * Núcleo independente de Android, Firebase e rede para o WelcomeBanner 2.2.
 *
 * Esta camada resolve os tempos gerais do rito romano adotado no Brasil.
 * Solenidades transferidas, calendários diocesanos e padroeiros locais exigem
 * uma tabela de exceções validada antes de aparecer como celebração do dia.
 * Não infere o início real de uma Missa nem o horário da Vigília Pascal.
 */
internal enum class WelcomeSeason {
    ADVENT, CHRISTMAS, ORDINARY, LENT, TRIDUUM, EASTER
}

internal enum class WelcomeLiturgicalColor {
    PURPLE, WHITE, GREEN, RED, ROSE, NEUTRAL
}

internal enum class WelcomeObservance {
    EPIPHANY, BAPTISM_OF_THE_LORD, ASH_WEDNESDAY, LAETARE,
    PALM_SUNDAY, HOLY_THURSDAY, GOOD_FRIDAY, HOLY_SATURDAY,
    EASTER_SUNDAY, PENTECOST, GAUDETE, CHRISTMAS_DAY
}

internal data class WelcomeLiturgicalDay(
    val season: WelcomeSeason,
    val color: WelcomeLiturgicalColor,
    val observance: WelcomeObservance? = null
)

/** Exceções inseridas somente após conferência do diretório litúrgico aplicável. */
internal data class WelcomeVerifiedException(
    val color: WelcomeLiturgicalColor,
    val title: String
)

internal data class WelcomeLiturgicalResult(
    val day: WelcomeLiturgicalDay,
    val verifiedException: WelcomeVerifiedException? = null
) {
    val effectiveColor: WelcomeLiturgicalColor
        get() = verifiedException?.color ?: day.color
}

/**
 * Datas civis para apresentação visual, não uma agenda de celebrações.
 * Quinta-feira Santa identifica o dia; a Ceia do Senhor não é presumida iniciada.
 * No Sábado Santo, não se anuncia a Vigília a partir de um horário fixo.
 */
internal object WelcomeLiturgicalCalendar {
    /** Computus gregoriano de Meeus/Jones/Butcher. */
    fun easterSunday(year: Int): LocalDate {
        require(year in 1583..4099) { "Ano fora do intervalo gregoriano previsto." }
        val a = year % 19
        val b = year / 100
        val c = year % 100
        val d = b / 4
        val e = b % 4
        val f = (b + 8) / 25
        val g = (b - f + 1) / 3
        val h = (19 * a + b - d - g + 15) % 30
        val i = c / 4
        val k = c % 4
        val l = (32 + 2 * e + 2 * i - h - k + 7 * 30) % 7
        val m = (a + 11 * h + 22 * l) / 451
        val month = (h + l - 7 * m + 114) / 31
        val day = (h + l - 7 * m + 114) % 31 + 1
        return LocalDate.of(year, month, day)
    }

    /** O quarto domingo antes do Natal (27/11 a 03/12). */
    fun firstAdventSunday(year: Int): LocalDate =
        LocalDate.of(year, 12, 25).minusDays(28)
            .with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))

    /** No Brasil a Epifania é celebrada no domingo entre 02 e 08/01. */
    fun epiphanySunday(year: Int): LocalDate =
        LocalDate.of(year, 1, 2).with(TemporalAdjusters.nextOrSame(DayOfWeek.SUNDAY))

    /**
     * Se a Epifania ocorre em 07 ou 08/01, o Batismo do Senhor é na segunda;
     * nos demais anos, no domingo seguinte.
     */
    fun baptismOfTheLord(year: Int): LocalDate {
        val epiphany = epiphanySunday(year)
        return if (epiphany.dayOfMonth >= 7) epiphany.plusDays(1)
        else epiphany.plusWeeks(1)
    }

    fun day(date: LocalDate): WelcomeLiturgicalDay {
        val year = date.year
        val easter = easterSunday(year)
        val ashWednesday = easter.minusDays(46)
        val palmSunday = easter.minusDays(7)
        val holyThursday = easter.minusDays(3)
        val pentecost = easter.plusDays(49)
        val advent = firstAdventSunday(year)
        val baptism = baptismOfTheLord(year)
        val epiphany = epiphanySunday(year)

        val season = when {
            !date.isBefore(advent) && date.isBefore(LocalDate.of(year, 12, 25)) -> WelcomeSeason.ADVENT
            date.monthValue == 12 && date.dayOfMonth >= 25 -> WelcomeSeason.CHRISTMAS
            !date.isAfter(baptism) -> WelcomeSeason.CHRISTMAS
            !date.isBefore(ashWednesday) && date.isBefore(holyThursday.plusDays(1)) -> WelcomeSeason.LENT
            date == easter.minusDays(2) || date == easter.minusDays(1) -> WelcomeSeason.TRIDUUM
            !date.isBefore(easter) && !date.isAfter(pentecost) -> WelcomeSeason.EASTER
            else -> WelcomeSeason.ORDINARY
        }

        val observance = when (date) {
            LocalDate.of(year, 12, 25) -> WelcomeObservance.CHRISTMAS_DAY
            epiphany -> WelcomeObservance.EPIPHANY
            baptism -> WelcomeObservance.BAPTISM_OF_THE_LORD
            ashWednesday -> WelcomeObservance.ASH_WEDNESDAY
            ashWednesday.plusDays(25) -> WelcomeObservance.LAETARE
            palmSunday -> WelcomeObservance.PALM_SUNDAY
            holyThursday -> WelcomeObservance.HOLY_THURSDAY
            easter.minusDays(2) -> WelcomeObservance.GOOD_FRIDAY
            easter.minusDays(1) -> WelcomeObservance.HOLY_SATURDAY
            easter -> WelcomeObservance.EASTER_SUNDAY
            pentecost -> WelcomeObservance.PENTECOST
            advent.plusDays(14) -> WelcomeObservance.GAUDETE
            else -> null
        }

        val color = when (observance) {
            WelcomeObservance.GAUDETE, WelcomeObservance.LAETARE -> WelcomeLiturgicalColor.ROSE
            WelcomeObservance.PALM_SUNDAY, WelcomeObservance.GOOD_FRIDAY,
            WelcomeObservance.PENTECOST -> WelcomeLiturgicalColor.RED
            WelcomeObservance.HOLY_THURSDAY -> WelcomeLiturgicalColor.WHITE
            WelcomeObservance.HOLY_SATURDAY -> WelcomeLiturgicalColor.NEUTRAL
            else -> when (season) {
                WelcomeSeason.ADVENT, WelcomeSeason.LENT -> WelcomeLiturgicalColor.PURPLE
                WelcomeSeason.CHRISTMAS, WelcomeSeason.EASTER -> WelcomeLiturgicalColor.WHITE
                WelcomeSeason.ORDINARY -> WelcomeLiturgicalColor.GREEN
                WelcomeSeason.TRIDUUM -> WelcomeLiturgicalColor.NEUTRAL
            }
        }
        return WelcomeLiturgicalDay(season, color, observance)
    }

    fun resolve(
        date: LocalDate,
        verifiedExceptions: Map<LocalDate, WelcomeVerifiedException> = emptyMap()
    ): WelcomeLiturgicalResult =
        WelcomeLiturgicalResult(day(date), verifiedExceptions[date])
}
