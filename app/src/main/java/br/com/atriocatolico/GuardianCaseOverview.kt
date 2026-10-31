package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query

private data class GuardianCaseSummary(val id: String, val status: String, val rule: String)

/** Informações para moderador autenticado: sem qualquer comando remoto. */
@Composable
internal fun GuardianCaseOverview(db: FirebaseFirestore, uid: String) {
    val observedUid = rememberGuardianAuthUid()
    val sessionActive = GuardianUiPolicy.sameSession(uid, observedUid)
    var cases by remember(uid) { mutableStateOf<List<GuardianCaseSummary>>(emptyList()) }
    var unavailable by remember(uid) { mutableStateOf(false) }
    DisposableEffect(db, uid, observedUid) {
        if (!sessionActive) {
            cases = emptyList()
            unavailable = false
            onDispose { }
        } else {
            var active = true
            val registration = db.collection("guardian_cases")
                .orderBy("createdAt", Query.Direction.DESCENDING).limit(30)
                .addSnapshotListener { snapshot, failure ->
                    if (active && GuardianUiPolicy.sameSession(
                            uid, FirebaseAuth.getInstance().currentUser?.uid
                        )) {
                        unavailable = failure != null
                        cases = if (failure == null) snapshot?.documents?.map {
                            GuardianCaseSummary(
                                it.id, it.getString("status").orEmpty(),
                                it.getString("ruleCode").orEmpty()
                            )
                        }.orEmpty() else emptyList()
                    }
                }
            onDispose { active = false; registration.remove() }
        }
    }
    if (!sessionActive) {
        Text("Sessão alterada. Entre novamente.")
        return
    }
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Átrio Guardião V2 — casos em análise",
                style = MaterialTheme.typography.titleMedium)
            Text("Painel informativo. A triagem automática permanece desativada até a autorização do servidor.",
                style = MaterialTheme.typography.bodySmall)
            if (unavailable) {
                Text("Casos indisponíveis. Verifique a conexão e o acesso administrativo.",
                    color = MaterialTheme.colorScheme.error)
            } else {
                Text("Últimos " + cases.size + " casos · revisão: " +
                    cases.count { it.status == "review" })
                if (cases.isEmpty()) Text("Nenhum caso automático registrado.",
                    style = MaterialTheme.typography.bodySmall)
                cases.take(5).forEach {
                    Text(it.status + " · " + it.rule + " · " + it.id.take(18),
                        style = MaterialTheme.typography.bodySmall)
                }
            }
        }
    }
}
