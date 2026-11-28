package br.com.atriocatolico.guardian.offline

// Pure offline presentation model. Context is a test fixture, not authentication.
// No network, Firebase, write, or production authorization.
enum class Priority(val rank: Int, val label: String) { NORMAL(0,"Normal"), PRIORITY(1,"Prioritária"), URGENT(2,"Urgente") }
enum class Source(val label: String) { FORUM("Fórum"), USERS("Perfis"), FEED("Feed e canais") }
enum class Kind(val label: String) { POST("Publicação"), REPLY("Resposta"), USER("Perfil"), COMMENT("Comentário"), CHANNEL("Canal") }
enum class Category(val label: String) { UNCLASSIFIED("Sem classificação"), SPAM("Spam"), FRAUD("Possível fraude"), THREAT("Possível ameaça"), PRIVACY("Privacidade"), HARASSMENT("Assédio"), OTHER("Outros") }
data class FixtureAccess(val environment: String, val project: String, val expectedUid: String, val currentUid: String?, val administrator: Boolean, val fresh: Boolean, val pendingWrites: Boolean = false)
// Synthetic alias only. No UID, document path, raw reason, evidence or reporter ID.
data class ReportGroup(val alias: String, val source: Source, val kind: Kind, val priority: Priority, val categories: Set<Category>, val oldestAtMs: Long, val reports: Int, val distinctReporters: Int)
data class FixturePage(val sessionUid: String, val serverFresh: Boolean, val hasPendingWrites: Boolean, val groups: List<ReportGroup>, val moreRemote: Boolean)
data class DashboardFilter(val source: Source? = null, val priority: Priority? = null, val category: Category? = null, val page: Int = 0)
data class Counts(val groups: Int, val reports: Int, val urgent: Int, val priority: Int, val normal: Int)
enum class DashboardStatus { DENIED, LOADING, UNAVAILABLE, READY }
data class DashboardState(val status: DashboardStatus, val counts: Counts? = null, val rows: List<ReportGroup> = emptyList(), val filteredGroups: Int = 0, val page: Int = 0, val pageCount: Int = 0, val moreRemote: Boolean = false, val remoteAuthorized: Boolean = false)
object GuardianDashboardModel {
    const val PAGE_SIZE = 20
    private const val MAX_GROUPS = 100
    private val fixtureUid = Regex("fixture_[A-Za-z0-9_-]{1,64}")
    private val alias = Regex("caso-[0-9]{1,6}")
    private fun allowed(a: FixtureAccess) = a.environment == "offline-fixture" && a.project == "guardian-v2-qa-fixture" && fixtureUid.matches(a.expectedUid) && a.expectedUid == a.currentUid && a.administrator && a.fresh && !a.pendingWrites
    private fun valid(g: ReportGroup, now: Long): Boolean = alias.matches(g.alias) && g.categories.isNotEmpty() && g.oldestAtMs in 0..now && g.reports in 1..100 && g.distinctReporters in 1..g.reports && when(g.source) {
        Source.FORUM -> g.kind in setOf(Kind.POST, Kind.REPLY)
        Source.USERS -> g.kind == Kind.USER
        Source.FEED -> g.kind in setOf(Kind.POST, Kind.COMMENT, Kind.CHANNEL)
    }
    fun evaluate(access: FixtureAccess, snapshot: FixturePage?, now: Long, filter: DashboardFilter = DashboardFilter(), failed: Boolean = false): DashboardState {
        if (!allowed(access)) return DashboardState(DashboardStatus.DENIED)
        if (failed || now < 0) return DashboardState(DashboardStatus.UNAVAILABLE)
        if (snapshot == null) return DashboardState(DashboardStatus.LOADING)
        if (snapshot.sessionUid != access.expectedUid || !snapshot.serverFresh || snapshot.hasPendingWrites) return DashboardState(DashboardStatus.UNAVAILABLE)
        val groups = snapshot.groups.toList()
        if (groups.size > MAX_GROUPS || groups.any { !valid(it, now) } || groups.map { it.alias }.toSet().size != groups.size || groups.sumOf { it.reports } > MAX_GROUPS) return DashboardState(DashboardStatus.UNAVAILABLE)
        val counts = Counts(groups.size, groups.sumOf { it.reports }, groups.count { it.priority == Priority.URGENT }, groups.count { it.priority == Priority.PRIORITY }, groups.count { it.priority == Priority.NORMAL })
        val filtered = groups.filter { (filter.source == null || filter.source == it.source) && (filter.priority == null || filter.priority == it.priority) && (filter.category == null || filter.category in it.categories) }.sortedWith(compareByDescending<ReportGroup> { it.priority.rank }.thenBy { it.oldestAtMs }.thenBy { it.alias })
        val pageCount = (filtered.size + PAGE_SIZE - 1) / PAGE_SIZE
        val page = filter.page.coerceIn(0, (pageCount-1).coerceAtLeast(0))
        return DashboardState(DashboardStatus.READY, counts, filtered.drop(page*PAGE_SIZE).take(PAGE_SIZE).map { it.copy(categories = it.categories.toSet()) }, filtered.size, page, pageCount, snapshot.moreRemote)
    }
}
