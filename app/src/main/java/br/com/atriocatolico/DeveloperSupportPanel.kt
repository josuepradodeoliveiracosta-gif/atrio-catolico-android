package br.com.atriocatolico

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.AccountBalance
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Edit
import androidx.compose.material.icons.outlined.ExpandLess
import androidx.compose.material.icons.outlined.ExpandMore
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

/**
 * Informações públicas de apoio voluntário. Nunca manter uma chave Pix
 * fictícia como fallback e nunca colocar credenciais administrativas no APK.
 */
internal data class DeveloperSupportData(
    val enabled: Boolean = false,
    val pixKey: String = "",
    val bankName: String = "",
    val agency: String = "",
    val account: String = "",
    val message: String = ""
) {
    val bankComplete get() = bankName.isNotBlank() && agency.isNotBlank() && account.isNotBlank()
    val bankPartial get() = listOf(bankName, agency, account).any { it.isNotBlank() } && !bankComplete
    val hasPaymentMethod get() = pixKey.isNotBlank() || bankComplete
    val valid get() = !bankPartial && (!enabled || hasPaymentMethod)
    fun normalized() = copy(
        pixKey = pixKey.trim(), bankName = bankName.trim(), agency = agency.trim(),
        account = account.trim(), message = message.trim()
    )

    companion object {
        fun from(snapshot: DocumentSnapshot?): DeveloperSupportData {
            if (snapshot?.exists() != true) return DeveloperSupportData()
            return DeveloperSupportData(
                enabled = snapshot.getBoolean("enabled") == true,
                pixKey = snapshot.getString("pixKey").orEmpty(),
                bankName = snapshot.getString("bankName").orEmpty(),
                agency = snapshot.getString("agency").orEmpty(),
                account = snapshot.getString("account").orEmpty(),
                message = snapshot.getString("message").orEmpty()
            )
        }
    }
}

