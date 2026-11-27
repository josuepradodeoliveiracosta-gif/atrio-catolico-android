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

@Composable
internal fun WelcomeVitralEntry(
    onCreate: () -> Unit,
    onLogin: () -> Unit,
    season: Season? = LocalLiturgicalDay.current.season,
    buildType: String = BuildConfig.BUILD_TYPE,
    loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? = ::decodeWelcomeVitral,
    visitCache: WelcomeVitralVisitCache? = null,
) {
    if (WelcomeVitralPolicy.resolve(buildType, season) == null) {
        RegistrationWelcomeDefault(onCreate, onLogin)
        return
    }
    BoxWithConstraints(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
        val width = maxWidth.coerceAtMost(440.dp)
        val artHeight = width * (1800f / 790f)
        val density = LocalDensity.current
        val frame = rememberWelcomeVitralFrame(
            targetWidth = with(density) { width.roundToPx() },
            targetHeight = with(density) { artHeight.roundToPx() },
            season = season, buildType = buildType, loader = loader, visitCache = visitCache,
        )
        if (frame == null) RegistrationWelcomeDefault(onCreate, onLogin)
        else WelcomeVitralScreen(frame, onCreate, onLogin)
    }
}

@Composable
private fun WelcomeVitralScreen(frame: WelcomeVitralFrame, onCreate: () -> Unit, onLogin: () -> Unit) {
    val p = frame.spec
    val surface = Color(p.readingSurface)
    val accent = Color(p.accent)
    val ink = Color(p.body)
    val white = Color(p.onPrimary)
    val createInteraction = remember { MutableInteractionSource() }
    val loginInteraction = remember { MutableInteractionSource() }
    val createPressed by createInteraction.collectIsPressedAsState()
    val createFocused by createInteraction.collectIsFocusedAsState()
    val loginPressed by loginInteraction.collectIsPressedAsState()
    val loginFocused by loginInteraction.collectIsFocusedAsState()
    val scroll = rememberScrollState()
    val surround = if (isSystemInDarkTheme()) Color(0xFF20171A) else surface

    BoxWithConstraints(
        Modifier.fillMaxSize().background(surround).testTag("atrio-signup-welcome")
            .statusBarsPadding().navigationBarsPadding(),
        contentAlignment = Alignment.TopCenter,
    ) {
        val width = maxWidth.coerceAtMost(440.dp)
        val artHeight = width * (1800f / 790f)
        Column(Modifier.width(width).verticalScroll(scroll)) {
            Box(Modifier.fillMaxWidth().heightIn(min = artHeight).background(surface)
                .testTag("atrio-welcome-season-" + p.assetName.substringAfterLast('/'))) {
                Image(
                    bitmap = frame.bitmap, contentDescription = null,
                    modifier = Modifier.fillMaxWidth().height(artHeight).testTag("atrio-welcome-vitral"),
                    contentScale = ContentScale.Fit, alignment = Alignment.TopCenter,
                )
                Column(Modifier.fillMaxWidth()) {
                    Spacer(Modifier.height(artHeight * 0.325f))
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(horizontal = 20.dp),
                        color = surface, contentColor = ink, shape = RoundedCornerShape(18.dp),
                    ) {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 16.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(12.dp),
                        ) {
                            Text("Átrio Católico", fontFamily = FontFamily.Serif,
                                fontWeight = FontWeight.Bold, color = accent,
                                textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineLarge)
                            Text("Boas-vindas!", color = accent, fontWeight = FontWeight.SemiBold,
                                textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineSmall)
                            Text("Aprenda mais sobre a fé católica, converse com respeito e viva a comunhão em comunidade.",
                                color = ink, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge)
                            Button(
                                onClick = onCreate,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("atrio-welcome-create"),
                                interactionSource = createInteraction,
                                colors = ButtonDefaults.buttonColors(
                                    containerColor = Color(if (createPressed) p.pressed else p.primary),
                                    contentColor = white),
                                border = if (createFocused) BorderStroke(3.dp, white) else null,
                                shape = RoundedCornerShape(14.dp),
                            ) { Text("Criar conta", textAlign = TextAlign.Center) }
                            OutlinedButton(
                                onClick = onLogin,
                                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag("atrio-welcome-login"),
                                interactionSource = loginInteraction,
                                colors = ButtonDefaults.outlinedButtonColors(
                                    containerColor = if (loginPressed) Color(p.pressed) else surface,
                                    contentColor = if (loginPressed) white else accent),
                                border = BorderStroke(if (loginFocused) 3.dp else 1.dp, accent),
                                shape = RoundedCornerShape(14.dp),
                            ) { Text("Entrar", textAlign = TextAlign.Center) }
                        }
                    }
                    Spacer(Modifier.height(24.dp))
                }
            }
        }
    }
}
