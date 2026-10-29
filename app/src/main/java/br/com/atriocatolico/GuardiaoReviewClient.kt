package br.com.atriocatolico

import android.os.Handler
import android.os.Looper
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Decisões do Guardião: nunca usar SDK privilegiado no Android.
 * A autorização é validada novamente no Worker e as escritas são atômicas.
 */
internal object GuardiaoReviewClient {
    private val validCase = Regex("^guard_[a-f0-9]{32}$")

    fun decide(caseId: String, restore: Boolean, note: String, callback: (Boolean, String) -> Unit) {
        val main = Handler(Looper.getMainLooper())
        fun finish(ok: Boolean, message: String) {
            main.post { callback(ok, message) }
        }
        val actor = FirebaseAuth.getInstance().currentUser
        val origin = BuildConfig.PUSH_RELAY_URL
        if (actor == null || !validCase.matches(caseId) ||
            note.trim().length !in 5..300 ||
            !origin.startsWith("https://") || !origin.endsWith(".workers.dev")) {
            finish(false, "Dados ou sessão inválidos.")
            return
        }
        actor.getIdToken(false).addOnSuccessListener { result ->
            val token = result.token
            if (token.isNullOrBlank() || FirebaseAuth.getInstance().currentUser?.uid != actor.uid) {
                finish(false, "Sessão alterada. Entre novamente.")
                return@addOnSuccessListener
            }
            thread(name = "atrio-guardiao-review") {
                try {
                    val conn = URL("$origin/moderation/review").openConnection() as HttpURLConnection
                    try {
                        conn.requestMethod = "POST"
                        conn.connectTimeout = 5000
                        conn.readTimeout = 8000
                        conn.instanceFollowRedirects = false
                        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        conn.setRequestProperty("Authorization", "Bearer $token")
                        conn.doOutput = true
                        val payload = JSONObject()
                            .put("caseId", caseId)
                            .put("action", if (restore) "restore" else "confirm")
                            .put("note", note.trim())
                        conn.outputStream.use { it.write(payload.toString().toByteArray(Charsets.UTF_8)) }
                        val code = conn.responseCode
                        val body = try {
                            (if (code < 400) conn.inputStream else conn.errorStream)
                                ?.bufferedReader()?.use { it.readText().take(250) }.orEmpty()
                        } catch (_: Exception) { "" }
                        val status = try { JSONObject(body).optString("status") }
                            catch (_: Exception) { "" }
                        val success = code == 200 && status in setOf("restored", "confirmed_removed")
                        finish(success, if (success) {
                            if (restore) "Publicação restaurada e decisão registrada."
                            else "Remoção confirmada e decisão registrada."
                        } else when (status) {
                            "not_admin", "self_review_forbidden" -> "Sem permissão para decidir este caso."
                            "parent_missing" -> "A discussão principal não existe; restauração bloqueada."
                            "already_reviewed", "review_conflict" -> "O caso mudou. Reabra para conferir."
                            "invalid_archive", "inconsistent_case" -> "Arquivo de moderação inconsistente."
                            else -> "Não foi possível concluir. Nenhuma decisão foi confirmada."
                        })
                    } finally { conn.disconnect() }
                } catch (_: Exception) {
                    finish(false, "Falha de conexão. Confira a rede e tente novamente.")
                }
            }
        }.addOnFailureListener { finish(false, "Falha ao autenticar com Firebase.") }
    }
}
