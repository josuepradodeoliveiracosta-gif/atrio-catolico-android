package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class NotificationModelsTest {
    @Test fun adminAlertsRequireCurrentUserAndServerConfirmedSnapshot() {
        val expected = "admin-qa"
        assertTrue(verifiedAdminNoticeSnapshot(expected, expected,
            hasError = false, hasData = true, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, "other-account",
            hasError = false, hasData = true, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, null,
            hasError = false, hasData = true, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot("", "",
            hasError = false, hasData = true, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, expected,
            hasError = true, hasData = true, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, expected,
            hasError = false, hasData = false, fromCache = false, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, expected,
            hasError = false, hasData = true, fromCache = true, pendingWrites = false))
        assertFalse(verifiedAdminNoticeSnapshot(expected, expected,
            hasError = false, hasData = true, fromCache = false, pendingWrites = true))
    }

    private fun event(id: String, kind: NoticeKind, target: String = "", read: Boolean = false, at: Long = 1) =
        NoticeEvent(id, kind, target, "title", "body", at, read)

    @Test fun repliesGroupByDiscussionAndKeepUnreadState() {
        val groups = groupNotices(listOf(event("a", NoticeKind.REPLY, "post1", true),
            event("b", NoticeKind.REPLY, "post1", false, 3), event("c", NoticeKind.REPLY, "post2", true, 2)), false)
        assertEquals(2, groups.size)
        assertEquals("post1", groups.first().target)
        assertEquals(2, groups.first().events.size)
        assertTrue(groups.first().unread)
        assertFalse(groups.last().unread)
    }
    @Test fun directRepliesHaveASeparateGroupFromDiscussionReplies() {
        val notice = NoticeEvent("d1", NoticeKind.REPLY, "p1",
            "Clara respondeu ao seu comentário", "Toque para abrir.", 3, false,
            directReply = true)
        val other = NoticeEvent("d2", NoticeKind.REPLY, "p1",
            "Miguel respondeu ao seu comentário", "Toque para abrir.", 4, true,
            directReply = true)
        val general = event("r1", NoticeKind.REPLY, "p1", at = 2)
        val groups = groupNotices(listOf(notice, other, general), false)
        assertEquals(2, groups.size)
        assertEquals("direct:p1", groups.first().id)
        assertEquals("p1", groups.first().target)
        assertEquals("2 respostas aos seus comentários", groups.first().title)
        assertEquals(2, groups.first().events.size)
        assertTrue(groups.first().unread)
        assertEquals("reply:p1", groups.last().id)
        assertEquals(1, groups.last().events.size)
    }

    @Test fun mentionsDoNotMixWithDirectRepliesAndKeepUnreadState() {
        val mentions = listOf(
            NoticeEvent("m1", NoticeKind.REPLY, "p", "Você foi mencionado",
                "Toque para abrir.", at = 3, mentioned = true),
            NoticeEvent("m2", NoticeKind.REPLY, "p", "Você foi mencionado",
                "Toque para abrir.", at = 4, read = true, mentioned = true))
        val direct = NoticeEvent("d1", NoticeKind.REPLY, "p",
            "Responderam ao seu comentário", "Abrir.", at = 2, directReply = true)
        val general = NoticeEvent("r1", NoticeKind.REPLY, "p",
            "Nova resposta", "Abrir.", at = 1)
        val groups = groupNotices(mentions + direct + general, false)
        assertEquals(3, groups.size)
        assertEquals("mention:p", groups.first().id)
        assertEquals("2 menções nesta discussão", groups.first().title)
        assertTrue(groups.first().unread)
        assertEquals("direct:p", groups[1].id)
        assertEquals("reply:p", groups.last().id)
    }

    @Test fun memberReportsJoinExistingAdminAlertsWithoutExposingIdentity() {
        val reportId = "rep_alice_user_bob"
        val member = pendingMemberReportNotice(reportId, "pending", 1700000000000L, 42)!!
        val post = event("post_1", NoticeKind.REPORTS, at = 1700000001000L)
        val group = groupNotices(listOf(post, member), true).single()
        assertEquals(NoticeKind.REPORTS, group.kind)
        assertEquals(2, group.events.size)
        assertTrue(group.body.contains("usuários denunciados"))
        assertFalse(group.title.contains("alice"))
        assertFalse(member.id.contains("alice"))
        assertFalse(member.localToken.contains("alice"))
        assertFalse(member.localToken.contains("bob"))
        assertTrue(groupNotices(listOf(post, member), false).isEmpty())
    }

    @Test fun memberReportsOnlyAlertWhilePendingWithStablePrivateToken() {
        val id = "alice_user_bob"
        val original = pendingMemberReportNotice(id, "pending", 1700000000000L, 1)!!
        assertEquals(original, pendingMemberReportNotice(id, "pending", 1700000000000L, 1))
        assertFalse(original.localToken == pendingMemberReportNotice(
            id, "pending", 1700000000000L, 2)!!.localToken)
        for (status in listOf("reviewed", "dismissed", "unknown", "")) {
            assertNull(pendingMemberReportNotice(id, status, 1700000000000L, 1))
        }
        assertNotNull(pendingMemberReportNotice(id, null, 1700000000000L, 1))
        assertNull(pendingMemberReportNotice("", "pending", 1700000000000L, 1))
        assertNull(pendingMemberReportNotice(id, "pending", 0L, 1))
    }

    @Test fun adminDataNeverAppearsForCommonUserOrRevokedAdmin() {
        val events = listOf(event("a", NoticeKind.REPORTS), event("b", NoticeKind.REQUESTS), event("c", NoticeKind.REPLY, "p"))
        assertEquals(3, groupNotices(events, true).size)
        assertEquals(listOf(NoticeKind.REPLY), groupNotices(events, false).map { it.kind })
    }
    @Test fun readAdminGroupRemainsPendingUntilSourceRemovesIt() {
        val events = listOf(event("a", NoticeKind.REPORTS, read = true), event("b", NoticeKind.REPORTS, read = true))
        val group = groupNotices(events, true).single()
        assertFalse(group.unread)
        assertTrue(group.administrative)
        assertEquals(2, group.events.size)
        assertTrue(groupNotices(emptyList(), true).isEmpty())
    }
    @Test fun newPendingItemMakesPreviouslyReadGroupUnread() {
        assertTrue(groupNotices(listOf(event("a", NoticeKind.REQUESTS, read = true),
            event("b", NoticeKind.REQUESTS)), true).single().unread)
    }
    @Test fun resubmittedOrUnknownReviewDoesNotShowOldDecision() {
        assertNull(reviewNotice("pending", "padre", 1, "token"))
        assertNull(reviewNotice("unknown", "padre", 1, "token"))
        assertNull(reviewNotice("approved", "unknown", 1, "token"))
    }
    @Test fun approvedAndRejectedResultsHaveAppropriatePublicCopy() {
        val approved = reviewNotice("approved", "padre", 10, "review:10")!!
        val rejected = reviewNotice("rejected", "diacono", 11, "review:11")!!
        assertEquals("Selo Padre aprovado", approved.title)
        assertTrue(rejected.title.contains("não aprovada"))
        assertTrue(rejected.body.contains("nova solicitação"))
        assertEquals("review:11", rejected.localToken)
        assertEquals(11L, rejected.at)
    }
}
