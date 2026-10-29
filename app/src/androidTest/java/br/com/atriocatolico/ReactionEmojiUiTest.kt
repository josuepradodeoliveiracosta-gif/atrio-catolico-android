package br.com.atriocatolico

import android.graphics.Bitmap
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.compose.runtime.*
import androidx.compose.material3.Surface
import androidx.compose.foundation.layout.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.unit.dp
import androidx.test.platform.app.InstrumentationRegistry
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.runBlocking
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import java.util.UUID
import java.util.concurrent.TimeUnit

/** All SDK calls point only at demo-atrio-v11. No push, profiles, badges or production changes. */
class ReactionEmojiUiTest {
    @get:Rule val compose = createComposeRule()
    private val context get() = InstrumentationRegistry.getInstrumentation().targetContext
    private fun device(): DeviceEmojiCatalog {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        return runBlocking { ReactionEmojiData.load(context) }
    }
    private fun waitFor(tag: String) = compose.waitUntil(15000) {
        compose.onAllNodesWithTag(tag, useUnmergedTree = true).fetchSemanticsNodes().isNotEmpty()
    }
    private fun tap(tag: String) = compose.onNodeWithTag(tag).performClick()

    @Test fun longPressQuickBarFullCatalogSearchTonesAndRecents() {
        val data = device()
        assertEquals(3944, data.catalog.entries.size)
        var chosen by mutableStateOf("")
        var recent = emptyList<String>()
        compose.setContent {
            AtrioTheme {
                DetailScreen(
                    post = Post("emoji-ui", "Clara", "Vida espiritual", "agora",
                        "Uma palavra de acolhimento", "Compartilhe sua caminhada de fé.",
                        replies = listOf(Reply("Miguel", "Vamos orar juntos.", "emoji-ui-reply"))),
                    name = "Clara", onLike = {}, onSave = {}, onReply = { _, done -> done(true) },
                    reactionsEnabled = true,
                    reactionContent = { reply, requested, dismiss ->
                        ReactionEmojiPicker(data, reply.id, chosen,
                            if (chosen.isEmpty()) emptyList() else listOf(ReactionSummary(chosen, 2, true)),
                            false, requested, dismiss, recents = { recent }, onPick = {
                                chosen = if (chosen == it) "" else it
                                recent = recentReactionEmojis(recent, it)
                            })
                    }
                )
            }
        }
        compose.onNodeWithText("Vamos orar juntos.", useUnmergedTree = true).performScrollTo()
            .performTouchInput { longClick() }
        waitFor("reaction-quick-bar")
        screenshot("01-barra-rapida")
        quickReactionEmojis.forEach { compose.onNodeWithTag("reaction-quick-$it").assertExists() }
        tap("reaction-more")
        waitFor("emoji-search")
        screenshot("02-catalogo-completo")
        compose.onNodeWithTag("emoji-search").performTextInput("família")
        compose.onNodeWithTag("emoji-catalog-grid").performScrollToNode(hasTestTag("emoji-cell-👨‍👩‍👧‍👦"))
        screenshot("03-pesquisa-familia")
        tap("emoji-cell-👨‍👩‍👧‍👦")
        compose.runOnIdle { assertEquals("👨‍👩‍👧‍👦", chosen) }
        compose.onNodeWithTag("reaction-open-emoji-ui-reply").performScrollTo().performClick()
        compose.onNodeWithTag("reaction-quick-👍").performTouchInput { longClick() }
        waitFor("emoji-variant-👍🏽")
        screenshot("04-tons-de-pele")
        tap("emoji-variant-👍🏽")
        compose.runOnIdle { assertEquals("👍🏽", chosen) }
        compose.onNodeWithTag("reaction-open-emoji-ui-reply").performScrollTo().performClick()
        tap("reaction-more"); tap("emoji-recent")
        compose.onNodeWithTag("emoji-cell-👍🏽").assertExists()
        compose.onNodeWithTag("emoji-cell-👨‍👩‍👧‍👦").assertExists()
        screenshot("05-emojis-recentes")
        tap("emoji-cell-👍🏽")
        compose.runOnIdle { assertEquals("", chosen) }
    }

