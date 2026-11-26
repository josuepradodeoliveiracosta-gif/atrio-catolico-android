package br.com.atriocatolico

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import java.time.Instant

/** Fixed local markers, never tokens, message data, paths, identities or exception text. */
internal enum class QaReceiptStage(val label: String) {
    RECEIVED("Callback FCM recebido"),
    PAYLOAD_REJECTED("Formato do sinal recusado"),
    TTL_REJECTED("TTL inválido"),
    SENT_TIME_MISSING("Horário de envio ausente"),
    CLOCK_FUTURE("Sinal no futuro pelo relógio local"),
    CLOCK_COMPARISON("Diferença FCM menos relógio local (ms)"),
    EXPIRED("Sinal expirado"),
    SIGNAL_VALID("Sinal válido"),
    SESSION_REJECTED("Sessão ausente ou alterada"),
    PERMISSION_REJECTED("Permissão de notificação ausente"),
    OPT_IN_REJECTED("Cadastro local ou titularidade recusados"),
    AUTH_UNAVAILABLE("Token de sessão indisponível"),
    HTTP_RESPONSE("Resposta HTTPS"),
    NOTICE_UNAVAILABLE("Aviso ausente, recusado ou indisponível"),
    NOTICE_INVALID("Formato ou par do aviso inválido"),
    FIRESTORE_UNAVAILABLE("Leitura Firestore indisponível"),
    CANONICAL_REJECTED("Mensagem canônica recusada"),
    CANONICAL_VALID("Mensagem canônica validada"),
    DUPLICATE("Aviso duplicado"),
    TICKET_FAILED("Falha ao salvar abertura segura"),
    CHANNEL_BLOCKED("Canal de notificação bloqueado"),
    NOTIFY_CALLED("Android recebeu a solicitação de exibição"),
    SECURITY_EXCEPTION("Android recusou a operação"),
    TIMEOUT("Prazo de processamento esgotado")
}

private const val MAX_FUTURE_SKEW_MS = 2_000L

/** Strict by default; only the physical QA round 46 opts into bounded future skew. */
internal fun qaReceiptSignalProblem(
    payloadValid: Boolean, ttl: Int, sent: Long, now: Long, allowClockSkew: Boolean = false
): QaReceiptStage? =
    when {
        !payloadValid -> QaReceiptStage.PAYLOAD_REJECTED
        ttl !in 1..60 -> QaReceiptStage.TTL_REJECTED
        sent <= 0 -> QaReceiptStage.SENT_TIME_MISSING
        now <= 0 -> QaReceiptStage.CLOCK_FUTURE
        now < sent && sent - now > (if (allowClockSkew) MAX_FUTURE_SKEW_MS else 0L) ->
            QaReceiptStage.CLOCK_FUTURE
        now - sent > ttl * 1000L -> QaReceiptStage.EXPIRED
        else -> null
    }

internal object QaReceiptDiagnostic {
    private val PREFS = if (BuildConfig.ATRIO_QA_RECEIPT_CLOCK_SKEW)
        "atrio_qa_receipt_diagnostic46" else "atrio_qa_receipt_diagnostic45"
    private val lock = Any()
    private val active = mutableMapOf<String, Trace>()

    // Exact physical QA identity, never laboratory or ordinary debug/release builds.
    private fun slot(context: Context): String? = try {
        if (!BuildConfig.ATRIO_QA_RECEIPT_DIAGNOSTIC) null else {
            val user = FirebaseAuth.getInstance().currentUser
            if (user != null && atrioSimpleDirectIdentity(FirebaseFirestore.getInstance(), user) &&
                QaConversationNotices.enabled(context)) {
                when (user.uid) {
                    "qa-nav-alice" -> "a"
                    "qa-nav-bob" -> "b"
                    else -> null
                }
            } else null
        }
    } catch (_: RuntimeException) { null }

    fun available(context: Context): Boolean = slot(context) != null

    fun snapshot(context: Context): String = try {
        val key = slot(context)
        if (key == null) "" else context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString(key, null) ?: "Nenhum callback registrado nesta instalação."
    } catch (_: RuntimeException) { "" }

    fun begin(context: Context): Trace? = try {
        val app = context.applicationContext
        val key = slot(app)
        if (key == null) null else synchronized(lock) {
            Trace(app, key).also {
                active[key] = it
                it.record(QaReceiptStage.RECEIVED)
            }
        }
    } catch (_: RuntimeException) { null }

    internal class Trace(private val context: Context, private val key: String) {
        private val startedAt = Instant.now().toString()
        private val steps = mutableListOf<String>()

        // The previous trace is replaced, not appended to indefinitely.
        // Diagnostic failures must never affect authorization or presentation.
        fun record(stage: QaReceiptStage, status: Int? = null, deltaMs: Long? = null) {
            try {
                synchronized(lock) {
                    if (active[key] !== this || slot(context) != key || steps.size >= 24) return
                    val suffix = when {
                        stage == QaReceiptStage.HTTP_RESPONSE && status != null &&
                            (status == 0 || status in 100..599) -> " ($status)"
                        stage == QaReceiptStage.CLOCK_COMPARISON && deltaMs != null -> ": $deltaMs"
                        else -> ""
                    }
                    steps.add(stage.label + suffix)
                    context.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                        .putString(key, (listOf("UTC: " + startedAt) + steps).joinToString("\n")).apply()
                }
            } catch (_: RuntimeException) {
                // No raw exception data, no change to the notification path.
            }
        }
    }
}
