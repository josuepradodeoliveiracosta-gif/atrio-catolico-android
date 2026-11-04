package br.com.atriocatolico

import android.media.MediaPlayer
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.widget.VideoView
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

private const val MAX_OPENING_DURATION_MS = 15_000L

/**
 * Full-screen, offline opening shown once per new MainActivity launch.
 * The 9:16 movie uses VideoView's aspect-preserving fit; never crop its content.
 *
 * The startup movie is purely visual and is not a Firebase loading indicator.
 * Authentication and the community UI start normally after playback or failure.
 * The bundled asset can be replaced independently at res/raw/abertura_atrio.mp4.
 */
@Composable
internal fun AtrioStartupVideo(activity: ComponentActivity, onFinished: () -> Unit) {
    val currentFinish by rememberUpdatedState(onFinished)
    var finished by remember { mutableStateOf(false) }
    val finishOnce: () -> Unit = {
        if (!finished) {
            finished = true
            currentFinish()
        }
    }

    val videoView = remember(activity) { VideoView(activity) }
    BackHandler(enabled = !finished) { finishOnce() }

    // Keep system bars hidden only during the video. Restore them for login/feed.
    DisposableEffect(activity) {
        val bars = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        bars.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        bars.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { bars.show(WindowInsetsCompat.Type.systemBars()) }
    }

    DisposableEffect(videoView, activity) {
        val handler = Handler(Looper.getMainLooper())
        val watchdog = Runnable { finishOnce() }
        var prepared = false
        var disposed = false

        videoView.setOnPreparedListener { media: MediaPlayer ->
            if (!disposed) {
                prepared = true
                media.isLooping = false
                // Never play loud audio unexpectedly when opening the app.
                media.setVolume(0f, 0f)
                if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                    videoView.start()
                }
            }
        }
        videoView.setOnCompletionListener { if (!disposed) finishOnce() }
        videoView.setOnErrorListener { _, _, _ ->
            if (!disposed) finishOnce()
            true
        }

        val lifecycleObserver = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> {
                    handler.removeCallbacks(watchdog)
                    handler.postDelayed(watchdog, MAX_OPENING_DURATION_MS)
                    if (prepared) videoView.start()
                }
                Lifecycle.Event.ON_PAUSE -> {
                    handler.removeCallbacks(watchdog)
                    if (prepared) videoView.pause()
                }
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(lifecycleObserver)
        // Local resource: works without internet, network permissions or a Worker.
        videoView.setVideoURI(
            Uri.parse("android.resource://${activity.packageName}/${R.raw.abertura_atrio}")
        )
        if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
            handler.postDelayed(watchdog, MAX_OPENING_DURATION_MS)
        }

        onDispose {
            disposed = true
            handler.removeCallbacks(watchdog)
            activity.lifecycle.removeObserver(lifecycleObserver)
            videoView.setOnPreparedListener(null)
            videoView.setOnCompletionListener(null)
            videoView.setOnErrorListener(null)
            videoView.stopPlayback()
        }
    }

    Box(Modifier.fillMaxSize().background(Paper).testTag("atrio-opening-fullscreen")) {
        AndroidView(
            factory = { videoView },
            modifier = Modifier.fillMaxSize().testTag("atrio-opening-video")
        )
        TextButton(
            onClick = finishOnce,
            modifier = Modifier.align(Alignment.BottomEnd)
                .navigationBarsPadding()
                .padding(16.dp)
                .heightIn(min = 48.dp)
                .testTag("atrio-opening-skip"),
            colors = ButtonDefaults.textButtonColors(contentColor = Wine)
        ) {
            Text("Pular")
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
