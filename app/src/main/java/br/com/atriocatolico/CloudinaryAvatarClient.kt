package br.com.atriocatolico

import android.graphics.Bitmap
import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONObject
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
