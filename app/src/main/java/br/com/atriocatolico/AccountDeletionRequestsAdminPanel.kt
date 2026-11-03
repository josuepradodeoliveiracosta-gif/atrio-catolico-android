package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Card
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source

private const val DELETION_QUEUE_PAGE_SIZE = 20
private class DeletionQueueLifetime(var active: Boolean = true)
private data class AdminDeletionRequest(
    val uid: String, val status: String, val source: String
)

/**
 * A late Firestore response from a former FirebaseAuth session must never
 * populate the administrative queue, even when the founder signs in again.
 * This check is UI defense; Firestore Rules remain the authority.
 */
internal fun trustedAdminDeletionQueueResponse(
    expectedEpoch: Int,
    currentEpoch: Int,
    sameSession: Boolean,
    fromCache: Boolean,
    pendingWrites: Boolean,
    allDocumentsTrusted: Boolean
): Boolean = sameSession && expectedEpoch == currentEpoch &&
    !fromCache && !pendingWrites && allDocumentsTrusted

private fun readableDeletionStatus(value: String): String = when (value) {
    "requested" -> "Recebido; aguardando atendimento"
    "processing" -> "Processamento informado"
    "completed" -> "Conclusão declarada; exclusão não comprovada nesta tela"
    "rejected" -> "Pendência informada; revisar com titular"
    else -> "Estado não confirmado; verificar pelo canal oficial"
}

/**
 * Visível somente no fluxo administrativo do fundador.
 * Firestore Rules são a autoridade; esta UI não altera pedidos ou contas.
 */
