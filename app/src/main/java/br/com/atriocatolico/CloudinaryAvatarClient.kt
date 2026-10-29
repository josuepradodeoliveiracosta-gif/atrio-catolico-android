package br.com.atriocatolico

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URL
import java.util.concurrent.TimeUnit

/**
 * O APK nunca recebe Cloudinary API Secret. Toda operação passa pelo Worker,
 * que valida o Firebase ID token e o UID no servidor.
 *
 * Os endpoints são inativos até ATRIO_AVATAR_WORKER_URL ser definido no build.
 */
internal object CloudinaryAvatarClient {
    val enabled: Boolean get() = BuildConfig.AVATAR_WORKER_URL.isNotBlank()

    suspend fun upload(uid: String, photo: Bitmap): String = withContext(Dispatchers.IO) {
        val image = ProfilePhotoStore.encodeUpload(photo)
        request(uid, "/avatar/upload", "POST", image)
    }

    suspend fun status(uid: String): String = withContext(Dispatchers.IO) {
        request(uid, "/avatar/status", "POST", null)
    }

    suspend fun remove(uid: String): String = withContext(Dispatchers.IO) {
        request(uid, "/avatar", "DELETE", null)
    }

    suspend fun moderateRemove(actorUid: String, targetUid: String, reason: String): String =
        withContext(Dispatchers.IO) {
            check(Regex("^[A-Za-z0-9_-]{1,128}$").matches(targetUid)) { "UID inválido." }
            require(reason.trim().length in 5..100) { "Informe o motivo da remoção." }
            request(actorUid, "/avatar/moderate", "POST", null,
                JSONObject().put("uid", targetUid).put("reason", reason.trim()).toString())
        }


    internal data class PendingAvatar(val uid: String, val createdAt: Long, val status: String)

    /** Fila administrativa: retornada somente a administradores autenticados. */
    suspend fun moderationPending(actorUid: String): List<PendingAvatar> = withContext(Dispatchers.IO) {
        val conn = adminConnection(actorUid, "/avatar/moderation/pending", "GET", "application/json")
        try {
            val code = conn.responseCode
            check(code == 200) {
                if (code == 403) "Sua conta não tem permissão para analisar fotos."
                else "Não foi possível carregar as fotos pendentes."
            }
            val json = conn.inputStream.use { it.bufferedReader().readText().take(20000) }
            val arr = JSONObject(json).getJSONArray("photos")
            buildList {
                for (i in 0 until minOf(arr.length(), 40)) {
                    val item = arr.getJSONObject(i)
                    val target = item.optString("uid")
                    val status = item.optString("status")
                    if (Regex("^[A-Za-z0-9_-]{1,128}$").matches(target) &&
                        status in setOf("pending", "approved")) {
                        add(PendingAvatar(target, item.optLong("createdAt"), status))
                    }
                }
            }
        } finally {
            conn.disconnect()
        }
    }

    /** A imagem protegida é entregue pelo Worker ao administrador; nunca há URL pública. */
    suspend fun moderationPreview(actorUid: String, targetUid: String): Bitmap? =
        withContext(Dispatchers.IO) {
            require(Regex("^[A-Za-z0-9_-]{1,128}$").matches(targetUid))
            val conn = adminConnection(actorUid, "/avatar/moderation/preview?uid=$targetUid",
                "GET", "image/jpeg")
            try {
                if (conn.responseCode != 200 ||
                    !conn.contentType.orEmpty().startsWith("image/jpeg") ||
                    conn.contentLengthLong > 350_000L) return@withContext null
                val output = ByteArrayOutputStream()
                conn.inputStream.use { stream ->
                    val buffer = ByteArray(8192)
                    while (true) {
                        val count = stream.read(buffer)
                        if (count < 0) break
                        if (output.size() + count > 350_000) return@withContext null
                        output.write(buffer, 0, count)
                    }
                }
                val bytes = output.toByteArray()
                val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
                if (bounds.outWidth !in 1..1000 || bounds.outHeight !in 1..1000)
                    return@withContext null
                BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
            } finally { conn.disconnect() }
        }

