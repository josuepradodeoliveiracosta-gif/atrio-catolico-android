package br.com.atriocatolico

/** Pure policy: no device, account identifiers, network or persistence. */
internal object QaAndroidDiagnosticPolicy {
    fun environment(buildType: String, pkg: String): String? = when {
        buildType == "perfilQa" && pkg == "br.com.atriocatolico.perfilqa" -> "perfil_qa"
        buildType == "chatQa" && pkg == "br.com.atriocatolico.chatqa" -> "chat_qa"
        buildType == "qaGeral" && pkg in setOf("br.com.atriocatolico.qageral",
            "br.com.atriocatolico.qageral.celular") -> "qa_geral"
        else -> null
    }
    fun approvedProject(env: String, project: String?): Boolean = when (env) {
        "perfil_qa" -> project == "atrio-catolico-qa-perfil"
        "chat_qa" -> project == "atrio-catolico-qa-geral"
        "qa_geral" -> project == "atrio-catolico-qa-general"
        else -> false
    }
    fun heapPercent(used: Long, max: Long): Int? =
        if (max <= 0 || used < 0 || used > max) null
        else (used.toDouble() / max.toDouble() * 100).toInt()
    fun openingMillis(start: Long, end: Long): Long? =
        if (start < 0 || end < start || end - start > 120_000) null else end - start
    enum class Exit { CRASH, ANR, OTHER }
    data class ExitSummary(val inspected: Int, val crashes: Int, val anrs: Int)
    fun exits(reasons: List<Exit>): ExitSummary {
        val bounded = reasons.take(5)
        return ExitSummary(bounded.size, bounded.count { it == Exit.CRASH },
            bounded.count { it == Exit.ANR })
    }
}
