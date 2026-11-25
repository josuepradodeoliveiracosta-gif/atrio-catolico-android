package br.com.atriocatolico

import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.remember
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import java.util.UUID
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.currentCoroutineContext
import kotlinx.coroutines.ensureActive

internal class AtrioManagedMessages(
    private val sameSession: () -> Boolean,
    private val write: suspend (AtrioMessageIntent) -> AtrioMessageReply,
    private val writeDecision: (suspend (AtrioDecisionIntent) -> AtrioDecisionReply)? = null
) {
    data class Draft(
        val text: String = "",
        val intent: AtrioMessageIntent? = null,
        val result: AtrioMessageReply? = null,
        val retryAtMs: Long? = null,
        val requiresRoomRefresh: Boolean = false
    ) {
        val sending get() = intent != null && result == null
        val pending get() = result == AtrioMessageReply.Pending || retryAtMs != null
        val locked get() = sending || pending
    }

    data class Decision(val intent: AtrioDecisionIntent, val result: AtrioDecisionReply? = null) {
        fun canChoose(status: String): Boolean =
            result == AtrioDecisionReply.Rejected ||
                (result == AtrioDecisionReply.Pending && intent.status == status)
    }

    private val decisions = mutableStateMapOf<String, Decision>()
    val supportsDecision get() = sameSession() && writeDecision != null
    fun decision(chatId: String): Decision? = if (sameSession()) decisions[chatId] else null

    suspend fun decide(chatId: String, status: String): AtrioDecisionReply? {
        val submit = writeDecision ?: return null
        if (!sameSession() || status !in listOf("accepted", "declined")) return null
        val old = decision(chatId)
        if (old != null && !old.canChoose(status)) return null
        val intent = if (old?.result == AtrioDecisionReply.Pending) old.intent
            else AtrioDecisionIntent(UUID.randomUUID().toString(), chatId, status)
        decisions[chatId] = Decision(intent)
        val reply = try {
            submit(intent).also { currentCoroutineContext().ensureActive() }
        } catch (cancelled: CancellationException) {
            if (sameSession()) decisions[chatId] = Decision(intent, AtrioDecisionReply.Pending)
            throw cancelled
        }
        if (!sameSession()) return null
        decisions[chatId] = Decision(intent, reply)
        return reply
    }

    private val drafts = mutableStateMapOf<String, Draft>()

    fun draft(peer: String): Draft = if (sameSession()) drafts[peer] ?: Draft() else Draft()

    fun edit(peer: String, text: String) {
        if (!sameSession()) return
        val current = draft(peer)
        if (!current.locked) drafts[peer] = if (current.requiresRoomRefresh)
            current.copy(text = text) else Draft(text = text)
    }

    fun reconcile(peer: String) {
        if (!sameSession()) return
        val current = draft(peer)
        if (current.requiresRoomRefresh) drafts[peer] = current.copy(requiresRoomRefresh = false)
    }

    suspend fun send(
        peer: String, chatId: String, firstPeer: String?, replyToId: String?
    ): AtrioMessageReply? {
        if (!sameSession() || peer.isBlank()) return null
        val previous = draft(peer)
        if (previous.sending || previous.requiresRoomRefresh ||
            previous.retryAtMs?.let { it > atrioMessageClockMs() } == true
        ) return null
        val text = previous.text.trim()
        val intent = if (previous.pending) previous.intent ?: return null else {
            val valid = if (firstPeer != null) AtrioChatPolicy.validRequest(text)
                else AtrioChatPolicy.validText(text)
            if (!valid) return null
            AtrioMessageIntent(UUID.randomUUID().toString(), chatId, firstPeer, text,
                if (firstPeer == null) replyToId else null)
        }
        val sending = previous.copy(intent = intent, result = null, retryAtMs = null)
        drafts[peer] = sending
        val result = try {
            write(intent).also { currentCoroutineContext().ensureActive() }
        } catch (cancelled: CancellationException) {
            if (sameSession()) drafts[peer] = sending.copy(result = AtrioMessageReply.Pending)
            throw cancelled
        }
        if (!sameSession()) return null
        drafts[peer] = sending.copy(
            text = if (result is AtrioMessageReply.Committed) "" else sending.text,
            result = result,
            retryAtMs = (result as? AtrioMessageReply.RateLimited)?.seconds
                ?.let { atrioMessageClockMs() + it * 1000 },
            requiresRoomRefresh = result is AtrioMessageReply.Conflict
        )
        return result
    }
}

internal fun atrioMessageClockMs(): Long = System.nanoTime() / 1_000_000

@Composable
internal fun rememberAtrioManagedMessages(
    auth: FirebaseAuth, user: FirebaseUser, db: FirebaseFirestore
): AtrioManagedMessages? = remember(auth, user, db) {
    if (!isAtrioManagedInboxQa(db)) null else {
        val service = AtrioInboxMessageHttp(token = { atrioQaInboxToken(auth, user) })
        AtrioManagedMessages({ auth.currentUser === user }, service::submit, service::submitDecision)
    }
}
