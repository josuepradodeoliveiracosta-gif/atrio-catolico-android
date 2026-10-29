package br.com.atriocatolico

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.util.LruCache
import androidx.compose.runtime.*
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asImageBitmap
import com.google.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import java.net.URL
import javax.net.ssl.HttpsURLConnection

/** Firestore da sessão atual, sem ler nenhum documento privado de terceiro. */
internal val LocalAvatarFirestore = compositionLocalOf<FirebaseFirestore?> { null }

private object AvatarImageCache {
    private val bitmaps = object : LruCache<String, Bitmap>(12 * 1024 * 1024) {
        override fun sizeOf(key: String, value: Bitmap): Int = value.byteCount
    }
    @Synchronized fun get(url: String): Bitmap? = bitmaps.get(url)
    @Synchronized fun put(url: String, bitmap: Bitmap) = bitmaps.put(url, bitmap)

    fun valid(url: String): Boolean = runCatching {
        val u = URL(url)
        u.protocol == "https" && u.host == "res.cloudinary.com" &&
            u.path.contains("/image/upload/") && url.length < 500
    }.getOrDefault(false)

    fun download(url: String): Bitmap? {
        if (!valid(url)) return null
        get(url)?.let { return it }
        val connection = URL(url).openConnection() as HttpsURLConnection
        try {
            connection.connectTimeout = 10000
            connection.readTimeout = 10000
            connection.instanceFollowRedirects = false
            if (connection.responseCode != 200) return null
            if (!connection.contentType.orEmpty().startsWith("image/")) return null
            if (connection.contentLengthLong > 2_000_000L) return null
            val bytes = ByteArrayOutputStream()
            connection.inputStream.use { input ->
                val chunk = ByteArray(8192)
                while (true) {
                    val count = input.read(chunk)
                    if (count < 0) break
                    if (bytes.size() + count > 2_000_000) return null
                    bytes.write(chunk, 0, count)
                }
            }
            val data = bytes.toByteArray()
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            BitmapFactory.decodeByteArray(data, 0, data.size, bounds)
            if (bounds.outWidth !in 1..2000 || bounds.outHeight !in 1..2000) return null
            val bitmap = BitmapFactory.decodeByteArray(data, 0, data.size) ?: return null
            put(url, bitmap)
            return bitmap
        } finally {
            connection.disconnect()
        }
    }
}

/** Cada item visível observa apenas profile_photos/{uid}; listagem proibida por regras. */
@Composable
internal fun rememberPublicAvatar(uid: String): ImageBitmap? {
    // Nunca consultar collection sem regras publicadas ou Worker configurado.
    if (!CloudinaryAvatarClient.enabled) return null
    val db = LocalAvatarFirestore.current
    var remoteUrl by remember(db, uid) { mutableStateOf("") }
    var bitmap by remember(db, uid) { mutableStateOf<ImageBitmap?>(null) }

    DisposableEffect(db, uid) {
        if (db == null || uid.isBlank()) {
            onDispose { }
        } else {
            val subscription = db.collection("profile_photos").document(uid)
                .addSnapshotListener { doc, failure ->
                    remoteUrl = if (failure == null) doc?.getString("photoUrl").orEmpty() else ""
                }
            onDispose { subscription.remove() }
        }
    }
    LaunchedEffect(remoteUrl, uid) {
        bitmap = if (remoteUrl.isBlank()) null
            else withContext(Dispatchers.IO) {
                runCatching { AvatarImageCache.download(remoteUrl)?.asImageBitmap() }.getOrNull()
            }
    }
    return bitmap
}
