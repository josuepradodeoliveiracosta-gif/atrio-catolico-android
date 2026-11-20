package br.com.atriocatolico

import android.content.Context
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.view.WindowManager
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.safeDrawingPadding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

private const val MAX_OPENING_DURATION_MS = 15_000L
private const val STARTUP_PREFS = "atrio-startup-video"
private const val WATCHED_TO_END_KEY = "watched_to_end"

/**
 * Full-screen, offline opening shown on every new MainActivity launch.
 * Center-crop covers the viewport without distortion. A separate landscape edit
 * keeps the logo and title visible when the available space is wider than it is tall.
 *
 * The startup movie includes audio and is not a Firebase loading indicator.
 * The first successful viewing is mandatory. Later launches show a Skip button.
 * Authentication and the community UI start after playback, on a permitted skip,
 * or on media failure/timeout (which must not count as a completed viewing).
 * The portrait and landscape edits share the same Android resource ID.
 */
@Composable
internal fun AtrioStartupVideo(activity: ComponentActivity, onFinished: () -> Unit) {
    // O registro local permanece após atualizações, mas é apagado ao limpar os
    // dados/reinstalar (android:allowBackup=false no manifesto).
    val prefs = remember(activity) {
        activity.getSharedPreferences(STARTUP_PREFS, Context.MODE_PRIVATE)
    }
    val canSkip = remember(activity) {
        prefs.getBoolean(WATCHED_TO_END_KEY, false)
    }
    val currentFinish by rememberUpdatedState(onFinished)
    var finished by remember { mutableStateOf(false) }
    val finishOnce: () -> Unit = {
        if (!finished) {
            finished = true
            currentFinish()
        }
    }

    val videoView = remember(activity) { OpeningVideoTexture(activity) }
    // Voltar fecha o aplicativo; não dispensa a primeira visualização.
    // Uma nova abertura cria uma nova Activity e reinicia a apresentação.
    BackHandler(enabled = !finished) { activity.finish() }

    // Keep system bars hidden only during the video. Restore them for login/feed.
    DisposableEffect(activity) {
        val window = activity.window
        val bars = WindowInsetsControllerCompat(window, window.decorView)
        val previousBehavior = bars.systemBarsBehavior
        val previousCutout = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            window.attributes.layoutInDisplayCutoutMode.also {
                window.attributes = window.attributes.apply {
                    layoutInDisplayCutoutMode = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_ALWAYS
                    } else {
                        WindowManager.LayoutParams.LAYOUT_IN_DISPLAY_CUTOUT_MODE_SHORT_EDGES
                    }
                }
            }
        } else null
        WindowCompat.setDecorFitsSystemWindows(window, false)
        bars.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        bars.hide(WindowInsetsCompat.Type.systemBars())
        onDispose {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P && previousCutout != null) {
                window.attributes = window.attributes.apply { layoutInDisplayCutoutMode = previousCutout }
            }
            WindowCompat.setDecorFitsSystemWindows(window, true)
            bars.systemBarsBehavior = previousBehavior
            bars.show(WindowInsetsCompat.Type.systemBars())
        }
    }

    DisposableEffect(videoView, activity) {
        val handler = Handler(Looper.getMainLooper())
        val watchdog = Runnable { finishOnce() }
        videoView.onPlaybackComplete = {
            if (!finished) {
                // Registrar apenas o término natural: Pular, erro, timeout e
                // fechamento do app nunca marcam o primeiro vídeo como visto.
                // commit() confirma a gravação antes de navegar para o app.
                prefs.edit().putBoolean(WATCHED_TO_END_KEY, true).commit()
                finishOnce()
            }
        }
        videoView.onPlaybackError = finishOnce

        val lifecycleObserver = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    handler.removeCallbacks(watchdog)
                    handler.postDelayed(watchdog, MAX_OPENING_DURATION_MS)
                    videoView.setPlaying(true)
                }
                Lifecycle.Event.ON_PAUSE -> {
                    handler.removeCallbacks(watchdog)
                    videoView.setPlaying(false)
                }
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(lifecycleObserver)
        onDispose {
            handler.removeCallbacks(watchdog)
            activity.lifecycle.removeObserver(lifecycleObserver)
            videoView.dispose()
        }
    }

    Box(Modifier.fillMaxSize().background(Color(0xFF182830)).testTag("atrio-opening-fullscreen")) {
        AndroidView(
            factory = { videoView },
            modifier = Modifier.fillMaxSize().testTag("atrio-opening-video")
        )
        if (canSkip) {
            FilledTonalButton(
                onClick = finishOnce,
                modifier = Modifier.align(Alignment.BottomEnd)
                    .safeDrawingPadding()
                    .padding(16.dp)
                    .heightIn(min = 48.dp)
                    .testTag("atrio-opening-skip"),
                colors = ButtonDefaults.filledTonalButtonColors(
                    containerColor = Color(0xFF182830), contentColor = Color(0xFFFFEBC0)
                )
            ) {
                Text("Pular")
            }
        }
    }
}


/**
 * Compatibilidade com a chamada antiga em OnlineAtrioApp.
 * A abertura agora pertence exclusivamente ao início de MainActivity:
 * autenticar uma conta nunca deve exibir o vídeo uma segunda vez.
 */
@Composable
@Suppress("UNUSED_PARAMETER")
internal fun OpeningVideo(activity: ComponentActivity, authenticated: Boolean) = Unit
