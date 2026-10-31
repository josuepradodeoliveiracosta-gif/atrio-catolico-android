package br.com.atriocatolico

/**
 * Avaliação pura da atualização: nenhum efeito de rede, download ou instalação.
 * A verificação de assinatura do arquivo APK baixado será realizada na etapa 4.
 */
internal sealed class OtaCheckStatus {
    data object Idle : OtaCheckStatus()
    data object Checking : OtaCheckStatus()
    data object NoRelease : OtaCheckStatus()
    data object UpToDate : OtaCheckStatus()
    data object TestBuild : OtaCheckStatus()
    data object Unavailable : OtaCheckStatus()
    data object Incompatible : OtaCheckStatus()
    data class Available(val version: String, val notes: String, val releasePage: String) : OtaCheckStatus()
}

internal data class OtaRemoteRelease(
    val tag: String,
    val page: String,
    val manifestUrl: String,
    val apkUrl: String,
    val draft: Boolean,
    val prerelease: Boolean
)

internal data class OtaManifest(
    val schemaVersion: Int,
    val channel: String,
    val applicationId: String,
    val versionName: String,
    val versionCode: Long,
    val mandatory: Boolean,
    val minimumAndroidSdk: Int,
    val apkAsset: String,
    val apkSizeBytes: Long,
    val apkSha256: String,
    val certificateSha256: String,
    val downloadUrl: String,
    val releasePageUrl: String,
    val releaseNotes: String
)

internal object OtaUpdatePolicy {
    const val PACKAGE = "br.com.atriocatolico"
    const val REPO = "josuepradodeoliveiracosta-gif/atrio-catolico-android"
    const val API = "https://api.github.com/repos/$REPO/releases/latest"
    private val versionPattern = Regex("""[0-9]+\.[0-9]+\.[0-9]+""")
    private val digestPattern = Regex("""[0-9a-fA-F]{64}""")

    fun expectedPage(tag: String) = "https://github.com/$REPO/releases/tag/$tag"
    fun expectedAsset(tag: String, file: String) =
        "https://github.com/$REPO/releases/download/$tag/$file"

    /**
     * Never compare versionName lexically; Android's versionCode is authoritative.
     * A manifest is not a signature. Match the installed app signer and reject
     * unexpected links or schema before even displaying an update announcement.
     */
    fun evaluate(
        release: OtaRemoteRelease,
        manifest: OtaManifest,
        installedVersionCode: Long,
        installedCertificateSha256: String,
        deviceSdk: Int
    ): OtaCheckStatus {
        val tag = release.tag
        val validName = versionPattern.matches(manifest.versionName)
        if (!validName || tag != "v${manifest.versionName}" ||
            release.draft || release.prerelease) return OtaCheckStatus.Unavailable
        val page = expectedPage(tag)
        val apkUrl = expectedAsset(tag, "atrio-catolico.apk")
        val manifestUrl = expectedAsset(tag, "update.json")
        val linksValid = release.page == page &&
            release.apkUrl == apkUrl && release.manifestUrl == manifestUrl &&
            manifest.downloadUrl == apkUrl && manifest.releasePageUrl == page
        val validManifest = manifest.schemaVersion == 1 && manifest.channel == "stable" &&
            manifest.applicationId == PACKAGE && manifest.apkAsset == "atrio-catolico.apk" &&
            !manifest.mandatory && manifest.versionCode > 0 &&
            manifest.minimumAndroidSdk >= 26 && manifest.apkSizeBytes in 1..262_144_000 &&
            digestPattern.matches(manifest.apkSha256) &&
            digestPattern.matches(manifest.certificateSha256) &&
            manifest.certificateSha256.equals(installedCertificateSha256, ignoreCase = true) &&
            manifest.releaseNotes.length in 10..3000
        if (!linksValid || !validManifest) return OtaCheckStatus.Unavailable
        if (manifest.minimumAndroidSdk > deviceSdk) return OtaCheckStatus.Incompatible
        return if (manifest.versionCode > installedVersionCode) {
            OtaCheckStatus.Available(manifest.versionName, manifest.releaseNotes, page)
        } else OtaCheckStatus.UpToDate
    }
}
