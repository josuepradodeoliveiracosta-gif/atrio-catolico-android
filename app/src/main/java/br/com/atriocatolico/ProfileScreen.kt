package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FirebaseFirestore

@Composable
internal fun OnlineProfileScreen(
    db: FirebaseFirestore, uid: String, name: String, email: String, biography: String,
    posts: List<Post>, publicationsFooter: @Composable () -> Unit,
    onSignOut: () -> Unit, onModeration: (() -> Unit)?, onClergyReview: (() -> Unit)?,
    onCreate: () -> Unit, onOpen: (String) -> Unit,
    onLike: (String) -> Unit, onSave: (String) -> Unit
) {
    var badgesOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var editorOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var savedMessage by remember(uid) { mutableStateOf(false) }
    BackHandler(enabled = badgesOpen && !editorOpen) { badgesOpen = false }

    if (badgesOpen) {
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                TextButton(onClick = { badgesOpen = false }) { Text("Voltar ao perfil") }
                SectionTitle("Gerenciar selos")
                Text("Sua identificação na comunidade", color = Muted, fontSize = 13.sp)
            }
            item { MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true) }
            item {
                Column(verticalArrangement = Arrangement.spacedBy(10.dp)) { BadgeSettings(uid) }
            }
        }
    } else {
        val founderCanBroadcast = onModeration != null && onClergyReview != null &&
            LocalFounderUid.current.isNotBlank() && LocalFounderUid.current == uid
        val mine = posts.filter { it.mine }
        LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Card(colors = CardDefaults.cardColors(containerColor = Color.White),
                    shape = RoundedCornerShape(24.dp), border = BorderStroke(1.dp, Line)) {
                    Column(Modifier.fillMaxWidth().padding(20.dp),
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        if (LocalFounderUid.current.isNotBlank() && LocalFounderUid.current == uid) {
                            FounderBadgeArt(Modifier.size(88.dp), compact = false)
                        } else {
                            Surface(shape = CircleShape, color = WineSoft, modifier = Modifier.size(76.dp)) {
                                Box(contentAlignment = Alignment.Center) {
                                    Text(name.trim().take(1).uppercase(), color = Wine,
                                        fontFamily = FontFamily.Serif, fontSize = 32.sp,
                                        fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                        Text(name, fontFamily = FontFamily.Serif, fontSize = 26.sp,
                            fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                        MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true)
                        Text(biography.ifBlank { "Conte um pouco sobre sua caminhada na fé." },
                            color = Muted, fontSize = 14.sp, textAlign = TextAlign.Center)
                        Button(onClick = { savedMessage = false; editorOpen = true },
                            modifier = Modifier.fillMaxWidth()) { Text("Editar perfil") }
                        if (savedMessage) Text("Perfil atualizado.", color = Wine, fontSize = 12.sp)
                    }
                }
            }
            item {
                Card(onClick = { badgesOpen = true }, modifier = Modifier.fillMaxWidth(),
                    colors = CardDefaults.cardColors(containerColor = WineSoft),
                    shape = RoundedCornerShape(18.dp)) {
                    Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                        Text("Meus selos", color = Wine, fontWeight = FontWeight.Bold)
                        Text("Escolha sua identificação e acompanhe verificações.", color = Muted, fontSize = 13.sp)
                        Text("Gerenciar selos →", color = Wine, fontSize = 13.sp)
                    }
                }
            }
            item { PushSettings(uid, db) }
            item {
                SectionTitle("Minhas publicações")
                Text("Publicações encontradas entre as discussões carregadas. Abra uma para editar ou excluir.",
                    color = Muted, fontSize = 12.sp)
            }
            if (mine.isEmpty()) item {
                Text("Nenhuma publicação sua nesta lista. Você pode buscar mais discussões ou iniciar uma conversa.",
                    color = Muted, fontSize = 13.sp)
                OutlinedButton(onClick = onCreate) { Text("Criar discussão") }
            }
            items(mine, key = { it.id }) { DiscussionCard(it, onOpen, onLike, onSave) }
            item { publicationsFooter() }
            if (onModeration != null || onClergyReview != null) item {
                HorizontalDivider(color = Line)
                Spacer(Modifier.height(16.dp))
                Text("Administração", fontWeight = FontWeight.Bold, color = Wine)
                onModeration?.let { action ->
                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) { Text("Denúncias") }
                }
                onClergyReview?.let { action ->
                    OutlinedButton(onClick = action, modifier = Modifier.fillMaxWidth()) { Text("Solicitações de selos") }
                }
            }
            // Somente o fundador que também é administrador vê a opção.
            if (founderCanBroadcast) {
                item { AdminBroadcastPanel() }
                item { AdminTestBotsPanel() }
            }
            item {
                HorizontalDivider(color = Line)
                Spacer(Modifier.height(16.dp))
                Text("Minha conta", fontWeight = FontWeight.Bold, color = Wine)
                Text(email, color = Muted, fontSize = 13.sp)
                Text("Seu e-mail e sua apresentação são visíveis somente para você.", color = Muted, fontSize = 12.sp)
                Text("Átrio Católico · ${androidx.compose.ui.platform.LocalContext.current.let {
                    it.packageManager.getPackageInfo(it.packageName, 0).versionName.orEmpty()
                }}", color = Muted, fontSize = 12.sp)
                OutlinedButton(onClick = onSignOut, modifier = Modifier.fillMaxWidth()) { Text("Sair da conta") }
            }
        }
    }
    if (editorOpen) ProfileEditor(db, uid, name, biography,
        onClose = { editorOpen = false },
        onSaved = { editorOpen = false; savedMessage = true })
}

