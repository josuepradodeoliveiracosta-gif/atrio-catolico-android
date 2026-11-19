package br.com.atriocatolico

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import java.io.IOException
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch

internal data class AtrioBlockIntent(val operationId: String, val peerUid: String, val block: Boolean)

internal enum class AtrioBlockReply { Committed, Pending, Rejected }

internal fun interface AtrioManagedBlockWriter {
    suspend fun submit(intent: AtrioBlockIntent): AtrioBlockReply
}

internal class AtrioManagedBlocks(
    private val sameSession: () -> Boolean,
    private val writer: AtrioManagedBlockWriter?
) {
    enum class Phase { Sending, Pending, Committed, Rejected }

    data class Operation(val intent: AtrioBlockIntent, val phase: Phase, val observed: Boolean = false)

    private val operations = mutableStateMapOf<String, Operation>()

    val available: Boolean get() = writer != null

    fun operation(peerUid: String): Operation? = operations[peerUid].takeIf { sameSession() }

    fun confirmed(peerUid: String, fromServer: Boolean?): Boolean? {
        if (!sameSession()) return null
        val operation = operation(peerUid)
        return if (operation?.phase == Phase.Committed && !operation.observed)
            operation.intent.block else fromServer
    }

    fun observe(peerUid: String, fromServer: Boolean?) {
        val operation = operation(peerUid) ?: return
        if (operation.phase == Phase.Committed && !operation.observed && fromServer == operation.intent.block)
            operations[peerUid] = operation.copy(observed = true)
    }

    fun hiddenPeers(): Set<String> = if (!sameSession()) emptySet() else operations.values
        .filter { it.intent.block && !it.observed && it.phase != Phase.Rejected }
        .mapTo(mutableSetOf()) { it.intent.peerUid }

    suspend fun submit(peerUid: String, fromServer: Boolean?) {
        if (writer == null || !sameSession() || peerUid.isBlank()) return
        val previous = operations[peerUid]
        if (previous?.phase == Phase.Sending) return
        val intent = if (previous?.phase == Phase.Pending) previous.intent else {
            val confirmed = confirmed(peerUid, fromServer) ?: return
            AtrioBlockIntent(UUID.randomUUID().toString(), peerUid, !confirmed)
        }
        operations[peerUid] = Operation(intent, Phase.Sending)
        val reply = try {
            writer.submit(intent).also { currentCoroutineContext().ensureActive() }
        } catch (_: IOException) {
            AtrioBlockReply.Pending
        } catch (cancelled: CancellationException) {
            // A UI pode fechar com o pedido no servidor. Preserve a chave para
            // confirmar ou repetir com segurança enquanto a sessão existir.
            if (sameSession()) operations[peerUid] = Operation(intent, Phase.Pending)
            throw cancelled
        }
        if (!sameSession()) return
        val phase = when (reply) {
            AtrioBlockReply.Committed -> Phase.Committed
            AtrioBlockReply.Pending -> Phase.Pending
            AtrioBlockReply.Rejected -> Phase.Rejected
        }
        operations[peerUid] = Operation(intent, phase)
    }
}

@Composable
internal fun rememberAtrioManagedBlocks(
    auth: FirebaseAuth,
    user: FirebaseUser,
    writer: AtrioManagedBlockWriter? = null
): AtrioManagedBlocks = remember(auth, user, writer) {
    AtrioManagedBlocks({ auth.currentUser === user }, writer)
}

@Composable
internal fun rememberAtrioConfirmedBlock(
    db: FirebaseFirestore, ownerUid: String, peerUid: String
): Boolean? {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    val user = auth.currentUser
    var blocked by remember(db, user, ownerUid, peerUid) { mutableStateOf<Boolean?>(null) }
    DisposableEffect(db, user, ownerUid, peerUid) {
        if (user == null || user.uid != ownerUid || peerUid.isBlank()) onDispose {}
        else {
            val listener = db.collection("users").document(ownerUid)
                .collection("blockedMembers").document(peerUid)
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
                    if (failure == null && snapshot != null &&
                        !snapshot.metadata.isFromCache && !snapshot.metadata.hasPendingWrites() &&
                        auth.currentUser === user) {
                        blocked = snapshot.exists()
                    }
                }
            onDispose { listener.remove() }
        }
    }
    return blocked
}

@Composable
internal fun AtrioManagedBlockControl(
    blocks: AtrioManagedBlocks,
    peerUid: String,
    fromServer: Boolean?,
    tag: String
) {
    val scope = rememberCoroutineScope()
    val operation = blocks.operation(peerUid)
    val confirmed = blocks.confirmed(peerUid, fromServer)
    LaunchedEffect(peerUid, fromServer, operation?.phase) { blocks.observe(peerUid, fromServer) }

    val action = if (operation?.phase == AtrioManagedBlocks.Phase.Pending) "Tentar novamente"
        else if (confirmed == true) "Desbloquear participante" else "Bloquear participante"
    val feedback = if (!blocks.available) "Alterações de bloqueio indisponíveis neste QA."
        else when (operation?.phase) {
            AtrioManagedBlocks.Phase.Sending -> "Aguardando confirmação do servidor."
            AtrioManagedBlocks.Phase.Pending -> if (operation.intent.block)
                "Bloqueio pendente. Tente novamente quando o serviço estiver disponível."
                else "Desbloqueio pendente. Tente novamente quando o serviço estiver disponível."
            AtrioManagedBlocks.Phase.Committed -> if (operation.intent.block)
                "Participante bloqueado." else "Participante desbloqueado."
            AtrioManagedBlocks.Phase.Rejected -> "O servidor recusou a alteração do bloqueio."
            null -> null
        }

    Column {
        OutlinedButton(
            onClick = { scope.launch { blocks.submit(peerUid, fromServer) } },
            enabled = blocks.available && operation?.phase != AtrioManagedBlocks.Phase.Sending &&
                (confirmed != null || operation?.phase == AtrioManagedBlocks.Phase.Pending),
            modifier = Modifier.testTag(tag)
        ) { Text(action) }
        if (feedback != null) Text(feedback, Modifier.testTag("atrio-managed-block-feedback")
            .semantics { liveRegion = LiveRegionMode.Polite })
    }
}
