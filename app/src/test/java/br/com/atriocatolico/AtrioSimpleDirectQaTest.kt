package br.com.atriocatolico
import org.junit.Assert.*
import org.junit.Test
class AtrioSimpleDirectQaTest {
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
