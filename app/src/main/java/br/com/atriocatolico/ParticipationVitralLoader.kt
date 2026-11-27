package br.com.atriocatolico

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.ComponentActivity
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalContext
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

private tailrec fun Context.participationActivity(): ComponentActivity? = when (this) {
    is ComponentActivity -> this
    is ContextWrapper -> baseContext.participationActivity()
    else -> null
}

/** Reuse the existing local decoder, but resolve only participation resources.
 * State is scoped to the requested spec and dimensions; cancelled results cannot
 * publish into a newer composition. A successful frame is retained on resume.
 */
@Composable
internal fun rememberParticipationVitralFrame(
    width: Int,
    height: Int,
    season: Season?,
    buildType: String,
    loader: (Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? = ::decodeWelcomeVitral,
): WelcomeVitralFrame? {
    val spec = ParticipationVitralPolicy.resolve(buildType, season) ?: return null
    if (width <= 0 || height <= 0) return null
    val context = LocalContext.current
    return key(context, spec, width, height, loader) {
        var frame by remember { mutableStateOf<WelcomeVitralFrame?>(null) }
        var retry by remember { mutableStateOf(0) }
        DisposableEffect(context) {
            val lifecycle = context.participationActivity()?.lifecycle
            var paused = false
            val observer = LifecycleEventObserver { _, event ->
                when (event) {
                    Lifecycle.Event.ON_PAUSE -> paused = true
                    Lifecycle.Event.ON_RESUME -> {
                        if (paused && frame == null) retry += 1
                        paused = false
                    }
                    else -> Unit
                }
            }
            lifecycle?.addObserver(observer)
            onDispose { lifecycle?.removeObserver(observer) }
        }
        LaunchedEffect(retry) {
            val bitmap = withContext(Dispatchers.IO) {
                loader(context, spec, width, height)
            }
            frame = bitmap?.let { WelcomeVitralFrame(spec, it) }
        }
        frame
    }
}
