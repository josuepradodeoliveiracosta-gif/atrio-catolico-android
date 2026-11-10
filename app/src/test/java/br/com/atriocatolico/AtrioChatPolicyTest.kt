package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AtrioChatPolicyTest {
    @Test fun canonicalPairIsIndependentOfWhoOpenedProfile() {
        assertEquals("alice__bob", AtrioChatPolicy.id("alice", "bob"))
        assertEquals("alice__bob", AtrioChatPolicy.id("bob", "alice"))
    }

    @Test fun firstContactExcludesLinksAndEmptyText() {
        assertTrue(AtrioChatPolicy.validRequest("Paz e bem!"))
        assertFalse(AtrioChatPolicy.validRequest("Veja https://example.com"))
        assertFalse(AtrioChatPolicy.validRequest("WWW.EXAMPLE.COM"))
        assertFalse(AtrioChatPolicy.validRequest("   "))
        assertFalse(AtrioChatPolicy.validRequest(" \n Oi"))
    }

    @Test fun textLimitAndControlCharacters() {
        assertTrue(AtrioChatPolicy.validText("a".repeat(1500)))
        assertFalse(AtrioChatPolicy.validText("a".repeat(1501)))
        assertFalse(AtrioChatPolicy.validText("Olá\u0000"))
        assertTrue(AtrioChatPolicy.validText("Uma oração.\nAmém."))
    }
}
