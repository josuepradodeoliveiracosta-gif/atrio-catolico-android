package br.com.atriocatolico

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaUpdatePolicyTest {
    private val certificate = "a".repeat(64)
    private val version = "0.20.1"
    private val tag = "v$version"
    private val release = OtaRemoteRelease(
        tag = tag,
        page = OtaUpdatePolicy.expectedPage(tag),
        manifestUrl = OtaUpdatePolicy.expectedAsset(tag, "update.json"),
        apkUrl = OtaUpdatePolicy.expectedAsset(tag, "atrio-catolico.apk"),
        draft = false,
        prerelease = false
    )
    private val manifest = OtaManifest(
        schemaVersion = 1,
        channel = "stable",
        applicationId = OtaUpdatePolicy.PACKAGE,
        versionName = version,
        versionCode = 36,
        mandatory = false,
        minimumAndroidSdk = 26,
        apkAsset = "atrio-catolico.apk",
        apkSizeBytes = 21_000_000L,
        apkSha256 = "b".repeat(64),
        certificateSha256 = certificate,
        downloadUrl = release.apkUrl,
        releasePageUrl = release.page,
        releaseNotes = "Melhorias gerais e correções."
    )

    private fun inspect(
        remote: OtaRemoteRelease = release,
        remoteManifest: OtaManifest = manifest,
        installedCode: Long = 35L,
        currentCertificate: String = certificate,
        sdk: Int = 35
    ) = OtaUpdatePolicy.evaluate(remote, remoteManifest, installedCode, currentCertificate, sdk)

    @Test fun updateIsAvailableOnlyIfVersionCodeIncreases() {
        val result = inspect()
        assertTrue(result is OtaCheckStatus.Available)
        val available = result as OtaCheckStatus.Available
        assertEquals("0.20.1", available.version)
        assertEquals(release.page, available.releasePage)
    }

    @Test fun sameAndOlderVersionAreUpToDate() {
        assertEquals(OtaCheckStatus.UpToDate, inspect(installedCode = 36))
        assertEquals(OtaCheckStatus.UpToDate, inspect(installedCode = 45))
    }

    @Test fun differentCertificateFailsClosed() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(currentCertificate = "c".repeat(64)))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(certificateSha256 = "")))
    }

    @Test fun untrustedHostsOrMismatchedLinksAreRejected() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remote = release.copy(manifestUrl = "https://example.org/update.json")))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(downloadUrl = "http://example.org/app.apk")))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remote = release.copy(page = "https://example.org/releases")))
    }

    @Test fun draftOrPreReleaseCannotBeOffered() {
        assertEquals(OtaCheckStatus.Unavailable, inspect(remote = release.copy(draft = true)))
        assertEquals(OtaCheckStatus.Unavailable, inspect(remote = release.copy(prerelease = true)))
    }

    @Test fun otherPackageOrUnsupportedSchemaFailsClosed() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(applicationId = "com.imposter")))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(schemaVersion = 2)))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(channel = "debug")))
    }

    @Test fun wrongTagOrMalformedNameFailsClosed() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remote = release.copy(tag = "v0.20.2")))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(versionName = "not-a-version")))
    }

    @Test fun insufficientAndroidVersionMustNotShowInstallOffer() {
        assertEquals(OtaCheckStatus.Incompatible,
            inspect(remoteManifest = manifest.copy(minimumAndroidSdk = 36), sdk = 35))
    }

    @Test fun invalidHashesSizesAndNotesAreRejected() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(apkSha256 = "bad")))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(apkSizeBytes = 0)))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(apkSizeBytes = 400_000_000)))
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(releaseNotes = "")))
    }

    @Test fun mandatoryUpdatesRemainDisabledInThisStage() {
        assertEquals(OtaCheckStatus.Unavailable,
            inspect(remoteManifest = manifest.copy(mandatory = true)))
    }

    @Test fun exactRepositoryAndLatestApiStayPinned() {
        assertEquals(
            "https://api.github.com/repos/josuepradodeoliveiracosta-gif/atrio-catolico-android/releases/latest",
            OtaUpdatePolicy.API
        )
    }
}
