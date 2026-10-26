package br.com.atriocatolico

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import androidx.work.Constraints
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.NetworkType
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.Data
import androidx.work.WorkManager
import com.google.android.gms.tasks.Tasks
import com.google.firebase.Timestamp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import java.util.Date
import java.util.concurrent.TimeUnit

/** Per-account, explicit opt-in. No server, service credentials or Firebase rules required. */
internal object BackgroundNoticeScheduler {
    private const val PREFS = "atrio_background_notices"
    private const val WORK_NAME = "atrio_background_notices"
    private const val UID_KEY = "uid"
    private fun prefs(context: Context, uid: String) =
        context.getSharedPreferences("${PREFS}_$uid", Context.MODE_PRIVATE)

    fun enabled(context: Context, uid: String): Boolean =
        uid.isNotBlank() && prefs(context, uid).getBoolean("enabled", false)

    fun enrolledAt(context: Context, uid: String): Long =
        prefs(context, uid).getLong("enrolledAt", 0L)

    fun seen(context: Context, uid: String): Set<String> =
        prefs(context, uid).getStringSet("seen", emptySet())?.toSet() ?: emptySet()

    fun lastChecked(context: Context, uid: String): Long =
        prefs(context, uid).getLong("lastCheckedAt", 0L)

    fun completed(context: Context, uid: String, start: Long, identifiers: List<String>) {
        if (!enabled(context, uid)) return
        val stored = seen(context, uid)
        prefs(context, uid).edit()
            .putStringSet("seen", BackgroundNoticePolicy.boundedSeen(stored, identifiers))
            .putLong("lastCheckedAt", start)
            .apply()
    }

    fun enable(context: Context, uid: String) {
        if (uid.isBlank() || FirebaseAuth.getInstance().currentUser?.uid != uid) return
        prefs(context, uid).edit().putBoolean("enabled", true)
            .putLong("enrolledAt", System.currentTimeMillis())
            .putLong("lastCheckedAt", 0L).remove("seen").apply()
        sync(context, uid)
    }

    fun sync(context: Context, uid: String) {
        if (!enabled(context, uid) || FirebaseAuth.getInstance().currentUser?.uid != uid) return
        val work = PeriodicWorkRequestBuilder<AtrioBackgroundNoticeWorker>(
            BackgroundNoticePolicy.REPEAT_MINUTES, TimeUnit.MINUTES
        ).setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
            .setInputData(Data.Builder().putString(UID_KEY, uid).build())
            .build()
        WorkManager.getInstance(context).enqueueUniquePeriodicWork(
            WORK_NAME, ExistingPeriodicWorkPolicy.KEEP, work
        )
    }

    fun disable(context: Context, uid: String) {
        if (uid.isBlank()) return
        prefs(context, uid).edit().putBoolean("enabled", false)
            .remove("seen").remove("lastCheckedAt").remove("enrolledAt").apply()
        WorkManager.getInstance(context).cancelUniqueWork(WORK_NAME)
    }

    fun inputUid(data: Data): String = data.getString(UID_KEY).orEmpty()
}

