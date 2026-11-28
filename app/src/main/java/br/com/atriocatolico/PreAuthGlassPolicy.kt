package br.com.atriocatolico

/** Shared pre-auth glass tokens. Never use these on a non-liturgical fallback.
 * Light tint 65% uses dedicated reading ink for contrast even over black.
 * Dark tint is intended for login/registration after their existing dark scrim.
 * Neither token changes the authentication flow or the original artwork.
 */
internal object PreAuthGlassPolicy {
    const val LIGHT_ALPHA: Int = 166 // 65% tint, 35% artwork
    const val DARK_ALPHA: Int = 153 // 60%
    // Only inside entrance panels: preserve all ornament pixels outside.
    const val ENTRANCE_SCRIM: Long = 0x59000000L // 35% black
    const val ENTRANCE_BASE: Long = 0xFF211922L
    const val ENTRANCE_TITLE: Long = 0xFFFFE4AAL
    const val ENTRANCE_BODY: Long = 0xFFFFF5E6L
    const val ENTRANCE_OUTLINE: Long = 0xFFD9B97BL
    const val BLUR_RADIUS_DP: Int = 12
    // Bound the optional GPU layer even for scrollable forms and 200% fonts.
    const val MAX_BLUR_PIXELS: Long = 2_500_000L
    const val MAX_BLUR_EDGE: Int = 4096
    fun withinBlurBudget(width: Int, height: Int, lowRam: Boolean): Boolean =
        !lowRam && width in 1..MAX_BLUR_EDGE && height in 1..MAX_BLUR_EDGE &&
            width.toLong() * height.toLong() <= MAX_BLUR_PIXELS
    const val MODAL_ALPHA: Int = 214 // Independent window: safe even over white.
    const val MODAL_BASE: Long = 0xFF211922L
    const val MODAL_TITLE: Long = 0xFFFFE4AAL
    const val MODAL_BODY: Long = 0xFFFFF5E6L
    const val MODAL_OUTLINE: Long = 0xFFD9B97BL
    fun modalSurface(): Long = (MODAL_BASE and 0x00FFFFFFL) or (MODAL_ALPHA.toLong() shl 24)
    fun canBlur(sdk: Int, hardwareAccelerated: Boolean, enabled: Boolean = true): Boolean =
        sdk >= 31 && hardwareAccelerated && enabled
    // Preserve the seasonal hue while increasing contrast; primary buttons retain
    // the original palette, and the shared participation palette is unchanged.
    fun lightReadingAccent(opaque: Long): Long {
        var result = 0xFF000000L
        for (shift in listOf(16, 8, 0)) {
            val channel = (opaque shr shift) and 255L
            result = result or (((channel * 3L) / 5L) shl shift)
        }
        return result
    }
    fun lightSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (LIGHT_ALPHA.toLong() shl 24)
    fun darkSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (DARK_ALPHA.toLong() shl 24)
}
