package br.com.atriocatolico

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import java.io.IOException
import java.net.Proxy
import java.net.URL
import java.util.concurrent.ExecutionException
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException
import javax.net.ssl.HttpsURLConnection
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONException
import org.json.JSONObject

internal sealed interface ProfileV3Discussion {
    data object NoLink : ProfileV3Discussion
    data object Unavailable : ProfileV3Discussion
    data class Available(val postId: String, val title: String) : ProfileV3Discussion
}

internal fun interface ProfileV3DiscussionResolver {
    suspend fun resolve(viewer: FirebaseUser, profileUid: String, interest: ProfileV3Interest): ProfileV3Discussion
}

internal class ProfileV3DiscussionClient(
    private val auth: FirebaseAuth,
    private val origin: String = BuildConfig.PUSH_RELAY_URL
) : ProfileV3DiscussionResolver {
    override suspend fun resolve(
        viewer: FirebaseUser, profileUid: String, interest: ProfileV3Interest
    ): ProfileV3Discussion = withContext(Dispatchers.IO) {
        val unavailable = ProfileV3Discussion.Unavailable
        if (auth.currentUser !== viewer || !profileV3DocumentId.matches(profileUid) ||
            !trustedOrigin.matches(origin)) return@withContext unavailable
        try {
            val token = Tasks.await(viewer.getIdToken(false), 5, TimeUnit.SECONDS).token
            if (token.isNullOrBlank() || auth.currentUser !== viewer) return@withContext unavailable
            val connection = URL("$origin/profile-v3/interest-discussion")
                .openConnection(Proxy.NO_PROXY) as HttpsURLConnection
            try {
                connection.instanceFollowRedirects = false
                connection.useCaches = false
                connection.connectTimeout = 4_000
                connection.readTimeout = 5_000
                connection.requestMethod = "POST"
                connection.doOutput = true
                connection.setRequestProperty("Authorization", "Bearer $token")
                connection.setRequestProperty("Content-Type", "application/json; charset=utf-8")
                connection.setRequestProperty("Cache-Control", "no-store")
                connection.setRequestProperty("Accept", "application/json")
                val request = JSONObject().put("profileUid", profileUid).put("interestKey", interest.id)
                connection.outputStream.use { it.write(request.toString().toByteArray(Charsets.UTF_8)) }
                if (connection.responseCode != 200) return@withContext unavailable
                val response = readInboxJson(connection.inputStream)
                if (auth.currentUser !== viewer) unavailable else profileV3DiscussionResponse(response)
            } finally {
                connection.disconnect()
            }
        } catch (_: IOException) {
            unavailable
        } catch (_: JSONException) {
            unavailable
        } catch (_: ExecutionException) {
            unavailable
        } catch (_: TimeoutException) {
            unavailable
        }
    }

    private companion object {
        val trustedOrigin = Regex("^https://[a-zA-Z0-9-]+\\.[a-zA-Z0-9-]+\\.workers\\.dev$")
    }
}

internal fun profileV3DiscussionResponse(body: JSONObject?): ProfileV3Discussion {
    if (body == null) return ProfileV3Discussion.Unavailable
    return when (body.opt("status")) {
        "no_link" -> ProfileV3Discussion.NoLink
        "available" -> {
            val id = (body.opt("postId") as? String)?.takeIf(profileV3DocumentId::matches)
            val title = (body.opt("title") as? String)?.takeIf { it.isNotBlank() }
            if (id == null || title == null) ProfileV3Discussion.Unavailable
            else ProfileV3Discussion.Available(id, title)
        }
        else -> ProfileV3Discussion.Unavailable
    }
}
