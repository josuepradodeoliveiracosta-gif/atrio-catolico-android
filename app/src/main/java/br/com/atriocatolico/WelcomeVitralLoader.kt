package br.com.atriocatolico

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.LocalContext
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import java.io.IOException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** A arte e a paleta só são publicadas juntas, após uma decodificação válida. */
internal data class WelcomeVitralFrame(val spec: WelcomeVitralSpec, val bitmap: ImageBitmap)

internal fun welcomeVitralSampleSize(
    sourceWidth: Int, sourceHeight: Int, targetWidth: Int, targetHeight: Int,
): Int {
    require(sourceWidth > 0 && sourceHeight > 0 && targetWidth > 0 && targetHeight > 0)
    var sample = 1
    while (sourceWidth / sample / 2 >= targetWidth &&
        sourceHeight / sample / 2 >= targetHeight) {
        sample *= 2
    }
    return sample
}

internal fun decodeWelcomeVitral(
    context: Context, spec: WelcomeVitralSpec, targetWidth: Int, targetHeight: Int,
): ImageBitmap? {
    if (targetWidth <= 0 || targetHeight <= 0) return null
    return try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        context.assets.open(spec.assetName).use { BitmapFactory.decodeStream(it, null, bounds) }
        // As seis artes verificadas têm 790 x 1800 px; rejeitar dimensões inesperadas.
        if (bounds.outWidth != 790 || bounds.outHeight != 1800) return null
        val options = BitmapFactory.Options().apply {
            inSampleSize = welcomeVitralSampleSize(bounds.outWidth, bounds.outHeight, targetWidth, targetHeight)
        }
        context.assets.open(spec.assetName).use {
            BitmapFactory.decodeStream(it, null, options)?.asImageBitmap()
        }
    } catch (_: IOException) {
        null
    } catch (_: IllegalArgumentException) {
        null
    } catch (_: OutOfMemoryError) {
        null
    }
}

/** Cache de uma única arte válida; acessado somente pela thread de composição.
 * Não guarda Activity, não recicla bitmaps ainda desenhados e não acumula seis artes.
 */
internal class WelcomeVitralCache {
    internal data class Key(val spec: WelcomeVitralSpec, val width: Int, val height: Int, val retry: Int)
    private var entry: Pair<Key, WelcomeVitralFrame>? = null
    fun get(key: Key): WelcomeVitralFrame? = entry?.takeIf { it.first == key }?.second
    fun put(key: Key, frame: WelcomeVitralFrame) { entry = key to frame }
}

internal val sharedWelcomeVitralCache = WelcomeVitralCache()

internal sealed interface WelcomeVitralLoadState {
    data object Loading : WelcomeVitralLoadState
    data object Unavailable : WelcomeVitralLoadState
    data class Ready(val frame: WelcomeVitralFrame) : WelcomeVitralLoadState
}

/** Distingue carregamento de falha real. A última arte válida sobrevive à navegação.
 * Chaves de tema, dimensões e tentativa impedem exibir um frame obsoleto.
 */
@Composable
internal fun rememberWelcomeVitralFrame(
    targetWidth: Int,
    targetHeight: Int,
    season: Season? = LocalLiturgicalDay.current.season,
    buildType: String = BuildConfig.BUILD_TYPE,
    retry: Int = 0,
    loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? = ::decodeWelcomeVitral,
    cache: WelcomeVitralCache? = if (loader == ::decodeWelcomeVitral) sharedWelcomeVitralCache else null,
): WelcomeVitralLoadState {
    val context = LocalContext.current.applicationContext
    val spec = WelcomeVitralPolicy.resolve(buildType, season) ?: return WelcomeVitralLoadState.Unavailable
    if (targetWidth <= 0 || targetHeight <= 0) return WelcomeVitralLoadState.Loading
    val cacheKey = WelcomeVitralCache.Key(spec, targetWidth, targetHeight, retry)
    return key(context, cacheKey, loader, cache) {
        val cached = cache?.get(cacheKey)
        val initial: WelcomeVitralLoadState = cached?.let { WelcomeVitralLoadState.Ready(it) }
            ?: WelcomeVitralLoadState.Loading
        val state by produceState(initialValue = initial) {
            if (cached == null) {
                val bitmap = withContext(Dispatchers.IO) {
                    loader(context, spec, targetWidth, targetHeight)
                }
                if (bitmap == null) {
                    value = WelcomeVitralLoadState.Unavailable
                } else {
                    val frame = WelcomeVitralFrame(spec, bitmap)
                    cache?.put(cacheKey, frame)
                    value = WelcomeVitralLoadState.Ready(frame)
                }
            }
        }
        state
    }
}
