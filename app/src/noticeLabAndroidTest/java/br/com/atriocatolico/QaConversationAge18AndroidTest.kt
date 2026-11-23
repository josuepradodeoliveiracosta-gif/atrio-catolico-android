package br.com.atriocatolico

// Apenas a variante noticeLabAndroidTest, com Firestore/Auth Emulator e
// Worker em loopback. Clara=qa-nav-alice, Miguel=qa-nav-bob, Lúcia=qa-nav-lucia.
// Não chama FCM remoto nem serviço de assinatura.
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.onNodeWithTag
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import org.junit.Test
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL

private fun postAge18Fixture(action: String) {
    check(action in setOf("revoke", "restore", "new-notice", "revoke-restoration", "reverse-setup"))
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

private const val ITEM15_CHAT = "qa-nav-alice__qa-nav-bob"
private const val ITEM15_DM = "chats/$ITEM15_CHAT/messages/qa-199-mensagem"
private const val ITEM15_GROUP = "chat_groups/qa-199-item15-private/messages/qa-199-group-private"

// Autorizações devem ser demonstradas na rede: leituras de cache não contam.
private fun sourceServerReadable(path: String) {
    val snap = Tasks.await(
        FirebaseFirestore.getInstance().document(path).get(Source.SERVER),
        15, TimeUnit.SECONDS
    )
    assertTrue("Controle positivo deve existir: $path", snap.exists())
    assertTrue("O documento não pode ser obtido do cache: $path", !snap.metadata.isFromCache)
    assertTrue("Não pode haver escrita pendente: $path", !snap.metadata.hasPendingWrites())
}
private fun sourceServerDenied(path: String) {
    val reason = try {
        Tasks.await(
            FirebaseFirestore.getInstance().document(path).get(Source.SERVER),
            15, TimeUnit.SECONDS
        )
        null
    } catch (failure: ExecutionException) {
        failure.cause
    }
    assertTrue("Lúcia deve receber PERMISSION_DENIED em vez de documento/erro de rede: $path",
        reason is FirebaseFirestoreException &&
            reason.code == FirebaseFirestoreException.Code.PERMISSION_DENIED)
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
        compose.waitUntil(10_000) { notices().isEmpty() }

        // Consumo de ticket de uso único no serviço administrativo local.
        postAge18Fixture("restore")
        sourceServerReadable(ITEM15_DM)
        openManually()
        verifyMessage()
        val afterManual = serverReads()
        finish(signal())
        // Restaurar 18+ NÃO torna o aviso velho reutilizável.
        assertEquals(afterManual + 1, serverReads())
        compose.waitUntil(10_000) { notices().isEmpty() }

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
    @Test fun luciaNaoLeDmNemGrupoMesmoDepoisDaRestauracao() {
        start(permissionGranted = true)
        postAge18Fixture("revoke")
        postAge18Fixture("restore")
        // Controles positivos excluem falso sucesso por documento inexistente.
        sourceServerReadable(ITEM15_DM)
        sourceServerReadable(ITEM15_GROUP)
        auth.signOut()
        signIn("lucia")
        sourceServerDenied(ITEM15_DM)
        sourceServerDenied(ITEM15_GROUP)
        finish(signal())
        assertTrue("Lúcia não pode receber notificação", notices().isEmpty())
        compose.onNodeWithTag("atrio-chat-thread").assertDoesNotExist()
        // Permissão negada pertence à suíte isolada específica: revogá-la em
        // tempo de execução força kill do processo pelo Android.
    }
}

class QaConversationNoticeAge18ReverseAndroidTest : QaConversationNoticeAndroidCase() {
    @Test fun restauraClaraComoDestinoDeMensagemDeMiguel() {
        start(permissionGranted = true)
        postAge18Fixture("reverse-setup")
        auth.signOut()
        signIn("alice")
        finish(signal())
        compose.waitUntil(12_000) { notices().size == 1 }
        val old = notices().single().notification.contentIntent
        postAge18Fixture("revoke")
        val beforeOldTap = serverReads()
        old.send()
        waitForRefusedTap(beforeOldTap + 1)
        compose.waitUntil(10_000) { notices().isEmpty() }
        postAge18Fixture("restore")
        sourceServerReadable("chats/$ITEM15_CHAT/messages/qa-199-inverse-initial")
        val oldReads = serverReads()
        finish(signal())
        assertEquals(oldReads + 1, serverReads())
        compose.waitUntil(10_000) { notices().isEmpty() }
        postAge18Fixture("new-notice")
        finish(signal())
        compose.waitUntil(12_000) { notices().size == 1 }
        val tap = notices().single().notification.contentIntent
        val beforeTap = serverReads()
        tap.send()
        compose.waitUntil(30_000) {
            compose.onAllNodes(
                hasText("Mensagem nova após restauração 18+") and
                    hasAnyAncestor(hasTestTag("atrio-chat-thread"))
            ).fetchSemanticsNodes().isNotEmpty()
        }
        assertEquals(beforeTap + 1, serverReads())
    }
}
