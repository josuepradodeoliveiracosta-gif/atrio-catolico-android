package br.com.atriocatolico

import android.provider.Settings
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp

/**
 * Metas de interação do guia visual v2.0. Uma duração de animação
 * NUNCA determina o tempo de espera por uma resposta remota.
 */
internal object AtrioMotion {
    const val TAB_MS = 220
    const val SAVE_MS = 180
    const val FORUM_MS = 240
    const val PUBLISH_MS = 220

    /** Respeita a escala de animação do Android, inclusive a opção Desativado. */
    @Composable
    fun reduced(): Boolean {
        val context = LocalContext.current
        return remember(context) {
            runCatching {
                Settings.Global.getFloat(
                    context.contentResolver, Settings.Global.ANIMATOR_DURATION_SCALE, 1f
                ) <= 0f
            }.getOrDefault(false)
        }
    }
}

internal object AtrioDimensions {
    val ScreenMargin = 16.dp
    val CardRadius = 16.dp
    val TouchTarget = 48.dp
    val SectionGap = 12.dp
}
