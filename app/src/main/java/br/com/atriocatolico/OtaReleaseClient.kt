package br.com.atriocatolico

import android.content.Context
import android.content.pm.PackageManager
import android.os.Build
import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

/**
 * Consultas públicas e de leitura do GitHub; nunca usa token de conta do usuário.
 * Sem DownloadManager, REQUEST_INSTALL_PACKAGES, FileProvider ou instalação.
 */
internal object OtaReleaseClient {
    private val allowedAssetHosts = setOf(
        "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
    )
    private const val API_RESPONSE_LIMIT = 262_144
    private const val MANIFEST_RESPONSE_LIMIT = 32_768

    fun check(context: Context): OtaCheckStatus {
        if (BuildConfig.PLAY_STORE_BUILD) return OtaCheckStatus.PlayStore
        if (BuildConfig.DEBUG) return OtaCheckStatus.TestBuild
        return try {
            val api = fetchText(OtaUpdatePolicy.API, API_RESPONSE_LIMIT, setOf("api.github.com"))
            if (api.first == 404) return OtaCheckStatus.NoRelease
            if (api.first != 200) return OtaCheckStatus.Unavailable

            val release = JSONObject(api.second)
            val tag = release.getString("tag_name")
            if (!Regex("""v[0-9]+\.[0-9]+\.[0-9]+""").matches(tag)) {
                return OtaCheckStatus.Unavailable
            }
            val assets = release.getJSONArray("assets")
            val urls = (0 until assets.length()).map { index ->
                val item = assets.getJSONObject(index)
                item.getString("name") to item.getString("browser_download_url")
            }
            val manifestLinks = urls.filter { it.first == "update.json" }
            val apkLinks = urls.filter { it.first == "atrio-catolico.apk" }
            if (manifestLinks.size != 1 || apkLinks.size != 1) {
                return OtaCheckStatus.Unavailable
            }
            val remote = OtaRemoteRelease(
                tag = tag,
                page = release.getString("html_url"),
                manifestUrl = manifestLinks.single().second,
                apkUrl = apkLinks.single().second,
                draft = release.getBoolean("draft"),
                prerelease = release.getBoolean("prerelease")
            )
            if (remote.draft || remote.prerelease ||
                remote.page != OtaUpdatePolicy.expectedPage(tag) ||
                remote.manifestUrl != OtaUpdatePolicy.expectedAsset(tag, "update.json") ||
                remote.apkUrl != OtaUpdatePolicy.expectedAsset(tag, "atrio-catolico.apk")) {
                return OtaCheckStatus.Unavailable
            }
            val manifestResponse = fetchText(
                remote.manifestUrl, MANIFEST_RESPONSE_LIMIT, allowedAssetHosts
            )
            if (manifestResponse.first != 200) return OtaCheckStatus.Unavailable
            val data = JSONObject(manifestResponse.second)
            val manifest = OtaManifest(
                schemaVersion = data.getInt("schemaVersion"),
                channel = data.getString("channel"),
                applicationId = data.getString("applicationId"),
                versionName = data.getString("versionName"),
                versionCode = data.getLong("versionCode"),
                mandatory = data.getBoolean("mandatory"),
                minimumAndroidSdk = data.getInt("minimumAndroidSdk"),
                apkAsset = data.getString("apkAsset"),
                apkSizeBytes = data.getLong("apkSizeBytes"),
                apkSha256 = data.getString("apkSha256"),
                certificateSha256 = data.getString("certificateSha256"),
                downloadUrl = data.getString("downloadUrl"),
                releasePageUrl = data.getString("releasePageUrl"),
                releaseNotes = data.getString("releaseNotes")
            )
            @Suppress("DEPRECATION")
            val packageFlags = if (Build.VERSION.SDK_INT >= 28)
                PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
            val installed = context.packageManager.getPackageInfo(context.packageName, packageFlags)
            @Suppress("DEPRECATION")
            val signers = if (Build.VERSION.SDK_INT >= 28)
                installed.signingInfo?.apkContentsSigners else installed.signatures
            if (signers == null || signers.size != 1) return OtaCheckStatus.Unavailable
            val installedFingerprint = MessageDigest.getInstance("SHA-256")
                .digest(signers.single().toByteArray()).joinToString("") {
                    "%02x".format(it.toInt() and 0xff)
                }
            @Suppress("DEPRECATION")
            val installedCode = if (Build.VERSION.SDK_INT >= 28)
                installed.longVersionCode else installed.versionCode.toLong()
            OtaUpdatePolicy.evaluate(
                remote, manifest, installedCode, installedFingerprint, Build.VERSION.SDK_INT
            )
        } catch (_: Exception) {
            // Never show GitHub response text, redirect URLs or exception details to users.
            OtaCheckStatus.Unavailable
        }
    }

    /**
     * Manual redirects and exact HTTPS host allowlists prevent manifest redirects
     * to arbitrary third-party servers (and HTTP downgrade).
     */
    private fun fetchText(url: String, maxBytes: Int, allowedHosts: Set<String>): Pair<Int, String> {
        var uri = URI(url)
        repeat(6) { redirectCount ->
            require(uri.scheme == "https" && uri.host in allowedHosts &&
                    uri.userInfo == null && uri.port == -1 && uri.fragment == null) {
                "OTA: destino nao autorizado"
            }
            val connection = (uri.toURL().openConnection() as HttpURLConnection)
            try {
                connection.instanceFollowRedirects = false
                connection.connectTimeout = 5000
                connection.readTimeout = 8000
                connection.setRequestProperty("Accept", "application/vnd.github+json")
                connection.setRequestProperty("User-Agent", "Atrio-Catolico-OTA-Check")
                val status = connection.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    check(redirectCount < 5) { "OTA: redirecionamentos excedidos" }
                    val location = connection.getHeaderField("Location")
                        ?: error("OTA: redirecionamento sem destino")
                    uri = uri.resolve(location)
                } else if (status == 404) {
                    return status to ""
                } else if (status != 200) {
                    return status to ""
                } else {
                    val buffer = ByteArray(4096)
                    val bytes = ByteArrayOutputStream()
                    connection.inputStream.use { stream ->
                        while (true) {
                            val count = stream.read(buffer)
                            if (count == -1) break
                            require(bytes.size() + count <= maxBytes) { "OTA: resposta muito grande" }
                            bytes.write(buffer, 0, count)
                        }
                    }
                    return status to bytes.toString(Charsets.UTF_8.name())
                }
            } finally {
                connection.disconnect()
            }
        }
        error("OTA: nao foi possivel validar o destino")
    }
}
