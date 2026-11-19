package br.com.atriocatolico

import android.net.ConnectivityManager
import android.net.Network
import android.os.Handler
import android.os.Looper
import androidx.compose.runtime.*
import androidx.compose.ui.platform.LocalContext
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlin.coroutines.resume

internal data class AtrioInboxNavigation(
    val result: AtrioInboxResult?,
    val page: Int,
    val restart: () -> Unit,
    val previous: () -> Unit,
    val next: () -> Unit
)

@Composable
internal fun rememberAtrioInboxNavigation(
    auth: FirebaseAuth,
    user: FirebaseUser,
    blockedPeers: Set<String>
): AtrioInboxNavigation {
    val context = LocalContext.current
    val manager = remember(context) {
        checkNotNull(context.getSystemService(ConnectivityManager::class.java))
    }
    var network by remember(manager) { mutableStateOf(manager.activeNetwork) }
    DisposableEffect(manager) {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(current: Network) { network = current }
            override fun onLost(lost: Network) {
                if (network == lost) network = manager.activeNetwork?.takeUnless { it == lost }
            }
        }
        manager.registerDefaultNetworkCallback(callback, Handler(Looper.getMainLooper()))
        onDispose { manager.unregisterNetworkCallback(callback) }
    }
    val client = remember { AtrioInboxDiscovery() }
    var cursors by remember(user, network, blockedPeers) { mutableStateOf(listOf<String?>(null)) }
    var refresh by remember(user, network, blockedPeers) { mutableIntStateOf(0) }
    val cursor = cursors.last()
    var result by remember(user, network, blockedPeers, cursors, refresh) {
        mutableStateOf<AtrioInboxResult?>(null)
    }
    LaunchedEffect(user, network, blockedPeers, cursors, refresh) {
        if (network == null) return@LaunchedEffect
        while (true) {
            val page = client.load(user.uid, cursor, sameSession = { auth.currentUser === user },
                getToken = {
                    suspendCancellableCoroutine { continuation ->
                        user.getIdToken(false).addOnCompleteListener { task ->
                            if (continuation.isActive)
                                continuation.resume(if (task.isSuccessful) task.result?.token else null)
                        }
                    }
                },
                request = { owner, token, next ->
                    withContext(Dispatchers.IO) { client.fetch(owner, token, next) }
                }) ?: return@LaunchedEffect
            ensureActive()
            result = if (page is AtrioInboxResult.Page &&
                (page.items.any { it.peerUid in blockedPeers } ||
                    (page.nextCursor != null && page.nextCursor in cursors))
            ) AtrioInboxResult.Unavailable else page
            if (result !is AtrioInboxResult.Page) return@LaunchedEffect
            // Revalida a página aberta sem manter prévias de páginas anteriores em memória.
            delay(10_000)
        }
    }
    val visible = when {
        network == null -> AtrioInboxResult.Unavailable
        auth.currentUser !== user -> null
        else -> result
    }
    return AtrioInboxNavigation(visible, cursors.size,
        restart = { cursors = listOf(null); refresh++ },
        previous = { if (cursors.size > 1) cursors = cursors.dropLast(1) },
        next = {
            val nextCursor = (visible as? AtrioInboxResult.Page)?.nextCursor
            if (nextCursor != null && nextCursor !in cursors) cursors = cursors + nextCursor
        })
}