@Composable
internal fun DeveloperSupportPanel(db: FirebaseFirestore, uid: String, founderAdmin: Boolean) {
    var expanded by rememberSaveable(uid) { mutableStateOf(false) }
    var editorOpen by remember(uid) { mutableStateOf(false) }
    var editorInitial by remember(uid) { mutableStateOf(DeveloperSupportData()) }
    var data by remember(uid) { mutableStateOf<DeveloperSupportData?>(null) }
    var error by remember(uid) { mutableStateOf(false) }
    var copyMessage by remember(uid) { mutableStateOf("") }
    val context = LocalContext.current

    // Uma consulta pontual e um listener APENAS enquanto a aba estiver aberta.
    if (expanded) {
        DisposableEffect(db, uid) {
            val registration = db.document("app_config/developer_support")
                .addSnapshotListener { snapshot, failure ->
                    error = failure != null
                    data = if (failure == null) DeveloperSupportData.from(snapshot) else null
                }
            onDispose { registration.remove() }
        }
    }

    Card(
        modifier = Modifier.fillMaxWidth().testTag("atrio-support-card"),
        shape = RoundedCornerShape(18.dp),
        border = BorderStroke(1.dp, Gold),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface),
        elevation = CardDefaults.cardElevation(defaultElevation = 2.dp)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Row(
                modifier = Modifier.fillMaxWidth().clickable {
                    expanded = !expanded
                    copyMessage = ""
                }.testTag("atrio-support-toggle").heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Icon(Icons.Outlined.FavoriteBorder, contentDescription = null, tint = Gold)
                Column(Modifier.weight(1f)) {
                    Text("Apoie o desenvolvedor", color = Wine, fontSize = 19.sp,
                        fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold)
                    Text("Contribua com a continuidade do Átrio Católico.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                Icon(if (expanded) Icons.Outlined.ExpandLess else Icons.Outlined.ExpandMore,
                    contentDescription = if (expanded) "Recolher apoio" else "Expandir apoio", tint = Wine)
            }
            if (expanded) {
                HorizontalDivider(color = Line)
                when {
                    error -> Text("Não foi possível consultar os dados de apoio. Verifique sua conexão.",
                        color = MaterialTheme.colorScheme.error,
                        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    data == null -> LinearProgressIndicator(Modifier.fillMaxWidth())
                    else -> {
                        val support = data!!
                        val visible = support.enabled && support.hasPaymentMethod
                        if (visible) {
                            if (support.message.isNotBlank()) Text(support.message,
                                color = Ink, style = MaterialTheme.typography.bodyMedium)
                            else Text("Seu apoio voluntário ajuda a manter esta comunidade.",
                                color = Ink, style = MaterialTheme.typography.bodyMedium)
                            if (support.pixKey.isNotBlank()) {
                                SupportCopyRow(
                                    label = "Chave Pix", value = support.pixKey,
                                    onCopy = {
                                        copySupportText(context, "Chave Pix", support.pixKey)
                                        copyMessage = "Chave Pix copiada."
                                    }
                                )
                            }
                            if (support.bankComplete) {
                                val bank = "${support.bankName} · Ag. ${support.agency} · Cc. ${support.account}"
                                SupportCopyRow(label = "Banco", value = bank, onCopy = {
                                    copySupportText(context, "Dados bancários", bank)
                                    copyMessage = "Dados bancários copiados."
                                })
                            }
                            if (support.pixKey.isNotBlank()) Button(
                                onClick = {
                                    copySupportText(context, "Chave Pix", support.pixKey)
                                    copyMessage = "Chave Pix copiada."
                                }, modifier = Modifier.fillMaxWidth().testTag("atrio-support-copy-pix"),
                                colors = ButtonDefaults.buttonColors(containerColor = Wine),
                                shape = RoundedCornerShape(12.dp)
                            ) {
                                Icon(Icons.Outlined.ContentCopy, contentDescription = null)
                                Spacer(Modifier.width(8.dp))
                                Text("Copiar chave Pix")
                            }
                        } else {
                            Text("Informações de apoio ainda não disponíveis.",
                                color = Muted, style = MaterialTheme.typography.bodyMedium)
                        }
                        // Não exibir a expressão "Somente Fundador Administrador" na interface.
                        if (founderAdmin) {
                            OutlinedButton(onClick = {
                                editorInitial = support
                                editorOpen = true
                            }, modifier = Modifier.fillMaxWidth().testTag("atrio-support-edit")) {
                                Icon(Icons.Outlined.Edit, contentDescription = null, tint = Wine)
                                Spacer(Modifier.width(8.dp))
                                Text("Editar informações", color = Wine)
                            }
                        }
                        if (copyMessage.isNotBlank()) Text(copyMessage,
                            color = Wine, style = MaterialTheme.typography.bodySmall,
                            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
                    }
                }
            }
        }
    }
    if (editorOpen && founderAdmin) DeveloperSupportEditor(
        initial = editorInitial, uid = uid,
        onDismiss = { editorOpen = false },
        onSave = { values, complete ->
            val update = values.normalized()
            db.document("app_config/developer_support").set(mapOf(
                "enabled" to update.enabled,
                "pixKey" to update.pixKey,
                "bankName" to update.bankName,
                "agency" to update.agency,
                "account" to update.account,
                "message" to update.message,
                "updatedBy" to uid,
                "updatedAt" to FieldValue.serverTimestamp()
            )).addOnCompleteListener { task -> complete(task.isSuccessful) }
        }
    )
}

private fun copySupportText(context: Context, label: String, value: String) {
    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    clipboard.setPrimaryClip(ClipData.newPlainText(label, value))
}

@Composable
private fun SupportCopyRow(label: String, value: String, onCopy: () -> Unit) {
    Surface(
        shape = RoundedCornerShape(12.dp), color = Paper,
        border = BorderStroke(1.dp, Line), modifier = Modifier.fillMaxWidth()
    ) {
        Row(Modifier.fillMaxWidth().padding(start = 12.dp, top = 8.dp, bottom = 8.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically) {
            Icon(if (label == "Banco") Icons.Outlined.AccountBalance else Icons.Outlined.FavoriteBorder,
                contentDescription = null, tint = Wine)
            Spacer(Modifier.width(12.dp))
            Column(Modifier.weight(1f)) {
                Text(label, color = Muted, style = MaterialTheme.typography.labelMedium)
                Text(value, color = Wine, style = MaterialTheme.typography.bodyMedium,
                    fontWeight = FontWeight.SemiBold)
            }
            IconButton(onClick = onCopy, modifier = Modifier.testTag(
                if (label == "Banco") "atrio-support-copy-bank" else "atrio-support-copy-pix-icon"
            )) { Icon(Icons.Outlined.ContentCopy, contentDescription = "Copiar $label", tint = Wine) }
        }
    }
}

@Composable
private fun DeveloperSupportEditor(
    initial: DeveloperSupportData, uid: String, onDismiss: () -> Unit,
    onSave: (DeveloperSupportData, (Boolean) -> Unit) -> Unit
) {
    var enabled by remember(uid) { mutableStateOf(initial.enabled) }
    var pix by remember(uid) { mutableStateOf(initial.pixKey) }
    var bank by remember(uid) { mutableStateOf(initial.bankName) }
    var agency by remember(uid) { mutableStateOf(initial.agency) }
    var account by remember(uid) { mutableStateOf(initial.account) }
    var message by remember(uid) { mutableStateOf(initial.message) }
    var busy by remember(uid) { mutableStateOf(false) }
    var failure by remember(uid) { mutableStateOf(false) }
    val draft = DeveloperSupportData(enabled, pix, bank, agency, account, message).normalized()
    val valid = draft.valid

    AlertDialog(
        onDismissRequest = { if (!busy) onDismiss() },
        title = { Text("Editar informações de apoio", color = Wine) },
        text = {
            Column(Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()),
                verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                    Text("Exibir dados de apoio aos membros", modifier = Modifier.weight(1f))
                    Switch(enabled, onCheckedChange = { enabled = it }, enabled = !busy)
                }
                OutlinedTextField(pix, { pix = it.take(140) }, enabled = !busy,
                    label = { Text("Chave Pix (opcional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth().testTag("atrio-support-edit-pix"))
                OutlinedTextField(bank, { bank = it.take(80) }, enabled = !busy,
                    label = { Text("Banco (opcional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(agency, { agency = it.take(30) }, enabled = !busy,
                    label = { Text("Agência (opcional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(account, { account = it.take(50) }, enabled = !busy,
                    label = { Text("Conta (opcional)") }, singleLine = true,
                    modifier = Modifier.fillMaxWidth())
                OutlinedTextField(message, { message = it.take(180) }, enabled = !busy,
                    label = { Text("Mensagem de apoio (opcional)") },
                    minLines = 2, maxLines = 4, modifier = Modifier.fillMaxWidth())
                Text("Informe todos os campos bancários ou deixe-os vazios. Para publicar, configure o Pix ou os dados bancários.",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
                if (!valid) Text("Complete os dados bancários e configure ao menos uma forma de apoio para publicar.",
                    color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall)
                if (failure) Text("Não foi possível salvar. Confira sua conexão e suas permissões.",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && valid, modifier = Modifier.testTag("atrio-support-save"), onClick = {
                busy = true
                failure = false
                onSave(draft) { success ->
                    busy = false
                    if (success) onDismiss() else failure = true
                }
            }) { Text(if (busy) "Salvando…" else "Salvar", color = Wine) }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onDismiss) { Text("Cancelar") } }
    )
}
