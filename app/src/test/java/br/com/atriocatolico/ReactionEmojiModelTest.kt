package br.com.atriocatolico

import java.io.File
import org.junit.Assert.*
import org.junit.Test

class ReactionEmojiModelTest {
    private fun catalog(): ReactionEmojiCatalog {
        val file = listOf(File("src/main/assets/reaction_emojis.tsv"), File("app/src/main/assets/reaction_emojis.tsv"))
            .first { it.exists() }
        return file.bufferedReader().use { ReactionEmojiCatalog.parse(it.lineSequence()) }
    }
    @Test fun fullCatalogPreservesSequencesAndPortugueseSearch() {
        val catalog = catalog()
        assertEquals(3944, catalog.entries.size)
        assertEquals((0..8).toSet(), catalog.entries.map { it.category }.toSet())
        for (emoji in listOf("👍🏽", "👨‍👩‍👧‍👦", "🇧🇷", "👩🏽‍💻", "🧑🏾‍🤝‍🧑🏻", "1️⃣", "❤️")) {
            assertEquals(emoji, catalog.byGlyph.getValue(emoji).glyph)
            assertTrue(catalog.search(emoji, null).any { it.glyph == emoji })
        }
        assertTrue(catalog.search("coracao", null).any { it.glyph == "❤️" })
        assertTrue(catalog.search("família", null).any { it.glyph == "👨‍👩‍👧‍👦" })
        assertEquals(6, catalog.variants.getValue(catalog.byGlyph.getValue("👍").variantKey).size)
        assertTrue(catalog.roots.size > 1500)
    }
    @Test fun legacyAndUnicodeReactionsAreCountedTogether() {
        val groups = summarizeReactions(mapOf("a" to "heart", "b" to "❤️", "c" to "prayer", "d" to "👍🏽"), "b")
        assertEquals(ReactionSummary("❤️", 2, true), groups.first())
        assertEquals(4, groups.sumOf { it.count })
        assertEquals(3, groups.size)
    }
    @Test fun toggleReplaceAndLegacyCompatibility() {
        assertNull(nextReactionKind("heart", "❤️"))
        assertNull(nextReactionKind("❤️", "❤️"))
        assertEquals("prayer", nextReactionKind("heart", "🙏"))
        assertEquals("light", nextReactionKind(null, "✨"))
        assertEquals("👩🏽‍💻", nextReactionKind("prayer", "👩🏽‍💻"))
        assertNull(nextReactionKind("👩🏽‍💻", "👩🏽‍💻"))
        assertEquals("👍🏿", nextReactionKind("👍🏽", "👍🏿"))
    }
    @Test fun recentListKeepsWholeEmojisUniqueAndBounded() {
        assertEquals(listOf("👨‍👩‍👧‍👦", "👍🏽"), recentReactionEmojis(listOf("👍🏽", "👨‍👩‍👧‍👦"), "👨‍👩‍👧‍👦"))
        assertEquals(24, recentReactionEmojis((0..30).map { "entry$it" }, "🙏").size)
    }
}
