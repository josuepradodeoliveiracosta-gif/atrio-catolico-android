package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source

private data class GuardianCaseSummary(
    val id: String, val status: String, val rule: String, val targetPath: String
)

/** O moderador vê as provas antes de encerrar um sinal V2, sem punir o autor. */
@Composable
internal fun GuardianCaseOverview(db: FirebaseFirestore, uid: String) {
    val observedUid = rememberGuardianAuthUid()
    val sessionActive = GuardianUiPolicy.sameSession(uid, observedUid)
    var cases by remember(uid) { mutableStateOf<List<GuardianCaseSummary>>(emptyList()) }
    var unavailable by remember(uid) { mutableStateOf(false) }
    var selectedId by remember(uid) { mutableStateOf<String?>(null) }
    var result by remember(uid) { mutableStateOf("") }
    DisposableEffect(db, uid, observedUid) {
        if (!sessionActive) {
            cases = emptyList()
            selectedId = null
            result = ""
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
                                it.getString("ruleCode").orEmpty(),
                                it.getString("targetPath").orEmpty()
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
            Text("Painel de triagem humana; nenhuma punição automática será aplicada.",
                style = MaterialTheme.typography.bodySmall)
            if (unavailable) {
                Text("Casos indisponíveis. Verifique a conexão e o acesso administrativo.",
                    color = MaterialTheme.colorScheme.error)
            } else {
                Text("Últimos " + cases.size + " casos · revisão: " +
                    cases.count { it.status == "review" })
                if (cases.isEmpty()) Text("Nenhum caso automático registrado.",
                    style = MaterialTheme.typography.bodySmall)
                cases.take(5).forEach { entry ->
                    Text(entry.status + " · " + entry.rule + " · " + entry.id.take(18),
                        style = MaterialTheme.typography.bodySmall)
                    if (entry.status in setOf("review", "warned") &&
                        Regex("^posts/[A-Za-z0-9_-]{1,128}(/replies/[A-Za-z0-9_-]{1,128})?$")
                            .matches(entry.targetPath)) {
                        if (GuardianV2ReviewClient.configured()) {
                            TextButton(onClick = { selectedId = entry.id }) {
                                Text("Revisar alerta V2")
                            }
                        } else {
                            Text("Decisão V2 indisponível até autorização do servidor.",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }
                }
            }
        }
    }
    val selected = cases.firstOrNull { it.id == selectedId &&
        it.status in setOf("review", "warned") }
    if (selected != null && GuardianV2ReviewClient.configured()) {
        var note by remember(selected.id) { mutableStateOf("") }
        var evidence by remember(selected.id) { mutableStateOf("Carregando contexto...") }
        var loaded by remember(selected.id) { mutableStateOf(false) }
        var busy by remember(selected.id) { mutableStateOf(false) }
        DisposableEffect(db, selected.id, observedUid) {
            var active = true
            if (GuardianUiPolicy.sameSession(uid, observedUid)) {
                db.document(selected.targetPath).get(Source.SERVER)
                    .addOnSuccessListener { snap ->
                        if (active && GuardianUiPolicy.sameSession(
                                uid, FirebaseAuth.getInstance().currentUser?.uid)) {
                            loaded = snap.exists()
                            evidence = if (loaded) {
                                (snap.getString("title").orEmpty() + " " +
                                    snap.getString("body").orEmpty()).take(800)
                            } else "O conteúdo original não está disponível."
                        }
                    }.addOnFailureListener {
                        if (active) {
                            loaded = false
                            evidence = "Não foi possível consultar o conteúdo original."
                        }
                    }
            }
            onDispose { active = false }
        }
        val mayAct = loaded && !busy && note.trim().length in 5..300 &&
            GuardianUiPolicy.sameSession(uid, observedUid)
        AlertDialog(
            onDismissRequest = { if (!busy) selectedId = null },
            title = { Text("Revisar alerta V2") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Confira o contexto. As decisões abaixo NÃO removem o conteúdo.")
                    Text(evidence, style = MaterialTheme.typography.bodySmall)
                    OutlinedTextField(note, { note = it.take(300) }, enabled = !busy,
                        label = { Text("Justificativa (5 a 300 caracteres)") })
                }
            },
            confirmButton = {
                Row {
                    TextButton(enabled = mayAct, onClick = {
                        busy = true
                        GuardianV2ReviewClient.resolve(uid, selected.id, "dismiss", note) { ok, msg ->
                            busy = false
                            if (GuardianUiPolicy.sameSession(uid,
                                    FirebaseAuth.getInstance().currentUser?.uid)) {
                                result = msg
                                if (ok) selectedId = null
                            }
                        }
                    }) { Text("Sem infração") }
                    TextButton(enabled = mayAct, onClick = {
                        busy = true
                        GuardianV2ReviewClient.resolve(uid, selected.id, "acknowledge", note) { ok, msg ->
                            busy = false
                            if (GuardianUiPolicy.sameSession(uid,
                                    FirebaseAuth.getInstance().currentUser?.uid)) {
                                result = msg
                                if (ok) selectedId = null
                            }
                        }
                    }) { Text("Orientar") }
                }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { selectedId = null }) {
                    Text("Cancelar")
                }
            }
        )
    }
    if (result.isNotBlank()) AlertDialog(
        onDismissRequest = { result = "" },
        title = { Text("Átrio Guardião V2") },
        text = { Text(result) },
        confirmButton = { TextButton(onClick = { result = "" }) { Text("Entendi") } }
    )
}
