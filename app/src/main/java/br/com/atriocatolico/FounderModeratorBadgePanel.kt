package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source

/**
 * Exclusivo do Fundador ativo. O servidor exige admins/{uid}.enabled=true
 * e app_config/founder.uid igual ao UID autenticado antes de qualquer gravação.
 * O selo é apenas visual; permissões reais continuam em admins/{uid}.
 */
@Composable
internal fun FounderModeratorBadgePanel(db: FirebaseFirestore, founderUid: String) {
    var targetUid by remember { mutableStateOf("") }
    var selectedUid by remember { mutableStateOf("") }
    var moderator by remember { mutableStateOf(false) }
    var loaded by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf("") }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Moderadores", color = Wine, style = MaterialTheme.typography.titleMedium)
        Text("Informe o UID da conta. Este selo não concede privilégios; " +
            "as permissões reais são definidas separadamente na administração.",
            fontSize = 12.sp, color = Muted)
        OutlinedTextField(
            value = targetUid,
            onValueChange = {
                targetUid = it.trim().take(128)
                loaded = false
                selectedUid = ""
                error = ""
            },
            label = { Text("UID do usuário") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth().testTag("atrio-moderator-uid"),
            enabled = !busy
        )
        OutlinedButton(
            onClick = {
                val target = targetUid.trim()
                if (target.isBlank() || target == founderUid || target.contains('/')) {
                    error = "Informe um UID válido de outra conta."
                    return@OutlinedButton
                }
                busy = true
                error = ""
                db.collection("badges").document(target).get(Source.SERVER)
                    .addOnCompleteListener { result ->
                        busy = false
                        if (result.isSuccessful) {
                            selectedUid = target
                            moderator = result.result?.getBoolean("moderator") == true
                            loaded = true
                        } else {
                            loaded = false
                            error = "Não foi possível consultar o selo. Confira a conexão."
                        }
                    }
            },
            enabled = !busy && targetUid.isNotBlank(),
            modifier = Modifier.testTag("atrio-moderator-lookup")
        ) { Text("Consultar identificação") }
        if (loaded && selectedUid == targetUid) {
            Text(if (moderator) "Selo de Moderador: ativo" else "Selo de Moderador: inativo",
                fontSize = 13.sp, color = Wine)
            Button(
                onClick = {
                    busy = true
                    error = ""
                    val next = !moderator
                    db.collection("badges").document(selectedUid)
                        .set(mapOf("moderator" to next), SetOptions.merge())
                        .addOnCompleteListener { result ->
                            busy = false
                            if (result.isSuccessful) {
                                moderator = next
                                error = if (next) "Selo visual de Moderador atribuído."
                                    else "Selo visual de Moderador revogado."
                            } else error = "Operação negada. Confira sua permissão de Fundador."
                        }
                },
                enabled = !busy,
                colors = ButtonDefaults.buttonColors(containerColor = Wine),
                modifier = Modifier.testTag("atrio-moderator-toggle")
            ) { Text(if (moderator) "Revogar selo de Moderador" else "Conceder selo de Moderador") }
        }
        if (error.isNotBlank()) Text(error, color = Wine, fontSize = 12.sp)
    }
}
