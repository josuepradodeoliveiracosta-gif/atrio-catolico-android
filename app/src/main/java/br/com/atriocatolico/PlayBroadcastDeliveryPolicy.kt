package br.com.atriocatolico

/** Apenas política local. Não autentica FCM nem substitui filtro do Worker. */
internal object PlayBroadcastDeliveryPolicy {
    fun accepts(
        playStoreBuild: Boolean,
        currentUid: String,
        destinationUid: String?,
        sender: String?,
        addressedTo: String?
    ): Boolean {
        if (!playStoreBuild) return true // APK OTA: preservar comportamento antigo.
        if (currentUid.isBlank() || destinationUid != currentUid) return false
        // O envio em tópico não admite exclusão bilateral de destinatários.
        if (sender.orEmpty().startsWith("/topics/") ||
            addressedTo.orEmpty().startsWith("/topics/")) return false
        return true
    }
}