    suspend fun moderationReview(actorUid: String, targetUid: String, approve: Boolean,
                                 reason: String): String = withContext(Dispatchers.IO) {
        require(Regex("^[A-Za-z0-9_-]{1,128}$").matches(targetUid)) { "Conta inválida." }
        require(reason.trim().length in 5..100) { "Informe o motivo (5 a 100 caracteres)." }
        request(actorUid, "/avatar/moderation/review", "POST", null, JSONObject()
            .put("uid", targetUid)
            .put("action", if (approve) "approved" else "rejected")
            .put("reason", reason.trim()).toString())
    }

    private fun adminConnection(uid: String, path: String, method: String,
                                accept: String): HttpURLConnection {
        check(enabled) { "Serviço de fotografias indisponível." }
        val actor = FirebaseAuth.getInstance().currentUser
        check(actor != null && actor.uid == uid) { "Sessão inválida. Entre novamente." }
        val token = Tasks.await(actor.getIdToken(false), 15, TimeUnit.SECONDS).token
        check(!token.isNullOrBlank()) { "Autenticação expirada." }
        return (URL(BuildConfig.AVATAR_WORKER_URL + path).openConnection() as HttpURLConnection).apply {
            requestMethod = method
            connectTimeout = 15000
            readTimeout = 25000
            instanceFollowRedirects = false
            setRequestProperty("Authorization", "Bearer $token")
            setRequestProperty("Accept", accept)
            setRequestProperty("Cache-Control", "no-store")
        }
    }

    private fun request(uid: String, path: String, method: String, image: ByteArray?,
                        jsonPayload: String? = null): String {
        check(enabled) { "O serviço de fotografias públicas ainda não está configurado." }
        val user = FirebaseAuth.getInstance().currentUser
        check(user != null && user.uid == uid) { "Entre novamente na sua conta." }
        val token = Tasks.await(user.getIdToken(false), 15, TimeUnit.SECONDS).token
        check(!token.isNullOrBlank()) { "Sua autenticação expirou." }

        // Host do Worker é validado em tempo de compilação no Gradle.
        val connection = URL(BuildConfig.AVATAR_WORKER_URL + path).openConnection() as HttpURLConnection
        return try {
            connection.requestMethod = method
            connection.connectTimeout = 15000
            connection.readTimeout = 25000
            connection.setRequestProperty("Authorization", "Bearer " + token)
            connection.setRequestProperty("Accept", "application/json")
            connection.setRequestProperty("Cache-Control", "no-store")
            if (image != null) {
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "image/jpeg")
                connection.setFixedLengthStreamingMode(image.size)
                connection.outputStream.use { it.write(image) }
            } else if (jsonPayload != null) {
                val data = jsonPayload.toByteArray(Charsets.UTF_8)
                connection.doOutput = true
                connection.setRequestProperty("Content-Type", "application/json")
                connection.setFixedLengthStreamingMode(data.size)
                connection.outputStream.use { it.write(data) }
            }
            val code = connection.responseCode
            val stream = if (code in 200..299) connection.inputStream else connection.errorStream
            val reply = stream?.use { it.bufferedReader().readText().take(1000) }.orEmpty()
            val state = runCatching { JSONObject(reply).optString("status") }.getOrDefault("")
            check(code in 200..299) {
                when(code) {
                    401 -> "Entre novamente na sua conta."
                    403 -> "Sem permissão para moderar fotografias."
                    409 -> "Outra alteração da foto está em andamento. Tente novamente."
                    413 -> "Imagem inválida ou maior que o limite de 5 MB."
                    429 -> "Aguarde um minuto para enviar outra foto."
                    502 -> when (state) {
                        "cloudinary_signature_invalid", "cloudinary_credentials_invalid" ->
                            "Falha na configuração das chaves do Cloudinary. Informe o administrador."
                        "cloudinary_protection_failed" ->
                            "Envio cancelado por segurança: Cloudinary não confirmou proteção da imagem."
                        "cloudinary_moderation_error" ->
                            "Moderação Cloudinary não disponível ou mal configurada."
                        "cloudinary_file_error" ->
                            "O Cloudinary rejeitou o arquivo. Escolha outra foto."
                        "cloudinary_preset_error" ->
                            "Configuração de envio do Cloudinary inválida."
                        else -> "Cloudinary rejeitou o envio ($state). Informe o administrador."
                    }
                    503 -> "O serviço de fotos apresentou erro interno. Informe o administrador."
                    else -> "Serviço de fotos temporariamente indisponível."
                }
            }
            check(state.isNotBlank()) { "Resposta inválida do serviço de fotos." }
            state
        } finally {
            connection.disconnect()
        }
    }
}
