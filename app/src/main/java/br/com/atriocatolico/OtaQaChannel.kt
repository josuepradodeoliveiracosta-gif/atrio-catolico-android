package br.com.atriocatolico

import java.net.URI

/**
 * Exclusivamente para homologacao em APK Debug criado com
 * ATRIO_OTA_QA_LOOPBACK=1. O Release e o Debug normal usam sempre GitHub.
 *
 * No celular, Termux hospeda os fixtures no loopback da propria maquina.
 * No emulador, adb reverse tcp:8765 tcp:8765 liga o Android ao host do CI.
 * Nao existe canal remoto de QA nem credenciais neste aplicativo.
 */
internal object OtaQaChannel {
    const val ORIGIN = "http://127.0.0.1:8765"
    val active: Boolean get() = BuildConfig.DEBUG && BuildConfig.OTA_QA_LOOPBACK

    fun isAllowedUri(uri: URI, productionHosts: Set<String>): Boolean {
        if (uri.rawUserInfo != null || uri.rawFragment != null ||
            uri.rawPath.isNullOrBlank()) return false
        return if (active) {
            // No laboratorio, nenhum token, query, redirect ou host externo.
            // Em producao, redirects assinados do CDN GitHub podem ter query.
            uri.rawQuery == null && uri.scheme == "http" &&
                uri.host == "127.0.0.1" && uri.port == 8765
        } else {
            uri.scheme == "https" && uri.host in productionHosts && uri.port == -1
        }
    }
}
