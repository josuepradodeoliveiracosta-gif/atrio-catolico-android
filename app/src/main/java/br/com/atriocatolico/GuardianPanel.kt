package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.Query
import kotlinx.coroutines.launch
import org.json.JSONObject

private data class GuardianCase(val id: String, val status: String, val rule: String)

/** Complemento da moderação existente; todos os comandos são revalidados pelo servidor. */
@Composable
internal fun GuardianPanel(db: FirebaseFirestore, uid: String) {
    var cases by remember(uid) { mutableStateOf<List<GuardianCase>>(emptyList()) }
    var config by remember(uid) { mutableStateOf<Map<String, Any>?>(null) }
    var error by remember(uid) { mutableStateOf("") }
    var busy by remember(uid) { mutableStateOf(false) }
    var result by remember(uid) { mutableStateOf("") }
    var selected by remember(uid) { mutableStateOf<GuardianCase?>(null) }
    var original by remember(uid) { mutableStateOf("") }
    var authorAppeal by remember(uid) { mutableStateOf("") }
    var enableConfirm by remember(uid) { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    DisposableEffect(db, uid) {
        var active = true
        val list = db.collection("guardian_cases").orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(40).addSnapshotListener { snapshot, failure ->
                if (active) {
                    if (failure != null || !GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid)) {
                        error = "Fila indisponível. Verifique sua sessão, permissões e rede."
                        cases = emptyList()
                        selected = null
                    } else {
                        error = ""
                        cases = snapshot?.documents?.map {
                            GuardianCase(it.id, it.getString("status").orEmpty(),
                                it.getString("ruleCode").orEmpty())
                        }.orEmpty()
                    }
                }
            }
        val settings = db.collection("guardian_config").document("policy")
            .addSnapshotListener { snapshot, failure ->
                if (active) {
                    if (failure == null && GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid)) config = snapshot?.data
                    else {
                        config = null
                        cases = emptyList()
                        selected = null
                        error = "Configuração indisponível ou permissão revogada."
                    }
                }
            }
        onDispose { active = false; list.remove(); settings.remove() }
    }

    fun submit(route: String, payload: JSONObject, close: () -> Unit = {}) {
        if (!GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid)) {
            result = "Sessão alterada. Entre novamente antes de decidir."
            return
        }
        if (busy) return
        busy = true
        scope.launch {
            val outcome = runCatching { GuardianClient.call(uid, route, payload) }
            busy = false
            outcome.onSuccess {
                close()
                result = "Operação confirmada pelo servidor: " + it
            }.onFailure { result = it.message ?: "Falha na comunicação." }
        }
    }

    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Text("Átrio Guardião V2", style = MaterialTheme.typography.titleMedium)
            Text("Indicadores dos últimos 40 casos consultados (não são totais históricos).",
                style = MaterialTheme.typography.bodySmall)
            Text("Casos: " + cases.size + " · em análise: " +
                cases.count { it.status == "review" } + " · retidos: " +
                cases.count { it.status == "held" })
            val stopped = config?.get("emergencyStop") == true
            Text(when {
                config == null -> "Configuração do backend não inicializada."
                stopped -> "Parada de emergência: ATIVADA"
                config?.get("enabled") == true -> "Triagem autorizada na configuração (verificar flags do servidor)."
                else -> "Triagem desativada."
            })
            if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
            if (!GuardianClient.configured) Text(
                "Servidor do Guardião V2 ausente neste APK; ações desativadas.",
                style = MaterialTheme.typography.bodySmall)
            Button(enabled = !busy && GuardianClient.configured && config != null && !stopped &&
                GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid),
                onClick = {
                    submit("/admin/config", JSONObject().put("enabled", false)
                        .put("allowHold", false).put("emergencyStop", true))
                }) { Text("Desligamento de emergência") }
            OutlinedButton(enabled = !busy && GuardianClient.configured &&
                config != null && (stopped || config?.get("enabled") != true) &&
                GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid),
                onClick = { enableConfirm = true }) { Text("Preparar triagem sem retenção") }
            Text("A ativação requer autorização no ambiente Cloudflare e no Firestore. " +
                "Nenhuma ação automática está liberada apenas pelo painel.",
                style = MaterialTheme.typography.bodySmall)
            cases.take(8).forEach { entry ->
                HorizontalDivider()
                Text(entry.status + " · " + entry.rule + " · " + entry.id.take(18),
                    style = MaterialTheme.typography.bodySmall)
                if (entry.status == "held") OutlinedButton(
                    enabled = !busy && GuardianClient.configured &&
                        GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid),
                    onClick = {
                        if (!GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid)) return@OutlinedButton
                        selected = entry
                        original = "Consultando a cópia protegida..."
                        authorAppeal = ""
                        db.collection("guardiao_quarantine").document(entry.id).get()
                            .addOnSuccessListener {
                                if (!GuardianUiPolicy.sameSession(uid, FirebaseAuth.getInstance().currentUser?.uid) || selected?.id != entry.id) return@addOnSuccessListener
                                authorAppeal = it.getString("appealText").orEmpty()
                                val map = it.get("originalFields") as? Map<*, *>
                                original = (map?.get("title") as? String).orEmpty() + "\n" +
                                    (map?.get("body") as? String).orEmpty()
                            }.addOnFailureListener {
                                if (selected?.id != entry.id) return@addOnFailureListener
                                original = "Não foi possível consultar a evidência."
                            }
                    }) { Text("Revisão humana") }
            }
        }
    }
    val case = selected?.takeIf { picked -> cases.any { it.id == picked.id && it.status == "held" } }
    if (case != null) {
        var note by remember(case.id) { mutableStateOf("") }
        var action by remember(case.id) { mutableStateOf("restore") }
        AlertDialog(
            onDismissRequest = { if (!busy) selected = null },
            title = { Text("Revisar retenção") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text(original.take(1200))
                    if (authorAppeal.isNotBlank()) {
                        HorizontalDivider()
                        Text("Contestação do autor", style = MaterialTheme.typography.titleSmall)
                        Text(authorAppeal.take(500), style = MaterialTheme.typography.bodyMedium)
                    }
                    OutlinedTextField(note, { note = it.take(300) }, enabled = !busy,
                        label = { Text("Justificativa (5 a 300 caracteres)") })
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(action == "restore", { action = "restore" },
                            label = { Text("Restaurar") })
                        FilterChip(action == "confirm", { action = "confirm" },
                            label = { Text("Confirmar") })
                    }
                }
            },
            confirmButton = {
                TextButton(enabled = GuardianUiPolicy.canReview(uid,
                    FirebaseAuth.getInstance().currentUser?.uid, case.status,
                    GuardianClient.configured, busy, note,
                    original.isNotBlank() && !original.startsWith("Consultando") &&
                        !original.startsWith("Não foi possível")),
                    onClick = {
                        if (!cases.any { it.id == case.id && it.status == "held" }) {
                            selected = null
                            result = "O caso mudou. Reabra a análise."
                            return@TextButton
                        }
                        submit("/admin/review", JSONObject().put("caseId", case.id)
                            .put("action", action).put("note", note.trim())) { selected = null }
                    }) { Text("Registrar decisão") }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { selected = null }) { Text("Cancelar") }
            }
        )
    }
    if (enableConfirm) AlertDialog(
        onDismissRequest = { if (!busy) enableConfirm = false },
        title = { Text("Preparar triagem?") },
        text = { Text("Esta ação só atualiza a configuração administrativa. " +
            "A automação permanece bloqueada enquanto as flags do servidor estiverem desativadas. " +
            "A retenção automática continuará desligada.") },
        confirmButton = {
            TextButton(enabled = !busy, onClick = {
                submit("/admin/config", JSONObject().put("enabled", true)
                    .put("allowHold", false).put("emergencyStop", false)) {
                    enableConfirm = false
                }
            }) { Text("Confirmar") }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = { enableConfirm = false }) {
                Text("Cancelar")
            }
        }
    )
    if (result.isNotBlank()) AlertDialog(
        onDismissRequest = { result = "" }, title = { Text("Átrio Guardião V2") },
        text = { Text(result) },
        confirmButton = { TextButton(onClick = { result = "" }) { Text("Entendi") } }
    )
}
