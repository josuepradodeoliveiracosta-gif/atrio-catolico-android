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
internal const val REGISTRATION_VITRAIS_QA_ENABLED = true
internal fun registrationVitraisEnabled(buildType: String): Boolean =
    REGISTRATION_VITRAIS_QA_ENABLED && buildType == "qaGeral"

internal fun registrationVitralAssetName(season: Season): String = "cadastro-vitrais/" + when (season) {
    Season.ADVENT -> "cadastro_vitral_advento.webp"
    Season.CHRISTMAS -> "cadastro_vitral_natal.webp"
    Season.LENT -> "cadastro_vitral_quaresma.webp"
    Season.TRIDUUM -> "cadastro_vitral_triduo_pascal.webp"
    Season.EASTER -> "cadastro_vitral_pascoa.webp"
    else -> "cadastro_vitral_tempo_comum.webp"
}

private fun decodeRegistrationVitral(context: Context, season: Season): ImageBitmap? = try {
    context.assets.open(registrationVitralAssetName(season)).use {
        BitmapFactory.decodeStream(it)?.asImageBitmap()
    }
} catch (_: Exception) { null }

@Composable
internal fun rememberRegistrationVitralBitmap(
    season: Season,
    loader: (Context, Season) -> ImageBitmap? = ::decodeRegistrationVitral,
): ImageBitmap? {
    val context = LocalContext.current
    return key(season, context, loader) {
        val bitmap by produceState<ImageBitmap?>(null) {
            val decoded = withContext(Dispatchers.IO) { loader(context, season) }
            withContext(Dispatchers.Main.immediate) {
                kotlinx.coroutines.currentCoroutineContext().ensureActive()
                value = decoded
            }
        }
        bitmap
    }
}

@Composable
internal fun RegistrationLiturgicalBackdrop(
    season: Season = LocalLiturgicalDay.current.season,
    loader: (Context, Season) -> ImageBitmap? = ::decodeRegistrationVitral,
) {
    val bitmap = rememberRegistrationVitralBitmap(season, loader)
    PreAuthFormArtwork(bitmap, "registration", season.name)
}
