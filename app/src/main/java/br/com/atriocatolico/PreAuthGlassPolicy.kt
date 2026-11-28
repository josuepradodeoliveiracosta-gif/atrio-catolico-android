package br.com.atriocatolico

/** Shared pre-auth glass tokens. Never use these on a non-liturgical fallback.
 * Light tint 84% is conservative against even a completely black backdrop.
 * Dark tint is intended for login/registration after their existing dark scrim.
 * Neither token changes the authentication flow or the original artwork.
 */
internal object PreAuthGlassPolicy {
    const val LIGHT_ALPHA: Int = 214 // 214/255
    const val DARK_ALPHA: Int = 153 // 60%
    fun lightSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (LIGHT_ALPHA.toLong() shl 24)
    fun darkSurface(opaque: Long): Long =
        (opaque and 0x00FFFFFFL) or (DARK_ALPHA.toLong() shl 24)
}
