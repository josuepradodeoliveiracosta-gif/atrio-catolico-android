package br.com.atriocatolico

import androidx.compose.ui.test.*
import androidx.compose.ui.test.junit4.createComposeRule
import com.google.firebase.FirebaseApp
import com.google.firebase.firestore.FirebaseFirestore
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test

/** Interações sem rede de produção: runner usa o projeto demo-atrio-v11. */
class PublicMemberProfileUiTest {
    @get:Rule val compose = createComposeRule()

    @Test fun tappingAuthorOpensCorrectUidInsteadOfPost() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        var profile = ""
        var opened = ""
        compose.setContent {
            AtrioTheme {
                DiscussionCard(
                    post = Post("qa-post", "Clara", "Vida espiritual", "hoje",
                        "Conversa de oração", "Uma mensagem.", ownerUid = "qa-clara"),
                    onOpen = { opened = it },
                    onLike = {}, onSave = {},
                    onOpenProfile = { uid, _ -> profile = uid }
                )
            }
        }
        compose.onNodeWithTag("atrio-open-author-qa-post").performClick()
        compose.runOnIdle {
            assertEquals("qa-clara", profile)
            assertEquals("", opened)
        }
    }

    @Test fun tappingReplyNameAndAvatarUsesReplyOwnerUid() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        val selected = mutableListOf<String>()
        compose.setContent {
            AtrioTheme {
                DetailScreen(
                    post = Post("qa-thread", "Clara", "Vida espiritual", "hoje",
                        "Encontro da comunidade", "Uma conversa em comunidade",
                        ownerUid = "qa-clara",
                        replies = listOf(Reply("Miguel", "Vamos rezar", "qa-reply", ownerUid = "qa-miguel"))),
                    name = "Lúcia", onLike = {}, onSave = {},
                    onReply = { _, done -> done(true) },
                    onOpenProfile = { uid, _ -> selected.add(uid) }
                )
            }
        }
        compose.onNodeWithTag("atrio-detail-replies").performScrollToIndex(1)
        compose.onNodeWithTag("atrio-open-reply-name-qa-reply").performClick()
        compose.onNodeWithTag("atrio-open-reply-avatar-qa-reply").performClick()
        compose.runOnIdle { assertEquals(listOf("qa-miguel", "qa-miguel"), selected) }
    }

    @Test fun publicProfileKeepsPrivateAccountControlsHidden() {
        check(FirebaseApp.getInstance().options.projectId == "demo-atrio-v11")
        var returned = false
        compose.setContent {
            AtrioTheme {
                PublicMemberProfileScreen(
                    db = FirebaseFirestore.getInstance(),
                    target = PublicMemberTarget("qa-visitor", "Joana"),
                    onBack = { returned = true },
                    onOpenDiscussion = {}
                )
            }
        }
        compose.onNodeWithTag("atrio-public-profile-name").assertTextContains("Joana")
        compose.onNodeWithTag("atrio-profile-edit").assertDoesNotExist()
        compose.onNodeWithTag("atrio-profile-signout").assertDoesNotExist()
        compose.onNodeWithTag("atrio-public-profile-back").performClick()
        compose.runOnIdle { assertEquals(true, returned) }
    }
}
