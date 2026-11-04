package br.com.atriocatolico

import java.security.MessageDigest

/**
 * An old Firestore listener can deliver a cached callback after sign-out.
 * Personal notices belong exclusively to the account captured at subscribe.
 */
internal fun currentPersonalNoticeSession(
    expectedUid: String, authenticatedUid: String?
): Boolean = expectedUid.isNotBlank() && authenticatedUid == expectedUid

/** Never display admin queues from cached, pending, failed or previous-session reads. */
internal fun verifiedAdminNoticeSnapshot(
    expectedUid: String,
    authenticatedUid: String?,
    hasError: Boolean,
    hasData: Boolean,
    fromCache: Boolean,
    pendingWrites: Boolean
): Boolean = expectedUid.isNotBlank() && authenticatedUid == expectedUid
    && !hasError && hasData && !fromCache && !pendingWrites

/**
 * O cache local ou um callback de outra sessão jamais concede privilégios.
 * Apenas um documento de administrador ativo e confirmado no servidor vale.
 */
internal fun verifiedAdminRoleSnapshot(
    expectedUid: String,
    authenticatedUid: String?,
    hasError: Boolean,
    hasData: Boolean,
    fromCache: Boolean,
    pendingWrites: Boolean,
    roleEnabled: Boolean
): Boolean = roleEnabled && verifiedAdminNoticeSnapshot(
    expectedUid, authenticatedUid, hasError, hasData, fromCache, pendingWrites
)

internal enum class NoticeKind { REPLY, REVIEW, REPORTS, REQUESTS }
internal data class NoticeEvent(
    val id: String, val kind: NoticeKind, val target: String = "",
    val title: String, val body: String, val at: Long = 0L,
    val read: Boolean = false, val localToken: String = "",
    val directReply: Boolean = false,
    val mentioned: Boolean = false,
    val actorUid: String = ""
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
    .groupBy {
        if (it.kind == NoticeKind.REPLY)
            (if (it.mentioned) "mention:" else if (it.directReply) "direct:" else "reply:") + it.target
        else it.kind.name
    }
    .map { (key, values) ->
        val latest = values.maxByOrNull { it.at }!!
        val title = when (latest.kind) {
            NoticeKind.REPLY -> when {
                values.size == 1 -> latest.title
                latest.mentioned -> "${values.size} menções nesta discussão"
                latest.directReply -> "${values.size} respostas aos seus comentários"
                else -> "${values.size} respostas nesta discussão"
            }
            NoticeKind.REPORTS -> "${values.size} denúncia(s) aguardando análise"
            NoticeKind.REQUESTS -> "${values.size} solicitação(ões) de selo aguardando análise"
            NoticeKind.REVIEW -> latest.title
        }
        val body = when (latest.kind) {
            NoticeKind.REPORTS -> "Abra a moderação para verificar discussões, respostas e usuários denunciados."
            NoticeKind.REQUESTS -> "Abra as solicitações para verificar os pedidos de Padre e Diácono."
            else -> latest.body
        }
        NoticeGroup(key, latest.kind, latest.target, title, body, values)
    }.sortedByDescending { it.at }

/**
 * Somente contagem de denuncias de contas para a central administrativa.
 * UIDs (presentes no ID canonico da denuncia) e justificativas jamais
 * entram no titulo, corpo nem nas preferencias persistidas no aparelho.
 * Esta funcao nao concede acesso: Firestore Rules ainda exige admin.
 */
internal fun pendingMemberReportNotice(
    reportId: String, status: String?, at: Long, nanos: Int
): NoticeEvent? {
    if (reportId.isBlank() || status != null && status != "pending" || at <= 0L)
        return null
    val digest = MessageDigest.getInstance("SHA-256")
        .digest(reportId.toByteArray(Charsets.UTF_8))
        .joinToString("") { "%02x".format(it.toInt() and 0xff) }
    return NoticeEvent(
        id = "member:$digest", kind = NoticeKind.REPORTS,
        title = "Denúncia de usuário pendente", body = "",
        at = at, localToken = "member_report:$digest:$at:$nanos"
    )
}

internal fun reviewNotice(status: String, kind: String, at: Long, token: String): NoticeEvent? {
    if (status !in listOf("approved", "rejected", "dismissed")) return null
    val label = when (kind) { "padre" -> "Padre"; "diacono" -> "Diácono"; else -> return null }
    return NoticeEvent("review", NoticeKind.REVIEW,
        title = if (status == "approved") "Selo $label aprovado" else "Solicitação de $label não aprovada",
        body = if (status == "approved") "Sua verificação foi concluída. Confira a identificação em Meus selos."
            else "A análise foi concluída. Você pode conferir o status e enviar uma nova solicitação em Meus selos.",
        at = at, localToken = token)
}
