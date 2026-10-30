package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GuardianUiPolicyTest {
    @Test fun rejectsChangedOrMissingSession() {
        assertTrue(GuardianUiPolicy.sameSession("alice", "alice"))
        assertFalse(GuardianUiPolicy.sameSession("alice", "bob"))
        assertFalse(GuardianUiPolicy.sameSession("", ""))
        assertFalse(GuardianUiPolicy.sameSession("alice", null))
    }

    @Test fun appealRequiresSameOwnerHeldCaseFirstAppealAndValidNote() {
        assertTrue(GuardianUiPolicy.canAppeal("alice","alice","held","",false,
            "Peço revisão humana, por favor."))
        assertFalse(GuardianUiPolicy.canAppeal("alice","bob","held","",false,
            "Peço revisão humana, por favor."))
        assertFalse(GuardianUiPolicy.canAppeal("alice","alice","restored","",false,
            "Peço revisão humana, por favor."))
        assertFalse(GuardianUiPolicy.canAppeal("alice","alice","held","Já recorri",false,
            "Peço revisão humana, por favor."))
        assertFalse(GuardianUiPolicy.canAppeal("alice","alice","held","",true,
            "Peço revisão humana, por favor."))
        assertFalse(GuardianUiPolicy.canAppeal("alice","alice","held","",false,"curto"))
        assertFalse(GuardianUiPolicy.canAppeal("alice","alice","held","",false,"x".repeat(501)))
        assertTrue(GuardianUiPolicy.canAppeal("alice","alice","held","",false,
            "  justificativa contextual e humana   "))
    }

    @Test fun reviewingNeedsCurrentSessionLiveHeldCaseServerAndEvidence() {
        val good = "Revisão humana."
        assertTrue(GuardianUiPolicy.canReview("admin","admin","held",true,false,good,true))
        assertFalse(GuardianUiPolicy.canReview("admin","outro","held",true,false,good,true))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","removed",true,false,good,true))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","held",false,false,good,true))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","held",true,true,good,true))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","held",true,false,good,false))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","held",true,false,"sim",true))
        assertFalse(GuardianUiPolicy.canReview("admin","admin","held",true,false,
            "x".repeat(301),true))
    }
}
