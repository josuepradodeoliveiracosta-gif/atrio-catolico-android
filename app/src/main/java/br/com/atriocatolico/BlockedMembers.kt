package br.com.atriocatolico

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges

@Composable
internal fun rememberAtrioCurrentUser(auth: FirebaseAuth): FirebaseUser? {
    var user by remember(auth) { mutableStateOf(auth.currentUser, referentialEqualityPolicy()) }
    DisposableEffect(auth) {
        val observer = FirebaseAuth.AuthStateListener { user = it.currentUser }
        auth.addAuthStateListener(observer)
        onDispose { auth.removeAuthStateListener(observer) }
    }
    return user.takeIf { auth.currentUser === it }
}

/** null significa que a lista desta sessão ainda não foi confirmada pelo servidor. */
@Composable
internal fun rememberBlockedMembers(
    db: FirebaseFirestore, viewerUid: String, retry: Int
): Set<String>? {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    val user = rememberAtrioCurrentUser(auth)
    var ids by remember(db, viewerUid, user, retry) { mutableStateOf<Set<String>?>(null) }
    DisposableEffect(db, viewerUid, user, retry) {
        if (user == null || user.uid != viewerUid) {
            onDispose {}
        } else {
            var active = true
            val listener = db.collection("users").document(viewerUid).collection("blockedMembers")
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, failure ->
                    if (active && auth.currentUser === user) {
                        ids = if (failure == null && snapshot != null &&
                            NoticePrivacyPolicy.serverConfirmed(
                                snapshot.metadata.isFromCache, snapshot.metadata.hasPendingWrites(), true
                            )
                        ) snapshot.documents.map { it.id }.toSet() else null
                    }
                }
            onDispose {
                active = false
                listener.remove()
            }
        }
    }
    return ids.takeIf { user != null && user.uid == viewerUid && auth.currentUser === user }
}

@Composable
internal fun BlockedMembersConnectionStatus(onRetry: () -> Unit) {
    Column(Modifier.padding(20.dp).testTag("atrio-block-list-unconfirmed")) {
        Text("Aguardando confirmação dos bloqueios. Confira sua conexão.",
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
        OutlinedButton(onClick = onRetry) { Text("Tentar novamente") }
    }
}
