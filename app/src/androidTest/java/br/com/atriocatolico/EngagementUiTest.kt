package br.com.atriocatolico

import androidx.compose.runtime.*
import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.test.platform.app.InstrumentationRegistry
import com.google.firebase.FirebaseApp
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test

/** Cenários isolados: nenhum bot envia mensagens a contas reais. */
class EngagementUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun followingIsKeptOnlyForTheCorrectAccount() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val postId = "qa_follow_thread"
        val one = "qa-engagement-a"
        val other = "qa-engagement-b"
        if (postId in LocalFollowedDiscussions.ids(context, one)) {
            LocalFollowedDiscussions.toggle(context, one, postId)
        }
        assertFalse(postId in LocalFollowedDiscussions.ids(context, one))
        assertTrue(LocalFollowedDiscussions.toggle(context, one, postId))
        assertTrue(postId in LocalFollowedDiscussions.ids(context, one))
        assertFalse(postId in LocalFollowedDiscussions.ids(context, other))
        assertFalse(LocalFollowedDiscussions.toggle(context, one, postId))
        assertFalse(postId in LocalFollowedDiscussions.ids(context, one))
    }

    @Test fun userCanQuoteAndRemoveQuoteWithoutChangingExistingReplyApi() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val quoted = Reply("Miguel", "Vamos orar juntos.", "qa_reply_1", ownerUid = "qa-bot-miguel")
        val post = Post(
            id = "qa_post_engagement", author = "Clara", category = "Vida espiritual",
            age = "hoje", title = "Partilha de fé na comunidade",
            body = "Compartilhe a sua experiência de oração.",
            replies = listOf(quoted)
        )
        var submitted = ""
        compose.setContent {
            AtrioTheme {
                DetailScreen(post, name = "Lúcia", onLike = {}, onSave = {},
                    onReply = { body, done -> submitted = body; done(true) },
                    onFollow = {})
            }
        }
        compose.onNodeWithTag("atrio-quote-reply").performClick()
        compose.onNodeWithText("Citando Miguel").assertExists()
        screenshot("08-citacao-engajamento")
        compose.onNodeWithTag("atrio-reply-input").performTextInput("Amém!")
        compose.onNodeWithTag("atrio-reply-submit").performClick()
        compose.runOnIdle { assertEquals("↳ Em resposta a Miguel: Amém!", submitted) }
        compose.onNodeWithText("Citando Miguel").assertDoesNotExist()
    }

    @Test fun followButtonUsesAccountStateWithoutChangingPost() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        var toggles = 0
        compose.setContent {
            AtrioTheme {
                DetailScreen(
                    post = Post("qa_post", "Clara", "Vida espiritual", "hoje",
                        "Como rezar em família?", "Partilhem suas experiências."),
                    name = "Lúcia", onLike = {}, onSave = {},
                    onReply = { _, done -> done(true) },
                    onFollow = { toggles++ }
                )
            }
        }
        compose.onNodeWithTag("atrio-follow-discussion").performClick()
        screenshot("09-acompanhar-discussao")
        compose.runOnIdle { assertEquals(1, toggles) }
    }

    private fun screenshot(name: String) {
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(
            automation.executeShellCommand("mkdir -p /data/local/tmp/atrio-profile-preview")
        ).use { it.readBytes() }
        val bitmap = automation.takeScreenshot() ?: error("Emulador não capturou tela")
        val fds = automation.executeShellCommandRw(
            "dd of=/data/local/tmp/atrio-profile-preview/$name.png"
        )
        ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input ->
                check(bitmap.compress(Bitmap.CompressFormat.PNG, 100, input))
            }
            output.readBytes()
        }
    }
}
