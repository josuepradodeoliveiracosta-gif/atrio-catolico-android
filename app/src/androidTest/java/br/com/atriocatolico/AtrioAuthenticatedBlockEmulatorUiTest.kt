package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.isEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import java.util.concurrent.TimeUnit
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Requer a fixture de inbox com o handler autenticado da #359 em loopback. */
@RunWith(AndroidJUnit4::class)
class AtrioAuthenticatedBlockEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun profileBlockWaitsForServerAndConversationCanUnblock() {
        val db = FirebaseFirestore.getInstance()
        val auth = FirebaseAuth.getInstance(db.app)
        check(BuildConfig.ATRIO_QA_INBOX_DISCOVERY && !BuildConfig.ATRIO_QA_GERAL_REMOTE)
        check(db.app.options.projectId == "demo-atrio-v11" &&
            db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)

        auth.signOut()
        val user = requireNotNull(Tasks.await(auth.signInWithEmailAndPassword(
            "inbox.clara@qa.invalid", "InboxQa355!Emulador"), 10, TimeUnit.SECONDS).user)
        val peer = PublicMemberTarget("qa-inbox-peer-01", "Par QA 01")
        val source = db.document("users/${user.uid}/blockedMembers/${peer.uid}")
        val inConversation = mutableStateOf(false)

        fun waitFor(text: String, substring: Boolean = false) = compose.waitUntil(20_000) {
            compose.onAllNodesWithText(text, substring = substring).fetchSemanticsNodes().isNotEmpty()
        }

        fun clickWhenEnabled(tag: String, text: String) {
            compose.waitUntil(20_000) {
                compose.onAllNodes(hasTestTag(tag) and hasText(text) and isEnabled())
                    .fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag(tag).performClick()
        }

        try {
            compose.setContent {
                AtrioTheme {
                    val blocks = rememberAtrioManagedBlocks(auth, user, db)
                    if (inConversation.value) {
                        AtrioConversationsScreen(db, user.uid, onBack = {},
                            initialPeer = peer, managedBlocks = blocks)
                    } else {
                        PublicMemberProfileScreen(db, peer, onBack = {}, onOpenDiscussion = {},
                            viewerUid = user.uid, managedBlocks = blocks)
                    }
                }
            }

            clickWhenEnabled("atrio-member-block", "Bloquear participante")
            waitFor("Bloqueio pendente", substring = true)
            compose.onNodeWithText("Participante bloqueado.").assertDoesNotExist()
            assertFalse(Tasks.await(source.get(Source.SERVER), 10, TimeUnit.SECONDS).exists())

            clickWhenEnabled("atrio-member-block", "Tentar novamente")
            waitFor("Participante bloqueado.")
            assertTrue(Tasks.await(source.get(Source.SERVER), 10, TimeUnit.SECONDS).exists())

            compose.runOnIdle { inConversation.value = true }
            clickWhenEnabled("atrio-chat-block-toggle", "Desbloquear participante")
            waitFor("Participante desbloqueado.")
            assertFalse(Tasks.await(source.get(Source.SERVER), 10, TimeUnit.SECONDS).exists())
            compose.onNodeWithTag("atrio-chat-block-toggle").assertTextContains("Bloquear participante")
        } finally {
            auth.signOut()
        }
    }
}
