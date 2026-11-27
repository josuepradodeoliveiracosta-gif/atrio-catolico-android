package br.com.atriocatolico

import android.graphics.Bitmap
import android.content.Context
import android.net.ConnectivityManager
import android.os.Build
import android.os.ParcelFileDescriptor
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import java.time.LocalDate
import java.util.Locale
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

    @Test fun nonQaNeverCallsTheLoader() {
        var loads = 0
        compose.setContent {
            WelcomeVitralEntry({}, {}, season = Season.ADVENT, buildType = "release",
                loader = { _, _, _, _ -> loads++; null })
        }
        compose.onNodeWithTag("atrio-welcome-create").assertExists()
        compose.onNodeWithTag("atrio-welcome-season-boas_vindas_vitral_advento.webp").assertDoesNotExist()
        compose.runOnIdle { assertEquals(0, loads) }
    }

    @Test fun realWelcomeNavigatesToLoginAndRegistrationInAllSixSeasons() {
        assumeTrue(BuildConfig.BUILD_TYPE == "qaGeral")
        val app = FirebaseApp.getInstance()
        check(BuildConfig.DEBUG && app.options.projectId == "demo-atrio-v11") { "Somente QA isolado" }
        val dates = listOf("2026-11-29" to Season.ADVENT, "2026-12-25" to Season.CHRISTMAS,
            "2026-11-28" to Season.ORDINARY, "2027-02-10" to Season.LENT,
            "2027-03-26" to Season.TRIDUUM, "2027-03-28" to Season.EASTER)
        val day = mutableStateOf(LiturgicalCalendarBR.day(LocalDate.parse(dates.first().first)))
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalLiturgicalDay provides day.value) {
                    OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app),
                        showWelcomeInIsolatedQa = true)
                }
            }
        }
        fun waitForTheme(season: Season) {
            val name = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season)).assetName.substringAfterLast('/')
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag("atrio-welcome-season-" + name, useUnmergedTree = true)
                    .fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag("atrio-welcome-create").assertExists()
        }
        var previous: Season? = null
        dates.forEach { (date, season) ->
            compose.runOnIdle { day.value = LiturgicalCalendarBR.day(LocalDate.parse(date)) }
            waitForTheme(season)
            previous?.let {
                val name = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", it)).assetName.substringAfterLast('/')
                compose.onNodeWithTag("atrio-welcome-season-" + name, useUnmergedTree = true).assertDoesNotExist()
            }
            val label = season.name.lowercase(Locale.ROOT)
            compose.onNodeWithTag("atrio-welcome-vitral", useUnmergedTree = true).assertIsDisplayed()
            captureWelcome(label + "-arte")
            compose.onNodeWithTag("atrio-welcome-login").performScrollTo().assertIsDisplayed()
            captureWelcome(label + "-acoes")
            compose.onNodeWithTag("atrio-welcome-login").performClick()
            compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertIsDisplayed()
            // LOGIN não possui RegistrationCompactHeader. Exercitar BackHandler real.
            ParcelFileDescriptor.AutoCloseInputStream(
                InstrumentationRegistry.getInstrumentation().uiAutomation
                    .executeShellCommand("input keyevent 4")
            ).use { it.readBytes() }
            waitForTheme(season)
            compose.onNodeWithTag("atrio-welcome-create").performScrollTo().performClick()
            compose.onNodeWithText("Como você quer participar?").assertExists()
            compose.onNodeWithText("Sou católico(a)").performScrollTo().performClick()
            compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertIsDisplayed()
            compose.onNodeWithTag("atrio-auth-back").performScrollTo().performClick()
            compose.onNodeWithText("Como você quer participar?").assertExists()
            compose.onNodeWithTag("atrio-auth-back").performScrollTo().performClick()
            waitForTheme(season)
            previous = season
        }
    }

    @Test fun allSixWelcomeArtsLoadWithNetworkDisconnected() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("atrioOfflineVitralQa") == "true")
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11" &&
            Build.HARDWARE in setOf("ranchu", "goldfish")) { "Somente emulador QA isolado" }
        val network = instrumentation.targetContext.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
        fun shell(command: String): String =
            ParcelFileDescriptor.AutoCloseInputStream(instrumentation.uiAutomation
                .executeShellCommand(command)).use { it.bufferedReader().readText().trim() }
        val wifi = shell("settings get global wifi_on")
        val mobile = shell("settings get global mobile_data")
        val airplane = shell("settings get global airplane_mode_on")
        check(wifi in setOf("0", "1") && mobile in setOf("0", "1") &&
            airplane in setOf("0", "1")) { "Estado inicial de rede desconhecido" }
        try {
            shell("cmd connectivity airplane-mode enable")
            shell("svc wifi disable")
            shell("svc data disable")
            compose.waitUntil(15_000) { network.activeNetwork == null }
            val selected = mutableStateOf(seasons.first())
            compose.setContent { AtrioTheme { WelcomeVitralEntry({}, {}, season = selected.value) } }
            for (season in seasons) {
                compose.runOnIdle { selected.value = season }
                val asset = requireNotNull(WelcomeVitralPolicy.resolve("qaGeral", season)).assetName.substringAfterLast('/')
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag("atrio-welcome-season-" + asset, useUnmergedTree = true)
                        .fetchSemanticsNodes().size == 1
                }
                compose.onNodeWithTag("atrio-welcome-create").performScrollTo().assertIsDisplayed()
                compose.onNodeWithTag("atrio-welcome-login").performScrollTo().assertIsDisplayed()
                assertNull("Rede deve permanecer desconectada", network.activeNetwork)
            }
        } finally {
            shell("cmd connectivity airplane-mode " + if (airplane == "1") "enable" else "disable")
            shell("svc wifi " + if (wifi == "1") "enable" else "disable")
            shell("svc data " + if (mobile == "1") "enable" else "disable")
        }
    }

    private fun captureWelcome(name: String) {
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        compose.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val dir = "/data/local/tmp/atrio-welcome-preview"
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $dir")).use { it.readBytes() }
        val bitmap = automation.takeScreenshot() ?: error("Emulador não capturou boas-vindas")
        try {
            val fds = automation.executeShellCommandRw("dd of=$dir/$name.png")
            ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
                ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input ->
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input))
                }
                output.readBytes()
            }
        } finally {
            bitmap.recycle()
        }
    }
}
