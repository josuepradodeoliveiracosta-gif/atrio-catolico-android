package br.com.atriocatolico

import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.snap
import androidx.compose.animation.core.tween
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer

/**
 * Feedback visual para um botão JÁ existente.
 *
 * Não intercepta onClick, não altera o alvo de toque, não aguarda a rede e não
 * inventa estados de sucesso. O mesmo interactionSource precisa ser passado
 * ao Button/IconButton original para conservar ripple, foco e acessibilidade.
 */
internal fun atrioPressTargetScale(
    pressed: Boolean,
    enabled: Boolean,
    reducedMotion: Boolean,
    pressedScale: Float = 0.97f
): Float = if (pressed && enabled && !reducedMotion) pressedScale else 1f

@Composable
internal fun Modifier.atrioButtonPressMotion(
    interactionSource: MutableInteractionSource,
    enabled: Boolean = true,
    pressedScale: Float = 0.97f
): Modifier {
    val pressed by interactionSource.collectIsPressedAsState()
    val reducedMotion = AtrioMotion.reduced()
    val scale by animateFloatAsState(
        targetValue = atrioPressTargetScale(pressed, enabled, reducedMotion, pressedScale),
        animationSpec = if (reducedMotion) snap() else tween(160),
        label = "Pressão do botão"
    )
    // Transformação só visual: área clicável, semântica e testTag permanecem.
    return this.graphicsLayer {
        scaleX = scale
        scaleY = scale
    }
}
