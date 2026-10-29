package br.com.atriocatolico

import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.platform.app.InstrumentationRegistry
import android.os.Build
import android.os.ParcelFileDescriptor
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Tela conectada real, com UID sintético e Firebase limitado pelo runner ao emulador. */
class ProfileLayoutUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun sectionsRemainReachableWithLargeText() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        var destination = ""
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    OnlineProfileScreen(
                        db = FirebaseFirestore.getInstance(), uid = "profile-layout-only",
                        name = "Maria da Comunidade", email = "maria@example.test",
                        biography = "Uma caminhada de fé e comunidade.", posts = emptyList(),
                        publicationsFooter = {}, onSignOut = { destination = "logout" },
                        onModeration = null, onClergyReview = null,
                        onCreate = { destination = "create" }, onOpen = {}, onLike = {}, onSave = {},
                        onSavedPosts = { destination = "saved" },
                        onNotifications = { destination = "notices" }, onReviews = { destination = "reviews" }
                    )
                }
            }
        }
        screenshot("01-identidade-fonte-ampliada")
        val list = compose.onNodeWithTag("atrio-profile-list")
        list.performScrollToNode(hasText("Publicações salvas"))
        compose.onNodeWithText("Publicações salvas").performClick()
        compose.runOnIdle { assertEquals("saved", destination) }
        list.performScrollToNode(hasText("Minhas revisões"))
        compose.onNodeWithText("Minhas revisões").performClick()
        compose.runOnIdle { assertEquals("reviews", destination) }
        list.performScrollToNode(hasText("Central de notificações"))
        compose.onNodeWithText("Central de notificações").performClick()
        compose.runOnIdle { assertEquals("notices", destination) }
        list.performScrollToNode(hasContentDescription("Receber avisos neste aparelho"))
        compose.onNodeWithContentDescription("Receber avisos neste aparelho").assertIsOff()
        screenshot("02-notificacoes-fonte-ampliada")
        list.performScrollToNode(hasTestTag("atrio-profile-signout"))
        compose.onNodeWithTag("atrio-profile-signout").assertIsDisplayed().performClick()
        compose.runOnIdle { assertEquals("logout", destination) }
        screenshot("03-conta-fonte-ampliada")
        list.performScrollToNode(hasTestTag("atrio-profile-publications"))
        compose.onNodeWithTag("atrio-profile-publications").performClick()
        list.performScrollToNode(hasText("Criar discussão"))
        compose.onNodeWithText("Criar discussão").performClick()
        compose.runOnIdle { assertEquals("create", destination) }
    }

    @Test fun badgesAndEditorRemainUsableWithLargeText() {
        // Acessibilidade e navegação testadas apenas no projeto demo isolado.
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        compose.setContent {
            val density = LocalDensity.current.density
            CompositionLocalProvider(LocalDensity provides Density(density, 1.5f)) {
                AtrioTheme {
                    OnlineProfileScreen(
                        db = FirebaseFirestore.getInstance(), uid = "profile-layout-only",
                        name = "Maria da Comunidade", email = "maria@example.test",
                        biography = "Uma caminhada de fé e comunidade.", posts = emptyList(),
                        publicationsFooter = {}, onSignOut = {},
                        onModeration = null, onClergyReview = null,
                        onCreate = {}, onOpen = {}, onLike = {}, onSave = {},
                        onSavedPosts = {}, onNotifications = {}, onReviews = {}
                    )
                }
            }
        }

        val list = compose.onNodeWithTag("atrio-profile-list")
        list.performScrollToNode(hasTestTag("atrio-profile-badges"))
        compose.onNodeWithTag("atrio-profile-badges").performClick()
        compose.onNodeWithText("Gerenciar selos").assertIsDisplayed()
        screenshot("04-selos-fonte-ampliada")
        compose.onNodeWithText("Voltar ao perfil").performClick()

        list.performScrollToNode(hasTestTag("atrio-profile-edit"))
        compose.onNodeWithTag("atrio-profile-edit").performClick()
        compose.onNodeWithTag("atrio-profile-name").assertIsDisplayed()
        compose.onNodeWithTag("atrio-profile-bio").performTextInput("Rascunho de apresentação")
        screenshot("05-editor-fonte-ampliada")

        // A saída do editor não pode descartar silenciosamente um rascunho.
        compose.onNodeWithText("Cancelar").performClick()
        compose.onNodeWithText("Descartar alterações?").assertIsDisplayed()
        compose.onNodeWithText("Continuar editando").performClick()
        compose.onNodeWithTag("atrio-profile-bio").assertTextContains("Rascunho de apresentação")
        compose.onNodeWithText("Cancelar").performClick()
        compose.onNodeWithText("Descartar").performClick()
        compose.onNodeWithTag("atrio-profile-edit").assertExists()
    }

    private fun screenshot(name: String) {
        // O Gradle pode desinstalar o APK ao terminar a suíte. Guardar a captura
        // no diretório do shell de QA evita perdê-la junto com os dados do app.
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("mkdir -p /data/local/tmp/atrio-profile-preview")
        ).use { it.readBytes() }
        // Captura pela automação Android: inclui diálogos, superfícies e selos
        // sem depender da captura Compose, que pode falhar no emulador de CI.
        val bitmap = automation.takeScreenshot()
            ?: error("O emulador Android não conseguiu capturar a tela")
        val pipes = automation.executeShellCommandRw("dd of=/data/local/tmp/atrio-profile-preview/$name.png")
        ParcelFileDescriptor.AutoCloseInputStream(pipes[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(pipes[1]).use { input ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input))
            }
            output.readBytes()
        }
    }
}
