package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Unit-only: não acessa token FCM, Firestore, rede ou emulador. */
class PlayBroadcastDeliveryPolicyTest {
    private fun allowed(
        play: Boolean = true,
        uid: String = "alice",
        target: String? = "alice",
        from: String? = "1234567890",
        to: String? = null
    ) = PlayBroadcastDeliveryPolicy.accepts(play, uid, target, from, to)

    @Test fun playAllowsOnlyTokenTargetedBroadcastToCurrentAccount() {
        assertTrue(allowed())
        assertFalse(allowed(target = null))
        assertFalse(allowed(target = ""))
        assertFalse(allowed(target = "bob"))
        assertFalse(allowed(uid = ""))
    }

    @Test fun playRejectsLegacyTopicsEvenWithForgedMatchingUid() {
        assertFalse(allowed(from = "/topics/atrio_comunicados_v1"))
        assertFalse(allowed(to = "/topics/atrio_comunicados_v1"))
        assertFalse(allowed(from = "/topics/another", target = "alice"))
    }

    @Test fun preservesExistingOtaBehaviorWithoutChangingServerSubscriptions() {
        assertTrue(allowed(play = false, target = null, from = "/topics/atrio_comunicados_v1"))
        assertTrue(allowed(play = false, target = "bob", from = "/topics/legacy"))
    }
}
