package br.com.atriocatolico

// Apenas a variante noticeLabAndroidTest, com Firestore/Auth Emulator e
// Worker em loopback. Clara=qa-nav-alice, Miguel=qa-nav-bob, Lúcia=qa-nav-lucia.
// Não chama FCM remoto nem serviço de assinatura.
import android.Manifest
import android.content.pm.PackageManager
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL

private fun postAge18Fixture(action: String) {
    check(action in setOf("revoke", "restore", "new-notice", "revoke-restoration"))
    val request = URL("http://127.0.0.1:8092/test/age18/$action")
        .openConnection(Proxy.NO_PROXY) as HttpURLConnection
    try {
        request.requestMethod = "POST"
        request.instanceFollowRedirects = false
        request.connectTimeout = 3_000
        request.readTimeout = 6_000
        assertEquals("Fixture de QA recusou $action", 204, request.responseCode)
    } finally {
        request.disconnect()
    }
}

class QaConversationNoticeAge18RestoredAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun miguelRecuperaLeituraMasAvisoAntigoPermaneceBloqueadoAteNovaAdmissao() {
        start(permissionGranted = true)
        // Miguel recebe sinal simulado FCM antes de perder elegibilidade.
        finish(signal())
        val staleTap = notices().single().notification.contentIntent
        postAge18Fixture("revoke")
        val priorReads = serverReads()
        staleTap.send()
        waitForRefusedTap(priorReads + 1)
        compose.onNodeWithTag("atrio-chat-thread").assertDoesNotExist()
        assertTrue(notices().isEmpty())

        // Consumo de ticket de uso único no serviço administrativo local.
        postAge18Fixture("restore")
        openManually()
        verifyMessage()
        val afterManual = serverReads()
        finish(signal())
        // Restaurar 18+ NÃO torna o aviso velho reutilizável.
        assertEquals(afterManual + 1, serverReads())
        assertTrue(notices().isEmpty())

        // Só outra admissão + mensagem canônica nova permitem novo aviso.
        postAge18Fixture("new-notice")
        finish(signal())
        compose.waitUntil(12_000) { notices().size == 1 }
        val fresh = notices().single().notification
        val beforeTap = serverReads()
        fresh.contentIntent.send()
        compose.waitUntil(30_000) {
            compose.onAllNodes(
                hasText("Mensagem nova após restauração 18+") and
                    hasAnyAncestor(hasTestTag("atrio-chat-thread"))
            ).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNode(
            hasText("Mensagem nova após restauração 18+") and
                hasAnyAncestor(hasTestTag("atrio-chat-thread"))
        ).assertIsDisplayed()
        assertEquals(beforeTap + 1, serverReads())
    }
}

class QaConversationNoticeAge18ReRevokedAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun revogacaoDoTokenConsumidoBloqueiaToqueDoNovoAviso() {
        start(permissionGranted = true)
        postAge18Fixture("revoke")
        postAge18Fixture("restore")
        postAge18Fixture("new-notice")
        finish(signal())
        compose.waitUntil(12_000) { notices().size == 1 }
        val tap = notices().single().notification.contentIntent
        postAge18Fixture("revoke-restoration")
        val before = serverReads()
        tap.send()
        waitForRefusedTap(before + 1)
        compose.onNodeWithTag("atrio-chat-thread").assertDoesNotExist()
        assertTrue(notices().isEmpty())
    }
}

class QaConversationNoticeThirdBotAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun luciaForaDaAdmissaoNaoRecebeAvisoNemAbreConversaEPermissaoNegadaPrevalece() {
        start(permissionGranted = true)
        auth.signOut()
        signIn("lucia")
        finish(signal())
        assertTrue("Lúcia sem elegibilidade não deve receber aviso", notices().isEmpty())
        compose.onNodeWithTag("atrio-chat-thread").assertDoesNotExist()
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        instrumentation.uiAutomation.revokeRuntimePermission(
            context.packageName,Manifest.permission.POST_NOTIFICATIONS
        )
        assertEquals(PackageManager.PERMISSION_DENIED,
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS))
        val reads = serverReads()
        finish(signal())
        assertEquals("Permissão negada deve evitar consulta",reads,serverReads())
        assertTrue(notices().isEmpty())
    }
}
