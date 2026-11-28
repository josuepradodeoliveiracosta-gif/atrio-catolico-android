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
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

/** A arte e a paleta só são publicadas juntas, após uma decodificação válida. */
internal data class WelcomeVitralFrame(val spec: WelcomeVitralSpec, val bitmap: ImageBitmap)

/** One successful frame, scoped to the authentication composition, never global.
 * A different spec, viewport, loader or retry cannot reuse the old bitmap.
 */
internal class WelcomeVitralVisitCache {
    private data class Entry(
        val context: Context, val width: Int, val height: Int, val retry: Int,
        val loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap?,
        val frame: WelcomeVitralFrame,
    )
    private var entry: Entry? = null

    fun get(context: Context, spec: WelcomeVitralSpec, width: Int, height: Int, retry: Int,
        loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap?): WelcomeVitralFrame? =
        entry?.takeIf {
            it.context === context && it.frame.spec == spec && it.width == width &&
                it.height == height && it.retry == retry && it.loader == loader
        }?.frame

    fun put(context: Context, width: Int, height: Int, retry: Int,
        loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap?, frame: WelcomeVitralFrame) {
        entry = Entry(context, width, height, retry, loader, frame)
    }
}

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

/**
 * Nulo = visual padrão completo. key cria uma nova célula de estado por tema,
 * dimensões e tentativa; a composição anterior é descartada e a cor antiga não
 * vaza para a arte nova. Sem rede, sem I/O na thread principal.
 */
@Composable
internal fun rememberWelcomeVitralFrame(
    targetWidth: Int,
    targetHeight: Int,
    season: Season? = LocalLiturgicalDay.current.season,
    buildType: String = BuildConfig.BUILD_TYPE,
    retry: Int = 0,
    loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? = ::decodeWelcomeVitral,
    visitCache: WelcomeVitralVisitCache? = null,
): WelcomeVitralFrame? {
    val context = LocalContext.current
    val spec = WelcomeVitralPolicy.resolve(buildType, season) ?: return null
    if (targetWidth <= 0 || targetHeight <= 0) return null
    return key(context, spec, targetWidth, targetHeight, retry, loader, visitCache) {
        val cached = visitCache?.get(context, spec, targetWidth, targetHeight, retry, loader)
        val frame by produceState<WelcomeVitralFrame?>(initialValue = cached) {
            if (cached == null) {
                val bitmap = withContext(Dispatchers.IO) {
                    loader(context, spec, targetWidth, targetHeight)
                }
                val decoded = bitmap?.let { WelcomeVitralFrame(spec, it) }
                withContext(Dispatchers.Main.immediate) {
                    ensureActive()
                    if (decoded != null) visitCache?.put(context, targetWidth, targetHeight, retry, loader, decoded)
                    value = decoded
                }
            }
        }
        frame
    }
}
