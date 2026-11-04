package br.com.atriocatolico

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Lista de bloqueio privada do próprio usuário; é sincronizada pelo Firestore
 * para que o bloqueio acompanhe a conta em outros aparelhos.
 * Não permite ler a lista de bloqueio de terceiros.
 */
@Composable
internal fun rememberBlockedMembers(db: FirebaseFirestore, viewerUid: String): Set<String> {
    var ids by remember(viewerUid) { mutableStateOf<Set<String>>(emptySet()) }
    DisposableEffect(db, viewerUid) {
        if (viewerUid.isBlank()) {
            ids = emptySet()
            onDispose { }
        } else {
            val listener = db.collection("users").document(viewerUid)
                .collection("blockedMembers")
                .addSnapshotListener { data, failure ->
                    if (failure == null) {
                        ids = data?.documents?.map { it.id }?.toSet().orEmpty()
                    }
                }
            onDispose { listener.remove() }
        }
    }
    return ids
}
