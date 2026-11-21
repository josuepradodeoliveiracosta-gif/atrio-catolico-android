package br.com.atriocatolico

import android.content.Context
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.messaging.FirebaseMessaging
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

/** Receiver registration for the isolated HTTPS build. Never joins topics or enables auto-init. */
internal object QaConversationPushRegistration {
    private const val OWNER = "last_token_owner"
    private const val DEVICE = "device_id"
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private val operations = Mutex()
    private fun prefs(context: Context) =
        context.getSharedPreferences("atrio_qa_conversation_push", Context.MODE_PRIVATE)
    private fun optIn(uid: String) = "opt_in_$uid"

    fun available(context: Context, uid: String): Boolean {
        if (BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB ||
            !QaConversationNotices.enabled(context)) return false
        val user = FirebaseAuth.getInstance().currentUser ?: return false
        return user.uid == uid && qaGeralPushIdentityMatches(uid, user.email, user.isEmailVerified)
    }

    fun enabled(context: Context, uid: String): Boolean =
        available(context, uid) && prefs(context).getBoolean(optIn(uid), false)

    fun mayPresent(context: Context, uid: String): Boolean =
        BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB ||
            (enabled(context, uid) && prefs(context).getString(OWNER, null) == uid)

    fun register(
        context: Context,
        uid: String,
        db: FirebaseFirestore,
        optInNow: Boolean = false,
        done: (Boolean, PushRegistrationProblem?) -> Unit = { _, _ -> }
    ) {
        val app = context.applicationContext
        val auth = FirebaseAuth.getInstance()
        val user = auth.currentUser
        if (user == null || !available(app, uid) ||
            db !== FirebaseFirestore.getInstance(auth.app)) {
            done(false, PushRegistrationProblem.SESSION_CHANGED)
            return
        }
        scope.launch {
            val problem = operations.withLock {
                bind(app, db, auth, user, optInNow)
            }
            done(problem == null, problem)
        }
    }

    private suspend fun bind(
        context: Context, db: FirebaseFirestore, auth: FirebaseAuth, user: FirebaseUser,
        optInNow: Boolean
    ): PushRegistrationProblem? {
        val uid = user.uid
        val preferences = prefs(context)
        fun current() = auth.currentUser === user && available(context, uid)
        if (!current() || (!optInNow && !enabled(context, uid)))
            return PushRegistrationProblem.SESSION_CHANGED
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context) !=
            ConnectionResult.SUCCESS) return PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE
        val messaging = FirebaseMessaging.getInstance()
        val device = preferences.getString(DEVICE, null) ?: UUID.randomUUID().toString()
        val previousOwner = preferences.getString(OWNER, null)
        try {
            // Never assign an installation token to two accounts, even if logout was offline.
            if (previousOwner != null && previousOwner != uid) await(messaging.deleteToken())
            if (!current()) return PushRegistrationProblem.SESSION_CHANGED
            // Persist before fetching the token so even an interrupted binding requires rotation.
            if (!preferences.edit().putString(DEVICE, device).putString(OWNER, uid).commit())
                return PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH
            val token = await(messaging.token)
            if (!current() || (!optInNow && !enabled(context, uid)))
                return PushRegistrationProblem.SESSION_CHANGED
            if (token.length !in 20..4096) return PushRegistrationProblem.TOKEN_UNAVAILABLE
            await(db.collection("users").document(uid).collection("pushDevices").document(device)
                .set(mapOf("token" to token, "updatedAt" to FieldValue.serverTimestamp())))
            if (!current()) return PushRegistrationProblem.SESSION_CHANGED
            if (optInNow && !preferences.edit().putBoolean(optIn(uid), true).commit())
                return PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH
            return null
        } catch (failure: ExecutionException) {
            return when ((failure.cause as? FirebaseFirestoreException)?.code) {
                FirebaseFirestoreException.Code.PERMISSION_DENIED ->
                    PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED
                FirebaseFirestoreException.Code.UNAVAILABLE,
                FirebaseFirestoreException.Code.DEADLINE_EXCEEDED ->
                    PushRegistrationProblem.FIRESTORE_UNAVAILABLE
                null -> PushRegistrationProblem.TOKEN_UNAVAILABLE
                else -> PushRegistrationProblem.FIRESTORE_WRITE_FAILED
            }
        } catch (_: TimeoutException) {
            return PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE
        } catch (_: InterruptedException) {
            Thread.currentThread().interrupt()
            return PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE
        }
    }

    fun deactivate(context: Context, uid: String, db: FirebaseFirestore) {
        if (!available(context, uid)) return
        val preferences = prefs(context)
        preferences.edit().remove(optIn(uid)).commit()
        QaConversationNotices.clear(context)
        val device = preferences.getString(DEVICE, null) ?: return
        if (preferences.getString(OWNER, null) != uid) return
        db.collection("users").document(uid).collection("pushDevices").document(device).delete()
        scope.launch {
            operations.withLock {
                if (preferences.getString(OWNER, null) == uid && !enabled(context, uid)) {
                    try {
                        await(FirebaseMessaging.getInstance().deleteToken())
                    } catch (_: ExecutionException) {
                        // The retained owner forces rotation before enabling another account.
                    } catch (_: TimeoutException) {
                        // Do not transfer ownership on an unconfirmed deletion.
                    } catch (_: InterruptedException) {
                        Thread.currentThread().interrupt()
                    }
                }
            }
        }
    }

    private suspend fun <T> await(task: Task<T>): T =
        withContext(Dispatchers.IO) { Tasks.await(task, 10, TimeUnit.SECONDS) }
}
