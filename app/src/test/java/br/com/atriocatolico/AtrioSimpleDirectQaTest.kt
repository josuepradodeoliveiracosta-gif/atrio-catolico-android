package br.com.atriocatolico
import org.junit.Assert.*
import org.junit.Test
class AtrioSimpleDirectQaTest {
    @Test fun eventHasOnlyCanonicalIdsAndDoesNotClaimDelivery() {
        val payload = org.json.JSONObject(AtrioSimpleDirectPush.payload(AtrioSimpleDirectQa.CHAT_ID, "message-1")!!)
        assertEquals(setOf("type", "chatId", "messageId"), payload.keys().asSequence().toSet())
        assertEquals("chat_message", payload.getString("type"))
        assertNull(AtrioSimpleDirectPush.payload("another-chat", "message-1"))
        assertNull(AtrioSimpleDirectPush.payload(AtrioSimpleDirectQa.CHAT_ID, "bad/id"))
        assertTrue(AtrioSimpleDirectPush.outcome(202, "accepted_by_fcm").contains("ainda não confirmada"))
        assertFalse(AtrioSimpleDirectPush.outcome(503, "accepted_by_fcm").startsWith("FCM aceitou"))
    }
    @Test fun onlyVerifiedFixedPair() {
        assertEquals("qa-nav-bob", AtrioSimpleDirectQa.peer("qa-nav-alice"))
        assertEquals("qa-nav-alice", AtrioSimpleDirectQa.peer("qa-nav-bob"))
        assertNull(AtrioSimpleDirectQa.peer("qa-nav-moderador"))
        assertTrue(AtrioSimpleDirectQa.verified("qa-nav-alice", "alice.navegacao@qa.invalid", true))
        assertFalse(AtrioSimpleDirectQa.verified("qa-nav-alice", "alice.navegacao@qa.invalid", false))
        assertFalse(AtrioSimpleDirectQa.verified("qa-nav-bob", "alice.navegacao@qa.invalid", true))
        assertFalse(AtrioSimpleDirectQa.verified("external", "bob.navegacao@qa.invalid", true))
    }
}
