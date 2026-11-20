package br.com.atriocatolico

import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollToNode
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.util.concurrent.TimeUnit

class ProfileV3ConsentEmulatorUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()
    private val sessions = mutableListOf<FirebaseAuth>()
    private lateinit var owner: FirebaseFirestore
    private lateinit var visitor: FirebaseFirestore
    private lateinit var uid: String
    private lateinit var visitorUid: String
    private val legacy get() = owner.document("profiles/$uid")
    private val privateV3 get() = owner.document("users/$uid/private/profile_v3")
    private val preferences get() = owner.document("users/$uid/private/preferences")
    private val publicProfile get() = visitor.document("public_profiles/$uid")
    private val name = "Pessoa de teste"
    private val saint = "Santa Teresinha"

    @Before fun setUp() {
        check(BuildConfig.APPLICATION_ID == "br.com.atriocatolico.qageral" &&
            BuildConfig.DEBUG && !BuildConfig.ATRIO_QA_GERAL_REMOTE &&
            !BuildConfig.ATRIO_QA_GERAL_PUSH && BuildConfig.PUSH_RELAY_URL.isBlank())
        val ownerSession = createSession("owner")
        owner = ownerSession.first
        uid = ownerSession.second
        val visitorSession = createSession("visitor")
        visitor = visitorSession.first
        visitorUid = visitorSession.second

        await(legacy.set(mapOf("displayName" to name, "createdAt" to FieldValue.serverTimestamp())))
        await(legacy.update("bio", "Apresentação anterior"))
        await(preferences.set(mapOf(
            "interests" to listOf("Oração", "Formação"),
            "participation" to "", "city" to "", "parish" to "",
            "consentVersion" to "cadastro-v2-2026-11",
            "consentAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp()
        )))
        await(privateV3.set(mapOf(
            "saint" to saint, "devotionPhrase" to "Fazer o simples com amor.",
            "ageBand" to "25–34", "maritalStatus" to "Casado(a)",
            "visibleFields" to ProfileV3Policy.visibleFields, "publicInterests" to listOf("Oração"),
            "consentVersion" to ProfileV3Policy.CONSENT_VERSION,
            "consentAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp()
        )))
        await(owner.document(publicProfile.path).set(mapOf(
            "displayName" to name, "bio" to "Apresentação anterior",
            "joinedAt" to requireNotNull(await(legacy.get(Source.SERVER)).getTimestamp("createdAt")),
            "updatedAt" to FieldValue.serverTimestamp(), "saint" to saint,
            "devotionPhrase" to "Fazer o simples com amor.", "ageBand" to "25–34",
            "maritalStatus" to "Casado(a)", "interests" to listOf("Oração")
        )))
    }

    @After fun cleanSessions() {
        sessions.forEach { it.signOut() }
    }

    @Test fun cancelThenWithdrawPreservesLegacyAndV2ForTheOwnerAndVisitor() {
        val beforeV3 = await(privateV3.get(Source.SERVER)).data
        val beforeProfile = await(legacy.get(Source.SERVER)).data
        val beforePreferences = await(preferences.get(Source.SERVER)).data
        val beforePublic = await(publicProfile.get(Source.SERVER)).data.orEmpty()
        assertEquals(saint, beforePublic["saint"])
        showEditor()
        openConfirmation()
        compose.onNodeWithText("Cancelar").performClick()
        assertEquals(beforeV3, await(privateV3.get(Source.SERVER)).data)
        assertEquals(beforePublic, await(publicProfile.get(Source.SERVER)).data)

        openConfirmation()
        compose.onNodeWithTag("atrio-profile-v3-withdraw-confirm").performClick()
        waitForTag("atrio-profile-v3-status")
        compose.onNodeWithTag("atrio-profile-v3-status").assertTextContains("Consentimento retirado.", substring = true)
        assertFalse(await(privateV3.get(Source.SERVER)).exists())
        assertEquals(beforeProfile, await(legacy.get(Source.SERVER)).data)
        assertEquals(beforePreferences, await(preferences.get(Source.SERVER)).data)
        val afterPublic = await(publicProfile.get(Source.SERVER)).data.orEmpty()
        assertEquals(beforePublic.filterKeys { it !in ProfileV3Policy.publicFields && it != "updatedAt" },
            afterPublic.filterKeys { it != "updatedAt" })

        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag("atrio-profile-v3-summary")).fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
        waitForEnabled("atrio-profile-v3-saint")
        compose.onNodeWithTag("atrio-profile-v3-saint").assert(
            SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(""))
        )
        compose.onNodeWithTag("atrio-profile-v3-save").assertIsNotEnabled()
    }

    @Test fun openEditorCannotRepublishAfterExternalWithdrawal() {
        showEditor()
        withdrawFromOutsideEditor()
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        waitForTag("atrio-profile-v3-message")
        compose.onNodeWithTag("atrio-profile-v3-message")
            .assertTextContains("Os dados do Perfil V3 mudaram.", substring = true)
        assertFalse(await(privateV3.get(Source.SERVER)).exists())
        assertFalse(await(publicProfile.get(Source.SERVER)).contains("saint"))
    }

    @Test fun visitorAlreadyOnProfileLosesThePublishedV3Fields() {
        compose.setContent {
            AtrioTheme {
                PublicMemberProfileScreen(visitor, PublicMemberTarget(uid, name),
                    onBack = {}, onOpenDiscussion = {}, viewerUid = visitorUid)
            }
        }
        waitForText("Santo de devoção · $saint")
        withdrawFromOutsideEditor()
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasText("Santo de devoção · $saint"))
                .fetchSemanticsNodes().isEmpty()
        }
        compose.onNodeWithText("Apresentação anterior").assertExists()
    }

    private fun createSession(role: String): Pair<FirebaseFirestore, String> {
        val appName = "perfil-v3-$role"
        // O SDK de Auth conserva o roteamento do emulador durante o processo.
        // Reutilizamos os apps, mas cada cenário recebe contas e documentos novos.
        val existing = FirebaseApp.getApps(compose.activity).firstOrNull { it.name == appName }
        val app = existing ?: requireNotNull(FirebaseApp.initializeApp(
            compose.activity, FirebaseOptions.Builder()
                .setProjectId("demo-atrio-v11")
                .setApplicationId("1:123456789012:android:0123456789abcdef")
                .setApiKey("local-emulator-test-$role").build(), appName
        ))
        val auth = FirebaseAuth.getInstance(app)
        val db = FirebaseFirestore.getInstance(app)
        if (existing == null) {
            auth.useEmulator("127.0.0.1", 9099)
            db.useEmulator("127.0.0.1", 8089)
        }
        check(db.firestoreSettings.host == "127.0.0.1:8089" && !db.firestoreSettings.isSslEnabled)
        sessions += auth
        auth.signOut()
        val user = requireNotNull(await(auth.createUserWithEmailAndPassword(
            "perfil-${UUID.randomUUID()}@qa.invalid", "PerfilFake-2026!"
        )).user)
        return db to user.uid
    }

    private fun showEditor() {
        compose.setContent {
            AtrioTheme {
                Column {
                    ProfileV3Summary(owner, uid)
                    ProfileV3Editor(owner, uid)
                }
            }
        }
        waitForTag("atrio-profile-v3-summary")
        compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
        waitForEnabled("atrio-profile-v3-save")
    }

    private fun waitForEnabled(tag: String) {
        compose.waitUntil(15_000) {
            runCatching {
                compose.onNodeWithTag(tag).assertIsEnabled()
            }.isSuccess
        }
    }

    private fun openConfirmation() {
        compose.onNodeWithTag("atrio-profile-v3-editor")
            .performScrollToNode(hasTestTag("atrio-profile-v3-withdraw"))
        compose.onNodeWithTag("atrio-profile-v3-withdraw").performClick()
        waitForText("Retirar consentimento do Perfil V3?")
    }

    private fun withdrawFromOutsideEditor() {
        val changes = ProfileV3Policy.publicFields.associateWith { FieldValue.delete() } +
            ("updatedAt" to FieldValue.serverTimestamp())
        val batch = owner.batch()
        batch.update(owner.document(publicProfile.path), changes)
        batch.delete(privateV3)
        await(batch.commit())
    }

    private fun waitForTag(tag: String) = compose.waitUntil(15_000) {
        compose.onAllNodes(hasTestTag(tag)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun waitForText(text: String) = compose.waitUntil(15_000) {
        compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isNotEmpty()
    }

    private fun <T> await(task: Task<T>): T = Tasks.await(task, 15, TimeUnit.SECONDS)
}
