package br.com.atriocatolico.guardian.offline
import java.io.File
private fun parseFixture(text:String):List<ReportGroup> {
    require(text.length <= 24000)
    val lines=text.trimEnd('\n').split('\n')
    require(lines.firstOrNull()=="GUARDIAN_FIXTURE_V1" && lines.size<=101)
    return lines.drop(1).map { line ->
        val p=line.split('\t'); require(p.size==8)
        ReportGroup(p[0],Source.valueOf(p[1]),Kind.valueOf(p[2]),Priority.valueOf(p[3]),p[4].split(',').map(Category::valueOf).toSet(),p[5].toLong(),p[6].toInt(),p[7].toInt())
    }
}
fun main(args:Array<String>) {
    val text=File(args.single()).readText(); val groups=parseFixture(text)
    val t=java.time.Instant.parse("2026-11-28T04:00:00Z").toEpochMilli()
    val a=FixtureAccess("offline-fixture","guardian-v2-qa-fixture","fixture_admin","fixture_admin",true,true)
    val p=FixturePage("fixture_admin",true,false,groups,false)
    var count=0
    fun verify(name:String, condition:Boolean){check(condition){name};println("PASS $name");count++}
    val r=GuardianDashboardModel.evaluate(a,p,t)
    verify("JS -> Kotlin READY",r.status==DashboardStatus.READY)
    verify("aggregate 3 groups 4 reports",r.counts==Counts(3,4,1,1,1))
    verify("urgent first",r.rows.first().priority==Priority.URGENT)
    verify("no remote authorization",!r.remoteAuthorized)
    verify("priority filter",GuardianDashboardModel.evaluate(a,p,t,DashboardFilter(priority=Priority.PRIORITY)).rows.single().source==Source.USERS)
    verify("source filter",GuardianDashboardModel.evaluate(a,p,t,DashboardFilter(source=Source.FEED)).rows.single().priority==Priority.NORMAL)
    verify("category filter",GuardianDashboardModel.evaluate(a,p,t,DashboardFilter(category=Category.THREAT)).rows.single().reports==2)
    verify("session change",GuardianDashboardModel.evaluate(a.copy(currentUid="fixture_other"),p,t).rows.isEmpty())
    verify("revoked moderator",GuardianDashboardModel.evaluate(a.copy(administrator=false),p,t).status==DashboardStatus.DENIED)
    verify("cached page",GuardianDashboardModel.evaluate(a,p.copy(serverFresh=false),t).status==DashboardStatus.UNAVAILABLE)
    verify("pending writes",GuardianDashboardModel.evaluate(a,p.copy(hasPendingWrites=true),t).status==DashboardStatus.UNAVAILABLE)
    verify("foreign session",GuardianDashboardModel.evaluate(a,p.copy(sessionUid="fixture_other"),t).status==DashboardStatus.UNAVAILABLE)
    verify("duplicate aliases",GuardianDashboardModel.evaluate(a,p.copy(groups=groups+groups.first()),t).status==DashboardStatus.UNAVAILABLE)
    verify("malformed version",runCatching{parseFixture(text.replace("GUARDIAN_FIXTURE_V1","UNKNOWN"))}.isFailure)
    verify("private payload absent",!text.contains("fixture_")&&!text.contains("reporterUid"))
    println("$count/$count bridge checks passed")
}
