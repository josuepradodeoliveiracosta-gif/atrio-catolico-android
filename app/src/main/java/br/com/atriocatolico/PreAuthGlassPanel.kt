package br.com.atriocatolico

import android.os.Build
import android.app.ActivityManager
import android.content.Context
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.layout.LayoutCoordinates
import androidx.compose.ui.layout.positionInRoot
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.getValue
import androidx.compose.runtime.setValue
import androidx.compose.ui.layout.onGloballyPositioned
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.graphics.drawscope.DrawScope
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
    val readingRegion: ParticipationReadingRegion? = null,
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
    localScrim: Color = Color.Transparent,
    content: @Composable () -> Unit,
) {
    val context = LocalContext.current
    val lowRam = remember(context) {
        (context.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager)?.isLowRamDevice ?: true
    }
    var panelSize by remember { mutableStateOf(IntSize.Zero) }
    val useBlur = PreAuthGlassPolicy.withinBlurBudget(panelSize.width, panelSize.height, lowRam) &&
        backdrop != null && backdrop.viewport.width > 0 &&
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
        Box(Modifier.onSizeChanged { panelSize = it }) {
            if (useBlur && backdrop != null) {
                Canvas(
                    Modifier.matchParentSize()
                        .blur(PreAuthGlassPolicy.BLUR_RADIUS_DP.dp, BlurredEdgeTreatment.Rectangle)
                        .testTag("atrio-preauth-glass-blur"),
                ) {
                    val bitmap = backdrop.bitmap
                    drawRect(backdrop.baseColor)
                    val region = backdrop.readingRegion
                    if (region != null) {
                        drawParticipationArtwork(bitmap, backdrop.viewport, region, IntOffset.Zero - backdrop.panelOrigin)
                    } else {
                    val scale = backdrop.contentScale.computeScaleFactor(
                        Size(bitmap.width.toFloat(), bitmap.height.toFloat()),
                        Size(backdrop.viewport.width.toFloat(), backdrop.viewport.height.toFloat()),
                    )
                    val scaled = IntSize(
                        (bitmap.width * scale.scaleX).roundToInt().coerceAtLeast(1),
                        (bitmap.height * scale.scaleY).roundToInt().coerceAtLeast(1),
                    )
                    val origin = Alignment.TopCenter.align(scaled, backdrop.viewport, layoutDirection)
                    drawImage(
                        image = bitmap,
                        dstOffset = origin - backdrop.panelOrigin,
                        dstSize = scaled,
                        filterQuality = FilterQuality.Low,
                    )
                    }
                    if (backdrop.scrim.alpha > 0f) drawRect(backdrop.scrim)
                }
            }
            // Tint and all interactive content are on independent sharp layers.
            if (localScrim.alpha > 0f) Box(Modifier.matchParentSize().background(localScrim))
            Box(Modifier.matchParentSize().background(tint))
            content()
        }
    }
}

internal val PreAuthFormBaseColor = Color(PreAuthGlassPolicy.GLASS_BASE)
internal val PreAuthFormScrim = Color(PreAuthGlassPolicy.ART_SCRIM)

/** Single registration-derived appearance for welcome, participation, login
 * and registration. Background must already have the same art scrim; the
 * replay carries it exactly once, never on top of the already-dimmed image. */
@Composable
internal fun PreAuthStandardGlassPanel(
    backdrop: PreAuthGlassBackdrop?,
    modifier: Modifier = Modifier,
    paleArtwork: Boolean = false,
    content: @Composable () -> Unit,
) {
    PreAuthGlassPanel(
        modifier = modifier,
        backdrop = backdrop,
        tint = Color(PreAuthGlassPolicy.standardSurface()),
        localScrim = if (paleArtwork) Color(PreAuthGlassPolicy.PALE_ART_COMPENSATION) else Color.Transparent,
        contentColor = Color(PreAuthGlassPolicy.GLASS_BODY),
        shape = RoundedCornerShape(PreAuthGlassPolicy.GLASS_RADIUS_DP.dp),
        border = BorderStroke(PreAuthGlassPolicy.GLASS_BORDER_DP.dp,
            Color(PreAuthGlassPolicy.GLASS_OUTLINE).copy(alpha = PreAuthGlassPolicy.GLASS_BORDER_ALPHA)),
        content = content,
    )
}

