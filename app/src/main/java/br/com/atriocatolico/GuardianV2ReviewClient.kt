package br.com.atriocatolico

import android.os.Handler
import android.os.Looper
import com.google.firebase.auth.FirebaseAuth
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import kotlin.concurrent.thread

/**
 * Decisão humana V2 não punitiva. SEM URL configurada, nenhuma rede/ação.
 * Nenhuma chave IAM é distribuída no APK; o Worker revalida Firebase/admin.
 */
internal object GuardianV2ReviewClient {
    private val validId = Regex("^guard_[a-f0-9]{32}$")
    private val allowedOrigin = Regex("^https://[a-zA-Z0-9-]+\\.[a-zA-Z0-9-]+\\.workers\\.dev$")

    fun configured(): Boolean = allowedOrigin.matches(BuildConfig.GUARDIAN_V2_WORKER_URL)

    fun resolve(
        expectedUid: String, caseId: String, action: String, note: String,
        callback: (Boolean, String) -> Unit
    ) {
        val main = Handler(Looper.getMainLooper())
        fun finish(ok: Boolean, message: String) {
            main.post { callback(ok, message) }
        }
        val actor = FirebaseAuth.getInstance().currentUser
        if (!configured() || actor == null || actor.uid != expectedUid ||
            !validId.matches(caseId) || action !in setOf("dismiss", "acknowledge") ||
            note.trim().length !in 5..300) {
            finish(false, "O Guardião V2 não está autorizado ou a sessão mudou.")
            return
        }
        actor.getIdToken(false).addOnSuccessListener { tokenResult ->
            val token = tokenResult.token
            if (token.isNullOrBlank() ||
                FirebaseAuth.getInstance().currentUser?.uid != expectedUid) {
                finish(false, "Sessão alterada. Entre novamente.")
                return@addOnSuccessListener
            }
            thread(name = "guardian-v2-human-resolution") {
                try {
                    val conn = URL(BuildConfig.GUARDIAN_V2_WORKER_URL + "/admin/resolve")
                        .openConnection() as HttpURLConnection
                    try {
                        conn.requestMethod = "POST"
                        conn.connectTimeout = 5000
                        conn.readTimeout = 8000
                        conn.instanceFollowRedirects = false
                        conn.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                        conn.setRequestProperty("Authorization", "Bearer " + token)
                        conn.doOutput = true
                        val payload = JSONObject()
                            .put("caseId", caseId)
                            .put("action", action)
                            .put("note", note.trim())
                        conn.outputStream.use {
                            it.write(payload.toString().toByteArray(Charsets.UTF_8))
                        }
                        val status = try {
                            val input = if (conn.responseCode < 400) conn.inputStream
                                else conn.errorStream
                            val body = input?.bufferedReader()?.use { it.readText().take(250) }.orEmpty()
                            JSONObject(body).optString("status")
                        } catch (_: Exception) { "" }
                        val success = conn.responseCode == 200 &&
                            status == (if (action == "dismiss") "dismissed" else "acknowledged")
                        if (FirebaseAuth.getInstance().currentUser?.uid != expectedUid) {
                            finish(false, "Sessão alterada. Resultado privado ocultado.")
                        } else {
                            finish(success, if (success) {
                                "Decisão registrada. Conteúdo preservado e autor avisado."
                            } else {
                                "Revisão não concluída. Confira autorização, versão e conexão."
                            })
                        }
                    } finally { conn.disconnect() }
                } catch (_: Exception) {
                    finish(false, "Falha de conexão; nenhuma decisão confirmada.")
                }
            }
        }.addOnFailureListener {
            finish(false, "Não foi possível confirmar a autenticação.")
        }
    }
}
