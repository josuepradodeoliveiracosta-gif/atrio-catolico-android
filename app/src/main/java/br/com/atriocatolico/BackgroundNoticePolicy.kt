package br.com.atriocatolico

/**
 * Time-based filtering for opt-in background checks. Tests run without Android/Firebase.
 * Always overlap scans: Firestore writes may arrive just after the previous query.
 */
internal object BackgroundNoticePolicy {
    const val REPEAT_MINUTES = 30L
    const val MAX_DOCS = 25L
    const val OVERLAP_MILLIS = 5 * 60 * 1000L

    fun cutoff(enrolledAt: Long, lastCheckedAt: Long): Long =
        maxOf(enrolledAt, lastCheckedAt - OVERLAP_MILLIS)

    fun isNew(eventAt: Long, cutoff: Long, now: Long): Boolean =
        eventAt > cutoff && eventAt <= now + 60_000L

    fun isPending(status: String?): Boolean = status == null || status == "pending"

    fun reviewStatus(status: String?): Boolean =
        status in setOf("approved", "rejected", "dismissed")

    fun boundedSeen(existing: Set<String>, newItems: List<String>): Set<String> =
        (newItems.asReversed() + existing.toList()).distinct().take(500).toSet()
}
