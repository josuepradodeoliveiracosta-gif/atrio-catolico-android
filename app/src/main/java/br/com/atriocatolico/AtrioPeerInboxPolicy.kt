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

    /**
     * Primeiro contato só nasce de perfil explicitamente escolhido, nunca
     * de documento de chat inexistente, índice inválido ou descoberta local.
     */
    fun explicitFirstContact(owner: String, profilePeer: String?,
                             chatId: String?, hasAuthorizedIndex: Boolean): Boolean =
        !hasAuthorizedIndex && profilePeer != null && chatId != null &&
            validPeer(owner, profilePeer) &&
            chatId == AtrioChatPolicy.id(owner, profilePeer)

    private fun matchesPairId(chatId: String, a: String, b: String): Boolean =
        chatId == "${a}__${b}" || chatId == "${b}__${a}"

    /** Uma resposta direta só pode ser exibida se o par pertence à sessão. */
    fun roomMatches(owner: String, chatId: String, requester: String?,
                    recipient: String?, status: String?): Boolean =
        requester != null && recipient != null &&
            validPeer(requester, recipient) &&
            (requester == owner || recipient == owner) &&
            matchesPairId(chatId, requester, recipient) &&
            status in setOf("pending", "accepted", "declined")

    fun peerFromChatId(owner: String, chatId: String?): String? {
        if (chatId == null || !uidPattern.matches(owner) || chatId.length > 260) return null
        val prefix = owner + "__"
        val suffix = "__" + owner
        val candidates = listOfNotNull(
            chatId.takeIf { it.startsWith(prefix) }?.removePrefix(prefix),
            chatId.takeIf { it.endsWith(suffix) }?.removeSuffix(suffix)
        ).distinct().filter { peer ->
            validPeer(owner, peer) && matchesPairId(chatId, owner, peer)
        }
        // IDs ambíguos não legitimam uma consulta a contato arbitrário.
        return candidates.singleOrNull()
    }

    fun entryMatches(owner: String, peer: String, chatId: String,
                     entryOwner: String?, entryPeer: String?,
                     status: String?, preview: String?): Boolean =
        validPeer(owner, peer) &&
            matchesPairId(chatId, owner, peer) &&
            entryOwner == owner && entryPeer == peer &&
            status in setOf("pending", "accepted", "declined") &&
            preview != null && preview.length <= AtrioChatPolicy.MAX_TEXT
}
