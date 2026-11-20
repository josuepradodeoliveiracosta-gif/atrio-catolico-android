package br.com.atriocatolico

import android.Manifest
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.SystemClock
import com.google.android.gms.tasks.Task
import com.google.android.gms.tasks.Tasks
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import java.util.UUID
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/** Entrada interna do laboratório. O APK local conserva o serviço FCM desligado. */
class QaConversationSignalReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        if (!QaConversationNotices.validSignal(context, intent)) return
        val completion = goAsync()
        QaConversationNotices.receive(context.applicationContext) { completion.finish() }
    }
}

internal object QaConversationNotices {
    const val SIGNAL = "br.com.atriocatolico.qa.CONVERSATION_REFRESH"
    const val SIGNAL_TIME = "receivedAtElapsed"
    const val CHANNEL = "atrio_qa_conversation"
    const val TITLE = "Novo aviso do Átrio"
    private const val TAP = "br.com.atriocatolico.qa.CONVERSATION_OPEN"
    private const val TICKET = "qaNoticeTicket"
    private const val NOTICE_ID = 701
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private data class Session(val user: FirebaseUser, val generation: Long)
    private data class Event(val chat: String, val message: String, val sender: String)
    private data class Notice(val ticket: String, val session: Session, val event: Event)
    private data class Opening(val session: Session, val chat: String)

    // Estado somente no processo do laboratório, acessado na thread principal.
    private var auth: FirebaseAuth? = null
    private var user: FirebaseUser? = null
    private var generation = 0L
    private var notice: Notice? = null
    private var opening: Opening? = null
    private val shown = linkedSetOf<Pair<String, Event>>()
    private val destinationChange = MutableStateFlow(0L)
    val destination = destinationChange.asStateFlow()

    fun enabled(context: Context): Boolean {
        if (!BuildConfig.ATRIO_QA_CONVERSATION_NOTICE_LAB || !BuildConfig.DEBUG ||
            BuildConfig.ATRIO_QA_GERAL_REMOTE || BuildConfig.ATRIO_QA_GERAL_PUSH ||
            context.packageName != "br.com.atriocatolico.qageral"
        ) return false
        val app = FirebaseApp.getApps(context).firstOrNull { it.name == FirebaseApp.DEFAULT_APP_NAME }
            ?: return false
        if (app.options.projectId != "demo-atrio-v11" ||
            app.options.applicationId != "1:1234567890:android:qa123456"
        ) return false
        val settings = FirebaseFirestore.getInstance(app).firestoreSettings
        return settings.host == "127.0.0.1:8089" && !settings.isSslEnabled
    }

    fun validSignal(context: Context, intent: Intent): Boolean {
        if (!enabled(context) || intent.action != SIGNAL || intent.extras?.keySet() != setOf(SIGNAL_TIME))
            return false
        val received = intent.getLongExtra(SIGNAL_TIME, -1L)
        return received >= 0 && SystemClock.elapsedRealtime() - received in 0L..60_000L
    }

    private fun manager(context: Context): NotificationManager =
        context.getSystemService(NotificationManager::class.java)

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
        notice = null
        opening = null
        manager(context).cancel(NOTICE_ID)
    }

    private fun current(session: Session) =
        session.generation == generation && auth?.currentUser === session.user

    private suspend fun await(task: Task<DocumentSnapshot>): DocumentSnapshot? =
        try {
            withContext(Dispatchers.IO) { Tasks.await(task, 3, TimeUnit.SECONDS) }
        } catch (_: ExecutionException) {
            null
        } catch (_: TimeoutException) {
            null
        }

    private suspend fun read(session: Session): Event? {
        if (!current(session)) return null
        val uid = session.user.uid
        val db = FirebaseFirestore.getInstance()
        val pending = await(db.document("users/$uid/chatPushPending/current").get(Source.SERVER))
        if (!current(session) || pending == null || !pending.exists() ||
            pending.metadata.isFromCache || pending.metadata.hasPendingWrites() ||
            pending.get("kind") != "chat_message" || pending.get("unread") != true
        ) return null
        val chat = pending.get("conversationId") as? String ?: return null
        val message = pending.get("messageId") as? String ?: return null
        val sender = pending.get("senderUid") as? String ?: return null
        if (AtrioPeerInboxPolicy.peerFromChatId(uid, chat) != sender ||
            !message.matches(Regex("[A-Za-z0-9_-]{1,128}"))
        ) return null
        val canonical = await(db.document("chats/$chat/messages/$message").get(Source.SERVER))
        if (!current(session) || canonical == null || !canonical.exists() ||
            canonical.metadata.isFromCache || canonical.metadata.hasPendingWrites() ||
            canonical.get("uid") != sender || canonical.get("deletedForAll") == true
        ) return null
        return Event(chat, message, sender)
    }

    fun receive(context: Context, done: () -> Unit) {
        scope.launch {
            try {
                val session = session(context) ?: return@launch
                if (!canNotify(context)) return@launch
                val event = read(session) ?: return@launch
                if (!current(session) || !canNotify(context)) return@launch
                val key = session.user.uid to event
                if (key in shown) return@launch
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
                manager(context).notify(NOTICE_ID, alert)
                notice = Notice(ticket, session, event)
                shown.add(key)
                if (shown.size > 32) shown.remove(shown.first())
            } catch (_: SecurityException) {
                // A permissão pode ser retirada entre a checagem e o aviso.
            } finally {
                done()
            }
        }
    }

    fun openFrom(context: Context, intent: Intent?) {
        if (!enabled(context) || intent?.action != TAP) return
        val ticket = intent.getStringExtra(TICKET) ?: return
        intent.removeExtra(TICKET)
        val application = context.applicationContext
        scope.launch {
            session(application) ?: return@launch
            val previous = notice?.takeIf { it.ticket == ticket && current(it.session) } ?: return@launch
            notice = null
            manager(application).cancel(NOTICE_ID)
            val event = read(previous.session)
            if (event == previous.event && current(previous.session)) {
                opening = Opening(previous.session, event.chat)
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
