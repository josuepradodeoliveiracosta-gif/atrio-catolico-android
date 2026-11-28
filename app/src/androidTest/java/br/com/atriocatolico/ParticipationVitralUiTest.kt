package br.com.atriocatolico

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.width
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.graphics.asAndroidBitmap
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

/** Real QA resources and synthetic failure injection. Physical and TalkBack evidence remain separate. */
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

    @Test fun realAssetsKeepAllChoicesReachableInBothModes() {
        org.junit.Assume.assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val selected = mutableStateOf(seasons.first())
        val dark = mutableStateOf(false)
        val visit = mutableStateOf(0)
        var calls = 0
        compose.setContent {
            val config = android.content.res.Configuration(androidx.compose.ui.platform.LocalConfiguration.current).apply {
                uiMode = (uiMode and android.content.res.Configuration.UI_MODE_NIGHT_MASK.inv()) or
                    (if (dark.value) android.content.res.Configuration.UI_MODE_NIGHT_YES else android.content.res.Configuration.UI_MODE_NIGHT_NO)
            }
            CompositionLocalProvider(androidx.compose.ui.platform.LocalConfiguration provides config) {
                AtrioTheme {
                    key(visit.value) {
                        ParticipationVitralEntry({ calls++ }, {}, selected.value)
                    }
                }
            }
        }
        for (night in listOf(false, true)) {
            for (season in seasons) {
                for (index in labels.indices) {
                    compose.runOnIdle { dark.value = night; selected.value = season; visit.value++ }
                    awaitTheme(season)
                    val choice = compose.onNodeWithTag("atrio-participation-choice-$index")
                    choice.performScrollTo().assertIsDisplayed().assertIsEnabled().assertTextContains(labels[index])
                    if (index == 0) {
                        val art = compose.onNodeWithTag(tag(season), useUnmergedTree = true).fetchSemanticsNode()
                        val reading = compose.onNodeWithTag("atrio-participation-reading", useUnmergedTree = true)
                            .fetchSemanticsNode()
                        val region = requireNotNull(ParticipationVitralPolicy.readingRegion(season))
                        val natural = kotlin.math.round(art.size.width * (1800f / 790f)).toInt()
                        val top = kotlin.math.round(natural * region.start).toInt()
                        val bottom = natural - kotlin.math.round(natural * region.end).toInt()
                        val relativeY = reading.positionInRoot.y - art.positionInRoot.y
                        val center = (top + art.size.height - bottom) / 2f
                        assertTrue("Leitura invade ornamento superior", relativeY >= top - 2)
                        assertTrue("Leitura invade ornamento inferior",
                            relativeY + reading.size.height <= art.size.height - bottom + 2)
                        assertTrue("Leitura não centralizada na faixa livre",
                            kotlin.math.abs(relativeY + reading.size.height / 2f - center) <= 2f)
                        captureParticipation(season.name.lowercase(java.util.Locale.ROOT) +
                            (if (night) "-escuro" else "-claro"))
                    }
                    choice.performClick()
                    choice.assertIsNotEnabled()
                }
            }
        }
        compose.runOnIdle { assertEquals(36, calls) }
    }

    @Test fun realNavigationAllSeasonsAndChoices() {
        org.junit.Assume.assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val app = com.google.firebase.FirebaseApp.getInstance()
        check(BuildConfig.DEBUG && app.options.projectId == "demo-atrio-v11")
        val dates = listOf("2026-11-29", "2026-12-25", "2026-11-28",
            "2027-02-10", "2027-03-26", "2027-03-28")
        val day = mutableStateOf(LiturgicalCalendarBR.day(java.time.LocalDate.parse(dates.first())))
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalLiturgicalDay provides day.value) {
                    OnlineAuthScreen(com.google.firebase.auth.FirebaseAuth.getInstance(app),
                        com.google.firebase.firestore.FirebaseFirestore.getInstance(app),
                        showWelcomeInIsolatedQa = true)
                }
            }
        }
        fun waitWelcome(season: Season) {
            val asset = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season)).assetName.substringAfterLast('/')
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("atrio-welcome-season-" + asset, useUnmergedTree = true)
                    .fetchSemanticsNodes().size == 1
            }
        }
        for ((season, date) in seasons.zip(dates)) {
            compose.runOnIdle { day.value = LiturgicalCalendarBR.day(java.time.LocalDate.parse(date)) }
            waitWelcome(season)
            compose.onNodeWithTag("atrio-welcome-create").performScrollTo().performClick()
            for (index in labels.indices) {
                awaitTheme(season)
                compose.onNodeWithTag("atrio-participation-choice-$index").performScrollTo().performClick()
                compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("atrio-auth-back").performScrollTo().performClick()
            }
            awaitTheme(season)
            compose.onNodeWithTag("atrio-auth-back").performScrollTo().performClick()
            waitWelcome(season)
            compose.onNodeWithTag("atrio-welcome-login").performScrollTo().performClick()
            compose.onNodeWithText("Entrar na comunidade").assertExists()
            android.os.ParcelFileDescriptor.AutoCloseInputStream(
                androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
                    .executeShellCommand("input keyevent 4")
            ).use { it.readBytes() }
            waitWelcome(season)
        }
    }

    @Test fun realArtsOnShortScreenWithLargeText() {
        org.junit.Assume.assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val selected = mutableStateOf(seasons.first())
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                Box(Modifier.width(320.dp).height(440.dp)) {
                    AtrioTheme { ParticipationVitralEntry({}, {}, selected.value) }
                }
            }
        }
        for (season in seasons) {
            compose.runOnIdle { selected.value = season }
            awaitTheme(season)
            for ((index, label) in labels.withIndex()) {
                compose.onNodeWithTag("atrio-participation-choice-$index")
                    .performScrollTo().assertIsDisplayed().assertIsEnabled()
                    .assertTextContains(label).assertHeightIsAtLeast(48.dp)
            }
            compose.onNodeWithTag("atrio-auth-back").performScrollTo().assertIsDisplayed()
        }
    }

    @Test fun realArtsLoadWithoutNetwork() {
        val instrumentation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation()
        org.junit.Assume.assumeTrue(androidx.test.platform.app.InstrumentationRegistry.getArguments()
            .getString("atrioOfflineVitralQa") == "true")
        val app = com.google.firebase.FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11" &&
            android.os.Build.HARDWARE in setOf("ranchu", "goldfish")) { "Somente emulador QA isolado" }
        val network = instrumentation.targetContext.getSystemService(android.content.Context.CONNECTIVITY_SERVICE)
            as android.net.ConnectivityManager
        fun shell(command: String): String =
            android.os.ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation
                .executeShellCommand(command)).use { it.bufferedReader().readText().trim() }
        val wifi = shell("settings get global wifi_on")
        val mobile = shell("settings get global mobile_data")
        val airplane = shell("settings get global airplane_mode_on")
        check(wifi in setOf("0", "1") && mobile in setOf("0", "1") && airplane in setOf("0", "1"))
        try {
            shell("cmd connectivity airplane-mode enable")
            shell("svc wifi disable")
            shell("svc data disable")
            compose.waitUntil(15_000) { network.activeNetwork == null }
            val selected = mutableStateOf(seasons.first())
            compose.setContent { AtrioTheme { ParticipationVitralEntry({}, {}, selected.value) } }
            for (season in seasons) {
                compose.runOnIdle { selected.value = season }
                awaitTheme(season)
                for (index in labels.indices) {
                    compose.onNodeWithTag("atrio-participation-choice-$index")
                        .performScrollTo().assertIsDisplayed().assertIsEnabled()
                }
                assertNull("Rede deve permanecer desconectada", network.activeNetwork)
            }
        } finally {
            shell("cmd connectivity airplane-mode " + if (airplane == "1") "enable" else "disable")
            shell("svc wifi " + if (wifi == "1") "enable" else "disable")
            shell("svc data " + if (mobile == "1") "enable" else "disable")
        }
    }

    @Test fun recordParticipationDecodeDiagnostics() {
        org.junit.Assume.assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val context = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().targetContext
        for (season in seasons) {
            val spec = requireNotNull(ParticipationVitralPolicy.resolve("qaGeral", season))
            val times = mutableListOf<Long>()
            val sizes = mutableListOf<Int>()
            repeat(4) {
                val start = android.os.SystemClock.elapsedRealtimeNanos()
                val bitmap = requireNotNull(decodeWelcomeVitral(context, spec, 1080, 2461))
                times += (android.os.SystemClock.elapsedRealtimeNanos() - start) / 1000
                val native = bitmap.asAndroidBitmap()
                try { sizes += native.allocationByteCount } finally { native.recycle() }
            }
            android.util.Log.i("AtrioQaParticipation",
                "decode=${season.name} first_us=${times.first()} repeated_median_us=${times.drop(1).sorted()[1]} max_bitmap_bytes=${sizes.maxOrNull()}")
        }
    }

    private fun captureParticipation(name: String) {
        if (android.os.Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        compose.waitForIdle()
        val automation = androidx.test.platform.app.InstrumentationRegistry.getInstrumentation().uiAutomation
        val dir = "/data/local/tmp/atrio-participation-preview"
        android.os.ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $dir")).use { it.readBytes() }
        val bitmap = automation.takeScreenshot() ?: error("Captura de participação indisponível")
        try {
            val fds = automation.executeShellCommandRw("dd of=$dir/$name.png")
            android.os.ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
                android.os.ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input ->
                    check(bitmap.compress(android.graphics.Bitmap.CompressFormat.PNG, 100, input))
                }
                output.readBytes()
            }
        } finally { bitmap.recycle() }
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
