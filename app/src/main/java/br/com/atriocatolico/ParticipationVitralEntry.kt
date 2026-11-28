package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsFocusedAsState
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.layout.Layout
import androidx.compose.ui.graphics.FilterQuality
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.IntSize
import kotlin.math.roundToInt
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import br.com.atriocatolico.LiturgicalCalendarBR.Season

/** The original callbacks remain parameterless. No classification is collected. */
@Composable
internal fun ParticipationVitralEntry(
    onContinue: () -> Unit,
    onBack: () -> Unit,
    season: Season? = LocalLiturgicalDay.current.season,
    buildType: String = BuildConfig.BUILD_TYPE,
    loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? = ::decodeWelcomeVitral,
) {
    if (buildType != "qaGeral") {
        RegistrationParticipationDefault(onContinue, onBack)
        return
    }

    val dark = isSystemInDarkTheme()
    val defaultBackground = if (dark) Color(0xFF20171A) else Color(0xFFFAF5ED)
    val defaultTitle = if (dark) Color(0xFFFFB2C6) else Color(0xFF701333)
    val defaultOutline = if (dark) Color(0xFFE8BA62) else Color(0xFFA57926)
    val scroll = rememberScrollState()
    var leaving by remember { mutableStateOf(false) }
    val continueAction = {
        if (!leaving) {
            leaving = true
            onContinue()
        }
    }
    val backAction = {
        if (!leaving) {
            leaving = true
            onBack()
        }
    }

    BoxWithConstraints(
        Modifier.fillMaxSize().background(defaultBackground)
            .statusBarsPadding().navigationBarsPadding()
            .testTag("atrio-participation"),
        contentAlignment = Alignment.TopCenter,
    ) {
        val availableWidth = maxWidth.coerceAtMost(440.dp)
        val viewportHeight = maxHeight
        val ratio = 1800f / 790f
        val fittedWidth = availableWidth.coerceAtMost(viewportHeight / ratio)
        // Avoid squeezing controls on short screens; allow vertical scrolling instead.
        val width = if (fittedWidth >= 300.dp) fittedWidth else availableWidth
        val artHeight = width * ratio
        val density = LocalDensity.current
        val frame = rememberParticipationVitralFrame(
            with(density) { width.roundToPx() },
            with(density) { artHeight.roundToPx() },
            season, buildType, loader,
        )
        val palette = frame?.spec
        val title = palette?.let { Color(it.title) } ?: defaultTitle
        val outline = palette?.let { Color(it.secondaryOutline) } ?: defaultOutline
        val region = frame?.let { ParticipationVitralPolicy.readingRegion(season) }
        Column(
            Modifier.fillMaxSize().background(defaultBackground).verticalScroll(scroll)
                .testTag("atrio-participation-scroll"),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Layout(
                modifier = Modifier.width(width).background(defaultBackground),
                content = {
                    if (frame != null && region != null) {
                        // Decorative image: no spoken description or touch interception.
                        Canvas(Modifier.testTag("atrio-participation-season-" +
                            frame.spec.assetName.substringAfterLast('/'))) {
                            val w = size.width.roundToInt()
                            val h = size.height.roundToInt()
                            val natural = (w * ratio).roundToInt()
                            val geometry = region.vertical(natural, 0, 0)
                            val source = frame.bitmap
                            val sourceTop = (source.height * region.start).roundToInt()
                            val sourceEnd = (source.height * region.end).roundToInt()
                            val middle = h - geometry.top - geometry.bottom
                            fun band(sy: Int, sh: Int, dy: Int, dh: Int) {
                                if (sh > 0 && dh > 0) drawImage(
                                    image = source,
                                    srcOffset = IntOffset(0, sy),
                                    srcSize = IntSize(source.width, sh),
                                    dstOffset = IntOffset(0, dy),
                                    dstSize = IntSize(w, dh),
                                    filterQuality = FilterQuality.Medium,
                                )
                            }
                            band(0, sourceTop, 0, geometry.top)
                            band(sourceTop, sourceEnd - sourceTop, geometry.top, middle)
                            band(sourceEnd, source.height - sourceEnd,
                                geometry.top + middle, geometry.bottom)
                        }
                    }
                    // No solid card over the verified light reading band.
                    Column(
                        Modifier.fillMaxWidth().testTag("atrio-participation-reading"),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(if (region == null) 12.dp else 8.dp),
                    ) {
                    RegistrationCompactHeader(title, outline, backAction, enabled = !leaving)
                    Text(
                        "Como você quer participar?",
                        modifier = Modifier.fillMaxWidth(),
                        color = title, fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold,
                        textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineSmall,
                    )
                    listOf(
                        "Sou católico(a)",
                        "Quero conhecer melhor a fé católica",
                        "Nenhuma das opções se aplica a mim",
                    ).forEachIndexed { index, label ->
                        val interaction = remember { MutableInteractionSource() }
                        val pressed by interaction.collectIsPressedAsState()
                        val focused by interaction.collectIsFocusedAsState()
                        val button = palette?.let { Color(if (pressed) it.pressed else it.primary) }
                            ?: Color(0xFF701333)
                        val ink = palette?.let { Color(it.onPrimary) } ?: Color.White
                        Button(
                            onClick = continueAction,
                            enabled = !leaving,
                            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                                .testTag("atrio-participation-choice-$index"),
                            interactionSource = interaction,
                            colors = ButtonDefaults.buttonColors(containerColor = button, contentColor = ink),
                            border = if (palette != null && focused) BorderStroke(3.dp, Color(palette.innerFocus)) else null,
                            shape = RoundedCornerShape(14.dp),
                        ) { Text(label, textAlign = TextAlign.Center) }
                    }
                    }
                },
            ) { measurables, constraints ->
                val w = constraints.maxWidth
                val side = if (region == null) 24.dp.roundToPx()
                    else (w * 0.14f).roundToInt().coerceAtLeast(1)
                val readingWidth = (w - 2 * side).coerceAtLeast(1)
                val controls = measurables.last().measure(
                    Constraints(minWidth = readingWidth, maxWidth = readingWidth)
                )
                if (region == null || frame == null) {
                    val padding = 24.dp.roundToPx()
                    val height = maxOf(viewportHeight.roundToPx(), controls.height + 2 * padding)
                    layout(w, height) { controls.placeRelative((w - readingWidth) / 2, padding) }
                } else {
                    val natural = (w * ratio).roundToInt()
                    val geometry = region.vertical(natural, controls.height, 8.dp.roundToPx())
                    val art = measurables.first().measure(Constraints.fixed(w, geometry.total))
                    val height = maxOf(viewportHeight.roundToPx(), geometry.total)
                    val artTop = (height - geometry.total) / 2
                    layout(w, height) {
                        art.placeRelative(0, artTop)
                        controls.placeRelative((w - readingWidth) / 2, artTop + geometry.contentTop)
                    }
                }
            }
        }
    }
}
