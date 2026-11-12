package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class UnifiedReportEntryQaPolicyTest {
    @Test fun normalMemberUsesOnlyTheThreePreexistingReportFlows() {
        val flows = mapOf(
            UnifiedReportSubjectQa.PARTICIPANT to UnifiedReportFlowQa.EXISTING_USER_REPORT,
            UnifiedReportSubjectQa.DIRECT_MESSAGE to UnifiedReportFlowQa.EXISTING_CHAT_REPORT,
            UnifiedReportSubjectQa.GROUP_MESSAGE to UnifiedReportFlowQa.EXISTING_GROUP_REPORT
        )
        for ((subject, flow) in flows) {
            val d = UnifiedReportEntryQaPolicy.decide(subject,
                UnifiedReportAccessQa.MEMBER_WITH_CONTEXT, true, true)
            assertEquals(flow, d.flow)
            assertTrue(d.mayRouteToExistingUi)
            assertFalse(d.rolloutApproved)
            assertFalse(d.canIssueReceipt)
        }
    }
    @Test fun exceptionalStatesNeverGrantPrivateHistoryOrReceipt() {
        for (subject in UnifiedReportSubjectQa.values())
        for (access in UnifiedReportAccessQa.values()) {
            val normal = access == UnifiedReportAccessQa.MEMBER_WITH_CONTEXT
            val d = UnifiedReportEntryQaPolicy.decide(subject, access,
                sessionAuthenticated = access != UnifiedReportAccessQa.NO_LOGIN,
                canAccessExistingContext = normal)
            if (!normal) {
                assertEquals(UnifiedReportFlowQa.EXCEPTIONAL_PENDING_APPROVAL, d.flow)
                assertFalse(d.mayRouteToExistingUi)
            }
            assertFalse(d.exceptionalIntakeActive)
            assertFalse(d.canIssueReceipt)
            assertFalse(d.canPersistExceptionalReport)
            assertFalse(d.canAccessPrivateHistory)
            assertFalse(d.rolloutApproved)
        }
    }
    @Test fun missingSessionOrContextCannotReusePrivateFlows() {
        for (subject in UnifiedReportSubjectQa.values())
        for (authenticated in listOf(true,false))
        for (context in listOf(true,false)) {
            val d = UnifiedReportEntryQaPolicy.decide(subject,
                UnifiedReportAccessQa.MEMBER_WITH_CONTEXT, authenticated, context)
            if (!authenticated || !context) {
                assertEquals(UnifiedReportFlowQa.EXCEPTIONAL_PENDING_APPROVAL, d.flow)
                assertFalse(d.mayRouteToExistingUi)
            }
        }
    }
    @Test fun suspensionAndFormerMembershipCannotBypassExistingRules() {
        for (access in listOf(UnifiedReportAccessQa.FORMER_MEMBER,
                UnifiedReportAccessQa.SUSPENDED,
                UnifiedReportAccessQa.CHAT_UNAVAILABLE)) {
            val d = UnifiedReportEntryQaPolicy.decide(
                UnifiedReportSubjectQa.GROUP_MESSAGE,access,true,true)
            assertEquals(UnifiedReportFlowQa.EXCEPTIONAL_PENDING_APPROVAL,d.flow)
            assertFalse(d.canAccessPrivateHistory)
        }
    }
}
