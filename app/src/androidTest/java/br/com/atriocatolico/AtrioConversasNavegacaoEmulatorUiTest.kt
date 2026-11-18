package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import androidx.test.core.app.ApplicationProvider
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.TimeUnit

abstract class AtrioConversasNavegacaoQa {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private lateinit var auth: FirebaseAuth
    private val viewerName = "Alice QA"
    protected val peerName = "Bob QA"
    private val peerBio = "Apresentação fictícia da navegação QA."

    protected fun startApp(firestorePort: Int) {
        assertEquals("br.com.atriocatolico.qageral", BuildConfig.APPLICATION_ID)
        check(BuildConfig.DEBUG && BuildConfig.PUSH_RELAY_URL.isBlank())
        val context = ApplicationProvider.getApplicationContext<Context>()
        val project = "demo-atrio-v11"
        val app = FirebaseApp.getApps(context).firstOrNull {
            it.name == FirebaseApp.DEFAULT_APP_NAME
        } ?: requireNotNull(FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setProjectId(project)
            .setApplicationId("1:123456789012:android:0123456789abcdef")
            .setApiKey("local-emulator-test")
            .build()))
        assertEquals(project, app.options.projectId)
        auth = FirebaseAuth.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        val db = FirebaseFirestore.getInstance(app)
        db.useEmulator("127.0.0.1", firestorePort)
        assertEquals("127.0.0.1:" + firestorePort, db.firestoreSettings.host)
        auth.signOut()
        val user = requireNotNull(Tasks.await(auth.signInWithEmailAndPassword(
            "conversas.alice@qa.invalid", "GrupoQa2026!Emulador"), 15, TimeUnit.SECONDS).user)
        assertEquals(true, Tasks.await(user.getIdToken(true), 10, TimeUnit.SECONDS)
            .claims["email_verified"])
        val policy = Tasks.await(db.document("app_config/conversations").get(Source.SERVER),
            10, TimeUnit.SECONDS)
        assertEquals(true, policy.getBoolean("enabled"))
        assertEquals(true, policy.getBoolean("minorPolicyApproved"))
        val proof = Tasks.await(db.document("users/" + user.uid + "/chatAgeEligibility/current")
            .get(Source.SERVER), 10, TimeUnit.SECONDS)
        assertEquals("eligible", proof.getString("status"))
        val post = Tasks.await(db.document("posts/qa-nav-bob-profile").get(Source.SERVER),
            10, TimeUnit.SECONDS)
        val peerUid = requireNotNull(post.getString("uid"))
        assertTrue(user.uid != peerUid)
        assertEquals(peerName, post.getString("authorName"))
        compose.setContent { OnlineAtrioApp(compose.activity) }
        waitForTag("atrio-home-feed")
    }

    protected fun waitForTag(tag: String) {
        compose.waitUntil(30_000) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true)
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    protected fun ownProfile() {
        compose.onNodeWithTag("atrio-tab-profile").performClick()
        verifyOwnProfile()
    }

    protected fun verifyOwnProfile() {
        waitForTag("atrio-profile-list")
        val profile = hasTestTag("atrio-profile-list")
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-profile-avatar"))
        compose.onNode(hasText(viewerName) and hasAnyAncestor(profile))
            .assertIsDisplayed()
    }

    protected fun publicProfile() {
        compose.onNodeWithTag("atrio-tab-home").performClick()
        val author = "atrio-open-author-qa-nav-bob-profile"
        compose.waitUntil(30_000) {
            try {
                compose.onNodeWithTag("atrio-home-feed", useUnmergedTree = true)
                    .performScrollToNode(hasTestTag(author))
                true
            } catch (_: AssertionError) {
                false
            }
        }
        compose.onNodeWithTag(author, useUnmergedTree = true).assertIsDisplayed().performClick()
        verifyPublicProfile()
    }

    protected fun verifyPublicProfile() {
        waitForTag("atrio-public-profile")
        compose.onNodeWithTag("atrio-public-profile", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-public-profile-name"))
        val publicProfile = hasTestTag("atrio-public-profile")
        compose.onNode(hasText(peerName) and hasAnyAncestor(publicProfile)).assertIsDisplayed()
        compose.waitUntil(30_000) {
            compose.onAllNodes(hasText(peerBio) and hasAnyAncestor(publicProfile))
                .fetchSemanticsNodes().isNotEmpty()
        }
    }

    protected fun backFromConversations() {
        compose.onNodeWithContentDescription("Voltar").assertIsDisplayed().performClick()
        compose.onNodeWithTag("atrio-chats-screen").assertDoesNotExist()
    }

    @After fun endSession() {
        if (::auth.isInitialized) auth.signOut()
    }
}

class AtrioConversasNavegacaoEmulatorUiTest : AtrioConversasNavegacaoQa() {
    @Test fun abreConversasPelosPerfisERetorna() {
        startApp(8089)
        ownProfile()
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasText("Conversas"))
        compose.onNodeWithText("Conversas").assertIsDisplayed().performClick()
        waitForTag("atrio-chats-list")
        backFromConversations()
        verifyOwnProfile()
        android.util.Log.i("AtrioNavegacaoQA", "perfil_proprio=abriu_conversas_e_retornou")

        publicProfile()
        val converse = "atrio-public-profile-converse"
        compose.onNodeWithTag("atrio-public-profile", useUnmergedTree = true)
            .performScrollToNode(hasTestTag(converse))
        compose.onNodeWithTag(converse).assertIsDisplayed().performClick()
        waitForTag("atrio-chat-thread")
        compose.onNode(hasText(peerName) and hasAnyAncestor(hasTestTag("atrio-chat-thread")))
            .assertIsDisplayed()
        backFromConversations()
        verifyPublicProfile()
        android.util.Log.i("AtrioNavegacaoQA", "perfil_publico=abriu_destinatario_correto_e_retornou")
    }
}

class AtrioConversasForaDaConfiguracaoEmulatorUiTest : AtrioConversasNavegacaoQa() {
    @Test fun ocultaAsDuasEntradasForaDoEnderecoQa() {
        // Rota alternativa para o mesmo emulador via ADB reverse. As duas
        // contas e os portões continuam ativos, e o host exigido pelo app difere.
        startApp(18089)
        ownProfile()
        compose.onNodeWithTag("atrio-profile-list", useUnmergedTree = true)
            .performScrollToNode(hasText("Minhas discussões"))
        compose.onNodeWithText("Minhas discussões").assertIsDisplayed()
        compose.onNodeWithText("Conversas").assertDoesNotExist()

        publicProfile()
        compose.onNodeWithTag("atrio-public-profile", useUnmergedTree = true)
            .performScrollToNode(hasTestTag("atrio-member-block"))
        compose.onNodeWithTag("atrio-member-block").assertIsDisplayed()
        compose.onNodeWithTag("atrio-public-profile-converse").assertDoesNotExist()
        compose.onNodeWithText("Conversar").assertDoesNotExist()
        android.util.Log.i("AtrioNavegacaoQA",
            "host_alternativo=127.0.0.1:18089 conversas=oculta conversar=oculta")
    }
}
