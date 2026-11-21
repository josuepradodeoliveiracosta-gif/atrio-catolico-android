package br.com.atriocatolico

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Rect
import android.os.Build
import android.app.UiAutomation
import android.os.ParcelFileDescriptor
import android.util.Log
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import androidx.test.platform.app.InstrumentationRegistry
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Column
import androidx.compose.material3.Button
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.unit.Density
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsFocused
import androidx.compose.ui.test.assertIsOff
import androidx.compose.ui.test.assertIsOn
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.hasAnyAncestor
import androidx.compose.ui.test.hasTestTag
import androidx.compose.ui.test.hasText
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.click
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performTouchInput
import androidx.compose.ui.test.performScrollToNode
import androidx.compose.ui.test.performTextReplacement
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
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import kotlinx.coroutines.CompletableDeferred
import java.util.concurrent.ConcurrentLinkedQueue
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
    private val fakePassword = "PerfilFake-2026!"

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
    }

    private fun seedV3(
        devotionVisible: Boolean = true,
        interests: List<String> = listOf("Oração")
    ) {
        val visibleFields = if (devotionVisible) ProfileV3Policy.visibleFields
            else ProfileV3Policy.visibleFields.filterNot { it == "saint" }
        await(privateV3.set(mapOf(
            "saint" to saint, "devotionPhrase" to "Fazer o simples com amor.",
            "ageBand" to "25–34", "maritalStatus" to "Casado(a)",
            "visibleFields" to visibleFields, "publicInterests" to interests,
            "consentVersion" to ProfileV3Policy.CONSENT_VERSION,
            "consentAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp()
        )))
        val published = mapOf(
            "displayName" to name, "bio" to "Apresentação anterior",
            "joinedAt" to requireNotNull(await(legacy.get(Source.SERVER)).getTimestamp("createdAt")),
            "updatedAt" to FieldValue.serverTimestamp(), "saint" to saint,
            "devotionPhrase" to "Fazer o simples com amor.", "ageBand" to "25–34",
            "maritalStatus" to "Casado(a)", "interests" to interests
        )
        await(owner.document(publicProfile.path).set(if (devotionVisible) published
            else published - setOf("saint", "devotionPhrase")))
    }

    @After fun cleanSessions() {
        sessions.forEach { it.signOut() }
    }

    @Test fun interestAccessibilityWithLargeText() {
        seedV3()
        val linkedTitle = "Oração em comunidade"
        val linked = createDiscussion(linkedTitle)
        val removed = createDiscussion("Discussão retirada")
        val question = "Como rezar em comunidade?"
        val fieldTag = "atrio-v3-question-oracao"
        val pickerTag = "atrio-v3-pick-oracao"
        val counter = "${question.length}/140"
        val a11y = compose.activity.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val talkBackInstalled = a11y.installedAccessibilityServiceList.any {
            it.resolveInfo.serviceInfo.name.endsWith("TalkBackService")
        }
        val talkBackActive = a11y.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_SPOKEN).any {
            it.resolveInfo.serviceInfo.name.endsWith("TalkBackService")
        }
        Log.i("AtrioQaProfileV3", "a11y_font_scale=1.5 talkback_installed=$talkBackInstalled talkback_active=$talkBackActive")

        showEditor(fontScale = 1.5f)
        editorControl(fieldTag).performTextReplacement("🕊".repeat(141))
        compose.onNodeWithText("141/140 · Limite excedido", useUnmergedTree = true).assertExists()
        compose.onNodeWithTag("atrio-profile-v3-save").assertIsNotEnabled()
        editorControl(fieldTag).performTextReplacement(question)
        compose.onNodeWithText("Pergunta opcional · Oração", useUnmergedTree = true).assertExists()
        compose.onNodeWithText(counter, useUnmergedTree = true).assertExists()
        editorControl(pickerTag).assertTextContains("Escolher discussão")
        selectDiscussion(linked)
        val linkLabel = "Discussão vinculada · $linkedTitle"
        waitForText(linkLabel)

        val order = listOf(
            hasTestTag("atrio-profile-v3-interest-0"),
            hasTestTag(fieldTag),
            hasText(counter),
            hasText(linkLabel),
            hasTestTag(pickerTag),
            hasTestTag("atrio-v3-remove-link-oracao")
        )
        val expectedIds = order.map { compose.onNode(it, useUnmergedTree = true).fetchSemanticsNode().id }
        val ids = compose.onAllNodes(order.reduce { a, b -> a or b }, useUnmergedTree = true)
            .fetchSemanticsNodes().map { it.id }
        assertEquals(expectedIds, ids)
        editorControl(pickerTag).assertTextContains("Trocar discussão")
        editorControl("atrio-v3-remove-link-oracao").assertTextContains("Remover vínculo")
        compose.onNodeWithText("Ao ocultar este interesse e salvar, a pergunta e o vínculo serão apagados.",
            useUnmergedTree = true).assertExists()
        Log.i("AtrioQaProfileV3", "a11y_semantics=interesse,pergunta,contador,discussao,trocar,remover")

        val originalRegionId = compose.onNodeWithTag("atrio-profile-v3-status-region")
            .fetchSemanticsNode().id
        saveEditor()
        waitForTag("atrio-profile-v3-status")
        val statusRegion = compose.onNodeWithTag("atrio-profile-v3-status")
        assertEquals(originalRegionId, statusRegion.fetchSemanticsNode().id)
        statusRegion
            .assertTextContains("Informações atualizadas.")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))

        openEditorAgain()
        selectDiscussion(removed)
        await(owner.collection("posts").document(removed).delete())
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        waitForTag("atrio-profile-v3-message")
        compose.onNodeWithTag("atrio-profile-v3-message")
            .assertTextContains("Troque ou remova", substring = true)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
        editorControl(fieldTag)
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString(question)))
        assertEquals(question, await(publicProfile.get(Source.SERVER)).get("interestQuestions.oracao"))
        Log.i("AtrioQaProfileV3", "a11y_feedback=sucesso_polite,erro_polite,rascunho_preservado")
    }

    @Test fun talkBackReturnsAccessibilityFocusAfterCancelWithLargeText() {
        verifyTalkBackPickerFocus(confirm = false)
    }

    @Test fun talkBackReturnsAccessibilityFocusAfterConfirmWithLargeText() {
        verifyTalkBackPickerFocus(confirm = true)
    }

    private fun verifyTalkBackPickerFocus(confirm: Boolean) {
        seedV3()
        val linked = createDiscussion("Oração em comunidade")
        showEditor(fontScale = 1.5f)
        val pickerTag = "atrio-v3-pick-oracao"
        editorControl(pickerTag)

        withTalkBack { automation, talkBackIsActive ->
            val action = if (confirm) "confirmar" else "cancelar"
            fun visiblePicker() = automation.rootInActiveWindow
                ?.takeIf { it.packageName?.toString() == BuildConfig.APPLICATION_ID }
                ?.findVisibleNode(pickerTag)

            var opener: AccessibilityNodeInfo? = null
            compose.waitUntil(15_000) { visiblePicker()?.let { opener = it } != null }
            val button = requireNotNull(opener)
            assertTrue(button.isAccessibilityFocused || button.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS))
            compose.waitUntil(15_000) { visiblePicker()?.isAccessibilityFocused == true }
            val editorWindowId = button.windowId
            assertTrue(button.performAction(AccessibilityNodeInfo.ACTION_CLICK))
            waitForTag("atrio-v3-discussion-candidates")
            compose.waitUntil(15_000) {
                val root = automation.rootInActiveWindow
                root != null && root.packageName?.toString() == BuildConfig.APPLICATION_ID &&
                    root.windowId != editorWindowId
            }

            if (confirm) {
                pickDiscussionCandidate(linked)
                compose.onNodeWithTag("atrio-v3-link-confirm").performClick()
            } else {
                compose.onNodeWithText("Cancelar").performClick()
            }
            waitForPickerDismissal()
            try {
                compose.waitUntil(15_000) { visiblePicker()?.windowId == editorWindowId }
            } finally {
                val node = visiblePicker()
                val bounds = Rect().also { node?.getBoundsInScreen(it) }
                Log.i("AtrioQaProfileV3", "a11y_opener_after_close=$action visible=${node != null} " +
                    "active_window=${automation.rootInActiveWindow?.windowId} editor_window=$editorWindowId " +
                    "bounds=${bounds.toShortString()} accessibility_focused=${node?.isAccessibilityFocused}")
            }
            compose.onNodeWithTag(pickerTag)
                .assertTextContains(if (confirm) "Trocar discussão" else "Escolher discussão")
            compose.waitUntil(15_000) {
                visiblePicker()?.let { it.windowId == editorWindowId && it.isAccessibilityFocused } == true
            }
            assertTrue(talkBackIsActive())
            Log.i("AtrioQaProfileV3", "a11y_talkback_picker_focus=$action")
        }
    }

    private fun withTalkBack(block: (UiAutomation, () -> Boolean) -> Unit) {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        val automation = instrumentation.getUiAutomation(UiAutomation.FLAG_DONT_SUPPRESS_ACCESSIBILITY_SERVICES)
        val manager = compose.activity.getSystemService(Context.ACCESSIBILITY_SERVICE) as AccessibilityManager
        val talkBack = manager.installedAccessibilityServiceList.single {
            it.resolveInfo.serviceInfo.name.endsWith("TalkBackService")
        }
        val service = talkBack.resolveInfo.serviceInfo
        val notificationPermission = Manifest.permission.POST_NOTIFICATIONS
        val grantNotifications = Build.VERSION.SDK_INT >= 33 &&
            compose.activity.packageManager.checkPermission(notificationPermission, service.packageName) !=
                PackageManager.PERMISSION_GRANTED
        val component = android.content.ComponentName(service.packageName, service.name)
            .flattenToShortString()
        val oldServices = automation.shellText("settings get secure enabled_accessibility_services")
        val oldEnabled = automation.shellText("settings get secure accessibility_enabled")
        val enabledServices = listOf(oldServices.takeUnless { it == "null" || it.isBlank() }, component)
            .filterNotNull().distinct().joinToString(":")
        try {
            // A permissão inicial do leitor abriria uma janela do sistema sobre a Activity de QA.
            if (grantNotifications) {
                automation.shellText("pm grant ${service.packageName} $notificationPermission")
            }
            automation.shellText("settings put secure enabled_accessibility_services $enabledServices")
            automation.shellText("settings put secure accessibility_enabled 1")
            fun talkBackIsActive() = manager.isTouchExplorationEnabled &&
                manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_SPOKEN)
                    .any { it.id == talkBack.id }
            compose.waitUntil(15_000) { talkBackIsActive() }
            Log.i("AtrioQaProfileV3", "a11y_talkback=ativo exploracao_por_toque=true")
            block(automation, ::talkBackIsActive)
        } finally {
            restoreSecureSetting(automation, "enabled_accessibility_services", oldServices)
            restoreSecureSetting(automation, "accessibility_enabled", oldEnabled)
            if (grantNotifications) {
                automation.shellText("pm revoke ${service.packageName} $notificationPermission")
            }
        }
    }

    private fun AccessibilityNodeInfo.findVisibleNode(tag: String): AccessibilityNodeInfo? {
        if (isVisibleToUser && viewIdResourceName == tag) return this
        for (index in 0 until childCount) {
            getChild(index)?.findVisibleNode(tag)?.let { return it }
        }
        return null
    }

    private fun UiAutomation.shellText(command: String): String =
        ParcelFileDescriptor.AutoCloseInputStream(executeShellCommand(command))
            .bufferedReader().use { it.readText().trim() }

    private fun restoreSecureSetting(automation: UiAutomation, name: String, value: String) {
        automation.shellText(
            if (value == "null" || value.isBlank()) "settings delete secure $name"
            else "settings put secure $name $value"
        )
    }

    @Test fun interestPickerReturnsInputFocusWithLargeText() {
        seedV3()
        val linked = createDiscussion("Oração em comunidade")
        showEditor(fontScale = 1.5f)
        editorControl("atrio-v3-pick-oracao").performTouchInput { click() }
        waitForTag("atrio-v3-discussion-candidates")
        compose.onNodeWithText("Cancelar").performTouchInput { click() }
        waitForRestoredPickerFocus("Escolher discussão")
        Log.i("AtrioQaProfileV3", "a11y_picker_focus=cancelar")
        selectDiscussion(linked)
        waitForRestoredPickerFocus("Trocar discussão")
        Log.i("AtrioQaProfileV3", "a11y_picker_focus=confirmar")
    }

    private fun waitForRestoredPickerFocus(label: String) {
        waitForPickerDismissal()
        val picker = compose.onNodeWithTag("atrio-v3-pick-oracao")
        compose.waitUntil(15_000) { runCatching { picker.assertIsFocused() }.isSuccess }
        picker.assertTextContains(label)
    }

    private fun waitForPickerDismissal() {
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag("atrio-v3-link-confirm")).fetchSemanticsNodes().isEmpty()
        }
    }

    @Test fun editsQuestionAndDiscussionTogetherAndHidingClearsBothProjections() {
        seedV3()
        val postA = createDiscussion("Discussão inicial da prova")
        val postB = createDiscussion("Discussão seguinte da prova")
        val postRemoved = createDiscussion("Discussão removida da prova")
        val v2 = await(preferences.get(Source.SERVER)).data
        val profile = await(legacy.get(Source.SERVER)).data
        val links = owner.document(publicProfile.path).profileV3Links()
        val question = "🕊".repeat(140)

        showEditor()
        editorControl("atrio-v3-question-oracao").performTextReplacement(question + "x")
        compose.onNodeWithTag("atrio-profile-v3-save").assertIsNotEnabled()
        editorControl("atrio-v3-question-oracao").performTextReplacement("  $question  ")
        selectDiscussion(postA)
        saveEditor()
        assertEquals(mapOf("oracao" to question), await(publicProfile.get(Source.SERVER)).get("interestQuestions"))
        assertEquals(mapOf("oracao" to postA), await(links.get(Source.SERVER)).get("postIds"))
        assertEquals(mapOf("question" to question, "postId" to postA),
            await(privateV3.get(Source.SERVER)).get("interestDetails.oracao"))

        openEditorAgain()
        editorControl("atrio-v3-pick-oracao").performClick()
        pickDiscussionCandidate(postB)
        compose.onNodeWithText("Cancelar").performClick()
        editorControl("atrio-v3-question-oracao").performTextReplacement("  Pergunta editada? ")
        saveEditor()
        assertEquals(mapOf("oracao" to postA), await(links.get(Source.SERVER)).get("postIds"))
        assertEquals("Pergunta editada?", await(publicProfile.get(Source.SERVER)).get("interestQuestions.oracao"))

        openEditorAgain()
        editorControl("atrio-profile-v3-interest-0").performClick().assertIsOff()
        compose.onNodeWithText("Fechar").performClick()
        assertEquals("Pergunta editada?", await(publicProfile.get(Source.SERVER)).get("interestQuestions.oracao"))

        openEditorAgain()
        selectDiscussion(postB)
        saveEditor()
        assertEquals(mapOf("oracao" to postB), await(links.get(Source.SERVER)).get("postIds"))
        assertEquals("Pergunta editada?", await(publicProfile.get(Source.SERVER)).get("interestQuestions.oracao"))

        openEditorAgain()
        editorControl("atrio-v3-clear-question-oracao").performClick()
        saveEditor()
        assertFalse(await(publicProfile.get(Source.SERVER)).contains("interestQuestions"))
        assertEquals(mapOf("oracao" to postB), await(links.get(Source.SERVER)).get("postIds"))

        openEditorAgain()
        editorControl("atrio-v3-remove-link-oracao").performClick()
        editorControl("atrio-v3-question-oracao").performTextReplacement("Pergunta sem discussão?")
        saveEditor()
        assertFalse(await(links.get(Source.SERVER)).exists())
        assertEquals("Pergunta sem discussão?", await(publicProfile.get(Source.SERVER)).get("interestQuestions.oracao"))

        openEditorAgain()
        selectDiscussion(postRemoved)
        await(owner.collection("posts").document(postRemoved).delete())
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        waitForTag("atrio-profile-v3-message")
        compose.onNodeWithTag("atrio-profile-v3-message").assertTextContains("Troque ou remova", substring = true)
        assertFalse(await(links.get(Source.SERVER)).exists())

        selectDiscussion(postB)
        saveEditor()
        assertEquals(mapOf("oracao" to postB), await(links.get(Source.SERVER)).get("postIds"))
        openEditorAgain()
        editorControl("atrio-profile-v3-interest-0").performClick().assertIsOff()
        editorControl("atrio-profile-v3-interest-1").performClick().assertIsOn()
        saveEditor()
        assertEquals(emptyMap<String, Any>(), await(privateV3.get(Source.SERVER)).get("interestDetails"))
        assertEquals(listOf("Formação"), await(publicProfile.get(Source.SERVER)).get("interests"))
        assertFalse(await(publicProfile.get(Source.SERVER)).contains("interestQuestions"))
        assertFalse(await(links.get(Source.SERVER)).exists())
        assertEquals(v2, await(preferences.get(Source.SERVER)).data)
        assertEquals(profile, await(legacy.get(Source.SERVER)).data)
        assertTrue(await(owner.collection("posts").document(postA).get(Source.SERVER)).exists())

        openEditorAgain()
        editorControl("atrio-profile-v3-interest-0").performClick().assertIsOn()
        editorControl("atrio-v3-question-oracao")
            .assert(SemanticsMatcher.expectValue(SemanticsProperties.EditableText, AnnotatedString("")))
        editorControl("atrio-v3-pick-oracao").assertTextContains("Escolher discussão")
    }

    @Test fun tappingRequiresFreshAccessAndTheSameDestination() {
        seedV3(devotionVisible = false)
        val responses = ConcurrentLinkedQueue<ProfileV3Discussion>().apply {
            add(ProfileV3Discussion.Available("original", "Discussão original fictícia"))
            add(ProfileV3Discussion.Available("trocada", "Outra discussão fictícia"))
            add(ProfileV3Discussion.Unavailable)
        }
        val opened = ConcurrentLinkedQueue<String>()
        var screenOpen by mutableStateOf(true)
        val lateResponse = CompletableDeferred<ProfileV3Discussion>()
        var waitForOldAccount = false
        var viewerAccount by mutableStateOf(visitorUid)
        val resolver = ProfileV3DiscussionResolver { viewer, id, interest ->
            assertEquals(uid, id)
            assertEquals(ProfileV3Interest.PRAYER, interest)
            if (viewer.uid != visitorUid) ProfileV3Discussion.NoLink
            else responses.poll() ?: if (waitForOldAccount) lateResponse.await()
            else ProfileV3Discussion.Available("confirmada", "Discussão confirmada fictícia")
        }
        compose.setContent {
            AtrioTheme {
                if (screenOpen) PublicMemberProfileScreen(
                    visitor, PublicMemberTarget(uid, name), onBack = {}, onOpenDiscussion = { opened.add(it) },
                    viewerUid = viewerAccount, discussionResolver = resolver
                )
            }
        }
        waitForText("Discussão original fictícia")
        compose.onNodeWithTag("atrio-v3-open-oracao").performClick()
        waitForText("Outra discussão fictícia")
        assertTrue(opened.isEmpty())
        compose.onNodeWithTag("atrio-v3-open-oracao").performClick()
        waitForText("Discussão indisponível")
        compose.onNodeWithTag("atrio-v3-open-oracao").assertDoesNotExist()
        compose.onNodeWithText("Outra discussão fictícia").assertDoesNotExist()
        assertTrue(opened.isEmpty())

        compose.runOnIdle { screenOpen = false }
        compose.waitForIdle()
        compose.runOnIdle { screenOpen = true }
        waitForText("Discussão confirmada fictícia")
        compose.onNodeWithTag("atrio-v3-open-oracao").performClick()
        compose.waitUntil(15_000) { opened.peek() == "confirmada" }

        compose.runOnIdle { waitForOldAccount = true }
        compose.onNodeWithTag("atrio-v3-open-oracao").performClick()
        waitForText("Consultando discussão…")
        val replacement = requireNotNull(await(FirebaseAuth.getInstance(visitor.app).createUserWithEmailAndPassword(
            "perfil-${UUID.randomUUID()}@qa.invalid", fakePassword
        )).user)
        compose.runOnIdle { viewerAccount = replacement.uid }
        waitForText("Oração")
        lateResponse.complete(ProfileV3Discussion.Available("confirmada", "Título da sessão anterior"))
        compose.waitForIdle()
        compose.onNodeWithText("Título da sessão anterior").assertDoesNotExist()
        compose.onNodeWithTag("atrio-v3-open-oracao").assertDoesNotExist()
        assertEquals(listOf("confirmada"), opened.toList())
    }

    private fun createDiscussion(title: String): String {
        val post = owner.collection("posts").document()
        await(post.set(mapOf(
            "uid" to uid, "title" to title, "body" to "Conteúdo fictício para o QA.",
            "authorName" to name, "category" to "Pedidos de oração",
            "createdAt" to FieldValue.serverTimestamp()
        )))
        return post.id
    }

    private fun editorControl(tag: String): androidx.compose.ui.test.SemanticsNodeInteraction {
        compose.onNodeWithTag("atrio-profile-v3-editor").performScrollToNode(hasTestTag(tag))
        return compose.onNodeWithTag(tag)
    }

    private fun selectDiscussion(postId: String) {
        editorControl("atrio-v3-pick-oracao").performClick()
        pickDiscussionCandidate(postId)
        compose.onNodeWithTag("atrio-v3-link-confirm").performClick()
        waitForPickerDismissal()
    }

    private fun pickDiscussionCandidate(postId: String) {
        val listTag = "atrio-v3-discussion-candidates"
        val candidateTag = "atrio-v3-candidate-$postId"
        waitForTag(listTag)
        compose.onNodeWithTag(listTag).performScrollToNode(hasTestTag(candidateTag))
        compose.onNodeWithTag(candidateTag).performClick()
    }

    private fun saveEditor() {
        waitForEnabled("atrio-profile-v3-save")
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag("atrio-profile-v3-save")).fetchSemanticsNodes().isEmpty() ||
                compose.onAllNodes(hasTestTag("atrio-profile-v3-message")).fetchSemanticsNodes().isNotEmpty()
        }
        compose.onNodeWithTag("atrio-profile-v3-message").assertDoesNotExist()
        compose.onNodeWithTag("atrio-profile-v3-save").assertDoesNotExist()
    }

    private fun openEditorAgain() {
        compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
        waitForEnabled("atrio-profile-v3-save")
    }

    @Test fun cancelThenWithdrawPreservesLegacyAndV2ForTheOwnerAndVisitor() {
        seedV3()
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

    @Test fun unifiedEditorSavesWithTalkBackAt150Percent() {
        seedV3()
        val beforePreferences = await(preferences.get(Source.SERVER)).data
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    ProfileV3Editor(owner, uid, ProfileIdentity(name, "Apresentação anterior"))
                }
            }
        }
        compose.onNodeWithTag("atrio-profile-edit").performClick()
        waitForTag("atrio-profile-v3-editor")
        editorControl("atrio-profile-bio").performTextReplacement("Nova apresentação")
        editorControl("atrio-profile-v3-show-saint")
        waitForEnabled("atrio-profile-v3-show-saint")
        compose.onNodeWithTag("atrio-profile-v3-show-saint").performClick()
        editorControl("atrio-profile-draft-preview").performClick()
        compose.onNodeWithTag("atrio-profile-draft-preview-bio").assertTextContains("Nova apresentação")
        compose.onNodeWithText("Devoção · $saint").assertDoesNotExist()
        compose.onNodeWithText("Fechar prévia").performClick()
        withTalkBack { automation, talkBackIsActive ->
            val saveTag = "atrio-profile-save"
            fun visibleSave() = automation.rootInActiveWindow
                ?.takeIf { it.packageName?.toString() == BuildConfig.APPLICATION_ID }
                ?.findVisibleNode(saveTag)
            compose.waitUntil(15_000) { visibleSave()?.isEnabled == true }
            val save = requireNotNull(visibleSave())
            assertTrue(save.isAccessibilityFocused ||
                save.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS))
            compose.waitUntil(15_000) { visibleSave()?.isAccessibilityFocused == true }
            val expected = "Informações atualizadas."
            val event = automation.executeAndWaitForEvent({
                check(requireNotNull(visibleSave()).performAction(AccessibilityNodeInfo.ACTION_CLICK))
            }, { candidate ->
                candidate.packageName?.toString() == BuildConfig.APPLICATION_ID &&
                    candidate.eventType in setOf(
                        AccessibilityEvent.TYPE_WINDOW_CONTENT_CHANGED,
                        AccessibilityEvent.TYPE_VIEW_TEXT_CHANGED,
                        AccessibilityEvent.TYPE_ANNOUNCEMENT
                    ) &&
                    (candidate.text.any { expected in it } ||
                        candidate.source?.text?.contains(expected) == true)
            }, 15_000)
            waitForTag("atrio-profile-v3-status")
            compose.onNodeWithTag("atrio-profile-v3-status").assertTextContains(expected)
                .assert(SemanticsMatcher.expectValue(SemanticsProperties.LiveRegion, LiveRegionMode.Polite))
            assertTrue(talkBackIsActive())
            Log.i("AtrioQaProfileV3", "a11y_unified_save=evento_android tipo=${event.eventType} fonte=150%")
        }

        val saved = await(publicProfile.get(Source.SERVER))
        assertEquals("Nova apresentação", saved.getString("bio"))
        assertEquals("Nova apresentação", await(legacy.get(Source.SERVER)).getString("bio"))
        assertFalse(saved.contains("saint"))
        assertFalse(saved.contains("devotionPhrase"))
        assertEquals(beforePreferences, await(preferences.get(Source.SERVER)).data)
    }

    @Test fun openEditorCannotRepublishAfterExternalWithdrawal() {
        seedV3()
        showEditor()
        withdrawFromOutsideEditor()
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        waitForTag("atrio-profile-v3-message")
        compose.onNodeWithTag("atrio-profile-v3-message")
            .assertTextContains("Os dados do Perfil V3 mudaram.", substring = true)
        assertFalse(await(privateV3.get(Source.SERVER)).exists())
        assertFalse(await(publicProfile.get(Source.SERVER)).contains("saint"))
    }

    @Test fun visitHighlightsOnlyPublishedCommonInterests() {
        seedV3(interests = listOf("Oração", "Formação"))
        val visitorLegacy = visitor.document("profiles/$visitorUid")
        await(visitorLegacy.set(mapOf(
            "displayName" to "Pessoa visitante", "createdAt" to FieldValue.serverTimestamp()
        )))
        val visitorPreferences = requireNotNull(await(preferences.get(Source.SERVER)).data)
        await(visitor.document("users/$visitorUid/private/preferences").set(visitorPreferences +
            mapOf("consentAt" to FieldValue.serverTimestamp(), "updatedAt" to FieldValue.serverTimestamp())))
        val visitorDraft = requireNotNull(await(privateV3.get(Source.SERVER)).data)
        await(visitor.document("users/$visitorUid/private/profile_v3").set(visitorDraft + mapOf(
            "publicInterests" to listOf("Formação"),
            "consentAt" to FieldValue.serverTimestamp(),
            "updatedAt" to FieldValue.serverTimestamp()
        )))
        compose.setContent {
            AtrioTheme {
                PublicMemberProfileScreen(visitor, PublicMemberTarget(uid, name),
                    onBack = {}, onOpenDiscussion = {}, viewerUid = visitorUid,
                    discussionResolver = { _, _, _ -> ProfileV3Discussion.NoLink })
            }
        }
        waitForText("Santo de devoção · $saint")
        val list = compose.onNodeWithTag("atrio-public-profile")
        list.performScrollToNode(hasTestTag("atrio-public-profile-interests"))
        compose.onNodeWithTag("atrio-public-profile-affinity").assertDoesNotExist()
        compose.onNodeWithTag("atrio-public-profile-common-formacao").assertDoesNotExist()

        await(visitor.document("public_profiles/$visitorUid").set(mapOf(
            "displayName" to "Pessoa visitante", "bio" to "",
            "joinedAt" to requireNotNull(await(visitorLegacy.get(Source.SERVER)).getTimestamp("createdAt")),
            "updatedAt" to FieldValue.serverTimestamp(),
            "saint" to saint, "devotionPhrase" to "Fazer o simples com amor.",
            "ageBand" to "25–34", "maritalStatus" to "Casado(a)",
            "interests" to listOf("Formação")
        )))
        waitForTag("atrio-public-profile-affinity")
        compose.onNode(hasAnyAncestor(hasTestTag("atrio-public-profile-affinity")) and hasText(saint))
            .assertExists()
        list.performScrollToNode(hasTestTag("atrio-public-profile-common-formacao"))
        compose.onNodeWithTag("atrio-public-profile-common-oracao").assertDoesNotExist()
        val formation = compose.onNodeWithText("Formação").fetchSemanticsNode().boundsInRoot
        val prayer = compose.onNodeWithText("Oração").fetchSemanticsNode().boundsInRoot
        assertTrue(formation.top < prayer.top)
    }

    @Test fun visitorAlreadyOnProfileLosesThePublishedV3Fields() {
        seedV3()
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

    @Test fun publishHideAndWithdrawAcrossOwnerAndVisitor() {
        seedV3(devotionVisible = false)
        val beforeLegacy = await(legacy.get(Source.SERVER)).data
        val beforePreferences = await(preferences.get(Source.SERVER)).data
        val beforePublic = await(publicProfile.get(Source.SERVER)).data.orEmpty()
        val legacyPresentation = beforePublic.filterKeys {
            it !in ProfileV3Policy.publicFields && it != "updatedAt"
        }
        val devotion = "Santo de devoção · $saint"
        val age = "Faixa etária · 25–34"

        var visitorOpen by mutableStateOf(true)
        compose.setContent {
            AtrioTheme {
                Column {
                    ProfileV3Editor(owner, uid)
                    if (visitorOpen) {
                        PublicMemberProfileScreen(visitor, PublicMemberTarget(uid, name),
                            onBack = { visitorOpen = false }, onOpenDiscussion = {},
                            viewerUid = visitorUid)
                    } else {
                        Button(onClick = { visitorOpen = true }) { Text("Reabrir perfil do titular") }
                    }
                }
            }
        }

        waitForText("Apresentação anterior")
        waitForText(age)
        compose.onNodeWithText(devotion).assertDoesNotExist()
        changeDevotionVisibility()
        waitForText(devotion)
        assertEquals(saint, await(publicProfile.get(Source.SERVER)).getString("saint"))
        reopenVisitorProfile()
        waitForText(devotion)

        changeDevotionVisibility()
        waitForTextToDisappear(devotion)
        assertFalse(await(publicProfile.get(Source.SERVER)).contains("saint"))
        assertEquals(saint, await(privateV3.get(Source.SERVER)).getString("saint"))
        reopenVisitorProfile()
        waitForText(age)
        compose.onNodeWithText(devotion).assertDoesNotExist()

        compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
        waitForEnabled("atrio-profile-v3-save")
        openConfirmation()
        compose.onNodeWithTag("atrio-profile-v3-withdraw-confirm").performClick()
        waitForTag("atrio-profile-v3-status")
        compose.onNodeWithTag("atrio-profile-v3-status")
            .assertTextContains("Consentimento retirado.", substring = true)
        waitForTextToDisappear(age)
        compose.onNodeWithText("Apresentação anterior").assertExists()
        reopenVisitorProfile()
        compose.onNodeWithText(devotion).assertDoesNotExist()
        compose.onNodeWithText(age).assertDoesNotExist()

        assertFalse(await(privateV3.get(Source.SERVER)).exists())
        assertEquals(beforeLegacy, await(legacy.get(Source.SERVER)).data)
        assertEquals(beforePreferences, await(preferences.get(Source.SERVER)).data)
        assertEquals(legacyPresentation,
            await(publicProfile.get(Source.SERVER)).data.orEmpty().filterKeys { it != "updatedAt" })
    }

    @Test fun offlineVisitorRefreshesRevokedProfileAndSwitchesAccounts() {
        seedV3()
        val ownerAuth = sessions.first()
        val visitorAuth = sessions.last()
        val ownerEmail = requireNotNull(ownerAuth.currentUser?.email)
        val visitorEmail = requireNotNull(visitorAuth.currentUser?.email)
        val presentation = "Apresentação anterior"
        val devotion = "Santo de devoção · $saint"
        val visitorDocument = publicProfile
        val ownerDocument = owner.document(visitorDocument.path)
        val beforePublic = await(ownerDocument.get(Source.SERVER)).data.orEmpty()
            .filterKeys { it !in ProfileV3Policy.publicFields && it != "updatedAt" }
        val beforeLegacy = await(legacy.get(Source.SERVER)).data
        val beforePreferences = await(preferences.get(Source.SERVER)).data
        var visitorOpen by mutableStateOf(true)
        var viewer by mutableStateOf<String?>(visitorUid)

        compose.setContent {
            DisposableEffect(visitorAuth) {
                val listener = FirebaseAuth.AuthStateListener { viewer = it.currentUser?.uid }
                visitorAuth.addAuthStateListener(listener)
                onDispose { visitorAuth.removeAuthStateListener(listener) }
            }
            AtrioTheme {
                Column {
                    ProfileV3Editor(owner, uid)
                    val currentViewer = viewer
                    if (currentViewer == null) {
                        Text("Sessão de visualização encerrada")
                    } else if (visitorOpen) {
                        PublicMemberProfileScreen(visitor, PublicMemberTarget(uid, name),
                            onBack = { visitorOpen = false }, onOpenDiscussion = {},
                            viewerUid = currentViewer)
                    } else {
                        Button(onClick = { visitorOpen = true }) { Text("Reabrir perfil do titular") }
                    }
                }
            }
        }

        waitForText(devotion)
        assertEquals(saint, await(visitorDocument.get(Source.SERVER)).getString("saint"))
        recordProfilePhase("conectado_antes_da_retirada")
        await(visitor.disableNetwork())
        try {
            compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
            waitForEnabled("atrio-profile-v3-save")
            openConfirmation()
            compose.onNodeWithTag("atrio-profile-v3-withdraw-confirm").performClick()
            waitForTag("atrio-profile-v3-status")
            compose.onNodeWithTag("atrio-profile-v3-status")
                .assertTextContains("Consentimento retirado.", substring = true)

            assertFalse(await(privateV3.get(Source.SERVER)).exists())
            assertEquals(beforePublic, await(ownerDocument.get(Source.SERVER)).data.orEmpty()
                .filterKeys { it != "updatedAt" })
            val cached = await(visitorDocument.get(Source.CACHE))
            assertTrue(cached.metadata.isFromCache)
            val cachedFields = ProfileV3Policy.publicFields.filter { cached.contains(it) }
            Log.i("AtrioQaProfileV3", "cache_offline_apos_retirada=$cachedFields")
            waitForText(presentation)
            recordProfilePhase("offline_apos_retirada")
        } finally {
            await(visitor.enableNetwork())
        }

        assertEquals(beforePublic, await(visitorDocument.get(Source.SERVER)).data.orEmpty()
            .filterKeys { it != "updatedAt" })
        waitForTextToDisappear(devotion)
        assertWithdrawnProfile("reconectado_tela_aberta")
        reopenVisitorProfile()
        assertWithdrawnProfile("reaberto_mesma_sessao")

        switchViewerAccount(visitorAuth, ownerEmail, uid)
        assertWithdrawnProfile("troca_para_titular")
        reopenVisitorProfile()
        assertWithdrawnProfile("reaberto_como_titular")
        switchViewerAccount(visitorAuth, visitorEmail, visitorUid)
        assertWithdrawnProfile("retorno_ao_visitante")
        reopenVisitorProfile()
        assertWithdrawnProfile("reaberto_como_visitante")
        assertEquals(beforePublic, await(visitorDocument.get(Source.CACHE)).data.orEmpty()
            .filterKeys { it != "updatedAt" })
        assertEquals(beforeLegacy, await(legacy.get(Source.SERVER)).data)
        assertEquals(beforePreferences, await(preferences.get(Source.SERVER)).data)
    }

    private fun switchViewerAccount(auth: FirebaseAuth, email: String, expectedUid: String) {
        auth.signOut()
        waitForText("Sessão de visualização encerrada")
        compose.onNodeWithTag("atrio-public-profile").assertDoesNotExist()
        assertEquals(expectedUid, await(auth.signInWithEmailAndPassword(email, fakePassword)).user?.uid)
        waitForText("Apresentação anterior")
    }

    private fun assertWithdrawnProfile(phase: String) {
        waitForText("Apresentação anterior")
        assertEquals("$phase: campos V3 na tela pública", emptyList<String>(), recordProfilePhase(phase))
    }

    private fun recordProfilePhase(phase: String): List<String> {
        val visibleFields = mapOf(
            "saint" to hasText("Santo de devoção · $saint"),
            "devotionPhrase" to hasText("“Fazer o simples com amor.”"),
            "ageBand" to hasText("Faixa etária · 25–34"),
            "maritalStatus" to hasText("Estado civil · Casado(a)"),
            "interests" to hasTestTag("atrio-public-profile-interests")
        ).filterValues { compose.onAllNodes(it).fetchSemanticsNodes().isNotEmpty() }.keys.toList()
        val presentationVisible = compose.onAllNodes(hasText("Apresentação anterior"))
            .fetchSemanticsNodes().isNotEmpty()
        Log.i("AtrioQaProfileV3", "fase=$phase campos_v3=$visibleFields apresentacao=$presentationVisible")
        return visibleFields
    }

    private fun changeDevotionVisibility() {
        compose.onNodeWithTag("atrio-profile-v3-edit").performClick()
        waitForEnabled("atrio-profile-v3-save")
        val toggle = "atrio-profile-v3-show-saint"
        compose.onNodeWithTag("atrio-profile-v3-editor").performScrollToNode(hasTestTag(toggle))
        compose.onNodeWithTag(toggle).performClick()
        compose.onNodeWithTag("atrio-profile-v3-save").performClick()
        compose.waitUntil(15_000) {
            compose.onAllNodes(hasTestTag("atrio-profile-v3-editor")).fetchSemanticsNodes().isEmpty()
        }
    }

    private fun reopenVisitorProfile() {
        compose.onNodeWithTag("atrio-public-profile-back").performClick()
        compose.onNodeWithText("Reabrir perfil do titular").performClick()
        waitForText("Apresentação anterior")
    }

    private fun waitForTextToDisappear(text: String) = compose.waitUntil(15_000) {
        compose.onAllNodes(hasText(text)).fetchSemanticsNodes().isEmpty()
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
            "perfil-${UUID.randomUUID()}@qa.invalid", fakePassword
        )).user)
        return db to user.uid
    }

    private fun showEditor(fontScale: Float? = null) {
        compose.setContent {
            val density = LocalDensity.current
            val scaledDensity = fontScale?.let { Density(density.density, it) } ?: density
            CompositionLocalProvider(LocalDensity provides scaledDensity) {
                AtrioTheme {
                    Column {
                        ProfileV3Summary(owner, uid)
                        ProfileV3Editor(owner, uid)
                    }
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
