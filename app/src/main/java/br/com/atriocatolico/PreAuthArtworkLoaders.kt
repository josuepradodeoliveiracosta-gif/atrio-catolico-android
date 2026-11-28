package br.com.atriocatolico

import android.content.Context
import androidx.compose.ui.graphics.ImageBitmap
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

internal enum class PreAuthFormKind { LOGIN, REGISTRATION }

/** Only local image decoders; this seam allows deterministic slow/missing-art tests. */
internal data class PreAuthArtworkLoaders(
    val entrance: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap?,
    val login: (Context, Season) -> ImageBitmap?,
    val registration: (Context, Season) -> ImageBitmap?,
) {
    fun form(kind: PreAuthFormKind) = if (kind == PreAuthFormKind.LOGIN) login else registration
    companion object {
        val Default = PreAuthArtworkLoaders(::decodeWelcomeVitral, ::decodeLoginVitral, ::decodeRegistrationVitral)
    }
}

/** One successful form image per auth composition, never process-global.
 * Cache and publication are main-confined. The mutex prevents concurrent decode
 * of a speculative and a requested image. Cancellation does not publish stale art.
 */
internal class PreAuthFormArtCache {
    private data class Entry(val context: Context, val season: Season, val kind: PreAuthFormKind,
        val loader: (Context, Season) -> ImageBitmap?, val bitmap: ImageBitmap)
    private var entry: Entry? = null
    private val mutex = Mutex()

    fun get(context: Context, season: Season, kind: PreAuthFormKind,
        loader: (Context, Season) -> ImageBitmap?): ImageBitmap? =
        entry?.takeIf { it.context === context && it.season == season &&
            it.kind == kind && it.loader == loader }?.bitmap

    suspend fun load(context: Context, season: Season, kind: PreAuthFormKind,
        loader: (Context, Season) -> ImageBitmap?): ImageBitmap? =
        withContext(Dispatchers.Main.immediate) {
            mutex.withLock {
                get(context, season, kind, loader)?.let { return@withLock it }
                entry = null
                val decoded = withContext(Dispatchers.IO) { loader(context, season) }
                ensureActive()
                if (decoded != null) entry = Entry(context, season, kind, loader, decoded)
                decoded
            }
        }
}
