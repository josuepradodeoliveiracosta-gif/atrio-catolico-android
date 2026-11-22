package br.com.atriocatolico

import android.content.BroadcastReceiver
import android.content.Context
import android.content.ContextWrapper
import android.content.Intent
import android.content.IntentFilter
import android.os.Handler
import android.os.Looper
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.ui.Modifier
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalView
import androidx.core.view.WindowCompat
import androidx.lifecycle.*
import java.time.Duration
import java.time.ZonedDateTime
import br.com.atriocatolico.LiturgicalCalendarBR.Season

private tailrec fun Context.activity(): ComponentActivity? = when (this) {
    is ComponentActivity -> this
    is ContextWrapper -> baseContext.activity()
    else -> null
}

internal val LocalLiturgicalDay = compositionLocalOf { LiturgicalCalendarBR.day(java.time.LocalDate.now()) }
internal val LocalGreeting = compositionLocalOf { "Paz e bem" }

@Composable
private fun localCivilClock(): ZonedDateTime {
    val context = LocalContext.current
    var now by remember { mutableStateOf(ZonedDateTime.now()) }
    DisposableEffect(context) {
        val lifecycle = context.activity()?.lifecycle
        val handler = Handler(Looper.getMainLooper())
        var active = false
        val tick = object : Runnable {
            override fun run() {
                handler.removeCallbacks(this)
                if (!active) return
                val current = ZonedDateTime.now()
                now = current
                val next = LiturgicalCalendarBR.nextChange(current)
                handler.postDelayed(this, Duration.between(current, next).toMillis().coerceAtLeast(1) + 1)
            }
        }
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = tick.run()
        }
        context.registerReceiver(receiver, IntentFilter().apply {
            addAction(Intent.ACTION_DATE_CHANGED); addAction(Intent.ACTION_TIME_CHANGED); addAction(Intent.ACTION_TIMEZONE_CHANGED)
        })
        val observer = LifecycleEventObserver { _, event -> when (event) {
            Lifecycle.Event.ON_START, Lifecycle.Event.ON_RESUME -> { active = true; tick.run() }
            Lifecycle.Event.ON_STOP -> { active = false; handler.removeCallbacks(tick) }
            else -> Unit
        } }
        lifecycle?.addObserver(observer)
        if (lifecycle == null) { active = true; tick.run() }
        onDispose { active = false; handler.removeCallbacks(tick); lifecycle?.removeObserver(observer); context.unregisterReceiver(receiver) }
    }
    return now
}

private class Pairing(val light: Long, val tint: Long, val dark: Long, val shade: Long)
private val palettes = mapOf(
    Season.ADVENT to Pairing(0xFF62417A,0xFFF0E7F5,0xFFDEC2F5,0xFF2F2438),
    Season.CHRISTMAS to Pairing(0xFF785415,0xFFF7EDD9,0xFFF7D488,0xFF3A2C17),
    Season.ORDINARY to Pairing(0xFF285D41,0xFFE5F0E8,0xFFA5DEB7,0xFF20352B),
    Season.LENT to Pairing(0xFF713E62,0xFFF2E6ED,0xFFECC0DC,0xFF362535),
    Season.TRIDUUM to Pairing(0xFF6F3640,0xFFF4E7E9,0xFFF0A9B2,0xFF3A252A),
    Season.EASTER to Pairing(0xFF725821,0xFFF7EFDB,0xFFF5D784,0xFF392F1D),
    Season.ATRIO to Pairing(0xFF641F32,0xFFF3E8EB,0xFFF0B9C6,0xFF37252A)
)

internal fun liturgicalColors(day: LiturgicalCalendarBR.Day, dark: Boolean): ColorScheme {
    val pair = palettes.getValue(if (day.red) Season.TRIDUUM else day.season)
    val accent = Color(if (dark) pair.dark else pair.light)
    val tint = Color(if (dark) pair.shade else pair.tint)
    val bg = if (dark) Color(0xFF191819) else Color(0xFFFAF8F5)
    val surface = if (dark) Color(0xFF232223) else Color.White
    val ink = if (dark) Color(0xFFF4F0EE) else Color(0xFF29262A)
    val muted = if (dark) Color(0xFFD0C6C9) else Color(0xFF5C5558)
    val outline = if (dark) Color(0xFFA89AA0) else Color(0xFF776D70)
    val onAccent = if (dark) Color(0xFF201B1D) else Color.White
    return (if (dark) darkColorScheme() else lightColorScheme()).copy(
        primary = accent, onPrimary = onAccent, primaryContainer = tint, onPrimaryContainer = accent,
        secondary = accent, onSecondary = onAccent, secondaryContainer = tint, onSecondaryContainer = accent,
        tertiary = accent, onTertiary = onAccent, tertiaryContainer = tint, onTertiaryContainer = accent,
        surfaceTint = accent, background = bg, onBackground = ink, surface = surface, onSurface = ink,
        surfaceVariant = tint, onSurfaceVariant = muted, outline = outline, outlineVariant = outline,
        surfaceContainerLowest = bg, surfaceContainerLow = surface, surfaceContainer = surface,
        surfaceContainerHigh = surface, surfaceContainerHighest = tint)
}

@Composable
internal fun LiturgicalTheme(content: @Composable () -> Unit) {
    val now = localCivilClock()
    val day = remember(now.toLocalDate()) { LiturgicalCalendarBR.day(now.toLocalDate()) }
    val dark = isSystemInDarkTheme()
    val scheme = remember(day, dark) { liturgicalColors(day, dark) }
    val window = LocalContext.current.activity()?.window
    val view = LocalView.current
    SideEffect {
        if (window != null && !view.isInEditMode) {
            if (android.os.Build.VERSION.SDK_INT < 35) {
                @Suppress("DEPRECATION")
                window.statusBarColor = scheme.background.toArgb()
                @Suppress("DEPRECATION")
                window.navigationBarColor = scheme.surface.toArgb()
            }
            WindowCompat.getInsetsController(window, view).apply {
                isAppearanceLightStatusBars = !dark; isAppearanceLightNavigationBars = !dark
            }
        }
    }
    CompositionLocalProvider(LocalLiturgicalDay provides day, LocalGreeting provides LiturgicalCalendarBR.greeting(now.hour)) {
        MaterialTheme(colorScheme = scheme, typography = AtrioMaterialTypography) {
            Surface(Modifier.fillMaxSize(), color = scheme.background, contentColor = scheme.onBackground, content = content)
        }
    }
}
