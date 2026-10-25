package br.com.atriocatolico

import android.content.Context
import android.media.MediaPlayer
import android.net.Uri
import android.widget.VideoView
import androidx.activity.ComponentActivity
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.LifecycleEventObserver
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.delay

/** State belongs to this task, not a navigation screen or an individual login. */
@Composable
internal fun OpeningVideo(activity: ComponentActivity) {
    val prefs = remember { activity.getSharedPreferences("atrio-opening", Context.MODE_PRIVATE) }
    var enabled by remember { mutableStateOf(prefs.getBoolean("enabled", true)) }
    var ready by rememberSaveable { mutableStateOf(false) }
    var consumed by rememberSaveable { mutableStateOf(false) }
    // A short, non-blocking opportunity to receive the remote switch before showing.
    LaunchedEffect(Unit) { delay(1200); ready = true }
    DisposableEffect(activity) {
        var active = true
        val registration = if (FirebaseApp.getApps(activity).isNotEmpty()) {
            FirebaseFirestore.getInstance().document("app_config/opening_video")
                .addSnapshotListener { snapshot, error ->
                    if (active && error == null && snapshot != null && !snapshot.metadata.isFromCache) {
                        // Missing or malformed configuration uses the bundled default (enabled).
                        val value = snapshot.data?.get("enabled") as? Boolean ?: true
                        prefs.edit().putBoolean("enabled", value).apply()
                        enabled = value
                        ready = true
                    }
                }
        } else null
        onDispose { active = false; registration?.remove() }
    }
    LaunchedEffect(ready, enabled) {
        if (ready && !enabled) consumed = true
    }
    if (ready && enabled && !consumed) {
        AtrioTheme { OpeningVideoDialog(activity, onClose = { consumed = true }) }
    }
}

@Composable
private fun OpeningVideoDialog(activity: ComponentActivity, onClose: () -> Unit) {
    var muted by rememberSaveable { mutableStateOf(true) }
    var position by rememberSaveable { mutableStateOf(0) }
    var prepared by remember { mutableStateOf(false) }
    var player by remember { mutableStateOf<MediaPlayer?>(null) }
    val close by rememberUpdatedState(onClose)
    val video = remember(activity) { VideoView(activity) }
    // A corrupt or unsupported video must not trap the user on the opening screen.
    LaunchedEffect(prepared) { if (!prepared) { delay(8000); close() } }
    DisposableEffect(video) {
        var disposed = false
        video.setOnPreparedListener { media ->
            if (!disposed) {
                player = media
                media.isLooping = false
                media.setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f)
                prepared = true
                if (position > 0) video.seekTo(position)
                if (activity.lifecycle.currentState.isAtLeast(Lifecycle.State.RESUMED)) video.start()
            }
        }
        video.setOnCompletionListener { if (!disposed) close() }
        video.setOnErrorListener { _, _, _ -> if (!disposed) close(); true }
        val observer = LifecycleEventObserver { _, event ->
            when (event) {
                Lifecycle.Event.ON_PAUSE -> {
                    position = video.currentPosition.coerceAtLeast(0)
                    video.pause()
                }
                Lifecycle.Event.ON_RESUME -> if (prepared) video.start()
                else -> Unit
            }
        }
        activity.lifecycle.addObserver(observer)
        video.setVideoURI(Uri.parse("android.resource://${activity.packageName}/${R.raw.abertura_atrio}"))
        onDispose {
            disposed = true
            position = video.currentPosition.coerceAtLeast(0)
            activity.lifecycle.removeObserver(observer)
            video.setOnPreparedListener(null)
            video.setOnCompletionListener(null)
            video.setOnErrorListener(null)
            player = null
            video.stopPlayback()
        }
    }
    LaunchedEffect(muted, player) {
        player?.setVolume(if (muted) 0f else 1f, if (muted) 0f else 1f)
    }
    Dialog(onDismissRequest = { close() }, properties = DialogProperties(usePlatformDefaultWidth = false)) {
        Surface(Modifier.widthIn(max = 640.dp).fillMaxWidth().padding(16.dp),
            shape = RoundedCornerShape(20.dp), color = Paper) {
            Column(Modifier.verticalScroll(rememberScrollState()).padding(12.dp)) {
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.End) {
                    TextButton(onClick = { close() }) { Text("Fechar") }
                }
                AndroidView(factory = { video }, modifier = Modifier.fillMaxWidth()
                    .aspectRatio(16f / 9f).background(Color.Black))
                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                    TextButton(onClick = { muted = !muted }, enabled = prepared) {
                        Text(if (muted) "Ativar som" else "Silenciar")
                    }
                    if (!prepared) Text("Carregando…", modifier = Modifier.padding(12.dp))
                }
            }
        }
    }
}
