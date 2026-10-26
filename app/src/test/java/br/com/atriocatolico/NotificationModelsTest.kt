package br.com.atriocatolico

import org.junit.Assert.*
import org.junit.Test

class NotificationModelsTest {
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
