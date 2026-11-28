package br.com.atriocatolico

import android.content.Context
import android.graphics.BitmapFactory
import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.produceState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext

// Somente QA Geral; não ativar no release antes da homologação e das artes finais.
internal const val LOGIN_VITRAIS_QA_ENABLED = true
internal fun loginVitraisEnabled(buildType: String): Boolean =
    LOGIN_VITRAIS_QA_ENABLED && buildType == "qaGeral"

internal fun loginVitralAssetName(season: Season): String = "login-vitrais/" + when (season) {
    Season.ADVENT -> "login_vitral_advento.webp"
    Season.CHRISTMAS -> "login_vitral_natal.webp"
    Season.LENT -> "login_vitral_quaresma.webp"
    Season.TRIDUUM -> "login_vitral_triduo_pascal.webp"
    Season.EASTER -> "login_vitral_pascoa.webp"
    else -> "login_vitral_tempo_comum.webp"
}

internal fun decodeLoginVitral(context: Context, season: Season): ImageBitmap? = try {
    context.assets.open(loginVitralAssetName(season)).use {
        BitmapFactory.decodeStream(it)?.asImageBitmap()
    }
} catch (_: Exception) { null } catch (_: OutOfMemoryError) { null }

@Composable
internal fun rememberLoginVitralBitmap(
    season: Season,
    loader: (Context, Season) -> ImageBitmap? = ::decodeLoginVitral,
    cache: PreAuthFormArtCache? = null,
): ImageBitmap? {
    val context = LocalContext.current
    return key(season, context, loader, cache) {
        val kind = PreAuthFormKind.LOGIN
        val cached = cache?.get(context, season, kind, loader)
        val bitmap by produceState<ImageBitmap?>(cached) {
            val decoded = cached ?: if (cache != null) cache.load(context, season, kind, loader)
                else withContext(Dispatchers.IO) { loader(context, season) }
            withContext(Dispatchers.Main.immediate) {
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                value = decoded
            }
        }
        bitmap
    }
}

@Composable
internal fun LoginLiturgicalBackdrop(
    season: Season = LocalLiturgicalDay.current.season,
    loader: (Context, Season) -> ImageBitmap? = ::decodeLoginVitral,
) {
    val bitmap = rememberLoginVitralBitmap(season, loader)
    PreAuthFormArtwork(bitmap, "login", season.name)
}
