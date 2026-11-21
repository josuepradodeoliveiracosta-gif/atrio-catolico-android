package br.com.atriocatolico

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import com.google.firebase.messaging.RemoteMessage
import java.security.MessageDigest
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

internal object QaConversationNotices {
    const val CHANNEL = "atrio_qa_conversation"
    const val TITLE = "Novo aviso do Átrio"
    private const val TAP = "br.com.atriocatolico.qa.CONVERSATION_OPEN"
    private const val TICKET = "qaNoticeTicket"
    private const val NOTICE_ID = 701
    private const val MAX_TAP_AGE_MS = 10 * 60_000L
    private val transport = if (BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB) {
        QaConversationNoticeHttp.loopback(BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB_URL)
    } else {
        QaConversationNoticeHttp.https(BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_ORIGIN)
    }
    val configured: Boolean get() = transport != null
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private data class Session(val user: FirebaseUser, val generation: Long)
    private data class Event(val chat: String, val message: String, val sender: String)
    private data class Opening(val session: Session, val chat: String)

    // Estado da sessão de avisos, acessado na thread principal.
    private var auth: FirebaseAuth? = null
    private var user: FirebaseUser? = null
    private var generation = 0L
    private var opening: Opening? = null
    private val shown = linkedSetOf<Pair<String, Event>>()
    private val destinationChange = MutableStateFlow(0L)
    val destination = destinationChange.asStateFlow()

    fun enabled(context: Context): Boolean {
        if (!configured || !BuildConfig.DEBUG || BuildConfig.ATRIO_QA_GERAL_PUSH ||
            context.packageName != "br.com.atriocatolico.qageral.celular"
        ) return false
        val app = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
            ?: return false
        val settings = FirebaseFirestore.getInstance(app).firestoreSettings
        if (BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB) {
            return BuildConfig.ATRIO_QA_GERAL_CELULAR_PILOT && !BuildConfig.ATRIO_QA_GERAL_REMOTE &&
                app.options.projectId == "demo-atrio-v11" &&
                app.options.applicationId == "1:1234567890:android:qa123456" &&
                settings.host == "127.0.0.1:8089" && !settings.isSslEnabled
        }
        return BuildConfig.ATRIO_QA_GERAL_REMOTE && BuildConfig.ATRIO_QA_GERAL_CELULAR_FUNCIONAL &&
            BuildConfig.ATRIO_QA_GERAL_CELULAR_RODADA && qaGeralCelularRoundMatches(
                context.packageName, app.options.projectId, app.options.applicationId,
                settings.host, settings.isSslEnabled
            )
    }

    private fun validSignal(message: RemoteMessage): Boolean {
        val ttl = message.ttl
        val sent = message.sentTime
        return message.notification == null && message.data == mapOf("signal" to "refresh") &&
            ttl in 1..60 && sent > 0 && System.currentTimeMillis() - sent in 0..ttl * 1000L
    }

    private fun manager(context: Context): NotificationManager =
        context.getSystemService(NotificationManager::class.java)

    private fun ticketStore(context: Context) =
        context.getSharedPreferences("atrio_qa_conversation_ticket", Context.MODE_PRIVATE)

    // Store a comparison key, not content or a route that could skip a server read.
    private fun eventKey(uid: String, event: Event): String =
        MessageDigest.getInstance("SHA-256")
            .digest(listOf(uid, event.chat, event.message, event.sender).joinToString("\u0000").toByteArray())
            .joinToString("") { "%02x".format(it) }

    fun clear(context: Context) {
        ticketStore(context).edit().clear().commit()
        opening = null
        manager(context).cancel(NOTICE_ID)
    }

    private fun canNotify(context: Context): Boolean =
        (Build.VERSION.SDK_INT < 33 ||
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED) && manager(context).areNotificationsEnabled()

    private fun session(context: Context): Session? {
        if (!enabled(context)) return null
        val authentication = FirebaseAuth.getInstance()
        if (auth == null) {
            auth = authentication
            user = authentication.currentUser
            authentication.addAuthStateListener { current ->
                updateSession(context.applicationContext, current.currentUser)
            }
        }
        updateSession(context, authentication.currentUser)
        return user?.let { Session(it, generation) }
    }

    private fun updateSession(context: Context, current: FirebaseUser?) {
        if (current === user) return
        user = current
        generation++
        clear(context)
    }

    private fun current(session: Session) =
        session.generation == generation && auth?.currentUser === session.user

    private suspend fun <T> await(task: Task<T>): T? =
        try {
            withContext(Dispatchers.IO) { Tasks.await(task, 3, TimeUnit.SECONDS) }
        } catch (_: ExecutionException) {
            null
        } catch (_: TimeoutException) {
            null
        }

