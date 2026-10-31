package br.com.atriocatolico

/** Regras puras para aceitar um APK: testes sem aparelho, rede ou assinaturas reais. */
internal object OtaApkPolicy {
    const val MAX_APK_BYTES = 262_144_000L
    private val shaPattern = Regex("[0-9a-f]{64}")

    fun validSize(bytes: Long, offer: OtaApkOffer): Boolean =
        offer.sizeBytes in 1L..MAX_APK_BYTES && bytes in 0L..offer.sizeBytes

    fun accept(
        offer: OtaApkOffer,
        bytes: Long,
        sha256: String,
        archivePackage: String,
        archiveVersionCode: Long,
        archiveVersionName: String,
        archiveCertificate: String,
        installedCode: Long,
        installedCertificate: String
    ): Boolean {
        if (!validSize(bytes, offer) || bytes != offer.sizeBytes) return false
        if (!shaPattern.matches(offer.sha256) || !shaPattern.matches(offer.signingCertSha256)) return false
        if (sha256 != offer.sha256 || archiveCertificate != offer.signingCertSha256) return false
        if (archiveCertificate != installedCertificate) return false
        if (archivePackage != OtaUpdatePolicy.PACKAGE) return false
        if (archiveVersionCode != offer.versionCode || archiveVersionCode <= installedCode) return false
        if (archiveVersionName != offer.versionName) return false
        val tag = "v" + offer.versionName
        if (!Regex("""v[0-9]+\.[0-9]+\.[0-9]+""").matches(tag)) return false
        if (offer.url != OtaUpdatePolicy.expectedAsset(tag, "atrio-catolico.apk")) return false
        return true
    }
}
