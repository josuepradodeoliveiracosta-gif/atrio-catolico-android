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

    @Test fun actualParticipationAssetsDecodeAndMatchManifest() {
        org.junit.Assume.assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        val expected = mapOf(
            "advento" to "6fca18e2fa6601fa7aaa655bbbd11a13256b435cbc64261c6752c6c273b34333",
            "natal" to "901cf551c528b7540341a4d556c3a1cbb71b7117123cc401eaeef9ef73ab21cb",
            "tempo_comum" to "b9d716e79f2b0b8582724dc35228d93b0042cb9fbb6d23ded51c3ae857ab080c",
            "quaresma" to "d68c783dac68d7872aeae7a65455787fd0e5625917a1ce4456674fba4420dc96",
            "triduo_pascal" to "de42a3128073e0b4dd2a2a1559b4833442ffaaa288ef661e2c72562ab0fcef68",
            "pascoa" to "eee64b19f93e596a863d39b9bab10c3d8dfc49581839b8843b94e1932ffd4bf2",
        )
        assertEquals(6, expected.size)
        for (season in seasons) {
            val spec = requireNotNull(ParticipationVitralPolicy.resolve("qaGeral", season))
            val name = spec.assetName.substringAfterLast('/').removePrefix("participacao_vitral_").removeSuffix(".webp")
            val bytes = context.assets.open(spec.assetName).use { it.readBytes() }
            val hash = java.security.MessageDigest.getInstance("SHA-256").digest(bytes)
                .joinToString("") { "%02x".format(it.toInt() and 255) }
            assertEquals(expected.getValue(name), hash)
            val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.assets.open(spec.assetName).use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
            assertEquals(790, bounds.outWidth)
            assertEquals(1800, bounds.outHeight)
            val bitmap = requireNotNull(decodeWelcomeVitral(context, spec, 360, 800))
            assertTrue(bitmap.width >= 360 && bitmap.height >= 800)
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
