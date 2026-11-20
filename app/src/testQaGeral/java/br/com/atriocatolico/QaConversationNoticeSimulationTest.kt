package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

/**
 * Contrato executável para revisão. Todo transporte, leitura e efeito é injetado.
 * Só é compilado no teste local qaGeral. Não registra FCM nem instala um receptor.
 */
class QaConversationNoticeSimulationTest {
    private data class Session(val uid: String, val generation: Int)
    private data class Pending(
        val owner: String,
        val conversation: String,
        val event: String,
        val fromServer: Boolean = true,
        val accessible: Boolean = true,
        val unread: Boolean = true,
    )
    private data class Alert(val session: Session, val pending: Pending)

    private class Simulation(
        val activeSession: () -> Session?,
        val canNotify: () -> Boolean,
        val readServer: (Session, String?) -> Pending?,
        val display: (Alert) -> Unit,
        val open: (String) -> Unit,
    ) {
        private val displayed = mutableSetOf<Triple<String, String, String>>()

        fun receive(data: Map<String, String>, hasNotification: Boolean, ageMillis: Long) {
            if (hasNotification || data != mapOf("signal" to "refresh") ||
                ageMillis !in 0..60_000 || !canNotify()
            ) return
            val session = activeSession() ?: return
            val pending = currentPending(session, null) ?: return
            if (!canNotify() || activeSession() != session) return
            if (displayed.add(Triple(session.uid, pending.conversation, pending.event))) {
                display(Alert(session, pending))
            }
        }

        fun tap(alert: Alert) {
            if (activeSession() != alert.session) return
            val pending = currentPending(alert.session, alert.pending.event) ?: return
            if (pending.conversation == alert.pending.conversation) open(pending.conversation)
        }

        private fun currentPending(session: Session, event: String?): Pending? {
            val pending = try {
                readServer(session, event)
            } catch (_: IOException) {
                return null
            }
            return pending?.takeIf {
                activeSession() == session && it.owner == session.uid && it.fromServer &&
                    it.accessible && it.unread && (event == null || it.event == event)
            }
        }
    }

    private class Fixture {
        val alice = Session("alice", 1)
        var session: Session? = alice
        var permission = true
        var pending: Pending? = Pending(alice.uid, "dm-fixture", "event-one")
        var afterRead: () -> Unit = {}
        val trace = mutableListOf<String>()
        val alerts = mutableListOf<Alert>()
        val opened = mutableListOf<String>()
        val simulation = Simulation(
            activeSession = { session },
            canNotify = { permission },
            readServer = { account, event ->
                trace += "server:${account.uid}:${event ?: "pending"}"
                val result = pending
                afterRead()
                result
            },
            display = { alerts += it; trace += "display" },
            open = { opened += it; trace += "open" },
        )

        fun signal(ageMillis: Long = 10) {
            simulation.receive(mapOf("signal" to "refresh"), false, ageMillis)
        }
    }

    @Test fun resolvesOnServerBeforeDisplayAndChecksSameEventAgainBeforeNavigation() {
        val fixture = Fixture()
        fixture.signal()
        fixture.simulation.tap(fixture.alerts.single())
        assertEquals(
            listOf("server:alice:pending", "display", "server:alice:event-one", "open"),
            fixture.trace,
        )
        assertEquals(listOf("dm-fixture"), fixture.opened)
    }

    @Test fun deniedPermissionSuppressesAlertWithoutConsumingPendingMessage() {
        val fixture = Fixture()
        fixture.permission = false
        fixture.signal()
        assertTrue(fixture.trace.isEmpty())
        assertTrue(fixture.alerts.isEmpty())
        // A simulação do push não altera a pendência que a UI poderá consultar.
        assertEquals("event-one", fixture.pending?.event)
        assertNull(fixture.opened.firstOrNull())
    }

    @Test fun cachedRevokedReadAndMissingPendenciesNeverDisplay() {
        val fixture = Fixture()
        val valid = requireNotNull(fixture.pending)
        for (result in listOf(
            valid.copy(fromServer = false),
            valid.copy(accessible = false),
            valid.copy(unread = false),
            null,
        )) {
            fixture.pending = result
            fixture.signal()
        }
        assertEquals(List(4) { "server:alice:pending" }, fixture.trace)
        assertTrue(fixture.alerts.isEmpty())
    }

    @Test fun offlineFailureSuppressesDisplayAndTap() {
        val fixture = Fixture()
        fixture.afterRead = { throw IOException("simulated offline") }
        fixture.signal()
        assertTrue(fixture.alerts.isEmpty())
        fixture.afterRead = {}
        fixture.signal()
        fixture.afterRead = { throw IOException("simulated offline") }
        fixture.simulation.tap(fixture.alerts.single())
        assertTrue(fixture.opened.isEmpty())
    }

    @Test fun logoutOrAccountChangeDuringReadDiscardsOldResultEvenAfterSameUidReturns() {
        val fixture = Fixture()
        fixture.afterRead = { fixture.session = Session("alice", 3) }
        fixture.signal()
        assertTrue(fixture.alerts.isEmpty())
        fixture.afterRead = { fixture.session = null }
        fixture.signal()
        assertTrue(fixture.alerts.isEmpty())
        fixture.signal()
        assertEquals(2, fixture.trace.size)
    }

    @Test fun delayedSignalCanOnlyLookUpTheCurrentAccount() {
        val fixture = Fixture()
        fixture.session = Session("bob", 2)
        fixture.signal()
        assertEquals(listOf("server:bob:pending"), fixture.trace)
        assertTrue(fixture.alerts.isEmpty())
    }

    @Test fun tapAfterRevocationOrAccountSwitchCannotNavigate() {
        val fixture = Fixture()
        fixture.signal()
        val alert = fixture.alerts.single()
        val original = requireNotNull(fixture.pending)
        fixture.pending = original.copy(accessible = false)
        fixture.simulation.tap(alert)
        fixture.pending = original.copy(conversation = "other-dm")
        fixture.simulation.tap(alert)
        fixture.pending = original.copy(event = "different-event")
        fixture.simulation.tap(alert)
        fixture.session = Session("bob", 2)
        fixture.simulation.tap(alert)
        assertEquals(List(3) { "server:alice:event-one" }, fixture.trace.drop(2))
        assertTrue(fixture.opened.isEmpty())
    }

    @Test fun malformedExpiredSignalsAndRepeatCannotDisplayAdditionalAlert() {
        val fixture = Fixture()
        val generic = mapOf("signal" to "refresh")
        fixture.simulation.receive(generic + ("chatId" to "injected"), false, 1)
        fixture.simulation.receive(generic, true, 1)
        fixture.signal(ageMillis = 60_001)
        assertTrue(fixture.trace.isEmpty())
        fixture.signal()
        fixture.signal()
        assertEquals(1, fixture.alerts.size)
        assertFalse(fixture.trace.contains("open"))
    }
}
