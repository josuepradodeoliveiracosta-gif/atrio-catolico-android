package br.com.atriocatolico

/** Shared pre-auth glass tokens. Never use these on a non-liturgical fallback.
 * Light tint 65% uses dedicated reading ink for contrast even over black.
 * Dark tint is intended for login/registration after their existing dark scrim.
 * Neither token changes the authentication flow or the original artwork.
 */
internal object PreAuthGlassPolicy {
    const val LIGHT_ALPHA: Int = 166 // 65% tint, 35% artwork
    const val DARK_ALPHA: Int = 153 // 60%
    // Registration is the visual reference for all four pre-auth screens.
    const val ART_SCRIM: Long = 0xA6000000L // ~65% black on the whole artwork
    const val GLASS_BASE: Long = 0xFF211922L
    const val GLASS_TITLE: Long = 0xFFFFE4AAL
    const val GLASS_BODY: Long = 0xFFFFF5E6L
    const val GLASS_OUTLINE: Long = 0xFFD9B97BL
    const val GLASS_RADIUS_DP: Int = 20
    const val GLASS_BORDER_DP: Int = 1
    const val GLASS_BORDER_ALPHA: Float = .55f
    const val GLASS_PADDING_DP: Int = 16
    const val GLASS_GAP_DP: Int = 10
    // The participation reading band is only 72% of the artwork width.
    const val PARTICIPATION_HORIZONTAL_PADDING_DP: Int = 12
    fun standardSurface(): Long = darkSurface(GLASS_BASE)
    const val BLUR_RADIUS_DP: Int = 12
    // Bound the optional GPU layer even for scrollable forms and 200% fonts.
    const val MAX_BLUR_PIXELS: Long = 2_500_000L
    const val MAX_BLUR_EDGE: Int = 4096
    fun withinBlurBudget(width: Int, height: Int, lowRam: Boolean): Boolean =
        !lowRam && width in 1..MAX_BLUR_EDGE && height in 1..MAX_BLUR_EDGE &&
            width.toLong() * height.toLong() <= MAX_BLUR_PIXELS
    const val MODAL_ALPHA: Int = 214 // Independent window: safe even over white.
    const val MODAL_BASE: Long = GLASS_BASE
    const val MODAL_TITLE: Long = GLASS_TITLE
    const val MODAL_BODY: Long = GLASS_BODY
    const val MODAL_OUTLINE: Long = GLASS_OUTLINE
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
