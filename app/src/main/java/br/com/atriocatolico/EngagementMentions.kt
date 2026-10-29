package br.com.atriocatolico

/**
 * Menções exclusivamente aos participantes já carregados no tópico.
 * Não consulta profiles/{uid} nem permite busca global de usuários.
 */
internal data class MentionCandidate(
    val uid: String,
    val name: String,
    val sourceReplyId: String = ""
)

internal fun mentionCandidates(post: Post, viewerUid: String): List<MentionCandidate> {
    val candidates = buildList {
        if (post.ownerUid.isNotBlank() && post.ownerUid != viewerUid) {
            add(MentionCandidate(post.ownerUid, post.author))
        }
        post.replies.forEach { reply ->
            if (reply.id.isNotBlank() && reply.ownerUid.isNotBlank() &&
                reply.ownerUid != viewerUid &&
                none { it.uid == reply.ownerUid }) {
                add(MentionCandidate(reply.ownerUid, reply.author, reply.id))
            }
        }
    }
    // Limite pequeno para facilitar a escolha e impedir menções em massa.
    return candidates.filter {
        it.uid.length in 1..128 && '/' !in it.uid &&
            it.name.isNotBlank()
    }.take(8)
}

internal fun mentionDisplay(candidate: MentionCandidate): String =
    "@" + candidate.name.replace(Regex("[\\r\\n\\t]"), " ").trim().take(35)

internal fun mentionBody(candidate: MentionCandidate, body: String): String {
    val prefix = mentionDisplay(candidate) + " "
    return (prefix + body.trim().take((600 - prefix.length).coerceAtLeast(0)))
        .take(600)
}
