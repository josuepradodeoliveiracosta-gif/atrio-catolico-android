package br.com.atriocatolico

import java.text.Normalizer
import java.util.Locale

internal val quickReactionEmojis = listOf("👍", "❤️", "😂", "😮", "😢", "🙏")
internal val reactionEmojiCategories = listOf(
    "😀 Rostos e emoções", "👋 Pessoas e gestos", "🐶 Animais e natureza",
    "🍎 Alimentos e bebidas", "⚽ Atividades", "🚗 Viagens e lugares",
    "💡 Objetos", "❤️ Símbolos", "🏳️ Bandeiras"
)

internal data class ReactionEmoji(
    val glyph: String, val category: Int, val label: String, val keywords: String, val variantKey: String
) {
    val searchText = normalizeEmojiSearch("$label $keywords")
    val hasSkinTone = glyph.codePoints().anyMatch { it in 0x1F3FB..0x1F3FF }
}

internal fun normalizeEmojiSearch(value: String): String = Normalizer.normalize(value, Normalizer.Form.NFD)
    .replace(Regex("\\p{M}+"), "").lowercase(Locale.ROOT).trim()

internal class ReactionEmojiCatalog(val entries: List<ReactionEmoji>) {
    val byGlyph = entries.associateBy { it.glyph }
    val variants = entries.groupBy { it.variantKey }
    val roots = variants.values.map { group -> group.firstOrNull { !it.hasSkinTone } ?: group.first() }
    fun search(query: String, category: Int?): List<ReactionEmoji> {
        val words = normalizeEmojiSearch(query).split(Regex("\\s+")).filter { it.isNotBlank() }
        return (if (query.isBlank()) roots else entries).filter { emoji ->
            (category == null || emoji.category == category) &&
                (query == emoji.glyph || words.all { it in emoji.searchText })
        }
    }
    companion object {
        fun parse(lines: Sequence<String>): ReactionEmojiCatalog = ReactionEmojiCatalog(
            lines.filter { it.isNotBlank() }.map { line ->
                val parts = line.split('\t')
                require(parts.size == 5)
                ReactionEmoji(parts[0], parts[1].toInt(), parts[2], parts[3], parts[4])
            }.toList()
        )
    }
}

// Preserve storage compatibility with the three existing kinds; never migrate other users' documents.
internal fun reactionGlyph(kind: String): String = when (kind) {
    "heart" -> "❤️"
    "prayer" -> "🙏"
    "light" -> "✨"
    else -> kind
}
internal fun reactionKind(glyph: String): String = when (glyph) {
    "❤️" -> "heart"
    "🙏" -> "prayer"
    "✨" -> "light"
    else -> glyph
}
internal fun nextReactionKind(current: String?, chosen: String): String? =
    if (reactionGlyph(current.orEmpty()) == chosen) null else reactionKind(chosen)

internal data class ReactionSummary(val emoji: String, val count: Int, val mine: Boolean)

internal fun summarizeReactions(values: Map<String, String>, uid: String): List<ReactionSummary> =
    values.entries.groupBy { reactionGlyph(it.value) }.map { (glyph, reactions) ->
        ReactionSummary(glyph, reactions.size, reactions.any { it.key == uid })
    }.sortedWith(compareByDescending<ReactionSummary> { it.count }.thenBy { it.emoji })

internal fun recentReactionEmojis(previous: List<String>, chosen: String): List<String> =
    (listOf(chosen) + previous).distinct().take(24)
