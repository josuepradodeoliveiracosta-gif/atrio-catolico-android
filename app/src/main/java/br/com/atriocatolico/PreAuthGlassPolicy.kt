package br.com.atriocatolico

/** Shared pre-auth glass tokens. Never use these on a non-liturgical fallback.
 * Light tint 84% is conservative against even a completely black backdrop.
 * Dark tint is intended for login/registration after their existing dark scrim.
 * Neither token changes the authentication flow or the original artwork.
 */
internal object PreAuthGlassPolicy {
    const val LIGHT_ALPHA: Int = 214 // 214/255
    const val DARK_ALPHA: Int = 153 // 60%
    const val BLUR_RADIUS_DP: Int = 12
    const val MODAL_ALPHA: Int = 214 // Independent window: safe even over white.
    const val MODAL_BASE: Long = 0xFF211922L
    const val MODAL_TITLE: Long = 0xFFFFE4AAL
    const val MODAL_BODY: Long = 0xFFFFF5E6L
    const val MODAL_OUTLINE: Long = 0xFFD9B97BL
    fun modalSurface(): Long = (MODAL_BASE and 0x00FFFFFFL) or (MODAL_ALPHA.toLong() shl 24)
    fun canBlur(sdk: Int, hardwareAccelerated: Boolean, enabled: Boolean = true): Boolean =
        sdk >= 31 && hardwareAccelerated && enabled
    fun lightSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (LIGHT_ALPHA.toLong() shl 24)
    fun darkSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (DARK_ALPHA.toLong() shl 24)
}
