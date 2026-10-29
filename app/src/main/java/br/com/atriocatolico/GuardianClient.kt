package br.com.atriocatolico

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL

/** Nenhuma credencial administrativa fica no APK. O Worker revalida a permissão. */
internal object GuardianClient {
    val configured: Boolean get() = BuildConfig.GUARDIAN_WORKER_URL.startsWith("https://")
    suspend fun call(uid: String, route: String, payload: JSONObject): String = withContext(Dispatchers.IO) {
        require(route in setOf("/admin/config", "/admin/review")) { "Rota inválida." }
        require(configured) { "Servidor Guardião V2 ainda não configurado no APK de testes." }
        val auth = FirebaseAuth.getInstance()
        val actor = auth.currentUser ?: error("Sessão expirada.")
        check(actor.uid == uid) { "Sessão alterada." }
        val token = Tasks.await(actor.getIdToken(false)).token
        check(!token.isNullOrBlank() && auth.currentUser?.uid == uid) { "Autenticação inválida." }
        val url = URL(BuildConfig.GUARDIAN_WORKER_URL + route)
        val conn = (url.openConnection() as HttpURLConnection)
        try {
            conn.requestMethod = "POST"
            conn.connectTimeout = 6000
            conn.readTimeout = 9000
            conn.instanceFollowRedirects = false
            conn.setRequestProperty("Authorization", "Bearer $token")
            conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
            conn.doOutput = true
            val bytes = payload.toString().toByteArray(Charsets.UTF_8)
            require(bytes.size <= 2048) { "Mensagem excessivamente longa." }
            conn.outputStream.use { it.write(bytes) }
            val status = conn.responseCode
            val stream = if (status < 400) conn.inputStream else conn.errorStream
            val data = stream?.use { input ->
                val buf = ByteArray(4096)
                val length = input.read(buf)
                if (length > 0) String(buf, 0, length, Charsets.UTF_8) else "{}"
            }.orEmpty()
            val result = runCatching { JSONObject(data).optString("status") }.getOrDefault("")
            check(auth.currentUser?.uid == uid) { "Sessão alterada." }
            if (status != 200 || result !in setOf("updated", "restored", "confirmed")) {
                error(when(result) {
                    "forbidden" -> "Você não possui permissão administrativa."
                    "not_configured" -> "O servidor ainda não está configurado."
                    "config_not_initialized" -> "Configurações do Guardião não inicializadas."
                    "not_pending" -> "Este caso já foi analisado."
                    else -> "A operação não foi confirmada pelo servidor."
                })
            }
            result
        } finally { conn.disconnect() }
    }
}
