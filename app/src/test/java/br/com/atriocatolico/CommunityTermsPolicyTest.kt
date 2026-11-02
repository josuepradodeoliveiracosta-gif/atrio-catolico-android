package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/** Testes locais: sem emulador, Firebase, rede ou configurações reais. */
class CommunityTermsPolicyTest {
    private val official = "https://atrio-catolico.org/termos/community-v1"

    @Test fun acceptsOnlyReviewedShapeForPublicTermsUrl() {
        assertTrue(validCommunityTermsUrl(official))
        assertTrue(validCommunityTermsUrl("https://app.atrio-catolico.org/termos/community-v1"))
        assertTrue(validCommunityTermsUrl("https://atrio-catolico.org:443/termos"))
    }

    @Test fun deniesCredentialsTokenParamsQaHostsAndUnsafeSchemes() {
        for (bad in listOf(
            "", "http://atrio-catolico.org/termos",
            "https://user:password@atrio-catolico.org/termos",
            "https://atrio-catolico.org/termos?token=x",
            "https://atrio-catolico.org/termos#session",
            "https://atrio-catolico.org:444/termos",
            "https://localhost/termos", "https://example.com/termos",
            "https://app.atrio.test/termos",
            "https://atrio-catolico-privacidade-qa.pages.dev/termos",
            "https://atrio-catolico.org\\@other.example/x",
            "https://atrio-catolico.org/termos\nInjected",
            "https://127.0.0.1/termos",
            "https://[::1]/termos"
        )) {
            assertFalse("Rejected: $bad", validCommunityTermsUrl(bad))
        }
    }

    @Test fun publishRequiresCurrentNonzeroVersionAndSafeUrl() {
        assertTrue(CommunityTermsPolicy("community-v1", official, true, true).available)
        for (version in listOf("", "ugc-v1", "community-v0", "community-v01",
                                "community-v10000", "community-v-1")) {
            assertFalse(version,
                CommunityTermsPolicy(version, official, true, true).available)
        }
        assertFalse(CommunityTermsPolicy("community-v1", official, false, true).available)
        assertFalse(CommunityTermsPolicy("community-v1", official, true, false).available)
        assertFalse(CommunityTermsPolicy(
            "community-v1", "https://atrio-catolico.org/termos?uid=123", true, true
        ).available)
    }
}
