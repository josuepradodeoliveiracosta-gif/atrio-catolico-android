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
import androidx.core.app.NotificationManagerCompat
import com.google.android.gms.common.ConnectionResult
import com.google.android.gms.common.GoogleApiAvailability
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.FirebaseFirestoreException
import com.google.firebase.messaging.FirebaseMessaging
import com.google.firebase.messaging.FirebaseMessagingService
import com.google.firebase.messaging.RemoteMessage
import java.util.Locale
import java.util.UUID

/**
 * FCM e apenas o transportador: nao envia mensagens nem concede autorizacao.
 * A entrega depende da ativacao controlada do relay confiavel Cloudflare.
 */
internal object PushRegistry {
    private const val PREFS = "atrio_push_devices"
    private const val CHANNEL = "atrio_avisos"
    private const val COMMUNICATION_TOPIC = "atrio_comunicados_v1"

    // Exibe somente categorias conhecidas; jamais a mensagem bruta da exceção.
    private fun diagnoseFcm(context: Context, error: Throwable?): PushRegistrationProblem {
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
            != ConnectionResult.SUCCESS) return PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE
        var cause = error
        repeat(5) {
            if (cause == null) return@repeat
            val marker = cause?.message.orEmpty().uppercase(Locale.ROOT)
            if (listOf("BAD_CONFIG", "FIS_AUTH_ERROR", "AUTHENTICATION_FAILED",
                    "INVALID_SENDER", "INVALID_ARGUMENT").any { marker.contains(it) })
                return PushRegistrationProblem.TOKEN_CONFIG_OR_AUTH
            if (listOf("SERVICE_NOT_AVAILABLE", "UNAVAILABLE", "TIMEOUT",
                    "TOO_MANY_REGISTRATIONS").any { marker.contains(it) })
                return PushRegistrationProblem.TOKEN_SERVICE_UNAVAILABLE
            cause = cause?.cause
        }
        return PushRegistrationProblem.TOKEN_UNAVAILABLE
    }
    private fun prefs(context: Context) = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun enabledKey(uid: String) = "enabled_$uid"
    private fun pendingRemovalKey(uid: String) = "removal_pending_$uid"
    private fun registrationEpochKey(uid: String) = "registration_epoch_$uid"

    // O registro precisa ser invalidado antes de qualquer nova intenção de
    // ativação/desativação. SharedPreferences conserva a geração no reinício.
    private fun epoch(context: Context, uid: String): Long =
        prefs(context).getLong(registrationEpochKey(uid), 0L)

    @Synchronized
    private fun invalidateRegistrations(context: Context, uid: String): Long {
        val next = epoch(context, uid) + 1L
        prefs(context).edit().putLong(registrationEpochKey(uid), next).apply()
        return next
    }

    private fun registrationCurrent(context: Context, uid: String, capturedEpoch: Long): Boolean =
        mayContinueFcmRegistration(
            expectedUid = uid,
            authenticatedUid = FirebaseAuth.getInstance().currentUser?.uid,
            enabledOnDevice = enabled(context, uid),
            removalPending = pendingRemoteRemoval(context, uid),
            expectedEpoch = capturedEpoch,
            currentEpoch = epoch(context, uid)
        )

    /** Pendência local não é prova de exclusão confirmada no Firestore. */
    fun pendingRemoteRemoval(context: Context, uid: String): Boolean =
        uid.isNotBlank() && prefs(context).getBoolean(pendingRemovalKey(uid), false)

    fun enabled(context: Context, uid: String): Boolean =
        uid.isNotBlank() && prefs(context).getBoolean(enabledKey(uid), false)

    private fun deviceId(context: Context): String {
        val preferences = prefs(context)
        return preferences.getString("device_id", null) ?: UUID.randomUUID().toString().also {
            preferences.edit().putString("device_id", it).apply()
        }
    }

    private fun document(db: FirebaseFirestore, uid: String, context: Context) =
        db.collection("users").document(uid).collection("pushDevices").document(deviceId(context))

    // Nunca exibimos token FCM, chave, UID ou mensagem bruta de exceção na interface.
    fun register(
        context: Context,
        uid: String,
        db: FirebaseFirestore,
        done: (Boolean, PushRegistrationProblem?) -> Unit = { _, _ -> }
    ) {
        val capturedEpoch = epoch(context, uid)
        if (!registrationCurrent(context, uid, capturedEpoch)) {
            done(false, PushRegistrationProblem.SESSION_CHANGED)
            return
        }
        if (GoogleApiAvailability.getInstance().isGooglePlayServicesAvailable(context)
            != ConnectionResult.SUCCESS) {
            done(false, PushRegistrationProblem.PLAY_SERVICES_UNAVAILABLE)
            return
        }
        FirebaseMessaging.getInstance().isAutoInitEnabled = true
        FirebaseMessaging.getInstance().token
            .addOnSuccessListener { token ->
                if (!registrationCurrent(context, uid, capturedEpoch)) {
                    done(false, PushRegistrationProblem.SESSION_CHANGED)
                    return@addOnSuccessListener
                }
                if (token.isBlank()) {
                    done(false, PushRegistrationProblem.TOKEN_UNAVAILABLE)
                    return@addOnSuccessListener
                }
                document(db, uid, context).set(mapOf(
                    "token" to token,
                    "updatedAt" to FieldValue.serverTimestamp()
                )).addOnCompleteListener { result ->
                    if (!registrationCurrent(context, uid, capturedEpoch)) {
                        done(false, PushRegistrationProblem.SESSION_CHANGED)
                    } else if (result.isSuccessful) {
                        if (BuildConfig.PLAY_STORE_BUILD) {
                            // O Play envia comunicados apenas por token individual.
                            // Não cadastrar novos assinantes do topic geral legado.
                            // Desinscrição é best-effort; a filtragem ao receber
                            // recusa broadcasts de topic mesmo se a rede falhar.
                            FirebaseMessaging.getInstance().unsubscribeFromTopic(COMMUNICATION_TOPIC)
                                .addOnCompleteListener {
                                    if (!registrationCurrent(context, uid, capturedEpoch)) {
                                        done(false, PushRegistrationProblem.SESSION_CHANGED)
                                    } else {
                                        ThreadPushSubscriptions.sync(context, uid)
                                        done(true, null)
                                    }
                                }
                        } else {
                            // Compatibilidade com APKs OTA existentes; sem mudar
                            // as preferências ou tópicos desses usuários.
                            FirebaseMessaging.getInstance().subscribeToTopic(COMMUNICATION_TOPIC)
                                .addOnCompleteListener { subscribed ->
                                    if (!registrationCurrent(context, uid, capturedEpoch)) {
                                        FirebaseMessaging.getInstance().unsubscribeFromTopic(COMMUNICATION_TOPIC)
                                        done(false, PushRegistrationProblem.SESSION_CHANGED)
                                    } else if (subscribed.isSuccessful) {
                                        ThreadPushSubscriptions.sync(context, uid)
                                        done(true, null)
                                    } else {
                                        done(false, PushRegistrationProblem.TOPIC_SUBSCRIPTION_FAILED)
                                    }
                                }
                        }
                    } else {
                        val issue = when ((result.exception as? FirebaseFirestoreException)?.code) {
                            FirebaseFirestoreException.Code.PERMISSION_DENIED ->
                                PushRegistrationProblem.FIRESTORE_PERMISSION_DENIED
                            FirebaseFirestoreException.Code.UNAVAILABLE,
                            FirebaseFirestoreException.Code.DEADLINE_EXCEEDED ->
                                PushRegistrationProblem.FIRESTORE_UNAVAILABLE
                            else -> PushRegistrationProblem.FIRESTORE_WRITE_FAILED
                        }
                        done(false, issue)
                    }
                }
            }
            .addOnFailureListener { error ->
                if (!registrationCurrent(context, uid, capturedEpoch))
                    done(false, PushRegistrationProblem.SESSION_CHANGED)
                else done(false, diagnoseFcm(context, error))
            }
    }

    fun enable(
        context: Context,
        uid: String,
        db: FirebaseFirestore,
        done: (Boolean, PushRegistrationProblem?) -> Unit
    ) {
        if (FirebaseAuth.getInstance().currentUser?.uid != uid) {
            done(false, PushRegistrationProblem.SESSION_CHANGED)
            return
        }
        if (pendingRemoteRemoval(context, uid)) {
            // Não registrar outro token enquanto a remoção antiga ainda
            // pode chegar ao servidor depois do novo cadastro.
            done(false, PushRegistrationProblem.REVOCATION_PENDING)
            return
        }
        val capturedEpoch = invalidateRegistrations(context, uid)
        prefs(context).edit().putBoolean(enabledKey(uid), true).apply()
        register(context, uid, db) { ok, issue ->
            // Um callback antigo não pode desligar uma ativação mais nova.
            if (epoch(context, uid) != capturedEpoch ||
                FirebaseAuth.getInstance().currentUser?.uid != uid ||
                pendingRemoteRemoval(context, uid)) {
                done(false, PushRegistrationProblem.SESSION_CHANGED)
                return@register
            }
            if (!ok) {
                prefs(context).edit().putBoolean(enabledKey(uid), false).apply()
                FirebaseMessaging.getInstance().isAutoInitEnabled = false
            }
            done(ok, issue)
        }
    }

    fun refreshIfEnabled(context: Context, uid: String, db: FirebaseFirestore) {
        if (FirebaseAuth.getInstance().currentUser?.uid != uid) return
        if (pendingRemoteRemoval(context, uid)) {
            // Reconciliar a pendência apenas sob a mesma identidade.
            deactivate(context, uid, db)
        } else if (enabled(context, uid)) register(context, uid, db)
    }

    /**
     * Retorna sucesso somente quando o servidor Firestore confirmou delete
     * ainda sob a mesma sessão. Não comprova revogação de todo token FCM.
     * Em offline, a pendência local sobrevive até nova autenticação do titular.
     */
    fun deactivate(
        context: Context, uid: String, db: FirebaseFirestore,
        done: (Boolean) -> Unit = {}
    ) {
        if (uid.isBlank() || FirebaseAuth.getInstance().currentUser?.uid != uid) {
            done(false)
            return
        }
        // Invalida callbacks FCM antigos ANTES de iniciar a remoção remota.
        val capturedEpoch = invalidateRegistrations(context, uid)
        prefs(context).edit()
            .putBoolean(enabledKey(uid), false)
            .putBoolean(pendingRemovalKey(uid), true).apply()
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        FirebaseMessaging.getInstance().unsubscribeFromTopic(COMMUNICATION_TOPIC)
        ThreadPushSubscriptions.unsubscribeAll(context, uid)
        FirebaseMessaging.getInstance().deleteToken()
        document(db, uid, context).delete().addOnCompleteListener { task ->
            val currentAttempt = FirebaseAuth.getInstance().currentUser?.uid == uid &&
                epoch(context, uid) == capturedEpoch
            if (currentAttempt && task.isSuccessful)
                prefs(context).edit().putBoolean(pendingRemovalKey(uid), false).apply()
            done(currentAttempt && task.isSuccessful)
        }
    }

    fun createChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, "Avisos do Átrio", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Avisos gerais de respostas, verificações e administração" })
    }

    fun showBroadcast(context: Context, uid: String, title: String, body: String) {
        if (!enabled(context, uid) || FirebaseAuth.getInstance().currentUser?.uid != uid) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) return
        val heading = title.trim()
        val details = body.trim()
        if (heading.length !in 5..60 || details.length !in 10..180 ||
            (heading + details).any { it.isISOControl() }) return
        createChannel(context)
        val destination = PendingIntent.getActivity(context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notification = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_atrio)
            .setContentTitle(heading)
            .setContentText(details)
            .setStyle(Notification.BigTextStyle().bigText(details))
            .setAutoCancel(true)
            .setContentIntent(destination)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notification)
    }

    fun showDiscussionReply(context: Context, uid: String, postId: String,
                            replyId: String, actorUid: String, topicDelivery: Boolean) {
        if (!enabled(context, uid) ||
            FirebaseAuth.getInstance().currentUser?.uid != uid ||
            actorUid == uid || actorUid.isBlank() ||
            !postId.matches(Regex("^[A-Za-z0-9_-]{1,128}$")) ||
            !replyId.matches(Regex("^[A-Za-z0-9_-]{1,128}$"))) return
        if (topicDelivery && !ThreadPushSubscriptions.contains(context, uid, postId)) return
        // Preferência de respostas da Central de Avisos também vale fora do app.
        if (!context.getSharedPreferences("atrio_notices_$uid", Context.MODE_PRIVATE)
                .getBoolean("replies", true)) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS)
            != PackageManager.PERMISSION_GRANTED) return

        // O mesmo aviso pode chegar pelo Push individual legado e pelo tópico
        // da discussão: exibir apenas uma vez neste aparelho.
        val prefs = context.getSharedPreferences("atrio_discussion_seen", Context.MODE_PRIVATE)
        val key = "seen_$uid"
        val id = "$postId:$replyId"
        synchronized(this) {
            val before = prefs.getStringSet(key, emptySet()).orEmpty()
            if (id in before) return
            prefs.edit().putStringSet(key, (before.toList().takeLast(999) + id).toSet()).apply()
        }
        createChannel(context)
        val intent = PendingIntent.getActivity(context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notice = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_atrio)
            .setContentTitle("Nova resposta em uma discussão")
            .setContentText("Uma conversa da qual você participa recebeu uma nova resposta.")
            .setAutoCancel(true)
            .setContentIntent(intent)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify(id.hashCode(), notice)
    }

    fun show(context: Context, uid: String, kind: String) {
        if (!enabled(context, uid)
            || FirebaseAuth.getInstance().currentUser?.uid != uid) return
        if (Build.VERSION.SDK_INT >= 33 &&
            context.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED)
            return
        val title = when (kind) {
            "reply" -> "Nova resposta no Átrio"
            "review" -> "Atualização da sua verificação"
            "admin" -> "Pendência administrativa no Átrio"
            else -> return
        }
        createChannel(context)
        val intent = PendingIntent.getActivity(context, 0,
            Intent(context, MainActivity::class.java).apply {
                flags = Intent.FLAG_ACTIVITY_CLEAR_TOP or Intent.FLAG_ACTIVITY_SINGLE_TOP
            }, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val notice = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_atrio)
            .setContentTitle(title)
            .setContentText("Abra o aplicativo para consultar sua central de notificações.")
            .setAutoCancel(true)
            .setContentIntent(intent)
            .build()
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.notify((System.currentTimeMillis() % Int.MAX_VALUE).toInt(), notice)
    }
}