    @Test fun firestoreCountsSyncAcrossAccountsAndSurviveScreenReopening() {
        device()
        val primary = FirebaseApp.getInstance()
        val auth = FirebaseAuth.getInstance(primary)
        val db = FirebaseFirestore.getInstance(primary)
        val secondary = FirebaseApp.initializeApp(context, FirebaseOptions.Builder()
            .setApplicationId("1:1234567890:android:emojiqa").setApiKey("fake-key-for-emulator-only")
            .setProjectId("demo-atrio-v11").build(), "emoji-${UUID.randomUUID()}")
        val auth2 = FirebaseAuth.getInstance(secondary)
        val db2 = FirebaseFirestore.getInstance(secondary)
        auth2.useEmulator("127.0.0.1", 9099); db2.useEmulator("127.0.0.1", 8089)
        val uid = Tasks.await(auth.signInAnonymously(), 15, TimeUnit.SECONDS).user!!.uid
        val other = Tasks.await(auth2.signInAnonymously(), 15, TimeUnit.SECONDS).user!!.uid
        val postId = "emoji-" + UUID.randomUUID().toString()
        val replyId = "reply"
        fun awaitTask(task: com.google.android.gms.tasks.Task<*>) { Tasks.await(task, 15, TimeUnit.SECONDS) }
        try {
            // Synthetic fixture in the emulator, created under real authorization rules.
            awaitTask(db.collection("profiles").document(uid).set(mapOf("displayName" to "Clara Emoji", "createdAt" to FieldValue.serverTimestamp())))
            awaitTask(db.collection("posts").document(postId).set(mapOf("uid" to uid, "authorName" to "Clara Emoji",
                "title" to "Reações no emulador", "body" to "Somente dados sintéticos para testar emojis.",
                "category" to "Vida espiritual", "createdAt" to FieldValue.serverTimestamp())))
            awaitTask(db.collection("posts").document(postId).collection("replies").document(replyId).set(mapOf(
                "uid" to uid, "authorName" to "Clara Emoji", "body" to "Uma resposta para reagir.", "createdAt" to FieldValue.serverTimestamp())))
            val collection = db.collection("posts").document(postId).collection("replies").document(replyId).collection("reactions")
            awaitTask(collection.document(uid).set(mapOf("kind" to "prayer", "createdAt" to FieldValue.serverTimestamp())))
            awaitTask(changeReplyReaction(db2, other, postId, replyId, "🙏"))
            var show by mutableStateOf(true)
            compose.setContent {
                AtrioTheme {
                    Surface { Column(Modifier.fillMaxWidth().padding(24.dp)) {
                        androidx.compose.material3.Text("Respostas · Teste de reações")
                        androidx.compose.material3.Text("Uma resposta para reagir.")
                        if (show) ReplyReactionBar(db, uid, postId, replyId)
                    } }
                }
            }
            waitFor("reaction-count-🙏")
            compose.waitUntil(15000) {
                compose.onAllNodesWithText("🙏 2").fetchSemanticsNodes().isNotEmpty()
            }
            tap("reaction-count-🙏") // remove my legacy prayer, not the other account's
            compose.waitUntil(15000) { compose.onAllNodesWithText("🙏 1").fetchSemanticsNodes().isNotEmpty() }
            tap("reaction-open-$replyId"); tap("reaction-quick-😂")
            compose.waitUntil(15000) { compose.onAllNodesWithText("😂 1").fetchSemanticsNodes().isNotEmpty() }
            awaitTask(changeReplyReaction(db2, other, postId, replyId, "😂"))
            compose.waitUntil(15000) { compose.onAllNodesWithText("😂 2").fetchSemanticsNodes().isNotEmpty() }
            screenshot("06-contagem-entre-contas")
            assertEquals("😂", Tasks.await(collection.document(uid).get(Source.SERVER),15,TimeUnit.SECONDS).getString("kind"))
            compose.runOnIdle { show = false }
            compose.waitForIdle()
            compose.runOnIdle { show = true }
            compose.waitUntil(15000) { compose.onAllNodesWithText("😂 2").fetchSemanticsNodes().isNotEmpty() }
            tap("reaction-open-$replyId"); tap("reaction-quick-❤️")
            compose.waitUntil(15000) { compose.onAllNodesWithText("❤️ 1").fetchSemanticsNodes().isNotEmpty() }
            assertEquals("heart", Tasks.await(collection.document(uid).get(Source.SERVER),15,TimeUnit.SECONDS).getString("kind"))
            assertEquals(2, Tasks.await(collection.get(Source.SERVER),15,TimeUnit.SECONDS).size())
        } finally {
            auth.signOut(); auth2.signOut()
            Tasks.await(db2.terminate(), 10, TimeUnit.SECONDS)
            secondary.delete()
        }
    }

    @Test fun recentEmojisPersistLocallyAndAreSeparatedByAccount() {
        device()
        val one="emoji-recent-${UUID.randomUUID()}"
        val two="emoji-other-${UUID.randomUUID()}"
        ReactionEmojiData.record(context,one,"👩🏽‍💻")
        ReactionEmojiData.record(context,one,"🇧🇷")
        ReactionEmojiData.record(context,one,"👩🏽‍💻")
        assertEquals(listOf("👩🏽‍💻","🇧🇷"),ReactionEmojiData.recent(context,one))
        assertTrue(ReactionEmojiData.recent(context,two).isEmpty())
    }

    private fun screenshot(name: String) {
        compose.waitForIdle()
        if (Build.VERSION.SDK_INT < 31) return
        require(name.matches(Regex("[a-z0-9-]+")))
        val automation = InstrumentationRegistry.getInstrumentation().uiAutomation
        ParcelFileDescriptor.AutoCloseInputStream(automation.executeShellCommand("mkdir -p /data/local/tmp/atrio-reaction-preview")).use { it.readBytes() }
        val bitmap = automation.takeScreenshot() ?: error("Emulador não capturou tela")
        val fds = automation.executeShellCommandRw("dd of=/data/local/tmp/atrio-reaction-preview/$name.png")
        ParcelFileDescriptor.AutoCloseInputStream(fds[0]).use { output ->
            ParcelFileDescriptor.AutoCloseOutputStream(fds[1]).use { input -> check(bitmap.compress(Bitmap.CompressFormat.PNG,100,input)) }
            output.readBytes()
        }
    }
}
