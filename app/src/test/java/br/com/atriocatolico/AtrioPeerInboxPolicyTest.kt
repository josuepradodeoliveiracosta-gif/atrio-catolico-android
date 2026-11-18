package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

/** Contrato #355 sem rede ou credenciais: nenhuma descoberta global. */
class AtrioPeerInboxPolicyTest {
    @Test fun knownPeerIsValidated() {
        assertTrue(AtrioPeerInboxPolicy.validPeer("alice", "bob"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("alice", "alice"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("", "bob"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("alice", "bad/uid"))
    }
    @Test fun exactChatIdYieldsOnlyItsKnownPartner() {
        assertEquals("bob", AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__bob"))
        assertEquals("alice", AtrioPeerInboxPolicy.peerFromChatId("bob", "alice__bob"))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", null))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__stranger__wrong"))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__alice"))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", "not-a-conversation"))
    }
    @Test fun unknownOrForgedIndexCannotRenderPrivatePreview() {
        val id = AtrioChatPolicy.id("alice", "bob")
        val okay = { owner: String?, peer: String?, status: String?, text: String? ->
            AtrioPeerInboxPolicy.entryMatches("alice", "bob", id, owner, peer, status, text)
        }
        assertTrue(okay("alice", "bob", "accepted", "Paz e bem"))
        assertTrue(okay("alice", "bob", "pending", "Pedido"))
        assertFalse(okay("bob", "alice", "accepted", "Texto"))
        assertFalse(okay("alice", "clara", "accepted", "Texto"))
        assertFalse(okay("alice", "bob", "removed", "Texto"))
        assertFalse(okay("alice", "bob", "accepted", null))
        assertFalse(okay("alice", "bob", "accepted", "a".repeat(1501)))
        assertFalse(AtrioPeerInboxPolicy.entryMatches("alice", "bob",
            "alice__clara", "alice", "bob", "accepted", "Segredo"))
    }
}
