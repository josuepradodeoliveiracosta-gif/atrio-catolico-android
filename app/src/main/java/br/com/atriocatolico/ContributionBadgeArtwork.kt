package br.com.atriocatolico

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.scale
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.vector.PathParser
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics

private const val BadgeViewport = 64f
private val FrameGold = Color(0xFFF4D48F)
private val LevelInk = Color(0xFFFFF1CF)
private val LevelGround = Color(0xFF2B2026)
private val UnearnedFilter = ColorFilter.colorMatrix(ColorMatrix().apply { setToSaturation(0f) })

private fun badgePath(data: String): Path = PathParser().parsePathString(data).toPath()

private val LevelNumerals by lazy {
    listOf(
        "M29.6,50.3L32,48.5V57.5M29.5,57.5H34.5",
        "M29,50.5C29,47.5 35,47.5 35,50.4C35,52.4 31,54.4 29,57.5H35",
        "M29.1,49.3C30.8,47.6 35,48.1 35,50.3C35,51.8 33.7,52.8 31.8,52.8C34,52.8 35.2,53.8 35.2,55.3C35.2,57.8 31,58.6 28.8,56.7",
        "M33.3,57.5V48.5L28.3,54.7H35.8",
        "M35,48.5H29.6L29,52.4C30.2,51.9 31.6,51.8 32.9,52.2C36.8,53.5 35.4,59.6 28.8,56.9"
    ).map(::badgePath)
}

private val OuterTracery by lazy {
    badgePath("M11.6,51V26C11.6,16 19,8.5 32,4.6C45,8.5 52.4,16 52.4,26V51")
}

@Composable
internal fun ContributionBadgeArtwork(
    track: String,
    level: Int,
    earned: Boolean,
    description: String,
    modifier: Modifier
) {
    val asset = when (track) {
        "helpful" -> R.drawable.contribution_vitral_helpful
        "welcome" -> R.drawable.contribution_vitral_welcome
        else -> R.drawable.contribution_vitral_conversation
    }
    Box(modifier.semantics { contentDescription = description }) {
        Image(
            painter = painterResource(asset),
            contentDescription = null,
            modifier = Modifier.matchParentSize(),
            colorFilter = if (earned) null else UnearnedFilter,
            alpha = if (earned) 1f else .76f
        )
        Canvas(Modifier.matchParentSize()) {
            // The same coordinate system as the vectors, even in a non-square slot.
            val square = size.minDimension
            translate((size.width - square) / 2f, (size.height - square) / 2f) {
                scale(square / BadgeViewport, pivot = Offset.Zero) {
                    if (earned) drawOrnaments(level)
                    val center = Offset(32f, 53f)
                    drawCircle(if (earned) LevelGround else Color(0xFF3B3C41), 9.2f, center)
                    drawCircle(
                        if (earned) FrameGold else Color(0xFFD7D8DA), 8.5f, center,
                        style = Stroke(1.15f)
                    )
                    if (earned) {
                        drawPath(LevelNumerals[level - 1], LevelInk,
                            style = Stroke(width = 1.8f, cap = StrokeCap.Round, join = StrokeJoin.Round))
                    } else {
                        drawLine(Color(0xFFE9E9EB), Offset(29f, 53f), Offset(35f, 53f),
                            strokeWidth = 1.7f, cap = StrokeCap.Round)
                    }
                }
            }
        }
    }
}

private fun DrawScope.drawOrnaments(level: Int) {
    if (level >= 2) {
        drawFacet(13f, 23f, 1.9f)
        drawFacet(51f, 23f, 1.9f)
    }
    if (level >= 3) {
        drawFacet(14f, 47f, 2.1f)
        drawFacet(50f, 47f, 2.1f)
    }
    if (level >= 4) drawPath(OuterTracery, FrameGold, style = Stroke(.9f, cap = StrokeCap.Round))
    if (level >= 5) drawFacet(32f, 6f, 3.5f)
}

private fun DrawScope.drawFacet(x: Float, y: Float, radius: Float) {
    val facet = Path().apply {
        moveTo(x, y - radius)
        lineTo(x + radius * .72f, y)
        lineTo(x, y + radius)
        lineTo(x - radius * .72f, y)
        close()
    }
    drawPath(facet, LevelGround, style = Stroke(width = 2f, join = StrokeJoin.Round))
    drawPath(facet, FrameGold)
}
