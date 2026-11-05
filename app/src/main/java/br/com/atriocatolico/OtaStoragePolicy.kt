package br.com.atriocatolico

/**
 * Preflight defensivo do cache privado. Nao substitui o verificador de espaco
 * do instalador Android, que pode exigir espaco adicional apos o download.
 */
internal object OtaStoragePolicy {
    private const val RESERVE_BYTES = 16L * 1024L * 1024L

    fun canStageApk(availableBytes: Long, apkSizeBytes: Long): Boolean =
        apkSizeBytes in 1L..OtaApkPolicy.MAX_APK_BYTES &&
            availableBytes >= apkSizeBytes + RESERVE_BYTES
}

/** O controlador usa somente este tipo para exibir uma orientacao segura. */
internal class OtaInsufficientSpaceException : Exception()
