package br.com.atriocatolico

import android.content.ClipData
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.core.content.FileProvider
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.withContext
import java.io.File
import java.io.FileOutputStream
import java.net.HttpURLConnection
import java.net.URI
import java.security.MessageDigest

/**
 * Download privado, com limite, cancelamento e validação antes de expor um APK
 * ao instalador do Android. Não usa permissões de armazenamento.
 */
internal object OtaApkDelivery {
    private val redirectHosts = setOf(
        "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"
    )
    private const val CONNECT_TIMEOUT_MS = 10_000
    private const val READ_TIMEOUT_MS = 10_000

    suspend fun download(
        context: Context,
        offer: OtaApkOffer,
        onProgress: suspend (Long) -> Unit
    ): File = withContext(Dispatchers.IO) {
        check(!BuildConfig.PLAY_STORE_BUILD) { "Distribuição Play não baixa APKs externos" }
        require(OtaApkPolicy.validSize(0, offer)) { "Tamanho do APK invalido" }
        val version = offer.versionName
        val expectedUrl = OtaUpdatePolicy.expectedAsset("v$version", "atrio-catolico.apk")
        require(offer.url == expectedUrl) { "Endereco do APK nao autorizado" }
        val folder = File(context.cacheDir, "ota")
        require(folder.isDirectory || folder.mkdirs()) { "Armazenamento indisponivel" }
        val target = File(folder, "atrio-catolico-ota.apk")
        val temporary = File(folder, "atrio-catolico-ota.part.apk")
        // Evita apresentar um APK de uma sessão anterior, mesmo após erro/cancelamento.
        target.delete()
        temporary.delete()
        var connection: HttpURLConnection? = null
        try {
            var uri = URI(offer.url)
            for (redirectCount in 0..5) {
                require(uri.scheme == "https" && uri.host in redirectHosts &&
                    uri.port == -1 && uri.rawUserInfo == null && uri.fragment == null) {
                    "Redirecionamento do APK nao autorizado"
                }
                if (uri.host == "github.com") {
                    require(uri.toString() == expectedUrl) { "Caminho de arquivo inesperado" }
                }
                connection = uri.toURL().openConnection() as HttpURLConnection
                connection.instanceFollowRedirects = false
                connection.connectTimeout = CONNECT_TIMEOUT_MS
                connection.readTimeout = READ_TIMEOUT_MS
                connection.setRequestProperty("User-Agent", "Atrio-Catolico-OTA")
                val status = connection.responseCode
                if (status in listOf(301, 302, 303, 307, 308)) {
                    require(redirectCount < 5) { "Limite de redirecionamentos" }
                    val next = connection.getHeaderField("Location")
                        ?: error("Endereco de redirecionamento ausente")
                    uri = uri.resolve(next)
                    connection.disconnect()
                    connection = null
                    continue
                }
                require(status == 200) { "Arquivo indisponivel no GitHub" }
                val declaredBytes = connection.contentLengthLong
                require(declaredBytes == -1L || declaredBytes == offer.sizeBytes) {
                    "Tamanho declarado nao corresponde ao release"
                }
                val sha = MessageDigest.getInstance("SHA-256")
                var transferred = 0L
                var lastNotified = 0L
                connection.inputStream.use { input ->
                    FileOutputStream(temporary).use { output ->
                        val buffer = ByteArray(32 * 1024)
                        while (true) {
                            currentCoroutineContext().ensureActive()
                            val n = input.read(buffer)
                            if (n == -1) break
                            transferred += n
                            require(OtaApkPolicy.validSize(transferred, offer)) {
                                "APK excede o tamanho aprovado"
                            }
                            output.write(buffer, 0, n)
                            sha.update(buffer, 0, n)
                            if (transferred - lastNotified >= 512 * 1024 ||
                                transferred == offer.sizeBytes) {
                                lastNotified = transferred
                                onProgress(transferred)
                            }
                        }
                        output.fd.sync()
                    }
                }
                val fileHash = sha.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
                require(transferred == offer.sizeBytes && fileHash == offer.sha256) {
                    "Integridade do APK invalida"
                }
                currentCoroutineContext().ensureActive()
                validate(context, offer, temporary)
                require(temporary.renameTo(target)) { "Nao foi possivel preparar o instalador" }
                return@withContext target
            }
            error("Nao foi possivel seguir redirecionamentos")
        } catch (cancelled: CancellationException) {
            throw cancelled
        } finally {
            connection?.disconnect()
            temporary.delete()
        }
    }

