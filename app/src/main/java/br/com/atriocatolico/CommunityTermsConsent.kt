package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges

/**
 * Somente endereços HTTPS públicos e sem parâmetros para a política UGC.
 * Um link com login, token, redirecionamento por URL ou domínio de QA não
 * pode ser apresentado como Termos oficiais, mesmo se o Admin errar a config.
 * Não realiza nenhuma requisição de rede.
 */
internal fun validCommunityTermsUrl(value: String): Boolean {
    if (value.length !in 12..2048 ||
        value.any { it.code <= 31 || it == '\\' || it == '"' || it == '\'' }) return false
    val uri = runCatching { java.net.URI(value) }.getOrNull() ?: return false
    if (uri.scheme != "https" || uri.rawUserInfo != null ||
        uri.rawQuery != null || uri.rawFragment != null ||
        (uri.port != -1 && uri.port != 443)) return false
    val host = uri.host?.lowercase(java.util.Locale.ROOT) ?: return false
    if (!Regex("^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\\.)+[a-z]{2,24}$")
        .matches(host)) return false
    if (host in setOf("example.com", "example.org", "example.net",
            "atrio-catolico-privacidade-qa.pages.dev") ||
        listOf(".localhost", ".local", ".invalid", ".test", ".example",
            ".example.com", ".example.org", ".example.net").any { host.endsWith(it) })
        return false
    return true
}

internal data class CommunityTermsPolicy(
    val version: String, val url: String, val required: Boolean, val published: Boolean
) {
    val available get() = required && published
        && version.matches(Regex("community-v[1-9][0-9]{0,3}"))
        && validCommunityTermsUrl(url)
}

internal data class CommunityTermsStatus(
    val loaded: Boolean = false,
    val failed: Boolean = false,
    val policy: CommunityTermsPolicy? = null,
    val accepted: Boolean = false,
    val acceptanceLoaded: Boolean = false
) {
    val required get() = policy?.required == true
    val canPublish get() = loaded && !failed && (
        (!required && !BuildConfig.PLAY_STORE_BUILD)
        || (policy?.available == true && acceptanceLoaded && accepted)
    )
}

/** Status remoto, sempre isolado pelo UID da sessao; cache local nunca prova aceite. */
@Composable
internal fun rememberCommunityTermsStatus(
    db: FirebaseFirestore, uid: String
): CommunityTermsStatus {
    var policy by remember(uid) { mutableStateOf<CommunityTermsPolicy?>(null) }
    var loaded by remember(uid) { mutableStateOf(false) }
    var failed by remember(uid) { mutableStateOf(false) }
    val auth = FirebaseAuth.getInstance()

    DisposableEffect(db, uid) {
        val registration = db.document("app_config/community_terms")
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                if (auth.currentUser?.uid != uid) return@addSnapshotListener
                if (error != null) {
                    loaded = false
                    failed = true
                    policy = null
                } else if (snapshot != null && !snapshot.metadata.isFromCache
                    && !snapshot.metadata.hasPendingWrites()) {
                    policy = if (snapshot.exists()) CommunityTermsPolicy(
                        version = snapshot.getString("version").orEmpty(),
                        url = snapshot.getString("url").orEmpty(),
                        required = snapshot.getBoolean("enforce") == true,
                        published = snapshot.getBoolean("published") == true
                    ) else null
                    loaded = true
                    failed = false
                }
            }
        onDispose { registration.remove() }
    }

    val version = policy?.version.orEmpty()
    val needsAcceptance = policy?.required == true && policy?.available == true
    var accepted by remember(uid, version) { mutableStateOf(false) }
    var acceptanceLoaded by remember(uid, version) { mutableStateOf(false) }
    DisposableEffect(db, uid, version, needsAcceptance) {
        if (!needsAcceptance) {
            accepted = false
            acceptanceLoaded = false
            onDispose { }
        } else {
            val registration = db.collection("users").document(uid)
                .collection("acceptedTerms").document(version)
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                    if (auth.currentUser?.uid != uid) return@addSnapshotListener
                    if (error != null) {
                        accepted = false
                        acceptanceLoaded = false
                    } else if (snapshot != null && !snapshot.metadata.isFromCache
                        && !snapshot.metadata.hasPendingWrites()) {
                        accepted = snapshot.exists()
                            && snapshot.getString("version") == version
                        acceptanceLoaded = true
                    }
                }
            onDispose { registration.remove() }
        }
    }
    return CommunityTermsStatus(
        loaded = loaded, failed = failed, policy = policy,
        accepted = accepted, acceptanceLoaded = acceptanceLoaded
    )
}

/** Nunca exibe minuta como Termos oficiais, nem aceita sem URL publicada. */
@Composable
internal fun CommunityTermsConsent(
    db: FirebaseFirestore,
    uid: String,
    status: CommunityTermsStatus
) {
    val policy = status.policy
    val uriHandler = LocalUriHandler.current
    var confirmed by remember(uid, policy?.version, policy?.url) { mutableStateOf(false) }
    var busy by remember(uid, policy?.version) { mutableStateOf(false) }
    var info by remember(uid, policy?.version) { mutableStateOf("") }
    Card(Modifier.fillMaxWidth().testTag("atrio-community-terms")) {
        Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Termos de Uso e Política da Comunidade",
                style = MaterialTheme.typography.titleMedium)
            when {
                status.failed -> Text("Não foi possível verificar os Termos no servidor. Verifique a conexão.")
                !status.loaded -> CircularProgressIndicator()
                policy?.available != true ->
                    Text("A publicação está indisponível até que os Termos oficiais sejam aprovados.")
                status.accepted -> Text("Você aceitou a versão vigente da Política da Comunidade.")
                else -> {
                    Text("Para publicar ou responder, leia os Termos oficiais e registre seu aceite.")
                    TextButton(onClick = { uriHandler.openUri(policy.url) },
                        modifier = Modifier.testTag("atrio-community-terms-open")) {
                        Text("Ler os Termos oficiais")
                    }
                    Row {
                        Checkbox(checked = confirmed,
                            onCheckedChange = { confirmed = it },
                            modifier = Modifier.testTag("atrio-community-terms-checkbox"))
                        Text("Li a política publicada e concordo em respeitá-la.")
                    }
                    Button(
                        modifier = Modifier.testTag("atrio-community-terms-accept"),
                        enabled = confirmed && !busy
                            && FirebaseAuth.getInstance().currentUser?.uid == uid,
                        onClick = {
                            if (FirebaseAuth.getInstance().currentUser?.uid != uid) return@Button
                            busy = true
                            info = ""
                            db.collection("users").document(uid)
                                .collection("acceptedTerms").document(policy.version).set(mapOf(
                                    "version" to policy.version,
                                    "acceptedAt" to FieldValue.serverTimestamp()
                                )).addOnCompleteListener { task ->
                                    if (FirebaseAuth.getInstance().currentUser?.uid != uid) {
                                        return@addOnCompleteListener
                                    }
                                    busy = false
                                    info = if (task.isSuccessful)
                                        "Aceite enviado. Aguarde a confirmação no servidor."
                                        else "Não foi possível confirmar o aceite. Tente novamente."
                                }
                        }
                    ) { Text(if (busy) "Registrando..." else "Aceitar Termos") }
                }
            }
            if (info.isNotBlank()) Text(info, style = MaterialTheme.typography.bodySmall)
        }
    }
}
