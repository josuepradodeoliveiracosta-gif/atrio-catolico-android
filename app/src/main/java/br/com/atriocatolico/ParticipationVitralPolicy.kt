package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season

/** Participation uses the same approved solid palette and season as welcome.
 * A missing or invalid QA resource keeps the complete default presentation.
 */
internal object ParticipationVitralPolicy {
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