    private suspend fun pending(token: String): JSONObject? = withContext(Dispatchers.IO) {
        val body = transport?.read(token) ?: return@withContext null
        try {
            JSONObject(body)
        } catch (_: JSONException) {
            null
        }
    }

    private suspend fun read(session: Session): Event? {
        if (!current(session)) return null
        val uid = session.user.uid
        val token = await(session.user.getIdToken(false))?.token ?: return null
        if (!current(session)) return null
        val pending = pending(token) ?: return null
        if (!current(session)) return null
        val chat = pending.opt("conversationId") as? String ?: return null
        val message = pending.opt("messageId") as? String ?: return null
        val sender = pending.opt("senderUid") as? String ?: return null
        if (AtrioPeerInboxPolicy.peerFromChatId(uid, chat) != sender ||
            !message.matches(Regex("[A-Za-z0-9_-]{1,128}"))
        ) return null
        val db = FirebaseFirestore.getInstance()
        val canonical = await(db.document("chats/$chat/messages/$message").get(Source.SERVER))
        if (!current(session) || canonical == null || !canonical.exists() ||
            canonical.metadata.isFromCache || canonical.metadata.hasPendingWrites() ||
            canonical.get("uid") != sender || canonical.get("deletedForAll") == true
        ) return null
        return Event(chat, message, sender)
    }

    suspend fun receive(context: Context, message: RemoteMessage) {
        if (!validSignal(message)) return
        withContext(Dispatchers.Main.immediate) {
            try {
                val session = session(context) ?: return@withContext
                if (!canNotify(context) ||
                    !QaConversationPushRegistration.mayPresent(context, session.user.uid)) return@withContext
                val event = read(session) ?: return@withContext
                if (!current(session) || !canNotify(context) || !validSignal(message) ||
                    !QaConversationPushRegistration.mayPresent(context, session.user.uid))
                    return@withContext
                val key = session.user.uid to event
                if (key in shown) return@withContext
                val ticket = UUID.randomUUID().toString()
                val destination = Intent(context, MainActivity::class.java).apply {
                    action = TAP
                    flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
                    putExtra(TICKET, ticket)
                }
                val tap = PendingIntent.getActivity(context, NOTICE_ID, destination,
                    PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE)
                manager(context).createNotificationChannel(
                    NotificationChannel(CHANNEL, "Avisos de Conversas QA", NotificationManager.IMPORTANCE_DEFAULT)
                )
                val alert = Notification.Builder(context, CHANNEL)
                    .setSmallIcon(R.drawable.ic_atrio)
                    .setContentTitle(TITLE)
                    .setContentText("Abra o aplicativo para consultar suas conversas.")
                    .setVisibility(Notification.VISIBILITY_PRIVATE)
                    .setContentIntent(tap)
                    .setAutoCancel(true)
                    .build()
                if (!ticketStore(context).edit()
                        .putString(TICKET, ticket)
                        .putString("event", eventKey(session.user.uid, event))
                        .putLong("created", System.currentTimeMillis())
                        .commit()) return@withContext
                manager(context).notify(NOTICE_ID, alert)
                shown.add(key)
                if (shown.size > 32) shown.remove(shown.first())
            } catch (_: SecurityException) {
                // A permissão pode ser retirada entre a checagem e o aviso.
            }
        }
    }

    fun openFrom(context: Context, intent: Intent?) {
        if (!enabled(context) || intent?.action != TAP) return
        val ticket = intent.getStringExtra(TICKET) ?: return
        intent.removeExtra(TICKET)
        val application = context.applicationContext
        scope.launch {
            val active = session(application) ?: return@launch
            val saved = ticketStore(application)
            if (saved.getString(TICKET, null) != ticket) return@launch
            val expected = saved.getString("event", null)
            val createdAt = saved.getLong("created", 0L)
            clear(application)
            if (expected == null || System.currentTimeMillis() - createdAt !in 0..MAX_TAP_AGE_MS ||
                !QaConversationPushRegistration.mayPresent(application, active.user.uid)) return@launch
            val event = read(active)
            if (event != null && eventKey(active.user.uid, event) == expected && current(active) &&
                QaConversationPushRegistration.mayPresent(application, active.user.uid)) {
                opening = Opening(active, event.chat)
                destinationChange.value++
            }
        }
    }

    fun consumeDestination(uid: String): String? {
        val requested = opening?.takeIf { it.session.user.uid == uid && current(it.session) }
            ?: return null
        opening = null
        return requested.chat
    }
}
