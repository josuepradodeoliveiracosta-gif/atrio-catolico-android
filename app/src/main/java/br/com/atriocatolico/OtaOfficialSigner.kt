package br.com.atriocatolico

/**
 * Identidade publica do assinante historico do APK oficial 0.20.0 (code 35).
 *
 * Uma assinatura valida do Android nao identifica, sozinha, a organizacao
 * proprietaria. O release oficial deve conservar esta identidade e ainda
 * corresponder ao APK instalado e ao manifesto da oferta.
 *
 * Rotacao deliberada de chave exige outro processo de homologacao e revisao
 * do fingerprint fixado tambem em scripts/ota_release_cert.py.
 */
internal object OtaOfficialSigner {
    const val CERTIFICATE_SHA256 =
        "ba2e86eacf32e2785718040d704609d3c95c3b88363c08dd3d7c5abe299902b0"

    private val hexSha256 = Regex("[a-fA-F0-9]{64}")

    fun acceptsInstalledSigner(fingerprint: String): Boolean =
        hexSha256.matches(fingerprint) &&
            (OtaQaChannel.active || fingerprint.equals(CERTIFICATE_SHA256, ignoreCase = true))
}
