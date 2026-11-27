package br.com.atriocatolico

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
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import kotlinx.coroutines.Dispatchers
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

// Artes horizontais já existentes: prévia exclusiva do QA, não são as artes do PDF.
internal fun loginVitralPreviewResource(season: Season): Int = when (season) {
    Season.ADVENT -> R.drawable.liturgy_advent
    Season.CHRISTMAS -> R.drawable.liturgy_christmas
    Season.LENT -> R.drawable.liturgy_lent
    Season.TRIDUUM -> R.drawable.liturgy_triduum
    Season.EASTER -> R.drawable.liturgy_easter
    else -> R.drawable.liturgy_ordinary
}

@Composable
internal fun LoginLiturgicalBackdrop() {
    val context = LocalContext.current
    val season = LocalLiturgicalDay.current.season
    Box(Modifier.fillMaxSize().background(Color(0xFF211922))) {
        key(season, context) {
            val bitmap by produceState<ImageBitmap?>(null) {
                value = withContext(Dispatchers.IO) {
                    val original = try {
                        context.assets.open(loginVitralAssetName(season)).use {
                            BitmapFactory.decodeStream(it)?.asImageBitmap()
                        }
                    } catch (_: Exception) { null }
                    original ?: try {
                        BitmapFactory.decodeResource(context.resources,
                            loginVitralPreviewResource(season))?.asImageBitmap()
                    } catch (_: Exception) { null }
                }
            }
            bitmap?.let {
                Image(bitmap = it, contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    alignment = Alignment.TopCenter, contentScale = ContentScale.Crop)
            }
        }
        // Scrim conservador para texto branco; o cartão mantém fundo opaco.
        Box(Modifier.fillMaxSize().background(Color.Black.copy(alpha = .65f)))
    }
}
