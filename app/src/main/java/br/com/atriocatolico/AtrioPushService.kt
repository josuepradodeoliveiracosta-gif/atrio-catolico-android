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
internal enum class PushRegistrationProblem {
    SESSION_CHANGED,
    TOKEN_UNAVAILABLE,
    PLAY_SERVICES_UNAVAILABLE,
    TOKEN_SERVICE_UNAVAILABLE,
    TOKEN_CONFIG_OR_AUTH,
    FIRESTORE_PERMISSION_DENIED,
    FIRESTORE_UNAVAILABLE,
    FIRESTORE_WRITE_FAILED
}

internal object PushRegistry {
    private const val PREFS = "atrio_push_devices"
    private const val CHANNEL = "atrio_avisos"

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
        if (FirebaseAuth.getInstance().currentUser?.uid != uid || !enabled(context, uid)) {
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
                if (FirebaseAuth.getInstance().currentUser?.uid != uid || !enabled(context, uid)) {
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
                    if (FirebaseAuth.getInstance().currentUser?.uid != uid || !enabled(context, uid)) {
                        done(false, PushRegistrationProblem.SESSION_CHANGED)
                    } else if (result.isSuccessful) {
                        done(true, null)
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
                done(false, diagnoseFcm(context, error))
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
        prefs(context).edit().putBoolean(enabledKey(uid), true).apply()
        register(context, uid, db) { ok, issue ->
            if (!ok && FirebaseAuth.getInstance().currentUser?.uid == uid) {
                prefs(context).edit().putBoolean(enabledKey(uid), false).apply()
                FirebaseMessaging.getInstance().isAutoInitEnabled = false
            }
            done(ok, issue)
        }
    }

    fun refreshIfEnabled(context: Context, uid: String, db: FirebaseFirestore) {
        if (enabled(context, uid)) register(context, uid, db)
    }

    fun deactivate(context: Context, uid: String, db: FirebaseFirestore) {
        if (uid.isBlank()) return
        prefs(context).edit().putBoolean(enabledKey(uid), false).apply()
        FirebaseMessaging.getInstance().isAutoInitEnabled = false
        // A exclusao remota e a rotacao do token sao tentativas assincronas.
        // Nao mostramos informacoes pessoais no corpo de avisos enviados.
        document(db, uid, context).delete()
        FirebaseMessaging.getInstance().deleteToken()
    }

    fun createChannel(context: Context) {
        val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        manager.createNotificationChannel(NotificationChannel(
            CHANNEL, "Avisos do Átrio", NotificationManager.IMPORTANCE_DEFAULT
        ).apply { description = "Avisos gerais de respostas, verificações e administração" })
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
        if (message.data["uid"] != uid) return
        PushRegistry.show(applicationContext, uid, message.data["kind"].orEmpty())
    }
}
