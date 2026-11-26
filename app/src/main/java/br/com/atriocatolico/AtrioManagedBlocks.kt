package br.com.atriocatolico

import androidx.compose.foundation.layout.Column
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
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
import java.util.UUID
import java.net.URL
import kotlin.coroutines.resume
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive
import kotlinx.coroutines.launch
import kotlinx.coroutines.suspendCancellableCoroutine

internal class AtrioManagedBlocks(
    private val sameSession: () -> Boolean,
    private val service: AtrioManagedBlockService
) {
    enum class Phase { Sending, Pending, Committed, StateChanged, Rejected }

    data class Operation(val intent: AtrioBlockIntent, val phase: Phase)

    private val operations = mutableStateMapOf<String, Operation>()
    private val confirmed = mutableStateMapOf<String, AtrioBlockState>()
    private val loading = mutableStateMapOf<String, Boolean>()
    private val awaitingBlockList = mutableStateMapOf<String, Boolean>()
    private var observedBlockList = emptySet<String>()

    fun operation(peerUid: String): Operation? = operations[peerUid].takeIf { sameSession() }
    fun confirmed(peerUid: String): AtrioBlockState? = confirmed[peerUid].takeIf { sameSession() }
    fun loading(peerUid: String): Boolean = loading[peerUid] == true

    fun hiddenPeers(): Set<String> = if (!sameSession()) emptySet() else buildSet {
        addAll(awaitingBlockList.keys)
        operations.values.forEach { (intent, phase) ->
            if (intent.block && (phase == Phase.Sending || phase == Phase.Pending)) add(intent.peerUid)
        }
    }

    fun observeBlockList(blockedPeers: Set<String>) {
        observedBlockList = blockedPeers
        awaitingBlockList.keys.removeAll(blockedPeers)
    }

    suspend fun refresh(peerUid: String) {
        if (!sameSession() || peerUid.isBlank() || loading(peerUid)) return
        val operation = operations[peerUid]
        if (operation?.phase == Phase.Sending || operation?.phase == Phase.Pending) return
        loading[peerUid] = true
        try {
            val current = service.read(peerUid)
            currentCoroutineContext().ensureActive()
            if (!sameSession()) return
            if (current != null) {
                confirmed[peerUid] = current
                if (!current.blocked) awaitingBlockList.remove(peerUid)
            } else confirmed.remove(peerUid)
        } finally {
            loading.remove(peerUid)
        }
    }

    suspend fun submit(peerUid: String) {
        if (!sameSession() || peerUid.isBlank() || loading(peerUid)) return
        val previous = operations[peerUid]
        if (previous?.phase == Phase.Sending) return
        val intent = if (previous?.phase == Phase.Pending) previous.intent else {
            val state = confirmed[peerUid] ?: return
            AtrioBlockIntent(UUID.randomUUID().toString(), peerUid, !state.blocked, state.etag)
        }
        operations[peerUid] = Operation(intent, Phase.Sending)
        val reply = try {
            service.submit(intent).also { currentCoroutineContext().ensureActive() }
        } catch (cancelled: CancellationException) {
            // O servidor ainda pode confirmar o pedido ao fechar a tela.
            if (sameSession()) operations[peerUid] = Operation(intent, Phase.Pending)
            throw cancelled
        }
        if (!sameSession()) return
        when (reply) {
            is AtrioBlockReply.Committed -> {
                confirmed[peerUid] = reply.state
                if (reply.state.blocked && peerUid !in observedBlockList)
                    awaitingBlockList[peerUid] = true
                else awaitingBlockList.remove(peerUid)
                operations[peerUid] = Operation(intent, Phase.Committed)
            }
            AtrioBlockReply.Pending -> operations[peerUid] = Operation(intent, Phase.Pending)
            AtrioBlockReply.StateChanged, AtrioBlockReply.Rejected -> {
                confirmed.remove(peerUid)
                val phase = if (reply == AtrioBlockReply.StateChanged) Phase.StateChanged else Phase.Rejected
                operations[peerUid] = Operation(intent, phase)
                // A próxima intenção só pode usar a precondição atual, obtida por GET.
                refresh(peerUid)
            }
        }
    }
}

@Composable
internal fun rememberAtrioManagedBlocks(
    auth: FirebaseAuth, user: FirebaseUser, db: FirebaseFirestore
): AtrioManagedBlocks? = remember(auth, user, db) {
    val base = atrioManagedInboxBase(db)
    if (base == null) null else {
        val service = AtrioInboxBlockHttp(token = { atrioQaInboxToken(auth, user) },
            baseUrl = URL(base, "blocks/"))
        AtrioManagedBlocks({ auth.currentUser === user }, service)
    }
}

internal fun isAtrioManagedInboxQa(db: FirebaseFirestore): Boolean =
    atrioManagedInboxBase(db) != null

internal suspend fun atrioQaInboxToken(auth: FirebaseAuth, user: FirebaseUser): String? {
    if (auth.currentUser !== user) return null
    if (BuildConfig.ATRIO_QA_GERAL_REMOTE &&
        !qaGeralPushIdentityMatches(user.uid, user.email, user.isEmailVerified)) return null
    return suspendCancellableCoroutine { continuation ->
        user.getIdToken(false).addOnCompleteListener { task ->
            if (continuation.isActive) continuation.resume(
                if (auth.currentUser === user && task.isSuccessful) task.result?.token else null
            )
        }
    }
}

@Composable
internal fun AtrioManagedBlockControl(
    blocks: AtrioManagedBlocks, peerUid: String, tag: String
) {
    val scope = rememberCoroutineScope()
    val operation = blocks.operation(peerUid)
    val confirmed = blocks.confirmed(peerUid)?.blocked
    val loading = blocks.loading(peerUid)
    LaunchedEffect(blocks, peerUid) { blocks.refresh(peerUid) }

    val pending = operation?.phase == AtrioManagedBlocks.Phase.Pending
    val action = when {
        pending -> "Tentar novamente"
        confirmed == null -> "Atualizar estado"
        confirmed -> "Desbloquear participante"
        else -> "Bloquear participante"
    }
    val feedback = when (operation?.phase) {
        AtrioManagedBlocks.Phase.Sending -> "Aguardando confirmação do servidor."
        AtrioManagedBlocks.Phase.Pending -> if (operation.intent.block)
            "Bloqueio pendente. Tente novamente quando o serviço estiver disponível."
            else "Desbloqueio pendente. Tente novamente quando o serviço estiver disponível."
        AtrioManagedBlocks.Phase.Committed -> when {
            confirmed != operation.intent.block -> "O estado do bloqueio mudou."
            confirmed == true -> "Participante bloqueado."
            else -> "Participante desbloqueado."
        }
        AtrioManagedBlocks.Phase.StateChanged -> "O estado do bloqueio mudou. Confira antes de tentar novamente."
        AtrioManagedBlocks.Phase.Rejected -> "O servidor recusou a alteração do bloqueio."
        null -> if (!loading && confirmed == null) "Estado do bloqueio indisponível." else null
    }

    Column {
        OutlinedButton(
            onClick = {
                scope.launch {
                    if (pending || confirmed != null) blocks.submit(peerUid) else blocks.refresh(peerUid)
                }
            },
            enabled = !loading && operation?.phase != AtrioManagedBlocks.Phase.Sending,
            modifier = Modifier.testTag(tag)
        ) { Text(action) }
        if (feedback != null) Text(feedback, Modifier.testTag("atrio-managed-block-feedback")
            .semantics { liveRegion = LiveRegionMode.Polite })
    }
}
