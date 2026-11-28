package br.com.atriocatolico

import android.os.Build
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.BlurredEdgeTreatment
import androidx.compose.ui.draw.blur
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.Shape
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import androidx.compose.ui.unit.dp
import kotlin.math.roundToInt

/** Original image and its placement relative to the panel. All dimensions are
 * pixels in the artwork viewport, not window or screen coordinates. No bitmap
 * is decoded, copied or cached here. */
internal data class PreAuthGlassBackdrop(
    val bitmap: ImageBitmap,
    val viewport: IntSize,
    val panelOrigin: IntOffset,
    val baseColor: Color,
    val contentScale: ContentScale = ContentScale.Fit,
    val scrim: Color = Color.Transparent,
)

/** Blur only the decorative replay of the artwork, never the content or the
 * surrounding artwork. On older/software renderers skip the replay entirely:
 * the translucent tint remains above the original image in the parent. */
@Composable
internal fun PreAuthGlassPanel(
    backdrop: PreAuthGlassBackdrop?,
    tint: Color,
    contentColor: Color,
    shape: Shape,
    border: BorderStroke,
    modifier: Modifier = Modifier,
    enableBlur: Boolean = true,
    content: @Composable () -> Unit,
) {
    val useBlur = backdrop != null && backdrop.viewport.width > 0 &&
        backdrop.viewport.height > 0 && PreAuthGlassPolicy.canBlur(
            Build.VERSION.SDK_INT, LocalView.current.isHardwareAccelerated, enableBlur)
    Surface(
        modifier = modifier,
        color = Color.Transparent,
        contentColor = contentColor,
        shape = shape,
        border = border,
        tonalElevation = 0.dp,
        shadowElevation = 0.dp,
    ) {
        Box {
            if (useBlur && backdrop != null) {
                Canvas(
                    Modifier.matchParentSize()
                        .blur(PreAuthGlassPolicy.BLUR_RADIUS_DP.dp, BlurredEdgeTreatment.Rectangle)
                        .testTag("atrio-preauth-glass-blur"),
                ) {
                    val bitmap = backdrop.bitmap
                    val scale = backdrop.contentScale.computeScaleFactor(
                        Size(bitmap.width.toFloat(), bitmap.height.toFloat()),
                        Size(backdrop.viewport.width.toFloat(), backdrop.viewport.height.toFloat()),
                    )
                    val scaled = IntSize(
                        (bitmap.width * scale.scaleX).roundToInt().coerceAtLeast(1),
                        (bitmap.height * scale.scaleY).roundToInt().coerceAtLeast(1),
                    )
                    val origin = Alignment.TopCenter.align(scaled, backdrop.viewport, layoutDirection)
                    drawRect(backdrop.baseColor)
                    drawImage(
                        image = bitmap,
                        dstOffset = origin - backdrop.panelOrigin,
                        dstSize = scaled,
                        filterQuality = FilterQuality.Low,
                    )
                    if (backdrop.scrim.alpha > 0f) drawRect(backdrop.scrim)
                }
            }
            // Tint and all interactive content are on independent sharp layers.
            Box(Modifier.matchParentSize().background(tint))
            content()
        }
    }
}
