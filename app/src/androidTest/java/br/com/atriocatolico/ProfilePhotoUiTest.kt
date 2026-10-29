package br.com.atriocatolico

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Fotos de QA são sintéticas e nunca são enviadas ao projeto Firebase de produção. */
class ProfilePhotoUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun photoIsPrivatePerUidAndCanBeRemoved() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val first = "qa-photo-user-a"
        val second = "qa-photo-user-b"
        ProfilePhotoStore.remove(context, first)
        ProfilePhotoStore.remove(context, second)
        val image = Bitmap.createBitmap(300, 200, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.rgb(99, 45, 57))
        }
        try {
            val crop = ProfilePhotoStore.crop(image, 1.5f, 0f, 0f)
            assertEquals(400, crop.width)
            assertEquals(400, crop.height)
            ProfilePhotoStore.save(context, first, crop)
            assertNotNull(ProfilePhotoStore.load(context, first))
            assertNull(ProfilePhotoStore.load(context, second))
            assertTrue(ProfilePhotoStore.remove(context, first))
            assertNull(ProfilePhotoStore.load(context, first))
        } finally {
            ProfilePhotoStore.remove(context, first)
            ProfilePhotoStore.remove(context, second)
        }
    }

    @Test fun photoPreviewAndPrivacyNoticeAppearInRealProfile() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val uid = "qa-photo-owner-only"
        val photo = Bitmap.createBitmap(400, 400, Bitmap.Config.ARGB_8888).apply {
            eraseColor(Color.rgb(99, 45, 57))
        }
        compose.setContent {
            CompositionLocalProvider(
                LocalProfileAvatar provides LocalAvatarState(uid, photo.asImageBitmap())
            ) {
                AtrioTheme {
                    OnlineProfileScreen(
                        db = FirebaseFirestore.getInstance(), uid = uid,
                        name = "Maria da Comunidade", email = "maria@example.test",
                        biography = "Minha fé e minha comunidade", posts = emptyList(),
                        publicationsFooter = {}, onSignOut = {},
                        onModeration = null, onClergyReview = null,
                        onCreate = {}, onOpen = {}, onLike = {}, onSave = {},
                        onSavedPosts = {}, onNotifications = {}, onReviews = {}
                    )
                }
            }
        }
        compose.onNodeWithTag("atrio-profile-avatar").assertExists()
        capture("06-foto-perfil-sintetica")
        compose.onNodeWithTag("atrio-profile-list")
            .performScrollToNode(hasTestTag("atrio-profile-photo-manage"))
        compose.onNodeWithTag("atrio-profile-photo-manage").performClick()
        compose.onNodeWithText("Escolher foto da galeria").assertIsDisplayed()
        compose.onNodeWithText("Remover foto deste aparelho").assertIsDisplayed()
        compose.onNodeWithText(
            "Sua foto fica privada neste aparelho por enquanto. " +
                "A sincronização entre contas depende de armazenamento e regras ainda não publicados."
        ).assertExists()
        capture("07-gerenciar-foto")
        compose.onNodeWithText("Fechar").performClick()
    }

    private fun capture(name: String) {
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("mkdir -p /data/local/tmp/atrio-profile-preview")
        ).use { it.readBytes() }
        val screenshot = automation.takeScreenshot() ?: error("Falha ao capturar tela")
        val streams = automation.executeShellCommandRw(
            "dd of=/data/local/tmp/atrio-profile-preview/$name.png"
        )
        ParcelFileDescriptor.AutoCloseInputStream(streams[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(streams[1]).use { input ->
                check(screenshot.compress(Bitmap.CompressFormat.PNG, 100, input))
            }
            output.readBytes()
        }
    }
}
