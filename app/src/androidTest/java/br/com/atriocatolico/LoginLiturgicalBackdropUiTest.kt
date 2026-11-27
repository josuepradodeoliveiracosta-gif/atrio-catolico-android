package br.com.atriocatolico

import android.content.Context
import android.net.ConnectivityManager
import org.junit.Assume.assumeTrue
import android.graphics.BitmapFactory
import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.height
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import androidx.compose.ui.graphics.ImageBitmap
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import br.com.atriocatolico.LiturgicalCalendarBR.Season
import org.junit.Rule
import org.junit.Test

/** Recursos locais e formulário real; nenhum pedido de autenticação ou recuperação é enviado. */
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

    @Test fun loginFormRemainsReachableAtLargeFontAndCompactViewport() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11") { "Somente QA isolado" }
        compose.setContent {
            val density = LocalDensity.current
            CompositionLocalProvider(LocalDensity provides Density(density.density, 2f)) {
                AtrioTheme {
                    Box(Modifier.width(320.dp).height(440.dp)) {
                        OnlineAuthScreen(FirebaseAuth.getInstance(app),
                            FirebaseFirestore.getInstance(app))
                    }
                }
            }
        }
        compose.onNodeWithTag("atrio-login-backdrop").assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-password").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
        // Sem e-mail válido, a ação deve apenas exibir o erro local.
        compose.onNodeWithText("Esqueci minha senha").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-auth-error").performScrollTo().assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-email").performScrollTo()
            .performTextInput("teste@qa.invalid")
        compose.onNodeWithTag("atrio-auth-password").performScrollTo()
            .performTextInput("SenhaFicticiaSomenteQA")
        compose.onNodeWithContentDescription("Mostrar senha").performScrollTo().performClick()
        compose.onNodeWithContentDescription("Ocultar senha").assertExists()
        compose.onNodeWithContentDescription("Ocultar senha").performClick()
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsEnabled()
        // Não submeter o login; verificar apenas a navegação e o isolamento visual do cadastro.
        compose.onNodeWithTag("atrio-auth-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-login-backdrop").assertDoesNotExist()
        compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertIsDisplayed()
    }

    @Test fun realLoginKeepsFormStateAcrossSixLiturgicalDates() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11") { "Somente QA isolado" }
        val dates = listOf("2026-11-28" to Season.ORDINARY, "2026-11-29" to Season.ADVENT,
            "2026-12-25" to Season.CHRISTMAS, "2027-02-10" to Season.LENT,
            "2027-03-26" to Season.TRIDUUM, "2027-03-28" to Season.EASTER)
        val day = mutableStateOf(LiturgicalCalendarBR.day(java.time.LocalDate.parse(dates.first().first)))
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalLiturgicalDay provides day.value) {
                    OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app))
                }
            }
        }
        val email = "transicao@qa.invalid"
        compose.onNodeWithTag("atrio-auth-email").performScrollTo().performTextInput(email)
        var previous: Season? = null
        dates.forEach { (date, season) ->
            compose.runOnIdle { day.value = LiturgicalCalendarBR.day(java.time.LocalDate.parse(date)) }
            val tag = "atrio-login-vitral-${season.name}"
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag(tag, useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertTextContains(email)
            previous?.let {
                compose.onNodeWithTag("atrio-login-vitral-${it.name}", useUnmergedTree = true)
                    .assertDoesNotExist()
            }
            previous = season
        }
        // Sem senha e sem envio ao servidor.
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
    }

    @Test fun loginArtLoadsWithNetworkDisconnected() {
        val instrumentation = InstrumentationRegistry.getInstrumentation()
        assumeTrue(InstrumentationRegistry.getArguments().getString("atrioOfflineVitralQa") == "true")
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11" &&
            Build.HARDWARE in setOf("ranchu", "goldfish")) { "Somente emulador QA isolado" }
        val context = instrumentation.targetContext
        val network = context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager
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
            val dates = listOf("2026-11-28" to Season.ORDINARY, "2026-11-29" to Season.ADVENT,
                "2026-12-25" to Season.CHRISTMAS, "2027-02-10" to Season.LENT,
                "2027-03-26" to Season.TRIDUUM, "2027-03-28" to Season.EASTER)
            val day = mutableStateOf(LiturgicalCalendarBR.day(java.time.LocalDate.parse(dates.first().first)))
            compose.setContent {
                AtrioTheme {
                    CompositionLocalProvider(LocalLiturgicalDay provides day.value) {
                        OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app))
                    }
                }
            }
            dates.forEach { (date, season) ->
                compose.runOnIdle { day.value = LiturgicalCalendarBR.day(java.time.LocalDate.parse(date)) }
                val tag = "atrio-login-vitral-${season.name}"
                compose.waitUntil(10_000) {
                    compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
                }
                compose.onNodeWithTag(tag, useUnmergedTree = true).assertIsDisplayed()
                assertTrue("Rede deve permanecer desconectada", network.activeNetwork == null)
            }
            compose.onNodeWithTag("atrio-auth-email").performScrollTo().assertIsDisplayed()
        } finally {
            shell("cmd connectivity airplane-mode " + if (airplane == "1") "enable" else "disable")
            shell("svc wifi " + if (wifi == "1") "enable" else "disable")
            shell("svc data " + if (mobile == "1") "enable" else "disable")
        }
    }

    @Test fun captureRealLoginAtNormalFont() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11") { "Somente QA isolado" }
        compose.setContent {
            AtrioTheme {
                OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app))
            }
        }
        val season = LiturgicalCalendarBR.day(java.time.LocalDate.now()).season
        val tag = "atrio-login-vitral-${season.name}"
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
        }
        compose.onNodeWithTag(tag, useUnmergedTree = true).assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-email").assertIsDisplayed()
        compose.onNodeWithTag("atrio-auth-password").assertIsDisplayed()
        compose.waitForIdle()
        if (Build.VERSION.SDK_INT >= 31) {
            val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
            val dir = "/data/local/tmp/atrio-login-preview"
            ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $dir")).use { it.readBytes() }
            val bitmap = automation.takeScreenshot() ?: error("Emulador não capturou tela")
            val name = "login-" + season.name.lowercase(java.util.Locale.ROOT) + ".png"
            val fds = automation.executeShellCommandRw("dd of=$dir/$name")
            ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
                ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input ->
                    check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input))
                }
                output.readBytes()
            }
            bitmap.recycle()
        }
    }

    @Test fun registrationUsesSixDedicatedLocalArtsAndKeepsRequiredControls() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11") { "Somente QA isolado" }
        val dates = listOf("2026-11-28" to Season.ORDINARY, "2026-11-29" to Season.ADVENT,
            "2026-12-25" to Season.CHRISTMAS, "2027-02-10" to Season.LENT,
            "2027-03-26" to Season.TRIDUUM, "2027-03-28" to Season.EASTER)
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        dates.forEach { (_, season) ->
            val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
            context.assets.open(registrationVitralAssetName(season)).use {
                BitmapFactory.decodeStream(it, null, bounds)
            }
            assertEquals(941, bounds.outWidth)
            assertEquals(1672, bounds.outHeight)
            assertEquals("image/webp", bounds.outMimeType)
        }
        val day = mutableStateOf(LiturgicalCalendarBR.day(java.time.LocalDate.parse(dates.first().first)))
        compose.setContent {
            AtrioTheme {
                CompositionLocalProvider(LocalLiturgicalDay provides day.value) {
                    OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app))
                }
            }
        }
        compose.onNodeWithTag("atrio-auth-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-login-backdrop").assertDoesNotExist()
        val name = "Pessoa QA"
        compose.onNodeWithTag("atrio-auth-name").performScrollTo().performTextInput(name)
        dates.forEach { (date, season) ->
            compose.runOnIdle { day.value = LiturgicalCalendarBR.day(java.time.LocalDate.parse(date)) }
            val tag = "atrio-registration-vitral-${season.name}"
            compose.waitUntil(10_000) {
                compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().size == 1
            }
            compose.onNodeWithTag(tag, useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithTag("atrio-auth-name").performScrollTo().assertTextContains(name)
        }
        listOf("atrio-auth-email", "atrio-auth-password", "atrio-auth-confirm",
            "atrio-auth-rules", "atrio-auth-privacy").forEach {
            compose.onNodeWithTag(it).performScrollTo().assertIsDisplayed()
        }
        compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
        compose.onNodeWithTag("atrio-auth-toggle").performScrollTo().performClick()
        compose.onNodeWithTag("atrio-registration-backdrop").assertDoesNotExist()
        compose.onNodeWithTag("atrio-login-backdrop").assertIsDisplayed()
    }

    @Test fun registrationDecodeFailureKeepsSolidBackdrop() {
        val missing: (Context, Season) -> ImageBitmap? = { _, _ -> null }
        compose.setContent { RegistrationLiturgicalBackdrop(Season.ADVENT, missing) }
        compose.waitForIdle()
        compose.onNodeWithTag("atrio-registration-backdrop").assertIsDisplayed()
        compose.onNodeWithTag("atrio-registration-vitral-ADVENT", useUnmergedTree = true).assertDoesNotExist()
    }

    @Test fun failedDecodeLeavesSolidBackdropAvailable() {
        val missing: (Context, Season) -> ImageBitmap? = { _, _ -> null }
        compose.setContent { LoginLiturgicalBackdrop(Season.ADVENT, missing) }
        compose.waitForIdle()
        compose.onNodeWithTag("atrio-login-backdrop").assertIsDisplayed()
        compose.onNodeWithTag("atrio-login-vitral-ADVENT", useUnmergedTree = true).assertDoesNotExist()
    }
}