/** Runs off the UI thread. Queries only documents the signed-in user may read. */
class AtrioBackgroundNoticeWorker(
    context: Context, params: WorkerParameters
) : Worker(context, params) {
    override fun doWork(): Result {
        val context = applicationContext
        val uid = BackgroundNoticeScheduler.inputUid(inputData)
        if (!BackgroundNoticeScheduler.enabled(context, uid)) return Result.success()
        val signedIn = runCatching { FirebaseAuth.getInstance().currentUser?.uid }.getOrNull()
        if (signedIn != uid) return Result.success()
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return Result.success()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (!manager.areNotificationsEnabled()) return Result.success()

        val now = System.currentTimeMillis()
        val enrolled = BackgroundNoticeScheduler.enrolledAt(context, uid)
        if (enrolled <= 0) return Result.success()
        val cutoff = BackgroundNoticePolicy.cutoff(
            enrolled, BackgroundNoticeScheduler.lastChecked(context, uid)
        )
        val seen = BackgroundNoticeScheduler.seen(context, uid)
        val cutoffTimestamp = Timestamp(Date(cutoff))
        val pending = mutableListOf<String>()
        val kinds = mutableSetOf<String>()
        val settings = context.getSharedPreferences("atrio_notices_$uid", Context.MODE_PRIVATE)
        val db = FirebaseFirestore.getInstance()

        fun offer(kind: String, identifier: String, timestamp: Long) {
            if (BackgroundNoticePolicy.isNew(timestamp, cutoff, now) && identifier !in seen) {
                kinds.add(kind)
                pending.add(identifier)
            }
        }
        fun fetch(task: com.google.android.gms.tasks.Task<com.google.firebase.firestore.QuerySnapshot>) =
            Tasks.await(task, 25, TimeUnit.SECONDS)
        fun fetchOne(task: com.google.android.gms.tasks.Task<DocumentSnapshot>) =
            Tasks.await(task, 25, TimeUnit.SECONDS)
        fun date(doc: DocumentSnapshot, field: String = "createdAt") =
            doc.getTimestamp(field)?.toDate()?.time ?: 0L

        try {
            if (settings.getBoolean("replies", true)) {
                val replies = fetch(db.collection("users").document(uid).collection("notifications")
                    .whereGreaterThan("createdAt", cutoffTimestamp)
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .limit(BackgroundNoticePolicy.MAX_DOCS).get(Source.SERVER))
                replies.documents.forEach { doc ->
                    if (doc.getBoolean("read") != true) {
                        offer("reply", "reply:${doc.id}:${date(doc)}", date(doc))
                    }
                }
            }
            if (settings.getBoolean("review", true)) {
                val review = fetchOne(db.collection("badge_requests").document(uid).get(Source.SERVER))
                val status = review.getString("status")
                if (review.exists() && BackgroundNoticePolicy.reviewStatus(status)) {
                    val checkedAt = date(review, "reviewedAt")
                    offer("review", "review:$status:$checkedAt", checkedAt)
                }
            }
            if (settings.getBoolean("admin", true)) {
                // Revoked admins are checked against the server on EVERY run.
                val role = fetchOne(db.collection("admins").document(uid).get(Source.SERVER))
                if (role.getBoolean("enabled") == true) {
                    val reports = fetch(db.collection("reports")
                        .whereGreaterThan("createdAt", cutoffTimestamp)
                        .orderBy("createdAt", Query.Direction.DESCENDING)
                        .limit(BackgroundNoticePolicy.MAX_DOCS).get(Source.SERVER))
                    reports.documents.forEach { doc ->
                        if (BackgroundNoticePolicy.isPending(doc.getString("status"))
                            && doc.getString("reporterUid") != uid) {
                            offer("admin", "report:${doc.id}:${date(doc)}", date(doc))
                        }
                    }
                    val requests = fetch(db.collection("badge_requests")
                        .whereGreaterThan("createdAt", cutoffTimestamp)
                        .orderBy("createdAt", Query.Direction.DESCENDING)
                        .limit(BackgroundNoticePolicy.MAX_DOCS).get(Source.SERVER))
                    requests.documents.forEach { doc ->
                        if (doc.id != uid && doc.getString("status") == "pending") {
                            offer("admin", "request:${doc.id}:${date(doc)}", date(doc))
                        }
                    }
                }
            }
            // Do not deliver to a user who signed out while Firestore was loading.
            if (FirebaseAuth.getInstance().currentUser?.uid != uid ||
                !BackgroundNoticeScheduler.enabled(context, uid)) return Result.success()
            kinds.forEach { PushRegistry.show(context, uid, it) }
            BackgroundNoticeScheduler.completed(context, uid, now, pending)
            return Result.success()
        } catch (_: Exception) {
            // No partial checkpoint; a later run may recover missed events.
            // Never log UIDs, notification bodies or tokens.
            return Result.retry()
        }
    }
}
