package br.com.atriocatolico

import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import com.google.firebase.auth.FirebaseAuth

/**
 * Observa eventos de autenticação e recompõe a interface imediatamente.
 * Essa camada é só de UX; Firestore Rules autorizam todas as operações.
 */
@Composable
internal fun rememberGuardianAuthUid(): String? {
    val auth = remember { FirebaseAuth.getInstance() }
    var sessionUid by remember(auth) { mutableStateOf(auth.currentUser?.uid) }
    DisposableEffect(auth) {
        val observer = FirebaseAuth.AuthStateListener { changed ->
            sessionUid = changed.currentUser?.uid
        }
        auth.addAuthStateListener(observer)
        onDispose { auth.removeAuthStateListener(observer) }
    }
    return sessionUid
}
