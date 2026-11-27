package br.com.atriocatolico

import android.content.Context
import android.graphics.BitmapFactory
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Rule
import org.junit.Test

/** Sem Firebase: verifica a troca dos seis recursos locais e o fallback sólido. */
class LoginLiturgicalBackdropUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun allDefinitiveAssetsArePackagedWithOriginalDimensions() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val seasons = listOf(Season.ADVENT, Season.CHRISTMAS, Season.ORDINARY,
            Season.LENT, Season.TRIDUUM, Season.EASTER)
        val names = seasons.map(::loginVitralAssetName)
        assertEquals(6, names.toSet().size)
        names.forEach { name ->
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.assets.open(name).use { BitmapFactory.decodeStream(it, null, bounds) }
            assertEquals(name, 941, bounds.outWidth)
            assertEquals(name, 1672, bounds.outHeight)
            assertTrue(name, bounds.outMimeType == "image/webp")
        }
    }

    @Test fun allSixSeasonsLoadAndReplacePreviousArt() {
        val seasons = listOf(Season.ADVENT, Season.CHRISTMAS, Season.ORDINARY,
            Season.LENT, Season.TRIDUUM, Season.EASTER)
        val selected = mutableStateOf(seasons.first())
        compose.setContent { LoginLiturgicalBackdrop(season = selected.value) }
        var previous: Season? = null
        seasons.forEach { season ->
            compose.runOnIdle { selected.value = season }
            val tag = "atrio-login-vitral-${season.name}"
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag(tag, useUnmergedTree = true).assertIsDisplayed()
            previous?.let {
                compose.onNodeWithTag("atrio-login-vitral-${it.name}", useUnmergedTree = true)
                    .assertDoesNotExist()
            }
            previous = season
        }
    }

    @Test fun failedDecodeLeavesSolidBackdropAvailable() {
        val missing: (Context, Season) -> ImageBitmap? = { _, _ -> null }
        compose.setContent { LoginLiturgicalBackdrop(Season.ADVENT, missing) }
        compose.waitForIdle()
        compose.onNodeWithTag("atrio-login-backdrop").assertIsDisplayed()
        compose.onNodeWithTag("atrio-login-vitral-ADVENT", useUnmergedTree = true).assertDoesNotExist()
    }
}
