package br.com.atriocatolico

import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Movie
import android.os.Handler
import android.os.Looper
import android.os.SystemClock
import android.view.View
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
import androidx.compose.ui.graphics.Color as ComposeColor
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver

private const val MAX_OPENING_DURATION_MS = 15_000L
private const val STARTUP_PREFS = "atrio-startup-video"
private const val WATCHED_TO_END_KEY = "watched_to_end"

/** Reproduz uma única passagem do GIF local, inclusive em Android 26/27. */
@Suppress("DEPRECATION")
private class OpeningGifView(context: Context) : View(context) {
    private val movie: Movie? = try {
        resources.openRawResource(R.raw.abertura_atrio).use { Movie.decodeStream(it) }
    } catch (_: Exception) { null }

    val durationMs = movie?.duration()?.toLong()?.takeIf { it > 0 } ?: 0L
    val valid = durationMs in 1L..MAX_OPENING_DURATION_MS &&
        (movie?.width() ?: 0) > 0 && (movie?.height() ?: 0) > 0
    private var elapsedMs = 0L
    private var resumedAt: Long? = null

    init {
        setLayerType(LAYER_TYPE_SOFTWARE, null)
        setBackgroundColor(Color.rgb(15, 25, 45))
        importantForAccessibility = IMPORTANT_FOR_ACCESSIBILITY_NO
    }

    fun elapsed(): Long = elapsedMs + (resumedAt?.let { SystemClock.uptimeMillis() - it } ?: 0L)
    fun resumeAnimation() {
        if (resumedAt == null) resumedAt = SystemClock.uptimeMillis()
        invalidate()
    }
    fun pauseAnimation() {
        elapsedMs = elapsed()
        resumedAt = null
        invalidate()
    }

    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        val image = movie ?: return
        if (!valid || width <= 0 || height <= 0) return
        image.setTime(elapsed().coerceIn(0L, durationMs - 1L).toInt())
        val sx = width.toFloat() / image.width()
        val sy = height.toFloat() / image.height()
        // Preenchimento em proporções próximas da arte. Em telas mais
        // estreitas/largas, não cortar título nem barra de progresso.
        val aspect = width.toFloat() / height
        val scale = if (aspect in 0.53f..0.59f) maxOf(sx, sy) else minOf(sx, sy)
        val dx = (width - image.width() * scale) / 2f
        val dy = (height - image.height() * scale) / 2f
        canvas.save()
        canvas.translate(dx, dy)
        canvas.scale(scale, scale)
        image.draw(canvas, 0f, 0f)
        canvas.restore()
        if (resumedAt != null && elapsed() < durationMs) postInvalidateOnAnimation()
    }
}

/** Mantém o gate existente, sem MP4, áudio ou dependência externa. */
@Composable
internal fun AtrioStartupVideo(activity: ComponentActivity, onFinished: () -> Unit) {
    val prefs = remember(activity) {
        activity.getSharedPreferences(STARTUP_PREFS, Context.MODE_PRIVATE)
    }
    val canSkip = remember(activity) { prefs.getBoolean(WATCHED_TO_END_KEY, false) }
    val currentFinish by rememberUpdatedState(onFinished)
    var finished by remember { mutableStateOf(false) }
    val finishOnce: () -> Unit = {
        if (!finished) {
            finished = true
            currentFinish()
        }
    }
    val gifView = remember(activity) { OpeningGifView(activity) }
    BackHandler(enabled = !finished) { activity.finish() }

    DisposableEffect(activity) {
        val bars = WindowInsetsControllerCompat(activity.window, activity.window.decorView)
        bars.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        bars.hide(WindowInsetsCompat.Type.systemBars())
        onDispose { bars.show(WindowInsetsCompat.Type.systemBars()) }
    }

    DisposableEffect(gifView, activity) {
        val handler = Handler(Looper.getMainLooper())
        var disposed = false
        val complete = Runnable {
            if (!disposed && !finished && activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) {
                gifView.pauseAnimation()
                prefs.edit().putBoolean(WATCHED_TO_END_KEY, true).apply()
                finishOnce()
            }
        }
        val watchdog = Runnable { if (!disposed) finishOnce() }
        fun pause() {
            handler.removeCallbacks(complete)
            handler.removeCallbacks(watchdog)
            gifView.pauseAnimation()
        }
        fun resume() {
            if (finished || disposed) return
            handler.removeCallbacks(complete)
            handler.removeCallbacks(watchdog)
            if (!gifView.valid) {
                handler.post(watchdog)
                return
            }
            gifView.resumeAnimation()
            handler.postDelayed(complete, (gifView.durationMs - gifView.elapsed()).coerceAtLeast(0L))
            handler.postDelayed(watchdog, MAX_OPENING_DURATION_MS)
        }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_RESUME -> resume()
                Lifecycle.Event.ON_PAUSE -> pause()
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(observer)
        if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) resume()
        onDispose {
            disposed = true
            pause()
            activity.lifecycle.removeObserver(observer)
        }
    }

    Box(Modifier.fillMaxSize().background(ComposeColor(0xFF0F192D)).testTag("atrio-opening-fullscreen")) {
        AndroidView(factory = { gifView }, modifier = Modifier.fillMaxSize().testTag("atrio-opening-video"))
        if (canSkip) {
            TextButton(
                onClick = finishOnce,
                modifier = Modifier.align(Alignment.BottomEnd).navigationBarsPadding()
                    .padding(end = 8.dp, bottom = 52.dp).heightIn(min = 48.dp)
                    .testTag("atrio-opening-skip"),
                colors = ButtonDefaults.textButtonColors(
                    containerColor = ComposeColor(0xE60F192D),
                    contentColor = ComposeColor.White
                )
            ) { Text("Pular") }
        }
    }
}

@Composable
@Suppress("UNUSED_PARAMETER")
internal fun OpeningVideo(activity: ComponentActivity, authenticated: Boolean) = Unit
