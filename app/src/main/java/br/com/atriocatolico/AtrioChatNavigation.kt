package br.com.atriocatolico

import android.content.Intent
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue

internal data class AtrioChatDestination(val uid: String, val chatId: String)

/** Recebe somente um identificador não sensível; Firestore revalida o acesso. */
internal object AtrioChatNavigation {
    var requested by mutableStateOf<AtrioChatDestination?>(null)
        private set

    fun accept(intent: Intent?) {
        val uid = intent?.getStringExtra("atrio_chat_uid").orEmpty()
        val chatId = intent?.getStringExtra("atrio_chat_id").orEmpty()
        if (uid.matches(Regex("[A-Za-z0-9_-]{1,128}")) &&
            chatId.matches(Regex("[A-Za-z0-9_-]{1,260}"))) {
            requested = AtrioChatDestination(uid, chatId)
            intent?.removeExtra("atrio_chat_uid")
            intent?.removeExtra("atrio_chat_id")
        }
    }
    fun consume() { requested = null }
}

/** Estado só em memória: fechar o processo nunca deixa "chat aberto" persistido. */
internal object AtrioChatForeground {
    @Volatile private var active: AtrioChatDestination? = null
    fun open(uid: String, chatId: String) { active = AtrioChatDestination(uid, chatId) }
    fun close(uid: String, chatId: String) {
        if (active == AtrioChatDestination(uid, chatId)) active = null
    }
    fun contains(uid: String, chatId: String) = active == AtrioChatDestination(uid, chatId)
}
