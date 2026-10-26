package br.com.atriocatolico

import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

/**
 * Comunica evento ja persistido ao relay gratuito, sem qualquer chave de serviço.
 * O relay valida Firebase Auth e consulta o Firestore: dados enviados pelo app
 * NUNCA são usados como prova de permissão/destinatário.
 * Falha de push não reverte nem afeta uma publicação ou uma denúncia.
 */
internal object InstantPushRelay {
    private val executor = ThreadPoolExecutor(
        1, 1, 30, TimeUnit.SECONDS,
        ArrayBlockingQueue(24), ThreadPoolExecutor.DiscardPolicy()
    )

    fun reply(postId: String, replyId: String) =
        post("reply", mapOf("postId" to postId, "replyId" to replyId))

    fun badgeRequest() = post("badge_request", emptyMap())

    fun badgeResult(targetUid: String) =
        post("badge_result", mapOf("targetUid" to targetUid))

    fun report(reportId: String) =
        post("report", mapOf("reportId" to reportId))

    private fun post(type: String, args: Map<String, String>) {
        val origin = BuildConfig.PUSH_RELAY_URL
        if (!origin.startsWith("https://") || !origin.endsWith(".workers.dev")) return
        val actor = FirebaseAuth.getInstance().currentUser ?: return
        if (args.values.any { it.isBlank() || it.length > 128 }) return
        actor.getIdToken(false).addOnSuccessListener { result ->
            val idToken = result.token?.takeIf { it.isNotBlank() } ?: return@addOnSuccessListener
            if (FirebaseAuth.getInstance().currentUser?.uid != actor.uid) return@addOnSuccessListener
            val payload = JSONObject().put("type", type)
            args.forEach { (key, value) -> payload.put(key, value) }
            executor.execute {
                try {
                    val connection = URL("$origin/event").openConnection() as HttpURLConnection
                    try {
                        connection.requestMethod = "POST"
                        connection.connectTimeout = 4000
                        connection.readTimeout = 4000
                        connection.instanceFollowRedirects = false
                        connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        connection.setRequestProperty("Authorization", "Bearer $idToken")
                        connection.doOutput = true
                        connection.outputStream.use {
                            it.write(payload.toString().toByteArray(Charsets.UTF_8))
                        }
                        connection.responseCode
                    } finally {
                        connection.disconnect()
                    }
                } catch (_: Exception) {
                    // Entrega best-effort. A central do Firestore continua como fonte oficial.
                }
            }
        }
    }
}
