package br.com.atriocatolico

/** Read-only QA projection of the already loaded forum page. No Firebase or network. */
internal data class GuardianPageRow(val id: String, val postId: String, val replyId: String?, val status: String, val fromGuardian: Boolean)
internal enum class GuardianPageKind { ALL, POST, REPLY }
internal enum class GuardianPageOrigin { ALL, COMMUNITY, GUARDIAN }
internal data class GuardianPageSummary(val reports: Int, val pending: Int, val reviewed: Int, val pendingTargets: Int, val matching: Int, val truncated: Boolean)
internal object GuardianReportPageSummary {
    private val id = Regex("[A-Za-z0-9_-]{1,128}")
    private const val LIMIT = 100
    fun evaluate(rows: List<GuardianPageRow>, sessionActive: Boolean, adminApproved: Boolean, serverFresh: Boolean, hasMore: Boolean,
        kind: GuardianPageKind = GuardianPageKind.ALL, origin: GuardianPageOrigin = GuardianPageOrigin.ALL): GuardianPageSummary? {
        if (!sessionActive || !adminApproved || !serverFresh) return null
        val selected = rows.take(LIMIT)
        if (selected.any { !id.matches(it.id) || !id.matches(it.postId) || (it.replyId != null && !id.matches(it.replyId)) || it.status !in setOf("pending", "dismissed", "removed") }) return null
        val unique = selected.distinctBy { it.id }
        if (unique.size != selected.size) return null
        val pending = unique.filter { it.status == "pending" }
        val matching = pending.count { (kind == GuardianPageKind.ALL || (it.replyId == null) == (kind == GuardianPageKind.POST)) && (origin == GuardianPageOrigin.ALL || it.fromGuardian == (origin == GuardianPageOrigin.GUARDIAN)) }
        return GuardianPageSummary(unique.size, pending.size, unique.size-pending.size, pending.map { it.postId to it.replyId }.toSet().size, matching, hasMore || rows.size > LIMIT)
    }
}
