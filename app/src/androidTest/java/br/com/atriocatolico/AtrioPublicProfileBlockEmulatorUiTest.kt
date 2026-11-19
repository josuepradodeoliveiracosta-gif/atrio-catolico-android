package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import java.net.HttpURLConnection
import java.net.Proxy
import java.net.URL
import java.util.UUID
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Perfil real, Auth/Firestore Emulator e rotas autenticadas em loopback. */
@RunWith(AndroidJUnit4::class)
class AtrioPublicProfileBlockEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test fun serverBlockFromSeparateSessionHidesLoadedDiscussionBeforeAndAfterLateHttp() {
        val db = FirebaseFirestore.getInstance()
        check(isAtrioManagedInboxQa(db))
        val auth = FirebaseAuth.getInstance(db.app)
        auth.signOut()
        val user = signIn(auth)
        val otherApp = FirebaseApp.initializeApp(compose.activity, db.app.options, "profile-block-secondary")
        val otherAuth = FirebaseAuth.getInstance(otherApp)
        otherAuth.useEmulator("127.0.0.1", 9099)

        try {
            val otherUser = signIn(otherAuth)
            assertEquals(user.uid, otherUser.uid)
            assertNotSame(user, otherUser)
            val primaryHttp = AtrioInboxBlockHttp(
                token = { atrioQaInboxToken(auth, user) }, readTimeoutMs = 28_000)
            val secondaryHttp = AtrioInboxBlockHttp(token = { atrioQaInboxToken(otherAuth, otherUser) })
            val blocks = AtrioManagedBlocks({ auth.currentUser === user }, primaryHttp)
            val peer = PublicMemberTarget("qa-inbox-peer-03", "Par QA 03")
            val forceRefresh = mutableStateOf(false)
            val profile = "atrio-public-profile"
            val post = "qa-inbox-profile-post"
            val postTag = "atrio-public-post-$post"
            val title = "Discussão já carregada em QA"
            val excerpt = "Trecho fictício para o focal de bloqueio."
            val hidden = "As publicações deste participante estão ocultas para você."

            compose.setContent {
                AtrioTheme {
                    val confirmed = rememberBlockedMembers(db, user.uid, retry = 0)
                    LaunchedEffect(forceRefresh.value) {
                        if (forceRefresh.value) blocks.refresh(peer.uid)
                    }
                    if (confirmed != null) PublicMemberProfileScreen(
                        db, peer, onBack = {}, onOpenDiscussion = {}, viewerUid = user.uid,
                        onConverse = {}, managedBlocks = blocks, confirmedBlockedMembers = confirmed)
                }
            }
            compose.waitUntil(15_000) { blocks.confirmed(peer.uid)?.blocked == false && !blocks.loading(peer.uid) }
            compose.onNodeWithTag(profile).performScrollToIndex(2)
            compose.waitUntil(15_000) {
                compose.onAllNodes(hasTestTag(postTag)).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithTag(postTag).assertIsDisplayed().assertTextContains(title)
            compose.onNodeWithText(excerpt).assertExists()
            assertEquals(title, await(db.document("posts/$post").get(Source.CACHE)).getString("title"))
            val oldState = compose.runOnIdle { requireNotNull(blocks.confirmed(peer.uid)) }

            assertEquals(204, fixture("POST"))
            compose.runOnIdle { forceRefresh.value = true }
            compose.waitUntil(15_000) { fixture("GET") == 200 }
            assertTrue(compose.runOnIdle { blocks.loading(peer.uid) })

            val committed = runBlocking {
                secondaryHttp.submit(AtrioBlockIntent(UUID.randomUUID().toString(), peer.uid, true, oldState.etag))
            } as AtrioBlockReply.Committed
            assertTrue(committed.state.blocked)
            assertTrue(await(db.document("users/${user.uid}/blockedMembers/${peer.uid}").get(Source.SERVER)).exists())
            compose.onNodeWithTag(profile).performScrollToIndex(1)
            compose.waitUntil(15_000) { compose.onAllNodesWithText(hidden).fetchSemanticsNodes().isNotEmpty() }

            fun assertProfileContentHidden() {
                compose.onNodeWithText(hidden).assertIsDisplayed()
                compose.onNodeWithTag(postTag).assertDoesNotExist()
                compose.onNodeWithText(title).assertDoesNotExist()
                compose.onNodeWithText(excerpt).assertDoesNotExist()
                compose.onNodeWithText("1 discussões carregadas", substring = true).assertDoesNotExist()
                compose.onNodeWithTag("atrio-public-profile-converse").assertDoesNotExist()
            }

            assertProfileContentHidden()
            assertTrue(compose.runOnIdle { blocks.loading(peer.uid) })
            assertEquals(204, fixture("DELETE"))
            compose.waitUntil(15_000) { !blocks.loading(peer.uid) }
            assertEquals(oldState, compose.runOnIdle { blocks.confirmed(peer.uid) })
            assertProfileContentHidden()

            compose.onNodeWithTag("atrio-member-block").assertTextContains("Atualizar estado").performClick()
            compose.waitUntil(15_000) { blocks.confirmed(peer.uid)?.blocked == true && !blocks.loading(peer.uid) }
            compose.onNodeWithTag("atrio-member-block").assertTextContains("Desbloquear participante")
            assertProfileContentHidden()
        } finally {
            otherAuth.signOut()
            otherApp.delete()
            auth.signOut()
        }
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 10, TimeUnit.SECONDS)

    private fun signIn(auth: FirebaseAuth): FirebaseUser =
        requireNotNull(await(auth.signInWithEmailAndPassword("inbox.clara@qa.invalid", "InboxQa355!Emulador")).user)

    private fun fixture(method: String): Int {
        val call = URL("http://127.0.0.1:8091/qa/profile-block")
            .openConnection(Proxy.NO_PROXY) as HttpURLConnection
        return try {
            call.instanceFollowRedirects = false
            call.useCaches = false
            call.connectTimeout = 2_000
            call.readTimeout = 3_000
            call.requestMethod = method
            call.responseCode
        } finally {
            call.disconnect()
        }
    }
}
