package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
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
import androidx.compose.ui.layout.ContentScale
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
        val surface = palette?.let { Color(it.readingSurface) } ?: defaultBackground
        Column(
            Modifier.fillMaxSize().background(defaultBackground).verticalScroll(scroll)
                .testTag("atrio-participation-scroll"),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(
                Modifier.width(width).heightIn(min = maxOf(viewportHeight, if (frame != null) artHeight else 0.dp))
                    .background(defaultBackground),
                contentAlignment = Alignment.TopCenter,
            ) {
                // The artwork has no spoken semantics and never intercepts touch.
            if (frame != null) {
                Image(
                    bitmap = frame.bitmap,
                    contentDescription = null,
                    modifier = Modifier.width(width).height(artHeight)
                        .testTag("atrio-participation-season-" + frame.spec.assetName.substringAfterLast('/')),
                    contentScale = ContentScale.Fit,
                    alignment = Alignment.TopCenter,
                )
            }
            // Stable composition for controls even when the image or season changes.
            Column(
                Modifier.fillMaxWidth().padding(horizontal = 24.dp, vertical = 24.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                Column(
                    Modifier.widthIn(max = if (palette == null) 440.dp else 392.dp)
                        .fillMaxWidth()
                        .background(surface, RoundedCornerShape(14.dp))
                        .padding(horizontal = if (palette == null) 0.dp else 12.dp,
                            vertical = if (palette == null) 0.dp else 8.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp),
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
            }
            }
        }
    }
}