@Composable
internal fun PreAuthFormArtwork(bitmap: ImageBitmap?, kind: String, season: String) {
    Box(Modifier.fillMaxSize().background(PreAuthFormBaseColor)
        .testTag("atrio-$kind-backdrop")) {
        bitmap?.let {
            Image(it, null, Modifier.fillMaxSize().testTag("atrio-$kind-vitral-$season"),
                alignment = Alignment.TopCenter, contentScale = ContentScale.Crop)
        }
        Box(Modifier.fillMaxSize().background(PreAuthFormScrim))
    }
}

/** Position in the same Compose root; update when scrolling or IME changes layout.
 * Keep no LayoutCoordinates reference after placement. */
internal data class PreAuthFormPlacement(val origin: IntOffset, val size: IntSize) {
    companion object {
        fun from(coordinates: LayoutCoordinates): PreAuthFormPlacement {
            val p = coordinates.positionInRoot()
            return PreAuthFormPlacement(IntOffset(p.x.roundToInt(),p.y.roundToInt()), coordinates.size)
        }
    }
}

@Composable
internal fun PreAuthFormPanel(
    modifier: Modifier,
    bitmap: ImageBitmap?,
    viewport: PreAuthFormPlacement?,
    fallbackColor: Color,
    fallbackInk: Color,
    useStandardGlass: Boolean,
    content: @Composable () -> Unit,
) {
    val shape = RoundedCornerShape(20.dp)
    if (!useStandardGlass) {
        Card(modifier = modifier, colors = CardDefaults.cardColors(
            containerColor = fallbackColor, contentColor = fallbackInk), shape = shape) { content() }
        return
    }
    var placement by remember { mutableStateOf<PreAuthFormPlacement?>(null) }
    val backdrop = if (bitmap != null && viewport != null) placement?.let {
        PreAuthGlassBackdrop(bitmap, viewport.size, it.origin - viewport.origin,
            PreAuthFormBaseColor, ContentScale.Crop, PreAuthFormScrim)
    } else null
    PreAuthStandardGlassPanel(
        modifier = modifier.testTag("atrio-preauth-form-glass")
            .onGloballyPositioned { placement = PreAuthFormPlacement.from(it) },
        backdrop = backdrop,
        content = content,
    )
}

/** Draw the identical three-band projection in the original participation
 * viewport and in the clipped glass replay. No stretched decorative ends and
 * no second bitmap; only the reading band grows when the measured content does. */
internal fun DrawScope.drawParticipationArtwork(
    bitmap: ImageBitmap,
    viewport: IntSize,
    region: ParticipationReadingRegion,
    offset: IntOffset = IntOffset.Zero,
) {
    val w = viewport.width
    val h = viewport.height
    if (w <= 0 || h <= 0) return
    val natural = (w * (1800f / 790f)).roundToInt()
    val geometry = region.vertical(natural, 0, 0)
    val sourceTop = (bitmap.height * region.start).roundToInt()
    val sourceEnd = (bitmap.height * region.end).roundToInt()
    val middle = h - geometry.top - geometry.bottom
    fun band(sy: Int, sh: Int, dy: Int, dh: Int) {
        if (sh > 0 && dh > 0) drawImage(
            image = bitmap,
            srcOffset = IntOffset(0, sy),
            srcSize = IntSize(bitmap.width, sh),
            dstOffset = offset + IntOffset(0, dy),
            dstSize = IntSize(w, dh),
            filterQuality = FilterQuality.Medium,
        )
    }
    band(0, sourceTop, 0, geometry.top)
    band(sourceTop, sourceEnd - sourceTop, geometry.top, middle)
    band(sourceEnd, bitmap.height - sourceEnd, geometry.top + middle, geometry.bottom)
}
