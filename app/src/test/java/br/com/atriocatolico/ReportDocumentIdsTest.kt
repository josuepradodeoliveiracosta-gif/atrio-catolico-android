package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ReportDocumentIdsTest {
    @Test fun samePostUsesSameId() {
        assertEquals(ReportDocumentIds.post("bob", "p2"), ReportDocumentIds.post("bob", "p2"))
        assertEquals("bob_post_p2", ReportDocumentIds.post("bob", "p2"))
    }

    @Test fun differentPeopleAndPostsUseDifferentIds() {
        assertNotEquals(ReportDocumentIds.post("bob", "p2"), ReportDocumentIds.post("alice", "p2"))
        assertNotEquals(ReportDocumentIds.post("bob", "p2"), ReportDocumentIds.post("bob", "p3"))
    }

    @Test fun repliesAreDistinctFromPostsAndFromEachOther() {
        assertEquals("bob_reply_p2_a", ReportDocumentIds.reply("bob", "p2", "a"))
        assertNotEquals(ReportDocumentIds.post("bob", "p2"), ReportDocumentIds.reply("bob", "p2", "a"))
        assertNotEquals(ReportDocumentIds.reply("bob", "p2", "a"), ReportDocumentIds.reply("bob", "p2", "b"))
    }
}
