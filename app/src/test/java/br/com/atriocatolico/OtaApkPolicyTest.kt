package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaApkPolicyTest {
    private val signature = "a".repeat(64)
    private val checksum = "b".repeat(64)
    private val offer = OtaApkOffer(
        versionName = "0.20.1",
        versionCode = 36L,
        sizeBytes = 20_000_000L,
        sha256 = checksum,
        signingCertSha256 = signature,
        url = OtaUpdatePolicy.expectedAsset("v0.20.1", "atrio-catolico.apk")
    )

    private fun accepts(
        offerValue: OtaApkOffer = offer,
        bytes: Long = offerValue.sizeBytes,
        actualSha: String = checksum,
        packageName: String = OtaUpdatePolicy.PACKAGE,
        code: Long = offerValue.versionCode,
        name: String = offerValue.versionName,
        apkCert: String = signature,
        installedCode: Long = 35L,
        installedCert: String = signature
    ) = OtaApkPolicy.accept(offerValue, bytes, actualSha, packageName, code,
        name, apkCert, installedCode, installedCert)

    @Test fun correctSignedApkIsAcceptedForUpgrade() {
        assertTrue(accepts())
    }

    @Test fun staleAndSameVersionAreRejected() {
        assertFalse(accepts(installedCode = 36L))
        assertFalse(accepts(installedCode = 40L))
        assertFalse(accepts(code = 35L))
    }

    @Test fun packageAndVersionMismatchesAreRejected() {
        assertFalse(accepts(packageName = "com.example.fake"))
        assertFalse(accepts(code = 37L))
        assertFalse(accepts(name = "0.20.2"))
    }

    @Test fun signerMustMatchBothInstalledAppAndManifest() {
        assertFalse(accepts(apkCert = "c".repeat(64)))
        assertFalse(accepts(installedCert = "d".repeat(64)))
        assertFalse(accepts(offerValue = offer.copy(signingCertSha256 = "bad")))
    }

    @Test fun contentHashMustBeExactlyAsPromised() {
        assertFalse(accepts(actualSha = "e".repeat(64)))
        assertFalse(accepts(offerValue = offer.copy(sha256 = "bad")))
    }

    @Test fun fileMustMatchExactBoundedSize() {
        assertFalse(accepts(bytes = offer.sizeBytes - 1))
        assertFalse(accepts(bytes = offer.sizeBytes + 1))
        assertFalse(OtaApkPolicy.validSize(1, offer.copy(sizeBytes = 0)))
        assertFalse(OtaApkPolicy.validSize(1, offer.copy(
            sizeBytes = OtaApkPolicy.MAX_APK_BYTES + 1)))
        assertTrue(OtaApkPolicy.validSize(offer.sizeBytes, offer))
    }

    @Test fun foreignDownloadUrlsAreRejected() {
        assertFalse(accepts(offerValue = offer.copy(url = "https://attacker.example/app.apk")))
        assertFalse(accepts(offerValue = offer.copy(url =
            "http://github.com/any/release.apk")))
        assertFalse(accepts(offerValue = offer.copy(url =
            OtaUpdatePolicy.expectedAsset("v0.20.2", "atrio-catolico.apk"))))
    }

    @Test fun invalidVersionNameIsRejected() {
        assertFalse(accepts(offerValue = offer.copy(versionName = "../../file")))
    }
}
