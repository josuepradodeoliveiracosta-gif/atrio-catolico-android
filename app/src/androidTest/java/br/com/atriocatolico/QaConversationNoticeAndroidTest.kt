package br.com.atriocatolico

import android.Manifest
import android.app.Notification
import android.app.NotificationManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.SystemClock
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

abstract class QaConversationNoticeAndroidCase {
    private val instrument = InstrumentationRegistry.getInstrumentation()
    protected val context: Context get() = instrument.targetContext
    private val auth get() = FirebaseAuth.getInstance()
    private val db get() = FirebaseFirestore.getInstance()
    private val manager get() = context.getSystemService(NotificationManager::class.java)
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
        val user = Tasks.await(auth.signInWithEmailAndPassword(
            "bob.navegacao@qa.invalid", "GrupoQa2026!Emulador"), 10, TimeUnit.SECONDS).user
        assertEquals("qa-nav-bob", user?.uid)
        assertEquals(true, user?.isEmailVerified)
        val pending = Tasks.await(db.document("users/qa-nav-bob/chatPushPending/current")
            .get(Source.SERVER), 8, TimeUnit.SECONDS)
        assertEquals("qa-199-mensagem", pending.getString("messageId"))
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasTestTag("atrio-home-feed"), useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    protected fun inject() {
        val completion = CountDownLatch(1)
        val signal = Intent(context, QaConversationSignalReceiver::class.java).apply {
            action = QaConversationNotices.SIGNAL
            putExtra(QaConversationNotices.SIGNAL_TIME, SystemClock.elapsedRealtime())
        }
        val observer = object : BroadcastReceiver() {
            override fun onReceive(context: Context, intent: Intent) = completion.countDown()
        }
        context.sendOrderedBroadcast(signal, null, observer, null, 0, null, null)
        assertTrue("O receptor precisa concluir o sinal injetado", completion.await(10, TimeUnit.SECONDS))
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
        auth.signOut()
        manager.cancelAll()
    }
}

class QaConversationNoticeDeniedAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun permissaoNegadaMantemAMesmaMensagemAcessivel() {
        start(permissionGranted = false)
        inject()
        assertTrue(notices().isEmpty())
        openManually()
        verifyMessage()
    }
}

class QaConversationNoticeGrantedAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun avisoGenericoAbreConversaExataERepeticaoNaoExibeOutro() {
        start(permissionGranted = true)
        inject()
        compose.waitUntil(8_000) { notices().size == 1 }
        val alert = notices().single().notification
        assertEquals(QaConversationNotices.TITLE,
            alert.extras.getCharSequence(Notification.EXTRA_TITLE).toString())
        assertEquals("Abra o aplicativo para consultar suas conversas.",
            alert.extras.getCharSequence(Notification.EXTRA_TEXT).toString())
        assertNotNull(alert.contentIntent)
        inject()
        assertEquals(alert.contentIntent, notices().single().notification.contentIntent)
        alert.contentIntent.send()
        verifyMessage()
        inject()
        assertTrue(notices().isEmpty())
    }
}
