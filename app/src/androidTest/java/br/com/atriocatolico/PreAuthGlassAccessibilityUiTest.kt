package br.com.atriocatolico

import android.Manifest
import android.accessibilityservice.AccessibilityServiceInfo
import android.app.UiAutomation
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import android.os.ParcelFileDescriptor
import android.util.Log
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.activity.ComponentActivity
import androidx.compose.foundation.layout.Box
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Focus and live regions only; spoken output and physical performance are not asserted. */
class PreAuthGlassAccessibilityUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    @OptIn(ExperimentalComposeUiApi::class)
    @Test fun realFormControlsKeepAccessibilityFocusWithTalkBack() {
        val app = com.google.firebase.FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11" &&
            Build.HARDWARE in setOf("ranchu", "goldfish"))
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    CompositionLocalProvider(LocalLiturgicalDay provides
                        LiturgicalCalendarBR.day(java.time.LocalDate.parse("2026-11-29"))) {
                        Box(Modifier.semantics { testTagsAsResourceId = true }) {
                            OnlineAuthScreen(com.google.firebase.auth.FirebaseAuth.getInstance(app),
                                com.google.firebase.firestore.FirebaseFirestore.getInstance(app))
                        }
                    }
                }
            }
        }
        fun waitArt(tag: String) {
            compose.waitUntil(15_000) {
                compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag("atrio-preauth-form-glass", useUnmergedTree = true).assertExists()
            assertFalse(compose.onNodeWithTag(tag, useUnmergedTree = true).fetchSemanticsNode()
                .config.contains(SemanticsProperties.ContentDescription))
        }
        waitArt("atrio-login-vitral-ADVENT")
        withTalkBack { automation, talkBackIsActive ->
            fun focus(tag: String) {
                compose.onNodeWithTag(tag).performScrollTo().assertIsDisplayed()
                fun visibleAction() = automation.rootInActiveWindow
                    ?.takeIf { it.packageName?.toString() == BuildConfig.APPLICATION_ID }
                    ?.findVisibleNode(tag)
                compose.waitUntil(15_000) { visibleAction()?.isEnabled == true }
                val node = requireNotNull(visibleAction())
                assertTrue(node.isAccessibilityFocused ||
                    node.performAction(AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS))
                compose.waitUntil(15_000) { visibleAction()?.isAccessibilityFocused == true }
            }
            for (tag in listOf("atrio-auth-email","atrio-auth-password","atrio-auth-recover","atrio-auth-toggle"))
                focus(tag)
            compose.onNodeWithTag("atrio-auth-recover").performScrollTo().performClick()
            compose.onNodeWithTag("atrio-auth-error").performScrollTo().assertIsDisplayed()
            assertEquals(androidx.compose.ui.semantics.LiveRegionMode.Polite,
                compose.onNodeWithTag("atrio-auth-error").fetchSemanticsNode().config[SemanticsProperties.LiveRegion])
            compose.onNodeWithTag("atrio-auth-toggle").performScrollTo().performClick()
            waitArt("atrio-registration-vitral-ADVENT")
            for (tag in listOf("atrio-auth-name","atrio-auth-email","atrio-auth-password",
                "atrio-auth-confirm","atrio-auth-rules","atrio-auth-privacy")) focus(tag)
            compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
            assertTrue(talkBackIsActive())
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

}
