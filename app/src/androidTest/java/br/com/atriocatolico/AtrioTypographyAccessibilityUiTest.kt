package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import java.util.UUID
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotSame
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Testes de acessibilidade e privacidade. As contas usadas pelos focais de
 * privacidade vivem exclusivamente nos emuladores locais do runner de QA.
 */
@RunWith(AndroidJUnit4::class)
class AtrioTypographyAccessibilityUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun erroDosAvisosPermiteRetentativaComFonteAmpliada() {
        var retries = 0
        compose.setContent {
            val base = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(base.density, 2.0f)) {
                AtrioTheme {
                    NotificationConnectionStatus(failed = true, stale = false) { retries++ }
                }
            }
        }
        compose.onNodeWithTag("atrio-notices-load-error").assertExists()
        compose.onNodeWithTag("atrio-notices-retry").assertIsDisplayed()
            .assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals(1, retries) }
    }

    @Test fun cacheDeAvisosTemEstadoOfflineDistintoDeVazio() {
        compose.setContent {
            AtrioTheme {
                NotificationConnectionStatus(failed = false, stale = true) {}
            }
        }
        compose.onNodeWithTag("atrio-notices-offline").assertExists()
        compose.onNodeWithText("Tentar novamente").assertDoesNotExist()
    }

    @Test fun campoDeRespostaContinuaAcessivelComFonteDuzentosPorCento() {
        val post = Post(
            id = "qa-tipografia-detalhe", author = "Participante de teste",
            category = "Vida espiritual", age = "hoje",
            title = "Diálogo na comunidade",
            body = "Uma reflexão sobre a fé para ler com conforto.",
            replies = listOf(Reply("Outra participante",
                "Esta resposta deve ficar legível sem perder as ações.", id = "qa-tipografia-reply"))
        )
        var sent = ""
        compose.setContent {
            val systemDensity = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(systemDensity.density, 2.0f)) {
                AtrioTheme {
                    DetailScreen(
                        post = post, name = "Participante de teste",
                        onLike = {}, onSave = {},
                        onReply = { body, complete -> sent = body; complete(true) }
                    )
                }
            }
        }
        compose.onNodeWithTag("atrio-open-reply-composer").assertIsDisplayed().performClick()
        compose.onNodeWithTag("atrio-reply-input").assertIsDisplayed()
            .performTextInput("Resposta com letras ampliadas")
        compose.onNodeWithTag("atrio-reply-submit").assertIsEnabled().performClick()
        compose.runOnIdle { assertEquals("Resposta com letras ampliadas", sent) }
    }

    @Test fun navegacaoMantemTodosOsDestinosComFonteCentoESessentaPorCento() {
        compose.setContent {
            val systemDensity = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(systemDensity.density, 1.6f)) {
                AtrioTheme {
                    AtrioBottomBar(selected = Tab.HOME, onSelect = {})
                }
            }
        }
        listOf("home", "communities", "publish", "saved", "profile").forEach { destination ->
            compose.onNodeWithTag("atrio-tab-${destination}").assertExists()
        }
    }

    private val db get() = FirebaseFirestore.getInstance().also {
        check(it.app.options.projectId == "demo-atrio-v11" &&
            it.firestoreSettings.host == "127.0.0.1:8089" && !it.firestoreSettings.isSslEnabled)
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 15, TimeUnit.SECONDS)

    private fun createAccount(auth: FirebaseAuth, email: String): FirebaseUser =
        requireNotNull(await(auth.createUserWithEmailAndPassword(email, "Qa354-emulador!")).user)

    private fun signIn(auth: FirebaseAuth, email: String): FirebaseUser =
        requireNotNull(await(auth.signInWithEmailAndPassword(email, "Qa354-emulador!")).user)

    private fun waitForText(text: String) {
        compose.waitUntil(15_000) { compose.onAllNodesWithText(text).fetchSemanticsNodes().isNotEmpty() }
    }

    @Test fun modalOfAClosesOnBAndDoesNotReturnWithA() {
        val firestore = db
        val auth = FirebaseAuth.getInstance(firestore.app)
        val marker = UUID.randomUUID().toString()
        val emailA = "qa354-a-$marker@qa.invalid"
        val emailB = "qa354-b-$marker@qa.invalid"
        val a = createAccount(auth, emailA)
        try {
            val b = createAccount(auth, emailB)
            auth.signOut()
            signIn(auth, emailA)
            var currentInbox: NotificationInbox? = null
            val aNotice = NoticeEvent("mesmo-id", NoticeKind.REPLY, "discussao-qa",
                "Aviso fictício de A", "Abrir discussão", actorUid = "participante-qa")
            val bNotice = aNotice.copy(title = "Aviso fictício de B")
            compose.setContent {
                AtrioTheme {
                    val user = rememberAtrioCurrentUser(auth)
                    if (user != null) {
                        val inbox = remember(user) {
                            NotificationInbox(firestore, user.uid, compose.activity.getSharedPreferences(
                                "notice-qa354-${user.uid}", Context.MODE_PRIVATE),
                                { auth.currentUser === user }, { emptySet() }, { false }).apply {
                                replies = listOf(if (user.uid == a.uid) aNotice else bNotice)
                                loadingReplies = false
                                loadingReview = false
                            }
                        }
                        currentInbox = inbox
                        NotificationCenter(inbox, false, emptyMap(), onOpen = {})
                    }
                }
            }
            val modal = "Dispensar avisos de respostas?"
            fun openDismiss() {
                compose.onNodeWithTag("atrio-notices-list").performScrollToNode(hasTestTag("atrio-notice-dismiss"))
                compose.onNodeWithTag("atrio-notice-dismiss").performClick()
                compose.onNodeWithText(modal).assertIsDisplayed()
            }
            waitForText(aNotice.title)
            openDismiss()
            val oldInbox = compose.runOnIdle { requireNotNull(currentInbox) }
            val oldGroup = groupNotices(listOf(aNotice), false).single()

            auth.signOut()
            signIn(auth, emailB)
            waitForText(bNotice.title)
            compose.onNodeWithText(modal).assertDoesNotExist()
            compose.onNodeWithText(aNotice.title).assertDoesNotExist()
            compose.runOnIdle {
                val inbox = requireNotNull(currentInbox)
                assertTrue(inbox.uid == b.uid)
                inbox.dismiss(oldGroup)
                assertFalse(inbox.busy)
                assertFalse(oldInbox.sessionIsCurrent())
            }

            auth.signOut()
            signIn(auth, emailA)
            waitForText(aNotice.title)
            compose.onNodeWithText(modal).assertDoesNotExist()
            compose.runOnIdle { assertNotSame(oldInbox, currentInbox) }
            openDismiss()
        } finally {
            auth.signOut()
        }
    }

    @Test fun blockedContentStaysHiddenOfflineAndIsConfirmedSeparatelyOnAccountChange() {
        val firestore = db
        val auth = FirebaseAuth.getInstance(firestore.app)
        val marker = UUID.randomUUID().toString()
        val emailA = "qa354-block-a-$marker@qa.invalid"
        val emailB = "qa354-block-b-$marker@qa.invalid"
        val peer = "qa354-bloqueado"
        val a = createAccount(auth, emailA)
        val retry = mutableIntStateOf(0)
        val content = "Publicação fictícia do participante"
        try {
            val block = firestore.document("users/${a.uid}/blockedMembers/$peer")
            await(block.set(mapOf("createdAt" to FieldValue.serverTimestamp())))
            assertTrue(await(block.get(Source.SERVER)).exists())
            createAccount(auth, emailB)
            auth.signOut()
            signIn(auth, emailA)
            await(firestore.disableNetwork())
            compose.setContent {
                AtrioTheme {
                    val user = rememberAtrioCurrentUser(auth)
                    if (user != null) {
                        val blocks = rememberBlockedMembers(firestore, user.uid, retry.intValue)
                        if (blocks == null) BlockedMembersConnectionStatus { retry.intValue++ }
                        else if (canShowWithBlockedMembers(blocks, peer)) Text(content)
                        else Text("Bloqueio confirmado")
                    }
                }
            }
            compose.onNodeWithTag("atrio-block-list-unconfirmed").assertExists()
            compose.onNodeWithText(content).assertDoesNotExist()
            await(firestore.enableNetwork())
            waitForText("Bloqueio confirmado")
            compose.onNodeWithText(content).assertDoesNotExist()

            await(firestore.disableNetwork())
            auth.signOut()
            signIn(auth, emailB)
            compose.onNodeWithTag("atrio-block-list-unconfirmed").assertExists()
            compose.onNodeWithText(content).assertDoesNotExist()
            await(firestore.enableNetwork())
            waitForText(content)
            compose.onNodeWithText("Bloqueio confirmado").assertDoesNotExist()
        } finally {
            await(firestore.enableNetwork())
            auth.signOut()
        }
    }
}
