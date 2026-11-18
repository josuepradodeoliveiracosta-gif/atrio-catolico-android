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

    DisposableEffect(auth, viewerUid) {
        val observer = FirebaseAuth.AuthStateListener { instance ->
            sessionUid = instance.currentUser?.uid
        }
        auth.addAuthStateListener(observer)
        onDispose { auth.removeAuthStateListener(observer) }
    }

    // Conservar o filtro já conhecido durante uma transição de sessão;
    // limpar aqui poderia exibir conteúdo de pessoas antes bloqueadas.
    DisposableEffect(db, viewerUid, sessionUid) {
        if (viewerUid.isBlank() || sessionUid != viewerUid) {
            onDispose { }
        } else {
            val listener = db.collection("users").document(viewerUid)
                .collection("blockedMembers")
                .addSnapshotListener { data, failure ->
                    if (auth.currentUser?.uid == viewerUid && failure == null) {
                        ids = data?.documents?.map { it.id }?.toSet().orEmpty()
                    }
                    // Uma falha temporária não apaga a lista de bloqueios já lida.
                }
            onDispose { listener.remove() }
        }
    }
    // remember(db, viewerUid) separa as contas; a lista conhecida não se
    // torna temporariamente vazia apenas por perda de sessão ou de rede.
    return ids
}