class AtrioPushService : FirebaseMessagingService() {
    override fun onNewToken(token: String) {
        super.onNewToken(token)
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        if (PushRegistry.enabled(applicationContext, uid)) {
            PushRegistry.register(applicationContext, uid, FirebaseFirestore.getInstance())
        }
    }

    override fun onMessageReceived(message: RemoteMessage) {
        super.onMessageReceived(message)
        // Apenas mensagens DATA, com UID correspondente a sessao atual.
        // Nunca use texto fornecido no payload como conteudo da notificacao.
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return
        if (message.data["kind"] == "broadcast") {
            // No Play, só comunicado individual destinado ao UID autenticado.
            // Uma mensagem por tópico jamais contorna bloqueios via payload.
            if (!PlayBroadcastDeliveryPolicy.accepts(
                    playStoreBuild = BuildConfig.PLAY_STORE_BUILD,
                    currentUid = uid,
                    destinationUid = message.data["uid"],
                    sender = message.from,
                    addressedTo = message.to
                )) return
            PushRegistry.showBroadcast(applicationContext, uid,
                message.data["title"].orEmpty(), message.data["body"].orEmpty())
            return
        }
        if (message.data["kind"] == "discussion_reply") {
            // Defense in depth: a build da Play nunca deve mostrar Push de
            // tópico legado. O envio seguro deve chegar por token individual.
            // Nenhum payload não autenticado de tópico pode contornar bloqueio.
            if (BuildConfig.PLAY_STORE_BUILD) return
            PushRegistry.showDiscussionReply(applicationContext, uid,
                message.data["postId"].orEmpty(), message.data["replyId"].orEmpty(),
                message.data["actorUid"].orEmpty(), topicDelivery = true)
            return
        }
        if (message.data["uid"] != uid) return
        if (message.data["kind"] == "reply" &&
            message.data["replyId"].orEmpty().isNotBlank()) {
            PushRegistry.showDiscussionReply(applicationContext, uid,
                message.data["postId"].orEmpty(), message.data["replyId"].orEmpty(),
                message.data["actorUid"].orEmpty(), topicDelivery = false)
        } else {
            PushRegistry.show(applicationContext, uid, message.data["kind"].orEmpty())
        }
    }
}
