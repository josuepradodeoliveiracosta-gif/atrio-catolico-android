package br.com.atriocatolico

import android.content.Context
import com.google.firebase.FirebaseApp
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Comunica eventos ja persistidos ao servidor, sem credenciais privilegiadas.
 * Falhas de push nao revertem a acao do usuario no Firestore.
 */
internal object InstantPushRelay {
    private val executor = ThreadPoolExecutor(
        1, 1, 30, TimeUnit.SECONDS,
        ArrayBlockingQueue(24), ThreadPoolExecutor.AbortPolicy()
    )
    private const val PREFS = "atrio_push_relay_diagnostics"

    // Somente codigos tecnicos fixos sao guardados localmente. Nunca salvar
    // ID tokens, UID de destino, corpo de mensagens ou token FCM.
    private fun record(uid: String, status: String) {
        if (uid.isBlank()) return
        FirebaseApp.getInstance().applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .edit().putString("status_$uid", status).apply()
    }

    fun lastStatus(context: Context, uid: String): String =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
            .getString("status_$uid", "Nenhum evento enviado por este APK até agora.")
            .orEmpty()

    fun reply(postId: String, replyId: String) =
        post("reply", mapOf("postId" to postId, "replyId" to replyId))

    fun badgeRequest() = post("badge_request", emptyMap())

    fun badgeResult(targetUid: String) =
        post("badge_result", mapOf("targetUid" to targetUid))

    fun report(reportId: String) =
        post("report", mapOf("reportId" to reportId))

    private fun post(type: String, args: Map<String, String>) {
        val actor = FirebaseAuth.getInstance().currentUser ?: return
        val origin = BuildConfig.PUSH_RELAY_URL
        if (!origin.startsWith("https://") || !origin.endsWith(".workers.dev")) {
            record(actor.uid, "Sem endereço Cloudflare configurado neste APK.")
            return
        }
        if (args.values.any { it.isBlank() || it.length > 128 }) {
            record(actor.uid, "Evento inválido. O envio não foi iniciado.")
            return
        }
        record(actor.uid, "Preparando comunicação com Cloudflare...")
        actor.getIdToken(false)
            .addOnSuccessListener { result ->
                val idToken = result.token?.takeIf { it.isNotBlank() }
                if (idToken == null) {
                    record(actor.uid, "Firebase Auth não forneceu token de sessão.")
                    return@addOnSuccessListener
                }
                if (FirebaseAuth.getInstance().currentUser?.uid != actor.uid) {
                    record(actor.uid, "Conta alterada antes do envio.")
                    return@addOnSuccessListener
                }
                val payload = JSONObject().put("type", type)
                args.forEach { (key, value) -> payload.put(key, value) }
                try {
                    executor.execute {
                        try {
                            val connection = URL("$origin/event").openConnection() as HttpURLConnection
                            try {
                                connection.requestMethod = "POST"
                                connection.connectTimeout = 5000
                                connection.readTimeout = 8000
                                connection.instanceFollowRedirects = false
                                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                                connection.setRequestProperty("Authorization", "Bearer $idToken")
                                connection.doOutput = true
                                connection.outputStream.use {
                                    it.write(payload.toString().toByteArray(Charsets.UTF_8))
                                }
                                val http = connection.responseCode
                                val serverResponse = try {
                                    val input = if (http < 400) connection.inputStream else connection.errorStream
                                    input?.bufferedReader()?.use { it.readText().take(250) }.orEmpty()
                                } catch (_: Exception) { "" }
                                val status = try {
                                    JSONObject(serverResponse).optString("status", "")
                                } catch (_: Exception) { "" }
                                val detail = when (status) {
                                    "accepted_by_fcm" -> "FCM aceitou o envio; entrega ao aparelho não confirmada."
                                    "no_devices_or_duplicate" -> "Nenhum dispositivo elegível ou envio duplicado."
                                    "ignored" -> "Cloudflare ignorou o evento após validar o Firestore."
                                    "unauthorized" -> "Sessão do Firebase recusada pelo Cloudflare."
                                    "delivery_failed" -> "Firebase FCM recusou a entrega."
                                    "unavailable" -> "Cloudflare ou integração com Firebase indisponível."
                                    "disabled" -> "Envio de Push desativado no servidor."
                                    "capacity_limit" -> "Limite de destinatários no servidor."
                                    else -> "Resposta recebida do servidor."
                                }
                                record(actor.uid, "HTTP $http: $detail")
                            } finally {
                                connection.disconnect()
                            }
                        } catch (_: Exception) {
                            record(actor.uid, "Falha de conexão com Cloudflare (rede ou tempo limite).")
                        }
                    }
                } catch (_: RejectedExecutionException) {
                    record(actor.uid, "Fila de envio ocupada. Tente após alguns segundos.")
                }
            }.addOnFailureListener {
                record(actor.uid, "Não foi possível autenticar o envio no Firebase.")
            }
    }
}
