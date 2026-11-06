package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.net.URI

class OtaQaChannelTest {
    private val productionHosts = setOf(
        "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
    )

    @Test fun localCleartextIsOnlyAllowedInExplicitLocalQaChannel() {
        val local = URI("http://127.0.0.1:8765/releases/latest")
        assertTrue(OtaQaChannel.isAllowedUri(local, productionHosts) == OtaQaChannel.usesLoopback)
        assertFalse(OtaQaChannel.isAllowedUri(URI("http://127.0.0.1:8080/releases/latest"), productionHosts))
        assertFalse(OtaQaChannel.isAllowedUri(URI("http://192.168.1.1:8765/releases/latest"), productionHosts))
        assertFalse(OtaQaChannel.isAllowedUri(URI("http://example.org/releases/latest"), productionHosts))
        assertFalse(OtaQaChannel.isAllowedUri(URI("http://127.0.0.1:8765/releases/latest?token=secret"), productionHosts))
    }

    @Test fun onlyQaOrProductionTransportCanBeUsed() {
        val official = URI("https://github.com/a/b/releases/download/v1.0.0/atrio-catolico.apk")
        assertTrue(OtaQaChannel.isAllowedUri(official, productionHosts) != OtaQaChannel.usesLoopback)
        assertFalse(OtaQaChannel.isAllowedUri(URI("https://example.org/release.apk"), productionHosts))
        assertFalse(OtaQaChannel.isAllowedUri(URI("https://user:pass@github.com/a"), productionHosts))
        assertFalse(OtaQaChannel.isAllowedUri(URI("https://github.com/a#fragment"), productionHosts))
    }

    @Test fun releaseAndQaAppIdentitiesCannotBeMixed() {
        if (OtaQaChannel.active) {
            assertTrue(OtaUpdatePolicy.PACKAGE.endsWith(".otalab"))
            assertTrue(OtaUpdatePolicy.API == OtaQaChannel.ORIGIN + "/releases/latest")
        } else {
            assertTrue(OtaUpdatePolicy.PACKAGE == "br.com.atriocatolico")
            if (OtaQaChannel.releasePilotActive) {
                assertTrue(OtaUpdatePolicy.API == OtaQaChannel.ORIGIN + "/releases/latest")
                assertTrue(OtaOfficialSigner.acceptsInstalledSigner(
                    OtaOfficialSigner.CERTIFICATE_SHA256))
                assertFalse(OtaOfficialSigner.acceptsInstalledSigner("f".repeat(64)))
            } else {
                assertTrue(OtaUpdatePolicy.API.startsWith("https://api.github.com/"))
            }
        }
    }
}
