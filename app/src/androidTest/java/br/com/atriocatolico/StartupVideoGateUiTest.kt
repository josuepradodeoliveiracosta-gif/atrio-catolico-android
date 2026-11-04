package br.com.atriocatolico

import android.content.Context
import androidx.activity.ComponentActivity
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.After
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.util.concurrent.atomic.AtomicBoolean

/** Testa o bloqueio da primeira abertura sem Firebase ou internet. */
@RunWith(AndroidJUnit4::class)
class StartupVideoGateUiTest {
    @get:Rule val compose = createAndroidComposeRule<ComponentActivity>()

    private fun prefs() = compose.activity.getSharedPreferences(
        "atrio-startup-video", Context.MODE_PRIVATE
    )

    @Before fun startClean() {
        check(BuildConfig.DEBUG) { "Teste exclusivo do APK debug" }
        check(prefs().edit().clear().commit())
    }

    @After fun cleanup() {
        prefs().edit().clear().commit()
    }

    @Test fun firstViewingDoesNotOfferSkip() {
        compose.setContent {
            AtrioTheme {
                AtrioStartupVideo(compose.activity, onFinished = {})
            }
        }
        compose.onNodeWithTag("atrio-opening-fullscreen").assertIsDisplayed()
        compose.onNodeWithTag("atrio-opening-skip").assertDoesNotExist()
    }

    @Test fun returningViewerCanSkip() {
        check(prefs().edit().putBoolean("watched_to_end", true).commit())
        val finished = AtomicBoolean(false)
        compose.setContent {
            AtrioTheme {
                AtrioStartupVideo(compose.activity) { finished.set(true) }
            }
        }
        compose.onNodeWithTag("atrio-opening-skip").assertIsDisplayed()
        compose.onNodeWithTag("atrio-opening-skip").performClick()
        compose.runOnIdle { assertTrue("Botão Pular deve concluir a abertura", finished.get()) }
    }
}
