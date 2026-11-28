package br.com.atriocatolico

import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.time.LocalDate
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Deterministic tests: actual auth navigation, artificial local image delay,
 * no requests to real Firebase, no real credentials. */
class PreAuthNoLegacyFlashUiTest {
    @get:Rule val compose = createComposeRule()
    private var rootView: android.view.View? = null
    private var keyboard: androidx.compose.ui.platform.SoftwareKeyboardController? = null
    private fun launch(loaders: PreAuthArtworkLoaders) {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.DEBUG && BuildConfig.BUILD_TYPE == "qaGeral" &&
            app.options.projectId == "demo-atrio-v11")
        compose.setContent {
            val view = LocalView.current
            val controller = LocalSoftwareKeyboardController.current
            SideEffect { rootView = view; keyboard = controller }
            AtrioTheme {
                CompositionLocalProvider(LocalLiturgicalDay provides
                    LiturgicalCalendarBR.day(LocalDate.parse("2026-11-29"))) {
                    OnlineAuthScreen(FirebaseAuth.getInstance(app),
                        FirebaseFirestore.getInstance(app),
                        showWelcomeInIsolatedQa = true, artworkLoaders = loaders)
                }
            }
        }
    }
    private fun exists(tag: String) =
        compose.onNodeWithTag(tag, useUnmergedTree = true).assertExists()
    private fun absent(tag: String) =
        compose.onNodeWithTag(tag, useUnmergedTree = true).assertDoesNotExist()
    private fun click(tag: String) =
        compose.onNodeWithTag(tag).performScrollTo().assertIsEnabled().performClick()
    private fun awaitArt(tag: String) {
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
        }
    }
    private fun back() {
        android.os.ParcelFileDescriptor.AutoCloseInputStream(
            androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
                .executeShellCommand("input keyevent 4")).use { it.readBytes() }
    }

    @Test fun slowImagesNeverSwitchToLegacyDuringRealNavigation() {
        val welcome = CountDownLatch(1)
        val participation = CountDownLatch(1)
        val login = CountDownLatch(1)
        val registration = CountDownLatch(1)
        val loginStarted = AtomicInteger()
        val registrationStarted = AtomicInteger()
        fun delayed(gate: CountDownLatch): ImageBitmap {
            check(gate.await(30, TimeUnit.SECONDS)) { "Test gate timed out" }
            return ImageBitmap(32, 32)
        }
        try {
            launch(PreAuthArtworkLoaders(
                entrance = { _, spec, _, _ ->
                    delayed(if (spec.assetName.startsWith("participacao-vitrais/")) participation else welcome)
                },
                login = { _, _ -> loginStarted.incrementAndGet(); delayed(login) },
                registration = { _, _ -> registrationStarted.incrementAndGet(); delayed(registration) },
            ))
            exists("atrio-welcome-glass")
            exists("atrio-welcome-no-art")
            absent("atrio-welcome-vitral")
            compose.waitUntil(5_000) { loginStarted.get() >= 1 }
            click("atrio-welcome-login")
            exists("atrio-preauth-form-glass")
            absent("atrio-login-vitral-ADVENT")
            compose.onNodeWithTag("atrio-auth-email").performScrollTo().performTextInput("transicao@qa.invalid")
            login.countDown()
            awaitArt("atrio-login-vitral-ADVENT")
            exists("atrio-preauth-form-glass")
            compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertTextContains("transicao@qa.invalid")
            // First close the IME explicitly: a hardware Back while it is visible
            // dismisses the keyboard, not the authentication destination.
            compose.runOnIdle { keyboard?.hide() }
            if (android.os.Build.VERSION.SDK_INT >= 30) {
                compose.waitUntil(5_000) {
                    compose.runOnIdle {
                        rootView?.rootWindowInsets?.isVisible(android.view.WindowInsets.Type.ime()) == false
                    }
                }
            }
            exists("atrio-preauth-form-glass")
            // Real back navigation; welcome decoder can still be pending.
            back()
            awaitArt("atrio-welcome-glass")
            exists("atrio-welcome-no-art")
            welcome.countDown()
            awaitArt("atrio-welcome-season-boas_vindas_vitral_advento.webp")
            click("atrio-welcome-create")
            exists("atrio-participation-glass")
            exists("atrio-participation-no-art")
            compose.waitUntil(5_000) { registrationStarted.get() >= 1 }
            click("atrio-participation-choice-0")
            exists("atrio-preauth-form-glass")
            absent("atrio-registration-vitral-ADVENT")
            compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertIsDisplayed()
            registration.countDown()
            participation.countDown()
            awaitArt("atrio-registration-vitral-ADVENT")
            exists("atrio-preauth-form-glass")
            compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
            click("atrio-auth-back")
            exists("atrio-participation-glass")
            awaitArt("atrio-participation-season-participacao_vitral_advento.webp")
            click("atrio-auth-back")
            exists("atrio-welcome-glass")
        } finally {
            welcome.countDown()
            participation.countDown()
            login.countDown()
            registration.countDown()
        }
    }

    @Test fun missingImagesKeepNewThemeAndActionsInAllFourScreens() {
        val misses = AtomicInteger()
        launch(PreAuthArtworkLoaders(
            entrance = { _, _, _, _ -> misses.incrementAndGet(); null },
            login = { _, _ -> misses.incrementAndGet(); null },
            registration = { _, _ -> misses.incrementAndGet(); null },
        ))
        exists("atrio-welcome-glass")
        exists("atrio-welcome-no-art")
        compose.waitUntil(5_000) { misses.get() >= 2 }
        click("atrio-welcome-login")
        exists("atrio-preauth-form-glass")
        absent("atrio-login-vitral-ADVENT")
        compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertIsEnabled()
        click("atrio-auth-recover")
        compose.onNodeWithTag("atrio-auth-error").performScrollTo().assertIsDisplayed()
        back()
        exists("atrio-welcome-glass")
        click("atrio-welcome-create")
        exists("atrio-participation-glass")
        exists("atrio-participation-no-art")
        click("atrio-participation-choice-1")
        exists("atrio-preauth-form-glass")
        absent("atrio-registration-vitral-ADVENT")
        compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertIsEnabled()
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
        click("atrio-auth-back")
        exists("atrio-participation-glass")
    }
}
