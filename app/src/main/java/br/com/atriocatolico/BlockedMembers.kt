package br.com.atriocatolico

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Lista de bloqueios do titular. O filtro de conteúdo jamais deve reutilizar
 * o estado da conta anterior depois do logout/troca de usuário.
 * Firestore Rules continuam a autoridade do acesso.
 */
@Composable
internal fun rememberBlockedMembers(db: FirebaseFirestore, viewerUid: String): Set<String> {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    var sessionUid by remember(auth) { mutableStateOf(auth.currentUser?.uid) }
    var ids by remember(db, viewerUid) { mutableStateOf<Set<String>>(emptySet()) }

    DisposableEffect(auth) {
        val observer = FirebaseAuth.AuthStateListener { instance ->
            sessionUid = instance.currentUser?.uid
            if (sessionUid != viewerUid) ids = emptySet()
        }
        auth.addAuthStateListener(observer)
        onDispose { auth.removeAuthStateListener(observer) }
    }

    DisposableEffect(db, viewerUid, sessionUid) {
        ids = emptySet()
        if (viewerUid.isBlank() || sessionUid != viewerUid) {
            onDispose { }
        } else {
            val listener = db.collection("users").document(viewerUid)
                .collection("blockedMembers")
                .addSnapshotListener { data, failure ->
                    if (auth.currentUser?.uid != viewerUid) {
                        ids = emptySet()
                    } else if (failure == null) {
                        ids = data?.documents?.map { it.id }?.toSet().orEmpty()
                    }
                    // Uma falha temporária não apaga a lista de bloqueios já lida.
                }
            onDispose { listener.remove() }
        }
    }
    return if (sessionUid == viewerUid && auth.currentUser?.uid == viewerUid) ids
        else emptySet()
}
