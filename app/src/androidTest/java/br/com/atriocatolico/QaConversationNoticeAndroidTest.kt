package br.com.atriocatolico

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.ServiceConnection
import android.content.pm.PackageManager
import android.os.IBinder
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.QaMessagingInjection
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

abstract class QaConversationNoticeAndroidCase {
    private val instrument = InstrumentationRegistry.getInstrumentation()
    protected val context: Context get() = instrument.targetContext
    protected val auth get() = FirebaseAuth.getInstance()
    private val manager get() = context.getSystemService(NotificationManager::class.java)
    private var connection: ServiceConnection? = null
    private lateinit var binder: IBinder
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    protected fun start(permissionGranted: Boolean) {
        check(QaConversationNotices.enabled(context))
        if (permissionGranted) {
            instrument.uiAutomation.grantRuntimePermission(context.packageName, Manifest.permission.POST_NOTIFICATIONS)
        }
        assertEquals(permissionGranted, context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED)
        manager.cancelAll()
        auth.signOut()
        signIn("bob")
        val ready = CountDownLatch(1)
        val serviceConnection = object : ServiceConnection {
            override fun onServiceConnected(name: ComponentName, service: IBinder) {
                binder = service
                ready.countDown()
            }
            override fun onServiceDisconnected(name: ComponentName) = Unit
        }
        check(context.bindService(Intent("com.google.firebase.MESSAGING_EVENT")
            .setClass(context, AtrioPushService::class.java), serviceConnection, Context.BIND_AUTO_CREATE))
        connection = serviceConnection
        assertTrue("O serviço FCM do APK precisa estar disponível", ready.await(10, TimeUnit.SECONDS))
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasTestTag("atrio-home-feed"), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    protected fun signIn(account: String) {
        val user = Tasks.await(auth.signInWithEmailAndPassword(
            "$account.navegacao@qa.invalid", "GrupoQa2026!Emulador"), 10, TimeUnit.SECONDS).user
        assertEquals("qa-nav-$account", user?.uid)
        assertEquals(true, user?.isEmailVerified)
    }

    protected fun signal(extra: Boolean = false, ageMs: Long = 0): Task<Void> {
        val input = Intent("com.google.android.c2dm.intent.RECEIVE").apply {
            putExtra("google.sent_time", System.currentTimeMillis() - ageMs)
            putExtra("google.ttl", 60)
            putExtra("signal", "refresh")
            if (extra) putExtra("messageId", "extra-recusado")
        }
        return QaMessagingInjection.deliver(binder, input)
    }

    protected fun finish(task: Task<Void>) {
        Tasks.await(task, 14, TimeUnit.SECONDS)
    }

    private fun fixture(path: String, method: String = "GET"): JSONObject? {
        val call = URL("http://127.0.0.1:8092/test/$path")
            .openConnection(Proxy.NO_PROXY) as HttpURLConnection
        return try {
            call.instanceFollowRedirects = false
            call.connectTimeout = 1_500
            call.readTimeout = 1_500
            call.requestMethod = method
            when (method) {
                "GET" -> {
                    check(call.responseCode == 200)
                    JSONObject(call.inputStream.bufferedReader().use { it.readText() })
                }
                else -> {
                    check(call.responseCode == 204)
                    null
                }
            }
        } finally {
            call.disconnect()
        }
    }

    protected fun serverReads(): Int = requireNotNull(fixture("state")).getInt("reads")

    protected fun holdServerResponse() {
        fixture("hold", "POST")
    }

    protected fun waitForHeldResponse() {
        compose.waitUntil(5_000) { fixture("state")?.getBoolean("held") == true }
    }

    protected fun releaseServerResponse() {
        fixture("release", "POST")
    }

    protected fun notices() = manager.activeNotifications.filter {
        it.notification.channelId == QaConversationNotices.CHANNEL
    }

    protected fun verifyMessage() {
        val message = hasText("Mensagem fictícia do teste 08–09") and
            hasAnyAncestor(hasTestTag("atrio-chat-thread"))
        compose.waitUntil(30_000) {
            compose.onAllNodes(message).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNode(message).assertIsDisplayed()
    }

    protected fun openManually() {
        val author = "atrio-open-author-qa-nav-alice-notice"
        compose.waitUntil(30_000) {
            try {
                compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
                    .performScrollToNode(hasTestTag(author))
                true
            } catch (_: AssertionError) {
                false
            }
        }
        compose.onNodeWithTag(author, useUnmergedTree = true).performClick()
        val converse = "atrio-public-profile-converse"
        compose.waitUntil(20_000) {
            compose.onAllNodes(hasTestTag(converse), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-public-profile", useUnmergedTree = true)
            .performScrollToNode(hasTestTag(converse))
        compose.onNodeWithTag(converse).performClick()
    }

    @After fun finishSession() {
        connection?.let { context.unbindService(it) }
        auth.signOut()
        manager.cancelAll()
    }
}

class QaConversationNoticeDeniedAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun permissaoNegadaMantemAMesmaMensagemAcessivel() {
        start(permissionGranted = false)
        val reads = serverReads()
        finish(signal())
        assertTrue(notices().isEmpty())
        assertEquals(reads, serverReads())
        openManually()
        verifyMessage()
    }
}

class QaConversationNoticeGrantedAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun avisoGenericoAbreConversaExataERepeticaoNaoExibeOutro() {
        start(permissionGranted = true)
        val before = serverReads()
        finish(signal(extra = true))
        finish(signal(ageMs = 61_000))
        assertEquals(before, serverReads())
        assertTrue(notices().isEmpty())

        holdServerResponse()
        val delivery = signal()
        waitForHeldResponse()
        assertEquals(before + 1, serverReads())
        assertTrue(notices().isEmpty())
        releaseServerResponse()
        finish(delivery)
        compose.waitUntil(8_000) { notices().size == 1 }
        val alert = notices().single().notification
        assertEquals(QaConversationNotices.TITLE,
            alert.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("Abra o aplicativo para consultar suas conversas.",
            alert.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertNotNull(alert.contentIntent)
        finish(signal())
        assertEquals(alert.contentIntent, notices().single().notification.contentIntent)
        val beforeTap = serverReads()
        alert.contentIntent.send()
        verifyMessage()
        assertEquals(beforeTap + 1, serverReads())
        finish(signal())
        assertTrue(notices().isEmpty())
    }
}

class QaConversationNoticeSessionAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun respostaEmVooDaSessaoAnteriorNaoExibeAviso() {
        start(permissionGranted = true)
        holdServerResponse()
        val delivery = signal()
        waitForHeldResponse()
        auth.signOut()
        signIn("alice")
        releaseServerResponse()
        finish(delivery)
        assertTrue(notices().isEmpty())

        auth.signOut()
        signIn("bob")
        finish(signal())
        assertEquals(1, notices().size)
    }
}
