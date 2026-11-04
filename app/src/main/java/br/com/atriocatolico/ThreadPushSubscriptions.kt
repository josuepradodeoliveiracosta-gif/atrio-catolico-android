package br.com.atriocatolico

import android.content.Context
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.messaging.FirebaseMessaging

/**
 * Tópicos por discussão: somente avisos genéricos, sem texto privado.
 * A pertença local é verificável antes de mostrar o Push no Android.
 */
internal object ThreadPushSubscriptions {
    private const val PREFS = "atrio_thread_push"
    private const val MAX_TRACKED = 400
    private val idPattern = Regex("^[a-zA-Z0-9_-]{1,128}$")

    private fun prefs(context: Context) =
        context.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
    private fun key(uid: String) = "threads_$uid"
    private fun topic(id: String) = "atrio_thread_$id"
    private fun get(context: Context, uid: String): Set<String> =
        prefs(context).getStringSet(key(uid), emptySet()).orEmpty().toSet()

    fun contains(context: Context, uid: String, postId: String): Boolean =
        idPattern.matches(postId) && postId in get(context, uid)

    fun track(context: Context, uid: String, postId: String) {
        if (!idPattern.matches(postId) || FirebaseAuth.getInstance().currentUser?.uid != uid) return
        val before = get(context, uid)
        if (postId in before) return
        // O registro persiste inclusive com Push desabilitado, para reinscrever
        // quando a pessoa ativar avisos, sem exigir nova participação.
        val after = (before.toList() + postId).takeLast(MAX_TRACKED).toSet()
        prefs(context).edit().putStringSet(key(uid), after).apply()
        // A build Play usa envio por dispositivo com filtro bilateral de
        // bloqueios no Worker. Nunca criar novos assinantes de tópicos
        // de discussão nessa build; preservar inscrição OTA legada.
        if (PushRegistry.enabled(context, uid) && !BuildConfig.PLAY_STORE_BUILD)
            FirebaseMessaging.getInstance().subscribeToTopic(topic(postId))
        // Se a capacidade local for excedida, desinscrever os mais antigos.
        (before - after).forEach { FirebaseMessaging.getInstance().unsubscribeFromTopic(topic(it)) }
    }

    fun sync(context: Context, uid: String) {
        if (FirebaseAuth.getInstance().currentUser?.uid != uid) return
        if (BuildConfig.PLAY_STORE_BUILD) {
            // Mesmo sem intenção de renovar a inscrição, remover as antigas.
            // Não depender de topic para notificar no Play: backend deve
            // entregar mensagens individualmente e respeitar bloqueios.
            unsubscribeAll(context, uid)
            return
        }
        if (!PushRegistry.enabled(context, uid)) return
        get(context, uid).forEach {
            if (idPattern.matches(it))
                FirebaseMessaging.getInstance().subscribeToTopic(topic(it))
        }
    }

    fun unsubscribeAll(context: Context, uid: String) {
        get(context, uid).forEach {
            if (idPattern.matches(it))
                FirebaseMessaging.getInstance().unsubscribeFromTopic(topic(it))
        }
    }
}