@Composable
private fun ProfileEditor(
    db: FirebaseFirestore, uid: String, name: String, biography: String,
    onClose: () -> Unit, onSaved: () -> Unit
) {
    var draftName by rememberSaveable(uid) { mutableStateOf(name) }
    var draftBio by rememberSaveable(uid) { mutableStateOf(biography) }
    var busy by remember { mutableStateOf(false) }
    var failure by remember { mutableStateOf("") }
    val validName = draftName.trim().length in 2..35
    val changed = draftName.trim() != name || draftBio.trim() != biography
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Editar perfil") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(draftName, { draftName = it.take(35) },
                    enabled = !busy, modifier = Modifier.fillMaxWidth(), singleLine = true,
                    label = { Text("Nome público") }, isError = !validName,
                    supportingText = { Text("${draftName.trim().length}/35 · mínimo de 2 caracteres") })
                OutlinedTextField(draftBio, { draftBio = it.take(180) },
                    enabled = !busy, modifier = Modifier.fillMaxWidth(), minLines = 3, maxLines = 5,
                    label = { Text("Apresentação (opcional)") },
                    supportingText = { Text("${draftBio.length}/180 caracteres") })
                Text("O nome será usado nas próximas publicações. Sua apresentação permanece privada.",
                    color = Muted, fontSize = 12.sp)
                if (failure.isNotBlank()) Text(failure, color = MaterialTheme.colorScheme.error, fontSize = 12.sp)
            }
        },
        confirmButton = {
            TextButton(enabled = !busy && validName && changed, onClick = {
                busy = true
                failure = ""
                db.collection("profiles").document(uid).update(mapOf(
                    "displayName" to draftName.trim(), "bio" to draftBio.trim()
                )).addOnCompleteListener { result ->
                    busy = false
                    if (result.isSuccessful) onSaved()
                    else failure = "Não foi possível salvar. Confira a conexão e tente novamente."
                }
            }) { Text(if (busy) "Salvando..." else "Salvar alterações") }
        },
        dismissButton = { TextButton(enabled = !busy, onClick = onClose) { Text("Cancelar") } }
    )
}
