package br.com.atriocatolico

import android.os.Handler
import android.os.Looper
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.UUID
import java.util.concurrent.Executors

/**
 * O app não possui credenciais administrativas e não escolhe destinatários.
 * Somente Cloudflare valida o fundador, controla frequência e envia ao tópico FCM.
 */
internal object AdminBroadcastRelay {
    private val executor = Executors.newSingleThreadExecutor()
    private val main = Handler(Looper.getMainLooper())

    fun send(title: String, message: String, done: (String) -> Unit) {
        val origin = BuildConfig.PUSH_RELAY_URL
        if (!origin.matches(Regex("^https://[a-zA-Z0-9-]+\\.[a-zA-Z0-9-]+\\.workers\\.dev$"))) {
            done("broadcast_disabled")
            return
        }
        val actor = FirebaseAuth.getInstance().currentUser
        if (actor == null) {
            done("unauthorized")
            return
        }
        if (title.trim() != title || title.length !in 5..60 ||
            message.trim() != message || message.length !in 10..180 ||
            (title + message).any { it.isISOControl() }) {
            done("invalid_broadcast")
            return
        }
        val payload = JSONObject().put("title", title)
            .put("body", message)
            .put("requestId", UUID.randomUUID().toString()).toString()
        actor.getIdToken(false).addOnCompleteListener { idResult ->
            val token = if (idResult.isSuccessful) idResult.result?.token?.takeIf { it.isNotBlank() }
                else null
            if (token == null || FirebaseAuth.getInstance().currentUser?.uid != actor.uid) {
                done("unauthorized")
                return@addOnCompleteListener
            }
            executor.execute {
                val result = try {
                    val connection = URL("$origin/broadcast").openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "POST"
                        connection.instanceFollowRedirects = false
                        connection.connectTimeout = 5000
                        connection.readTimeout = 8000
                        connection.setRequestProperty("Authorization", "Bearer $token")
                        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        connection.doOutput = true
                        connection.outputStream.use {
                            it.write(payload.toByteArray(Charsets.UTF_8))
                        }
                        val stream = if (connection.responseCode < 400) {
                            connection.inputStream
                        } else connection.errorStream
                        val response = stream?.bufferedReader()?.use { it.readText().take(256) }.orEmpty()
                        JSONObject(response).optString("status", "unavailable")
                    } finally {
                        connection.disconnect()
                    }
                } catch (_: Exception) {
                    "unavailable"
                }
                main.post {
                    if (FirebaseAuth.getInstance().currentUser?.uid == actor.uid) done(result)
                    else done("unauthorized")
                }
            }
        }
    }
}
