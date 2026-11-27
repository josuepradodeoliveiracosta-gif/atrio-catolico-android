package br.com.atriocatolico

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import java.security.MessageDigest

class WelcomeVitralUiTest {
    @get:Rule val compose = createComposeRule()
    private val seasons = listOf(Season.ADVENT, Season.CHRISTMAS, Season.ORDINARY,
        Season.LENT, Season.TRIDUUM, Season.EASTER)

    @Test fun actualQaAssetsDecodeAndMatchManifest() {
        assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val hashes = listOf(
            "4f39cd854a99b29760f11d79cecc2395e09dfb3cf3565c39eb91b60edeec35fe",
            "b54bca717a05d7e58fd3b8050f32a57f70b448c3c75a135827dd8ebb739bb1eb",
            "12b9f8adb9c7203ce8cabda4a2351c8b85edb50dc57fae3ff8cf6d5957f04905",
            "df91dff7d091d267dfcbfbde7ceafb0e6093d2ab5b3c03b3484a1ed6a033db3a",
            "aadca1fdb4876dbc80eca355afd4f2aa916a4ae555312abf077d1d41e311a407",
            "9ff9265a7758c79f775a12ba0faf6a108e8930f0ea96cf7a491d93e1f1e771d2",
        )
        seasons.zip(hashes).forEach { (season, expected) ->
            val spec = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season))
            val bytes = context.assets.open(spec.assetName).use { it.readBytes() }
            val digest = MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            assertEquals(expected, digest)
            val bitmap = requireNotNull(decodeWelcomeVitral(context, spec, 360, 800))
            assertTrue(bitmap.width >= 360 && bitmap.height >= 800)
        }
    }

    @Test fun sixThemesKeepBothActionsReachableAtLargeFont() {
        assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val selected = mutableStateOf(seasons.first())
        var creates = 0
        var logins = 0
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                Box(Modifier.width(320.dp).height(440.dp)) {
                    WelcomeVitralEntry({ creates++ }, { logins++ }, season = selected.value)
                }
            }
        }
        for (season in seasons) {
            compose.runOnIdle { selected.value = season }
            val asset = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season)).assetName.substringAfterLast('/')
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("atrio-welcome-season-" + asset, useUnmergedTree = true)
                    .fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag("atrio-welcome-create").performScrollTo().performClick()
            compose.onNodeWithTag("atrio-welcome-login").performScrollTo().performClick()
        }
        compose.runOnIdle { assertEquals(6, creates); assertEquals(6, logins) }
    }

    @Test fun missingAssetKeepsDefaultActions() {
        var creates = 0
        compose.setContent {
            WelcomeVitralEntry({ creates++ }, {}, season = Season.ADVENT, buildType = "qaGeral",
                loader = { _, _, _, _ -> null })
        }
        compose.onNodeWithTag("atrio-welcome-create").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-welcome-login").assertExists()
        compose.onNodeWithTag("atrio-welcome-season-boas_vindas_vitral_advento.webp").assertDoesNotExist()
        compose.runOnIdle { assertEquals(1, creates) }
    }
}
