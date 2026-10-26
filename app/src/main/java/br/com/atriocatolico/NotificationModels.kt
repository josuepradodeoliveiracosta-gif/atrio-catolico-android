package br.com.atriocatolico

internal enum class NoticeKind { REPLY, REVIEW, REPORTS, REQUESTS }
internal data class NoticeEvent(
    val id: String, val kind: NoticeKind, val target: String = "",
    val title: String, val body: String, val at: Long = 0L,
    val read: Boolean = false, val localToken: String = ""
)
internal data class NoticeGroup(
    val id: String, val kind: NoticeKind, val target: String,
    val title: String, val body: String, val events: List<NoticeEvent>
) {
    val unread: Boolean get() = events.any { !it.read }
    val at: Long get() = events.maxOfOrNull { it.at } ?: 0L
    val administrative: Boolean get() = kind == NoticeKind.REPORTS || kind == NoticeKind.REQUESTS
}

internal fun groupNotices(events: List<NoticeEvent>, admin: Boolean): List<NoticeGroup> = events
    .filter { admin || it.kind !in listOf(NoticeKind.REPORTS, NoticeKind.REQUESTS) }
    .groupBy { if (it.kind == NoticeKind.REPLY) "reply:${it.target}" else it.kind.name }
    .map { (key, values) ->
        val latest = values.maxByOrNull { it.at }!!
        val title = when (latest.kind) {
            NoticeKind.REPLY -> if (values.size == 1) latest.title else "${values.size} respostas nesta discussão"
            NoticeKind.REPORTS -> "${values.size} denúncia(s) aguardando análise"
            NoticeKind.REQUESTS -> "${values.size} solicitação(ões) de selo aguardando análise"
            NoticeKind.REVIEW -> latest.title
        }
        val body = when (latest.kind) {
            NoticeKind.REPORTS -> "Abra a moderação para verificar discussões e respostas denunciadas."
            NoticeKind.REQUESTS -> "Abra as solicitações para verificar os pedidos de Padre e Diácono."
            else -> latest.body
        }
        NoticeGroup(key, latest.kind, latest.target, title, body, values)
    }.sortedByDescending { it.at }

internal fun reviewNotice(status: String, kind: String, at: Long, token: String): NoticeEvent? {
    if (status !in listOf("approved", "rejected", "dismissed")) return null
    val label = when (kind) { "padre" -> "Padre"; "diacono" -> "Diácono"; else -> return null }
    return NoticeEvent("review", NoticeKind.REVIEW,
        title = if (status == "approved") "Selo $label aprovado" else "Solicitação de $label não aprovada",
        body = if (status == "approved") "Sua verificação foi concluída. Confira a identificação em Meus selos."
            else "A análise foi concluída. Você pode conferir o status e enviar uma nova solicitação em Meus selos.",
        at = at, localToken = token)
}
