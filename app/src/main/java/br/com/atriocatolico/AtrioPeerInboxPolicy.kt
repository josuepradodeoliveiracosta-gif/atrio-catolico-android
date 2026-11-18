package br.com.atriocatolico

/**
 * Identidade local de destino CONHECIDO, nunca mecanismo de descoberta.
 * A presença de UID/ID é insuficiente para autorizar qualquer leitura:
 * Firestore Rules e Source.SERVER são obrigatórios.
 */
internal object AtrioPeerInboxPolicy {
    private val uidPattern = Regex("^[A-Za-z0-9_-]{1,128}$")

    /** Cache local, escrita pendente e conta trocada nunca autorizam prévia. */
    fun freshServer(fromCache: Boolean, pendingWrites: Boolean,
                    sameSession: Boolean): Boolean =
        sameSession && !fromCache && !pendingWrites

    fun validPeer(owner: String, peer: String): Boolean =
        uidPattern.matches(owner) && uidPattern.matches(peer) && owner != peer

    fun peerFromChatId(owner: String, chatId: String?): String? {
        if (chatId == null || !uidPattern.matches(owner) || chatId.length > 260) return null
        val prefix = owner + "__"
        val suffix = "__" + owner
        val candidates = listOfNotNull(
            chatId.takeIf { it.startsWith(prefix) }?.removePrefix(prefix),
            chatId.takeIf { it.endsWith(suffix) }?.removeSuffix(suffix)
        ).distinct().filter { peer ->
            validPeer(owner, peer) && AtrioChatPolicy.id(owner, peer) == chatId
        }
        // IDs ambíguos não legitimam uma consulta a contato arbitrário.
        return candidates.singleOrNull()
    }

    fun entryMatches(owner: String, peer: String, chatId: String,
                     entryOwner: String?, entryPeer: String?,
                     status: String?, preview: String?): Boolean =
        validPeer(owner, peer) &&
            chatId == AtrioChatPolicy.id(owner, peer) &&
            entryOwner == owner && entryPeer == peer &&
            status in setOf("pending", "accepted", "declined") &&
            preview != null && preview.length <= AtrioChatPolicy.MAX_TEXT
}