    /**
     * Also called immediately before installation to detect changes in cache,
     * upgrades since download and certificate mismatch.
     */
    fun validate(context: Context, offer: OtaApkOffer, apk: File) {
        check(!BuildConfig.PLAY_STORE_BUILD) { "Distribuição Play não valida APKs externos" }
        require(apk.isFile && apk.length() == offer.sizeBytes) { "Arquivo nao encontrado ou incompleto" }
        require(apk.canonicalFile.parentFile == File(context.cacheDir, "ota").canonicalFile) {
            "Arquivo fora da pasta privada"
        }
        val sha = MessageDigest.getInstance("SHA-256")
        apk.inputStream().use { input ->
            val buffer = ByteArray(32 * 1024)
            while (true) {
                val n = input.read(buffer)
                if (n < 0) break
                sha.update(buffer, 0, n)
            }
        }
        val digest = sha.digest().joinToString("") { "%02x".format(it.toInt() and 0xff) }
        @Suppress("DEPRECATION")
        val flags = if (Build.VERSION.SDK_INT >= 28)
            PackageManager.GET_SIGNING_CERTIFICATES else PackageManager.GET_SIGNATURES
        val pm = context.packageManager
        @Suppress("DEPRECATION")
        val installed = pm.getPackageInfo(context.packageName, flags)
        @Suppress("DEPRECATION")
        val archive = pm.getPackageArchiveInfo(apk.absolutePath, flags)
            ?: error("Pacote Android invalido")
        @Suppress("DEPRECATION")
        fun fingerprints(info: android.content.pm.PackageInfo): List<String> {
            val certs = if (Build.VERSION.SDK_INT >= 28)
                info.signingInfo?.apkContentsSigners else info.signatures
            return certs?.map { cert ->
                MessageDigest.getInstance("SHA-256").digest(cert.toByteArray())
                    .joinToString("") { "%02x".format(it.toInt() and 0xff) }
            }.orEmpty()
        }
        val installedCerts = fingerprints(installed)
        val archiveCerts = fingerprints(archive)
        require(installedCerts.size == 1 && archiveCerts.size == 1) {
            "Identidade de assinatura nao verificavel"
        }
        @Suppress("DEPRECATION")
        val currentCode = if (Build.VERSION.SDK_INT >= 28)
            installed.longVersionCode else installed.versionCode.toLong()
        @Suppress("DEPRECATION")
        val candidateCode = if (Build.VERSION.SDK_INT >= 28)
            archive.longVersionCode else archive.versionCode.toLong()
        require(OtaApkPolicy.accept(offer, apk.length(), digest,
            archive.packageName.orEmpty(), candidateCode,
            archive.versionName.orEmpty(), archiveCerts.single(), currentCode,
            installedCerts.single())) { "APK nao autorizado para atualizar esta instalacao" }
        // O instalador do sistema executara a verificacao definitiva da assinatura APK.
    }

    /**
     * Must be invoked after validate(), on explicit user tap, from the main thread.
     * Unknown-sources consent and final install confirmation belong to Android.
     */
    fun requestInstall(context: Context, apk: File): Boolean {
        check(!BuildConfig.PLAY_STORE_BUILD) { "Instalação externa proibida na variante Play" }
        if (!context.packageManager.canRequestPackageInstalls()) {
            val settings = Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES,
                Uri.parse("package:${context.packageName}"))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            context.startActivity(settings)
            return false
        }
        val uri = FileProvider.getUriForFile(context,
            "${context.packageName}.ota.fileprovider", apk)
        val intent = Intent(Intent.ACTION_INSTALL_PACKAGE).apply {
            setDataAndType(uri, "application/vnd.android.package-archive")
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_ACTIVITY_NEW_TASK)
            clipData = ClipData.newUri(context.contentResolver, "Atualizacao oficial do Atrio", uri)
        }
        context.startActivity(intent)
        return true
    }
}
