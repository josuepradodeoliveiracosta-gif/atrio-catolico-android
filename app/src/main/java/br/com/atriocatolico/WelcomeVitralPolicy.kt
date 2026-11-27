package br.com.atriocatolico

import br.com.atriocatolico.LiturgicalCalendarBR.Season

/**
 * Contrato de arte da tela anterior à autenticação, separado do banner interno.
 * Recursos limpos e isolados em src/qaGeral; integração em revisão e QA.
 */
internal data class WelcomeVitralSpec(
    val assetName: String,
    val accent: Long,
    val pressed: Long,
    val readingSurface: Long = 0xFFFFF9F1,
    val body: Long = 0xFF31272A,
    val onPrimary: Long = 0xFFFFFFFF,
) {
    val title: Long get() = accent
    val primary: Long get() = accent
    val secondaryOutline: Long get() = accent
    val secondaryLabel: Long get() = accent
    val outerFocus: Long get() = accent
    val innerFocus: Long get() = onPrimary
}

internal object WelcomeVitralPolicy {
    private fun spec(name: String, accent: Long, pressed: Long) =
        WelcomeVitralSpec("boas-vindas-vitrais/boas_vindas_vitral_${name}.webp", accent, pressed)

    private val themes = mapOf(
        Season.ADVENT to spec("advento", 0xFF54266E, 0xFF47205D),
        Season.CHRISTMAS to spec("natal", 0xFF214477, 0xFF1C3965),
        Season.ORDINARY to spec("tempo_comum", 0xFF235438, 0xFF1D472F),
        Season.LENT to spec("quaresma", 0xFF62405F, 0xFF533650),
        Season.TRIDUUM to spec("triduo_pascal", 0xFF7B2639, 0xFF682030),
        Season.EASTER to spec("pascoa", 0xFF745014, 0xFF624411),
    )

    /** Null representa o visual padrão íntegro, não um tema substituto. */
    fun resolve(buildType: String, season: Season?): WelcomeVitralSpec? =
        if (buildType == "qaGeral") themes[season] else null
}
