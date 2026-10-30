package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onAllNodesWithText
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.TimeUnit

/** Exclusivo de emulador: projeto demo e Firebase Auth de teste. */
@RunWith(AndroidJUnit4::class)
class GuardianSessionUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private lateinit var db: FirebaseFirestore

    @Before fun setup() {
        assertTrue(BuildConfig.DEBUG)
        assertTrue(BuildConfig.GUARDIAN_WORKER_URL.isBlank())
        assertEquals("demo-atrio-v11", FirebaseApp.getInstance().options.projectId)
        auth = FirebaseAuth.getInstance()
        db = FirebaseFirestore.getInstance()
        auth.signOut()
    }

    @After fun cleanup() {
        if (::auth.isInitialized) auth.signOut()
    }

    @Test fun signedOutAuthorCannotOpenAppeal() {
        compose.setContent { GuardiaoAppealsScreen(db, "qaFakeOwner") }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Solicitar revisão").assertDoesNotExist()
        compose.onNodeWithText("Enviar contestação").assertDoesNotExist()
    }

    @Test fun logoutClosesAppealsWithoutWaitingForFirestore() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { GuardiaoAppealsScreen(db, user!!.uid) }
        auth.signOut()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Sessão alterada. Entre novamente.")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Enviar contestação").assertDoesNotExist()
    }

    @Test fun signedOutAdminCannotActivateGuardianOrReview() {
        compose.setContent { GuardianPanel(db, "qaFakeAdmin") }
        compose.onNodeWithText("Sessão alterada. Entre novamente.").assertIsDisplayed()
        compose.onNodeWithText("Preparar triagem sem retenção").assertIsNotEnabled()
        compose.onNodeWithText("Desligamento de emergência").assertIsNotEnabled()
        compose.onNodeWithText("Registrar decisão").assertDoesNotExist()
    }

    @Test fun signedOutModerationHidesPrivateQueue() {
        compose.setContent { ModerationScreen(db, "qaFakeAdmin", onBack = {}) }
        compose.onNodeWithText("Sessão alterada. Entre novamente para acessar a moderação.")
            .assertIsDisplayed()
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }

    @Test fun logoutClearsModerationQueueAndButtonsImmediately() {
        val user = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user
        assertTrue(user != null && user.uid.isNotBlank())
        compose.setContent { ModerationScreen(db, user!!.uid, onBack = {}) }
        auth.signOut()
        compose.waitUntil(15_000) {
            compose.onAllNodesWithText("Sessão alterada. Entre novamente para acessar a moderação.")
                .fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithText("Sessão alterada. Entre novamente para acessar a moderação.")
            .assertIsDisplayed()
        compose.onNodeWithText("Pendentes").assertDoesNotExist()
        compose.onNodeWithText("Remover foto inadequada").assertDoesNotExist()
    }
}
