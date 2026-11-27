package br.com.atriocatolico

import android.content.Context
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

    @Test fun failedDecodeLeavesSolidBackdropAvailable() {
        val missing: (Context, Season) -> ImageBitmap? = { _, _ -> null }
        compose.setContent { LoginLiturgicalBackdrop(Season.ADVENT, missing) }
        compose.waitForIdle()
        compose.onNodeWithTag("atrio-login-backdrop").assertIsDisplayed()
        compose.onNodeWithTag("atrio-login-vitral-ADVENT", useUnmergedTree = true).assertDoesNotExist()
    }
}
