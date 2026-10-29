package br.com.atriocatolico

import android.content.Context
import android.graphics.Paint
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray

internal data class DeviceEmojiCatalog(val catalog: ReactionEmojiCatalog, val supported: Set<String>)

internal object ReactionEmojiData {
    private val mutex = Mutex()
    private var cached: DeviceEmojiCatalog? = null
    suspend fun load(context: Context): DeviceEmojiCatalog = mutex.withLock {
        cached ?: withContext(Dispatchers.Default) {
            val text = withContext(Dispatchers.IO) {
                context.applicationContext.assets.open("reaction_emojis.tsv").bufferedReader().use { it.readText() }
            }
            val catalog = ReactionEmojiCatalog.parse(text.lineSequence())
            // Keep the device's native glyphs. Do not download a font or show unsupported tofu in the picker.
            val paint = Paint().apply { textSize = 32f }
            DeviceEmojiCatalog(catalog, catalog.entries.filter { paint.hasGlyph(it.glyph) }.map { it.glyph }.toSet())
        }.also { cached = it }
    }
    fun recent(context: Context, uid: String): List<String> = runCatching {
        val json = JSONArray(context.getSharedPreferences("atrio-reaction-emojis", Context.MODE_PRIVATE)
            .getString("recent_$uid", "[]"))
        (0 until json.length()).map { json.getString(it) }.distinct().take(24)
    }.getOrDefault(emptyList())
    fun record(context: Context, uid: String, emoji: String) {
        val values = recentReactionEmojis(recent(context, uid), emoji)
        context.getSharedPreferences("atrio-reaction-emojis", Context.MODE_PRIVATE).edit()
            .putString("recent_$uid", JSONArray(values).toString()).apply()
    }
}
