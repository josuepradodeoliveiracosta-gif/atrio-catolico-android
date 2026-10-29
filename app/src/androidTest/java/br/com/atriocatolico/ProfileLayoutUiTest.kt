package br.com.atriocatolico

import android.content.Context
import android.graphics.Bitmap
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.Density
import androidx.test.core.app.ApplicationProvider
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import java.io.File
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

    private fun screenshot(name: String) {
        val context = ApplicationProvider.getApplicationContext<Context>()
        val directory = context.getExternalFilesDir("profile-preview")!!
        directory.mkdirs()
        val bitmap = compose.onRoot().captureToImage().asAndroidBitmap()
        File(directory, "$name.png").outputStream().use { bitmap.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
