package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class EngagementMentionsTest {
    @Test fun restrictCandidatesToKnownParticipantsAndUniqueUids() {
        val post = Post(
            id = "topic", author = "Clara", category = "Vida espiritual",
            age = "hoje", title = "Conversa", body = "Compartilhe.",
            ownerUid = "uid-clara",
            replies = listOf(
                Reply("Miguel", "Olá", "reply-1", ownerUid = "uid-miguel"),
                Reply("Miguel", "Outra resposta", "reply-2", ownerUid = "uid-miguel"),
                Reply("Lúcia", "Partilho.", "reply-3", ownerUid = "uid-lucia"),
                Reply("Usuário inválido", "Teste", "reply-4", ownerUid = "uid/unsafe")
            )
        )
        val result = mentionCandidates(post, "uid-lucia")
        assertEquals(listOf("uid-clara", "uid-miguel"), result.map { it.uid })
        assertEquals("", result.first().sourceReplyId)
        assertEquals("reply-1", result.last().sourceReplyId)
        assertEquals("@Miguel", mentionDisplay(result.last()))
    }

    @Test fun mentionBodyHasStrictSixHundredCharacterLimit() {
        val result = mentionBody(MentionCandidate("uid-clara", "Clara"), "x".repeat(900))
        assertTrue(result.startsWith("@Clara "))
        assertEquals(600, result.length)
    }
}
