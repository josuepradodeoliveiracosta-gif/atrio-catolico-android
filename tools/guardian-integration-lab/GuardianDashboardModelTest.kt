package br.com.atriocatolico.guardian.offline

fun main() {
    val a = FixtureAccess("offline-fixture", "guardian-v2-qa-fixture", "fixture_admin", "fixture_admin", true, true)
    val t = 10_000L
    val g = ReportGroup("caso-1", Source.FORUM, Kind.POST, Priority.NORMAL, setOf(Category.UNCLASSIFIED), 100, 1, 1)
    val p = FixturePage(a.expectedUid, true, false, listOf(g), false)
    fun run(a0: FixtureAccess = a, p0: FixturePage? = p, f: DashboardFilter = DashboardFilter(), failed: Boolean = false, now: Long = t) = GuardianDashboardModel.evaluate(a0,p0,now,f,failed)
    var passed = 0
    fun test(name: String, block: () -> Boolean) { check(block()) { "FAIL: $name" }; passed++; println("PASS: $name") }
    fun hidden(s: DashboardState) = s.rows.isEmpty() && s.counts == null && !s.remoteAuthorized
    listOf(a.copy(environment="production"), a.copy(project="atrio-catolico"), a.copy(currentUid="fixture_other"), a.copy(currentUid=null), a.copy(expectedUid="real",currentUid="real"), a.copy(administrator=false), a.copy(fresh=false), a.copy(pendingWrites=true)).forEachIndexed { i,x -> test("denied context $i") { run(a0=x).let { it.status==DashboardStatus.DENIED && hidden(it) } } }
    listOf(p.copy(sessionUid="fixture_other"),p.copy(serverFresh=false),p.copy(hasPendingWrites=true)).forEachIndexed { i,x -> test("denied snapshot $i") { run(p0=x).let { it.status==DashboardStatus.UNAVAILABLE && hidden(it) } } }
    test("loading") { run(p0=null).let { it.status==DashboardStatus.LOADING && hidden(it) } }
    test("error hides old rows") { run(failed=true).let { it.status==DashboardStatus.UNAVAILABLE && hidden(it) } }
    test("negative clock") { hidden(run(now=-1)) }
    listOf(g.copy(alias="uid-real"),g.copy(oldestAtMs=t+1),g.copy(oldestAtMs=-1),g.copy(reports=0),g.copy(reports=101),g.copy(distinctReporters=0),g.copy(distinctReporters=2),g.copy(categories=emptySet()),g.copy(source=Source.USERS),g.copy(kind=Kind.COMMENT)).forEachIndexed { i,x -> test("invalid projection $i") { run(p0=p.copy(groups=listOf(x))).let { it.status==DashboardStatus.UNAVAILABLE && hidden(it) } } }
    test("duplicate alias") { hidden(run(p0=p.copy(groups=listOf(g,g)))) }
    test("over group cap") { hidden(run(p0=p.copy(groups=(1..101).map { g.copy(alias="caso-$it") }))) }
    test("over report cap") { hidden(run(p0=p.copy(groups=listOf(g.copy(reports=100),g.copy(alias="caso-2"))))) }
    val urgent=g.copy(alias="caso-2",priority=Priority.URGENT,source=Source.FEED,kind=Kind.CHANNEL,categories=setOf(Category.FRAUD),oldestAtMs=200,reports=2)
    val medium=g.copy(alias="caso-3",priority=Priority.PRIORITY,source=Source.USERS,kind=Kind.USER,categories=setOf(Category.PRIVACY),oldestAtMs=50)
    val full=p.copy(groups=listOf(g,urgent,medium),moreRemote=true)
    test("order priority before age") { run(p0=full).rows.map { it.alias }==listOf("caso-2","caso-3","caso-1") }
    test("counts are page wide") { run(p0=full,f=DashboardFilter(source=Source.FEED)).let { it.counts==Counts(3,4,1,1,1) && it.rows==listOf(urgent) } }
    test("priority filter") { run(p0=full,f=DashboardFilter(priority=Priority.NORMAL)).rows==listOf(g) }
    test("category filter") { run(p0=full,f=DashboardFilter(category=Category.FRAUD)).rows==listOf(urgent) }
    test("combined filters AND") { run(p0=full,f=DashboardFilter(source=Source.USERS,category=Category.FRAUD)).let { it.rows.isEmpty() && it.filteredGroups==0 && it.pageCount==0 } }
    test("page-only flag") { run(p0=full).moreRemote }
    test("empty page") { run(p0=p.copy(groups=emptyList())).let { it.status==DashboardStatus.READY && it.counts==Counts(0,0,0,0,0) } }
    test("no escalation by volume") { run(p0=p.copy(groups=listOf(g.copy(reports=100,distinctReporters=100)))).counts?.normal==1 }
    test("never remote authorized") { !run(p0=full).remoteAuthorized }
    val many=p.copy(groups=(1..41).map { g.copy(alias="caso-$it",oldestAtMs=it.toLong()) })
    test("local pagination first") { run(p0=many).let { it.rows.size==20 && it.pageCount==3 } }
    test("local pagination second") { run(p0=many,f=DashboardFilter(page=1)).rows.first().alias=="caso-21" }
    test("local pagination last") { run(p0=many,f=DashboardFilter(page=2)).rows.single().alias=="caso-41" }
    test("clamp high") { run(p0=many,f=DashboardFilter(page=Int.MAX_VALUE)).page==2 }
    test("clamp negative") { run(p0=many,f=DashboardFilter(page=Int.MIN_VALUE)).page==0 }
    test("determinism") { run(p0=full)==run(p0=full.copy(groups=full.groups.reversed())) }
    test("session change after ready") { run(p0=full).rows.isNotEmpty() && hidden(run(a0=a.copy(currentUid="fixture_new"),p0=full)) }
    test("revocation after ready") { run(p0=full).rows.isNotEmpty() && hidden(run(a0=a.copy(administrator=false),p0=full)) }
    println("KOTLIN: $passed/$passed passed")
}
