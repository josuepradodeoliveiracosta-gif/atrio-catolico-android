package br.com.atriocatolico

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

/** Controles por conta, nunca privilégios administrativos. */
@Composable
internal fun MemberSafetyControls(
    db: FirebaseFirestore,
    viewerUid: String,
    memberUid: String,
    onBlockedChange: (Boolean) -> Unit
) {
    if (viewerUid.isBlank() || memberUid.isBlank() || viewerUid == memberUid) return
    val auth = FirebaseAuth.getInstance()
    var blocked by remember(viewerUid, memberUid) { mutableStateOf(false) }
    var loaded by remember(viewerUid, memberUid) { mutableStateOf(false) }
    var busy by remember(viewerUid, memberUid) { mutableStateOf(false) }
    var reportOpen by remember(viewerUid, memberUid) { mutableStateOf(false) }
    var reason by remember(viewerUid, memberUid) { mutableStateOf("") }
    var status by remember(viewerUid, memberUid) { mutableStateOf("") }
    val blockRef = remember(db, viewerUid, memberUid) {
        db.collection("users").document(viewerUid)
            .collection("blockedMembers").document(memberUid)
    }
    DisposableEffect(blockRef, viewerUid, memberUid) {
        var active = true
        val listener = blockRef.addSnapshotListener { snapshot, error ->
            if (!active || auth.currentUser?.uid != viewerUid) return@addSnapshotListener
            if (error == null) {
                blocked = snapshot?.exists() == true
                loaded = true
                onBlockedChange(blocked)
            } else {
                loaded = false
                status = "Não foi possível verificar o bloqueio. Verifique sua conexão."
            }
        }
        onDispose { active = false; listener.remove() }
    }
    Column(verticalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
        Text("Segurança e convivência", style = MaterialTheme.typography.titleMedium)
        if (status.isNotBlank()) Text(status, style = MaterialTheme.typography.bodySmall)
        OutlinedButton(
            modifier = Modifier.fillMaxWidth().testTag("atrio-member-block"),
            enabled = loaded && !busy && auth.currentUser?.uid == viewerUid,
            onClick = {
                if (auth.currentUser?.uid != viewerUid) return@OutlinedButton
                busy = true
                status = ""
                val operation = if (blocked) blockRef.delete() else blockRef.set(mapOf(
                    "createdAt" to FieldValue.serverTimestamp()
                ))
                operation.addOnCompleteListener { task ->
                    if (auth.currentUser?.uid != viewerUid) return@addOnCompleteListener
                    busy = false
                    if (!task.isSuccessful) status = "Não foi possível alterar o bloqueio."
                }
            }
        ) { Text(if (blocked) "Desbloquear usuário" else "Bloquear usuário") }
        OutlinedButton(
            modifier = Modifier.fillMaxWidth().testTag("atrio-member-report"),
            enabled = !busy && auth.currentUser?.uid == viewerUid,
            onClick = { reason = ""; reportOpen = true }
        ) { Text("Denunciar usuário") }
        if (blocked) Text(
            "Este participante está bloqueado. Suas discussões não são mostradas neste perfil.",
            style = MaterialTheme.typography.bodySmall
        )
    }
    if (reportOpen) AlertDialog(
        onDismissRequest = { if (!busy) reportOpen = false },
        title = { Text("Denunciar usuário") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text("Descreva a conduta para análise pela moderação. Não informe dados pessoais.")
                OutlinedTextField(
                    value = reason, onValueChange = { if (it.length <= 300) reason = it },
                    label = { Text("Motivo") },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-member-report-reason")
                )
            }
        },
        confirmButton = {
            Button(
                enabled = !busy && reason.trim().length in 5..300
                    && auth.currentUser?.uid == viewerUid,
                modifier = Modifier.testTag("atrio-member-report-confirm"),
                onClick = {
                    if (auth.currentUser?.uid != viewerUid) return@Button
                    val reporter = viewerUid
                    val target = memberUid
                    busy = true
                    val reportId = "${reporter}_user_${target}"
                    db.collection("user_reports").document(reportId).set(mapOf(
                        "reporterUid" to reporter,
                        "targetUid" to target,
                        "reason" to reason.trim(),
                        "createdAt" to FieldValue.serverTimestamp()
                    )).addOnCompleteListener { task ->
                        if (auth.currentUser?.uid != reporter) return@addOnCompleteListener
                        busy = false
                        reportOpen = false
                        reason = ""
                        status = if (task.isSuccessful) "Denúncia enviada para análise."
                            else "Não foi possível confirmar a denúncia. Ela pode já estar registrada."
                    }
                }
            ) { Text("Enviar denúncia") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = { reportOpen = false }) {
            Text("Cancelar")
        } }
    )
}
