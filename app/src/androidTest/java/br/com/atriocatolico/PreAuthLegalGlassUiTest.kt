package br.com.atriocatolico

import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.mutableStateOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.unit.Density
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.Rule
import org.junit.Test

class PreAuthLegalGlassUiTest {
    @get:Rule val compose = createComposeRule()

    @OptIn(ExperimentalTestApi::class)
    @Test fun realRegistrationLinksOpenAndCloseWithoutAcceptingConsent() {
        val app = FirebaseApp.getInstance()
        check(BuildConfig.BUILD_TYPE == "qaGeral" && BuildConfig.DEBUG &&
            app.options.projectId == "demo-atrio-v11")
        compose.setContent {
            AtrioTheme {
                OnlineAuthScreen(FirebaseAuth.getInstance(app), FirebaseFirestore.getInstance(app))
            }
        }
        compose.onNodeWithTag("atrio-auth-toggle").performScrollTo().performClick()
        compose.waitUntil(10_000) {
            compose.onAllNodesWithTag("atrio-preauth-form-glass", useUnmergedTree = true)
                .fetchSemanticsNodes().size == 1
        }
        val scenarios = listOf(
            listOf("atrio-auth-terms-links","terms","Termos de Uso — prévia","Fechar"),
            listOf("atrio-auth-privacy-link","privacy","Política de Privacidade — prévia","Fechar"),
            listOf("atrio-auth-terms-links","rules","Regras da Comunidade","Entendi"),
        )
        for ((node, link, title, button) in scenarios) {
            compose.onNodeWithTag(node, useUnmergedTree = true).performScrollTo()
                .performFirstLinkClick { (it.item as? LinkAnnotation.Clickable)?.tag == link }
            compose.onNodeWithTag("atrio-preauth-legal-glass", useUnmergedTree = true).assertIsDisplayed()
            compose.onNodeWithText(title).assertIsDisplayed()
            compose.onNodeWithText(button).assertIsDisplayed()
            capture(link)
            compose.onNodeWithText(button).performClick()
            compose.onNodeWithTag("atrio-preauth-legal-glass", useUnmergedTree = true).assertDoesNotExist()
            compose.onNodeWithTag("atrio-auth-rules").assertIsOff()
            compose.onNodeWithTag("atrio-auth-privacy").assertIsOff()
            compose.onNodeWithTag("atrio-auth-submit").performScrollTo().assertIsNotEnabled()
        }
    }

    @Test fun largeFontModalAndFallbackKeepDismissAction() {
        val visible = mutableStateOf(true)
        val glass = mutableStateOf(true)
        compose.setContent {
            val d = LocalDensity.current
            AtrioTheme {
                CompositionLocalProvider(LocalDensity provides Density(d.density,2f)) {
                    if (visible.value) PreAuthLegalDialog(
                        glass = glass.value,
                        onDismissRequest = { visible.value = false },
                        title = { Text("Regras") },
                        text = { Column(Modifier.verticalScroll(rememberScrollState())) {
                            Text(("Texto de teste sem dados pessoais. ").repeat(35))
                        } },
                        confirmLabel = "Fechar",
                        onConfirm = { visible.value = false },
                    )
                }
            }
        }
        compose.onNodeWithTag("atrio-preauth-legal-glass").assertIsDisplayed()
        compose.onNodeWithText("Fechar").assertIsDisplayed().performClick()
        compose.onNodeWithText("Regras").assertDoesNotExist()
        compose.runOnIdle { glass.value = false; visible.value = true }
        compose.onNodeWithTag("atrio-preauth-legal-glass").assertDoesNotExist()
        compose.onNodeWithText("Fechar").assertIsDisplayed().performClick()
        compose.onNodeWithText("Regras").assertDoesNotExist()
    }

    private fun capture(name: String) {
        if (Build.VERSION.SDK_INT < 31) return
        require(name in setOf("terms","privacy","rules"))
        compose.waitForIdle()
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        val dir = "/data/local/tmp/atrio-legal-glass-preview"
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p $dir")).use { it.readBytes() }
        val bitmap = automation.takeScreenshot() ?: error("Captura indisponível")
        try {
            val fds = automation.executeShellCommandRw("dd of=$dir/$name.png")
            ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
                ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input ->
                    check(bitmap.compress(Bitmap.CompressFormat.PNG,100,input))
                }
                output.readBytes()
            }
        } finally { bitmap.recycle() }
    }
}
