package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import java.util.concurrent.TimeUnit
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Executar somente com o handler de teste da #359, por adb reverse em 8091. */
@RunWith(AndroidJUnit4::class)
class AtrioInboxDiscoveryEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun percorreAteUltimaPaginaETrocaDeContaSemPreviaAnterior() {
        val db = FirebaseFirestore.getInstance()
        val auth = FirebaseAuth.getInstance(db.app)
        check(BuildConfig.ATRIO_QA_INBOX_DISCOVERY && !BuildConfig.ATRIO_QA_GERAL_REMOTE)
        check(db.app.options.projectId == "demo-atrio-v11" &&
            db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)
        val uid = mutableStateOf<String?>(null)
        fun login(name: String) {
            auth.signOut()
            val user = requireNotNull(Tasks.await(auth.signInWithEmailAndPassword(
                "inbox.$name@qa.invalid", "InboxQa355!Emulador"), 10, TimeUnit.SECONDS).user)
            compose.runOnIdle { uid.value = user.uid }
        }
        fun waitFor(tag: String) = compose.waitUntil(20_000) {
            compose.onAllNodesWithTag(tag).fetchSemanticsNodes().isNotEmpty()
        }
        val page = "atrio-inbox-page"
        val next = "atrio-inbox-next"
        compose.setContent {
            AtrioTheme {
                uid.value?.let { AtrioConversationsScreen(db, it, onBack = {}) }
            }
        }
        try {
            login("clara")
            waitFor(next)
            compose.onNodeWithTag(page).assertTextContains("Página 1")
            compose.onNodeWithTag(next).performClick()
            waitFor(next)
            compose.onNodeWithTag(page).assertTextContains("Página 2")
            compose.onNodeWithTag(next).performClick()
            waitFor(page)
            compose.onNodeWithTag(page).assertTextContains("Última página", substring = true)
            compose.onNodeWithTag(next).assertDoesNotExist()

            val claraUid = checkNotNull(uid.value)
            login("miguel")
            waitFor("atrio-inbox-empty")
            compose.onNodeWithTag("atrio-inbox-empty").assertTextContains("Nenhuma conversa encontrada.")
            compose.onNodeWithTag("atrio-chat-" + AtrioChatPolicy.id(claraUid, "qa-inbox-peer-43"))
                .assertDoesNotExist()
            compose.onNodeWithTag("atrio-inbox-unavailable").assertDoesNotExist()

            login("lucia")
            waitFor("atrio-inbox-unavailable")
            compose.onNodeWithTag("atrio-inbox-empty").assertDoesNotExist()
            compose.onNodeWithTag(next).assertDoesNotExist()
        } finally {
            auth.signOut()
        }
    }
}
