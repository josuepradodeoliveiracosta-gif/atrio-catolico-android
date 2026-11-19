package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

/** Contrato #355 sem rede ou credenciais: nenhuma descoberta global. */
class AtrioPeerInboxPolicyTest {
    @Test fun cacheOfflineAndAccountSwitchNeverAuthorizeInbox() {
        assertTrue(AtrioPeerInboxPolicy.freshServer(false, false, true))
        assertFalse(AtrioPeerInboxPolicy.freshServer(true, false, true))
        assertFalse(AtrioPeerInboxPolicy.freshServer(false, true, true))
        assertFalse(AtrioPeerInboxPolicy.freshServer(false, false, false))
    }
    @Test fun knownPeerIsValidated() {
        assertTrue(AtrioPeerInboxPolicy.validPeer("alice", "bob"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("alice", "alice"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("", "bob"))
        assertFalse(AtrioPeerInboxPolicy.validPeer("alice", "bad/uid"))
    }
    @Test fun firstContactRequiresExplicitProfileAndNoAuthorizedIndex() {
        val id = AtrioChatPolicy.id("clara", "miguel")
        assertTrue(AtrioPeerInboxPolicy.explicitFirstContact(
            "clara", "miguel", id, false))
        assertFalse(AtrioPeerInboxPolicy.explicitFirstContact(
            "clara", null, id, false)) // link exato não cria contato
        assertFalse(AtrioPeerInboxPolicy.explicitFirstContact(
            "clara", "miguel", id, true)) // índice existente, não sobrescrever
        assertFalse(AtrioPeerInboxPolicy.explicitFirstContact(
            "clara", "lucia", id, false)) // perfil diferente do chat
        assertFalse(AtrioPeerInboxPolicy.explicitFirstContact(
            "clara", "clara", "clara__clara", false))
    }

    @Test fun serverRoomMustMatchAuthenticatedOwnerAndDeterministicChat() {
        val id = AtrioChatPolicy.id("clara", "miguel")
        assertTrue(AtrioPeerInboxPolicy.roomMatches(
            "clara", id, "miguel", "clara", "pending"))
        assertTrue(AtrioPeerInboxPolicy.roomMatches(
            "miguel", id, "miguel", "clara", "accepted"))
        assertFalse(AtrioPeerInboxPolicy.roomMatches(
            "lucia", id, "miguel", "clara", "accepted"))
        assertFalse(AtrioPeerInboxPolicy.roomMatches(
            "clara", id, "lucia", "clara", "accepted"))
        assertFalse(AtrioPeerInboxPolicy.roomMatches(
            "clara", id, "clara", "clara", "pending"))
        assertFalse(AtrioPeerInboxPolicy.roomMatches(
            "clara", id, "miguel", "clara", "unknown"))
        assertFalse(AtrioPeerInboxPolicy.roomMatches(
            "clara", id, null, "clara", "accepted"))
    }

    @Test fun exactChatIdYieldsOnlyItsKnownPartner() {
        assertEquals("bob", AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__bob"))
        assertEquals("alice", AtrioPeerInboxPolicy.peerFromChatId("bob", "alice__bob"))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", null))
        assertEquals("stranger__wrong",
            AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__stranger__wrong"))
        assertNull(AtrioPeerInboxPolicy.peerFromChatId("alice", "alice__bad/uid"))
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
