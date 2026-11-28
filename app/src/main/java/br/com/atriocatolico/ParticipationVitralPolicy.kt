package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season
import kotlin.math.roundToInt

/** Participation uses the same approved solid palette and season as welcome.
 * A missing or invalid QA resource keeps the complete default presentation.
 */
internal object ParticipationVitralPolicy {
    // Fractions measured on the six approved 790 × 1800 WebP images.
    // The rectangle x=14%..86% is free of ornaments throughout these bands.
    fun readingRegion(season: Season?): ParticipationReadingRegion? = when (season) {
        Season.ADVENT, Season.ORDINARY -> ParticipationReadingRegion(0.18f, 0.75f)
        Season.CHRISTMAS, Season.EASTER -> ParticipationReadingRegion(0.18f, 0.65f)
        Season.LENT, Season.TRIDUUM -> ParticipationReadingRegion(0.18f, 0.70f)
        else -> null
    }

    fun resolve(buildType: String, season: Season?): WelcomeVitralSpec? {
        val palette = WelcomeVitralPolicy.resolve(buildType, season) ?: return null
        val name = when (season) {
            Season.ADVENT -> "advento"
            Season.CHRISTMAS -> "natal"
            Season.ORDINARY -> "tempo_comum"
            Season.LENT -> "quaresma"
            Season.TRIDUUM -> "triduo_pascal"
            Season.EASTER -> "pascoa"
            else -> return null
        }
        return palette.copy(assetName = "participacao-vitrais/participacao_vitral_${name}.webp")
    }
}

/** Keep both decorated ends at their original aspect ratio. Only the reading band
 * grows if the controls need extra height (e.g. font scale 200%). */
internal data class ParticipationReadingRegion(val start: Float, val end: Float) {
    fun vertical(natural: Int, content: Int, inset: Int): ParticipationVerticalGeometry {
        val top = (natural * start).roundToInt()
        val bottom = natural - (natural * end).roundToInt()
        val middle = maxOf(natural - top - bottom, content + 2 * inset)
        return ParticipationVerticalGeometry(top, middle, bottom, top + (middle - content) / 2)
    }
}

internal data class ParticipationVerticalGeometry(
    val top: Int, val middle: Int, val bottom: Int, val contentTop: Int,
) {
    val total: Int get() = top + middle + bottom
}
