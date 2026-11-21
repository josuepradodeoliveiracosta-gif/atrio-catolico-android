package br.com.atriocatolico

import android.util.Base64
import androidx.activity.ComponentActivity
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.firestore.Source
import java.security.KeyStore
import java.security.cert.CertificateFactory
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManagerFactory
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

class ProfileV3DiscussionHttpEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @Test
    fun realHttpOpensOnlyTheLinkedDiscussionForAnAuthorizedVisitor() {
        val app = requireNotNull(FirebaseApp.initializeApp(
            compose.activity,
            FirebaseOptions.Builder()
                .setProjectId("demo-atrio-v11")
                .setApplicationId("1:123456789012:android:0123456789abcdef")
                .setApiKey("qa-local-key")
                .build(),
            "perfil-v3-http-emulator"
        ))
        val auth = FirebaseAuth.getInstance(app)
        val db = FirebaseFirestore.getInstance(app)
        auth.useEmulator("127.0.0.1", 9099)
        db.useEmulator("127.0.0.1", 8089)
        check(db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)
        val client = ProfileV3DiscussionClient.forLocalQa(auth, localTls())
        val postRef = db.collection("posts").document("qa-v3-http-z-escolhida")

        fun signIn(account: String) = requireNotNull(
            await(auth.signInWithEmailAndPassword("$account@qa.invalid", "SenhaSomenteNoEmulador42!")).user
        )

        try {
            val denied = signIn("qa-v3-http-refused")
            assertFalse(denied.isEmailVerified)
            val readFailure = runCatching { await(postRef.get(Source.SERVER)) }.exceptionOrNull()
            val deniedCode = ((readFailure as? ExecutionException)?.cause as? FirebaseFirestoreException)?.code
            assertEquals(FirebaseFirestoreException.Code.PERMISSION_DENIED, deniedCode)

            var viewerUid by mutableStateOf(denied.uid)
            var openedId by mutableStateOf<String?>(null)
            var post by mutableStateOf<Post?>(null)
            compose.setContent {
                AtrioTheme {
                    key(viewerUid) {
                        val selected = post
                        if (selected == null) {
                            PublicMemberProfileScreen(
                                db = db,
                                target = PublicMemberTarget("qa-v3-http-profile", "Perfil fictício do vínculo"),
                                viewerUid = viewerUid,
                                onBack = {},
                                discussionResolver = client,
                                onOpenDiscussion = { id ->
                                    openedId = id
                                    db.collection("posts").document(id).get(Source.SERVER)
                                        .addOnSuccessListener { snapshot ->
                                            if (snapshot.exists()) post = Post(
                                                id = snapshot.id,
                                                author = snapshot.getString("authorName").orEmpty(),
                                                category = snapshot.getString("category").orEmpty(),
                                                age = "",
                                                title = snapshot.getString("title").orEmpty(),
                                                body = snapshot.getString("body").orEmpty(),
                                                ownerUid = snapshot.getString("uid").orEmpty(),
                                                remote = true
                                            )
                                        }
                                }
                            )
                        } else {
                            DetailScreen(selected, "Visitante fictício", {}, {}, { _, done -> done(false) })
                        }
                    }
                }
            }

            waitForText("Discussão indisponível")
            compose.onNodeWithText("Como começar a rezar?").assertExists()
            compose.onNodeWithText("Discussão exata escolhida").assertDoesNotExist()
            compose.onNodeWithTag("atrio-v3-open-oracao").assertDoesNotExist()
            compose.runOnIdle { assertEquals(null, openedId) }

            auth.signOut()
            val allowed = signIn("qa-v3-http-permitted")
            assertTrue(allowed.isEmailVerified)
            assertTrue(await(db.collection("posts").document("qa-v3-http-a-outra").get(Source.SERVER)).exists())
            compose.runOnIdle { viewerUid = allowed.uid }
            waitForText("Discussão exata escolhida")
            compose.onNodeWithText("Outra discussão da mesma categoria").assertDoesNotExist()
            compose.onNodeWithTag("atrio-v3-open-oracao").performClick()
            compose.waitUntil(20_000) {
                compose.onAllNodes(hasTestTag("atrio-detail-v2")).fetchSemanticsNodes().isNotEmpty()
            }
            compose.onNodeWithText("Discussão exata escolhida").assertExists()
            compose.onNodeWithText("Texto do destino exato no Firestore Emulator.").assertExists()
            compose.runOnIdle { assertEquals(postRef.id, openedId) }
        } finally {
            auth.signOut()
        }
    }

    private fun localTls(): javax.net.ssl.SSLSocketFactory {
        val encoded = requireNotNull(InstrumentationRegistry.getArguments().getString("profileV3WorkerCert"))
        val certificate = Base64.decode(encoded, Base64.DEFAULT).inputStream().use {
            CertificateFactory.getInstance("X.509").generateCertificate(it)
        }
        val trust = KeyStore.getInstance(KeyStore.getDefaultType()).apply {
            load(null, null)
            setCertificateEntry("qa-profile-v3", certificate)
        }
        val managers = TrustManagerFactory.getInstance(TrustManagerFactory.getDefaultAlgorithm()).apply {
            init(trust)
        }
        return SSLContext.getInstance("TLS").apply { init(null, managers.trustManagers, null) }.socketFactory
    }

    private fun waitForText(value: String) = compose.waitUntil(20_000) {
        compose.onAllNodes(hasText(value)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 15, TimeUnit.SECONDS)
}
