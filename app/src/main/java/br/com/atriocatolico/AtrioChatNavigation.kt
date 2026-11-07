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

internal data class AtrioGroupDestination(val uid:String,val groupId:String)

/** Navegação não concede acesso: Firestore verifica membership e elegibilidade. */
internal object AtrioGroupNavigation {
    var requested by mutableStateOf<AtrioGroupDestination?>(null)
        private set
    fun accept(intent:Intent?) {
        val uid=intent?.getStringExtra("atrio_group_uid").orEmpty()
        val groupId=intent?.getStringExtra("atrio_group_id").orEmpty()
        if(uid.matches(Regex("[A-Za-z0-9_-]{1,128}")) &&
            groupId.matches(Regex("[A-Za-z0-9_-]{1,128}"))) {
            requested=AtrioGroupDestination(uid,groupId)
            intent?.removeExtra("atrio_group_uid")
            intent?.removeExtra("atrio_group_id")
        }
    }
    fun consume() { requested=null }
}
internal object AtrioGroupForeground {
    @Volatile private var active:AtrioGroupDestination?=null
    @Volatile private var foreground:Boolean=false
    fun foreground(value:Boolean) { foreground=value }
    fun open(uid:String,groupId:String) { active=AtrioGroupDestination(uid,groupId) }
    fun close(uid:String,groupId:String) {
        if(active==AtrioGroupDestination(uid,groupId)) active=null
    }
    fun contains(uid:String,groupId:String)=foreground &&
        active==AtrioGroupDestination(uid,groupId)
}

/** Estado só em memória: fechar o processo nunca deixa "chat aberto" persistido. */
internal object AtrioChatForeground {
    @Volatile private var active: AtrioChatDestination? = null
    @Volatile private var appForeground: Boolean = false
    fun foreground(isVisible: Boolean) { appForeground = isVisible }
    fun open(uid: String, chatId: String) { active = AtrioChatDestination(uid, chatId) }
    fun close(uid: String, chatId: String) {
        if (active == AtrioChatDestination(uid, chatId)) active = null
    }
    fun contains(uid: String, chatId: String) = appForeground &&
        active == AtrioChatDestination(uid, chatId)
}