@Composable
internal fun AccountDeletionRequestsAdminPanel(db: FirebaseFirestore, founderUid: String) {
    val lifetime = remember(db, founderUid) { DeletionQueueLifetime() }
    val auth = FirebaseAuth.getInstance()
    var observedUid by remember(db, founderUid) { mutableStateOf(auth.currentUser?.uid) }
    var sessionEpoch by remember(db, founderUid) { mutableIntStateOf(0) }
    var requests by remember(db, founderUid) { mutableStateOf<List<AdminDeletionRequest>>(emptyList()) }
    var lastDocument by remember(db, founderUid) { mutableStateOf<DocumentSnapshot?>(null) }
    var loaded by remember(db, founderUid) { mutableStateOf(false) }
    var hasMore by remember(db, founderUid) { mutableStateOf(false) }
    var loading by remember(db, founderUid) { mutableStateOf(false) }
    var error by remember(db, founderUid) { mutableStateOf(false) }

    DisposableEffect(lifetime, auth) {
        val listener = FirebaseAuth.AuthStateListener { current ->
            val nextUid = current.currentUser?.uid
            if (observedUid != nextUid) {
                // Invalidate pending callbacks and wipe private records before
                // allowing a new account to interact with this panel.
                sessionEpoch++
                observedUid = nextUid
                requests = emptyList()
                lastDocument = null
                hasMore = false
                loaded = false
                loading = false
                error = false
            }
        }
        auth.addAuthStateListener(listener)
        onDispose {
            lifetime.active = false
            auth.removeAuthStateListener(listener)
        }
    }

    fun sameSession() = lifetime.active &&
        founderUid.isNotBlank() && observedUid == founderUid &&
        auth.currentUser?.uid == founderUid

    fun readPage(reset: Boolean) {
        if (loading || !sameSession()) return
        val cursor: DocumentSnapshot? = if (reset) null else {
            lastDocument ?: return
        }
        if (reset) {
            requests = emptyList()
            lastDocument = null
            hasMore = false
        }
        loading = true
        error = false
        val requestedEpoch = sessionEpoch
        val query = db.collection("account_deletion_requests")
            .orderBy("requestedAt", Query.Direction.DESCENDING)
            .limit(DELETION_QUEUE_PAGE_SIZE.toLong())
            .let { if (cursor == null) it else it.startAfter(cursor) }
        query.get(Source.SERVER).addOnCompleteListener { task ->
            // An old request may finish after logout and a fast re-login.
            // Never overwrite a newer session's loading/results state.
            if (!lifetime.active || sessionEpoch != requestedEpoch)
                return@addOnCompleteListener
            if (!sameSession()) {
                requests = emptyList()
                lastDocument = null
                hasMore = false
                loading = false
                return@addOnCompleteListener
            }
            loading = false
            loaded = true
            val snapshot = if (task.isSuccessful) task.result else null
            val verified = snapshot != null && trustedAdminDeletionQueueResponse(
                expectedEpoch = requestedEpoch,
                currentEpoch = sessionEpoch,
                sameSession = sameSession(),
                fromCache = snapshot.metadata.isFromCache,
                pendingWrites = snapshot.metadata.hasPendingWrites(),
                allDocumentsTrusted = snapshot.documents.all {
                    !it.metadata.isFromCache && !it.metadata.hasPendingWrites()
                }
            )
            if (!verified) {
                // A cache response or a server failure must not expose old rows.
                requests = emptyList()
                lastDocument = null
                hasMore = false
                error = true
                return@addOnCompleteListener
            }
            val docs = snapshot!!.documents
            val next = docs.map { item ->
                AdminDeletionRequest(
                    uid = item.id,
                    status = item.getString("status").orEmpty(),
                    source = item.getString("source").orEmpty()
                )
            }
            if (next.any { !Regex("^[A-Za-z0-9_-]{1,128}$").matches(it.uid) }) {
                requests = emptyList()
                lastDocument = null
                hasMore = false
                error = true
                return@addOnCompleteListener
            }
            requests = if (reset) next else (requests + next).distinctBy { it.uid }
            lastDocument = docs.lastOrNull()
            hasMore = docs.size == DELETION_QUEUE_PAGE_SIZE
        }
    }

    Card(Modifier.fillMaxWidth().testTag("atrio-admin-deletion-queue")) {
        Column(
            Modifier.padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Text("Pedidos de exclusão de conta", style = MaterialTheme.typography.titleMedium)
            Text(
                "Consulta reservada ao fundador. Este painel não apaga contas, não " +
                    "altera pedidos e não comprova a remoção de dados. Confirme " +
                    "a identidade e conduza o atendimento pelo canal oficial.",
                style = MaterialTheme.typography.bodySmall
            )
            OutlinedButton(
                enabled = !loading && sameSession(),
                onClick = { readPage(reset = true) },
                modifier = Modifier.fillMaxWidth().testTag("atrio-admin-deletion-refresh")
            ) { Text(if (loaded) "Atualizar pedidos" else "Consultar pedidos") }
            if (loading) Text("Consultando o servidor...")
            if (error) Text(
                "Não foi possível confirmar a fila no servidor. Confira a conexão " +
                    "e o acesso de fundador.",
                color = MaterialTheme.colorScheme.error
            )
            if (loaded && !loading && !error && requests.isEmpty()) {
                Text("Nenhum pedido encontrado nas páginas consultadas.")
            }
            // No stale rows may be rendered during an auth state transition.
            if (sameSession()) requests.forEach { item ->
                Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                    Text("UID do solicitante: " + item.uid)
                    Text(readableDeletionStatus(item.status),
                        style = MaterialTheme.typography.bodySmall)
                    Text(
                        if (item.source == "android") "Origem: aplicativo"
                        else if (item.source == "web") "Origem: site"
                        else "Origem não confirmada",
                        style = MaterialTheme.typography.bodySmall
                    )
                }
            }
            if (hasMore && !error && sameSession()) {
                OutlinedButton(
                    enabled = !loading && sameSession(),
                    onClick = { readPage(reset = false) },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-admin-deletion-more")
                ) { Text("Consultar pedidos anteriores") }
            }
        }
    }
}
