package br.com.atriocatolico

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicInteger

/** Synthetic bitmaps only: real artwork, TalkBack and physical evidence are separate gates. */
class ParticipationVitralUiTest {
    @get:Rule val compose = createComposeRule()
    private val seasons = listOf(Season.ADVENT, Season.CHRISTMAS, Season.ORDINARY,
        Season.LENT, Season.TRIDUUM, Season.EASTER)
    private val labels = listOf("Sou católico(a)", "Quero conhecer melhor a fé católica",
        "Nenhuma das opções se aplica a mim")

    private fun tag(season: Season) = "atrio-participation-season-" +
        requireNotNull(ParticipationVitralPolicy.resolve("qaGeral", season)).assetName.substringAfterLast('/')

    private fun awaitTheme(season: Season) {
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag(tag(season), useUnmergedTree = true).fetchSemanticsNodes().size == 1
        }
    }

    @Test fun sixThemesThreeChoicesWithLargeFontAndOneCallbackPerVisit() {
        val selected = mutableStateOf(seasons.first())
        val visit = mutableStateOf(0)
        var calls = 0
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                Box(Modifier.width(320.dp).height(440.dp)) {
                    key(visit.value) {
                        ParticipationVitralEntry({ calls++ }, {}, selected.value, "qaGeral",
                            loader = { _, _, _, _ -> ImageBitmap(16, 16) })
                    }
                }
            }
        }
        for (season in seasons) {
            for ((index, label) in labels.withIndex()) {
                compose.runOnIdle { selected.value = season; visit.value++ }
                awaitTheme(season)
                compose.onNodeWithTag("atrio-participation-choice-$index")
                    .assertTextContains(label).performScrollTo().performClick()
                compose.onNodeWithTag("atrio-participation-choice-$index").assertIsNotEnabled()
            }
        }
        compose.runOnIdle { assertEquals(18, calls) }
    }

    @Test fun missingResourceKeepsAllActionsAndReturn() {
        var backs = 0
        compose.setContent {
            ParticipationVitralEntry({}, { backs++ }, Season.ADVENT, "qaGeral",
                loader = { _, _, _, _ -> null })
        }
        for (label in labels) compose.onNodeWithText(label).assertIsEnabled()
        compose.onNodeWithTag(tag(Season.ADVENT)).assertDoesNotExist()
        compose.onNodeWithContentDescription("Voltar").performClick()
        compose.runOnIdle { assertEquals(1, backs) }
    }

    @Test fun nonQaDoesNotDecode() {
        val loads = AtomicInteger()
        compose.setContent {
            ParticipationVitralEntry({}, {}, Season.ADVENT, "release",
                loader = { _, _, _, _ -> loads.incrementAndGet(); null })
        }
        for (label in labels) compose.onNodeWithText(label).assertIsEnabled()
        compose.runOnIdle { assertEquals(0, loads.get()) }
    }

    @Test fun latePreviousThemeCannotReplaceNewTheme() {
        val selected = mutableStateOf(Season.ADVENT)
        val started = CountDownLatch(1)
        val unblock = CountDownLatch(1)
        val finished = CountDownLatch(1)
        val loader: (android.content.Context, WelcomeVitralSpec, Int, Int) -> ImageBitmap? =
            { _, spec, _, _ ->
                if (spec.assetName.contains("advento")) {
                    started.countDown()
                    try { unblock.await(10, TimeUnit.SECONDS) } finally { finished.countDown() }
                }
                ImageBitmap(16, 16)
            }
        try {
            compose.setContent {
                ParticipationVitralEntry({}, {}, selected.value, "qaGeral", loader)
            }
            compose.waitUntil(5_000) { started.count == 0L }
            compose.runOnIdle { selected.value = Season.EASTER }
            awaitTheme(Season.EASTER)
            unblock.countDown()
            compose.waitUntil(5_000) { finished.count == 0L }
            compose.waitForIdle()
            compose.onNodeWithTag(tag(Season.ADVENT)).assertDoesNotExist()
            compose.onNodeWithTag(tag(Season.EASTER)).assertExists()
        } finally { unblock.countDown() }
    }
}
