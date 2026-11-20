package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

internal object ProfileV3Policy {
    const val CONSENT_VERSION = "perfil-v3-2026-11"
    const val SAINT_LIMIT = 60
    const val DEVOTION_LIMIT = 160
    val ageBands = listOf("18–24", "25–34", "35–44", "45–54", "55+")
    val maritalStatuses = listOf(
        "Solteiro(a)", "Casado(a)", "Separado(a)", "Divorciado(a)", "Viúvo(a)"
    )
    val visibleFields = listOf("saint", "ageBand", "maritalStatus")

    fun data(document: DocumentSnapshot?): ProfileV3Draft = ProfileV3Draft(
        saint = document?.getString("saint").orEmpty(),
        devotionPhrase = document?.getString("devotionPhrase").orEmpty(),
        ageBand = document?.getString("ageBand").orEmpty(),
        maritalStatus = document?.getString("maritalStatus").orEmpty(),
        visibleFields = (document?.get("visibleFields") as? List<*>)
            ?.filterIsInstance<String>().orEmpty().filter { it in visibleFields }.toSet(),
        publicInterests = (document?.get("publicInterests") as? List<*>)
            ?.filterIsInstance<String>().orEmpty()
            .filter { it in RegistrationOptionalPolicy.interests }.take(3),
        consentAccepted = document?.getString("consentVersion") == CONSENT_VERSION
    )

    fun projection(draft: ProfileV3Draft): Map<String, Any> = buildMap {
        if ("saint" in draft.visibleFields && draft.saint.isNotBlank()) {
            put("saint", draft.saint.trim())
            if (draft.devotionPhrase.isNotBlank()) put("devotionPhrase", draft.devotionPhrase.trim())
        }
        if ("ageBand" in draft.visibleFields && draft.ageBand in ageBands) put("ageBand", draft.ageBand)
        if ("maritalStatus" in draft.visibleFields && draft.maritalStatus in maritalStatuses) {
            put("maritalStatus", draft.maritalStatus)
        }
        if (draft.publicInterests.isNotEmpty()) put("interests", draft.publicInterests)
    }
}

internal data class ProfileV3Draft(
    val saint: String = "",
    val devotionPhrase: String = "",
    val ageBand: String = "",
    val maritalStatus: String = "",
    val visibleFields: Set<String> = emptySet(),
    val publicInterests: List<String> = emptyList(),
    val consentAccepted: Boolean = false
)

@Composable
internal fun ProfileV3Editor(db: FirebaseFirestore, uid: String) {
    var editorOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var savedMessage by remember(uid) { mutableStateOf(false) }
    if (editorOpen) ProfileV3EditorDialog(
        db, uid, onClose = { editorOpen = false },
        onSaved = { editorOpen = false; savedMessage = true }
    )
    Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
        OutlinedButton(
            onClick = { editorOpen = true; savedMessage = false },
            modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-edit")
        ) { Text("Editar informações e interesses") }
        if (savedMessage) Text(
            "Informações atualizadas.",
            color = Wine,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("atrio-profile-v3-saved")
        )
    }
}

@Composable
internal fun ProfileV3PreviewButton(onClick: () -> Unit) {
    TextButton(
        onClick = onClick,
        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-preview")
    ) { Text("Ver como os outros veem") }
}

@Composable
internal fun ProfileV3Summary(db: FirebaseFirestore, uid: String) {
    var draft by remember(uid) { mutableStateOf(ProfileV3Draft()) }
    var loading by remember(uid) { mutableStateOf(true) }
    LaunchedEffect(db, uid) {
        db.document("users/$uid/private/profile_v3").get().addOnCompleteListener { result ->
            loading = false
            if (result.isSuccessful) {
                draft = ProfileV3Policy.data(result.result?.takeIf { it.exists() })
            }
        }
    }
    if (loading) return
    val hasAbout = draft.saint.isNotBlank() || draft.ageBand.isNotBlank() ||
        draft.maritalStatus.isNotBlank()
    val hasInterests = draft.publicInterests.isNotEmpty()
    if (!hasAbout && !hasInterests) return
    Column(
        Modifier.fillMaxWidth().testTag("atrio-profile-v3-summary"),
        verticalArrangement = Arrangement.spacedBy(6.dp)
    ) {
        if (hasAbout) {
            Text("Sobre mim", fontWeight = FontWeight.Bold, color = Wine)
            if (draft.saint.isNotBlank()) {
                ProfilePrivateSummaryRow("Devoção", draft.saint,
                    "saint" in draft.visibleFields)
                if (draft.devotionPhrase.isNotBlank()) Text(
                    "“${draft.devotionPhrase}”", style = MaterialTheme.typography.bodySmall,
                    color = Muted, modifier = Modifier.padding(start = 8.dp)
                )
            }
            if (draft.ageBand.isNotBlank()) {
                ProfilePrivateSummaryRow("Faixa etária", draft.ageBand,
                    "ageBand" in draft.visibleFields)
            }
            if (draft.maritalStatus.isNotBlank()) {
                ProfilePrivateSummaryRow("Estado civil", draft.maritalStatus,
                    "maritalStatus" in draft.visibleFields)
            }
        }
        if (hasInterests) {
            Text("Vamos conversar sobre…", fontWeight = FontWeight.Bold, color = Wine,
                modifier = Modifier.padding(top = 4.dp))
            Text(draft.publicInterests.joinToString(" · "), color = Ink)
        }
    }
}

@Composable
private fun ProfilePrivateSummaryRow(label: String, value: String, visible: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("$label · $value", modifier = Modifier.weight(1f), color = Ink)
        Text(if (visible) "Visível" else "Oculto",
            style = MaterialTheme.typography.labelSmall, color = if (visible) Wine else Muted)
    }
}

@Composable
internal fun ProfileV3EditorDialog(
    db: FirebaseFirestore,
    uid: String,
    onClose: () -> Unit,
    onSaved: () -> Unit = onClose
) {
    var draft by remember(uid) { mutableStateOf(ProfileV3Draft()) }
    var availableInterests by remember(uid) { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember(uid) { mutableStateOf(true) }
    var busy by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf("") }
    var loaded by rememberSaveable(uid) { mutableStateOf(false) }
    var loadAttempt by remember(uid) { mutableIntStateOf(0) }
    val v3Ref = remember(db, uid) { db.document("users/$uid/private/profile_v3") }
    val preferencesRef = remember(db, uid) { db.document("users/$uid/private/preferences") }
    val publicRef = remember(db, uid) { db.collection("public_profiles").document(uid) }
    val profileRef = remember(db, uid) { db.collection("profiles").document(uid) }

    LaunchedEffect(db, uid, loadAttempt) {
        if (loaded) return@LaunchedEffect
        db.runTransaction { transaction ->
            val v3 = transaction.get(v3Ref)
            val preferences = transaction.get(preferencesRef)
            Pair(v3, preferences)
        }.addOnCompleteListener { result ->
            loading = false
            if (result.isSuccessful) {
                val snapshots = result.result
                draft = ProfileV3Policy.data(snapshots.first.takeIf { it.exists() })
                availableInterests = (snapshots.second.get("interests") as? List<*>)
                    ?.filterIsInstance<String>().orEmpty()
                    .filter { it in RegistrationOptionalPolicy.interests }.distinct()
                loaded = true
            } else message = "Não foi possível carregar seus dados. Tente novamente."
        }
    }

    val valid = draft.saint.length <= ProfileV3Policy.SAINT_LIMIT &&
        draft.devotionPhrase.length <= ProfileV3Policy.DEVOTION_LIMIT &&
        (draft.ageBand.isBlank() || draft.ageBand in ProfileV3Policy.ageBands) &&
        (draft.maritalStatus.isBlank() || draft.maritalStatus in ProfileV3Policy.maritalStatuses) &&
        draft.visibleFields.all { it in ProfileV3Policy.visibleFields } &&
        draft.publicInterests.size <= 3 && draft.publicInterests.distinct().size == draft.publicInterests.size &&
        draft.publicInterests.all { it in availableInterests } &&
        ("saint" !in draft.visibleFields || draft.saint.trim().isNotEmpty()) &&
        ("ageBand" !in draft.visibleFields || draft.ageBand.isNotBlank()) &&
        ("maritalStatus" !in draft.visibleFields || draft.maritalStatus.isNotBlank())

    BackHandler { if (!busy) onClose() }
    AlertDialog(
        onDismissRequest = { if (!busy) onClose() },
        title = { Text("Editar perfil") },
        text = {
            LazyColumn(
                modifier = Modifier.heightIn(max = 520.dp).testTag("atrio-profile-v3-editor"),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (loading) item {
                    LinearProgressIndicator(Modifier.fillMaxWidth())
                    Text("Carregando informações privadas…")
                }
                item {
                    Text("Sobre mim", fontWeight = FontWeight.Bold, color = Wine)
                    Text(
                        "Preencha apenas o que quiser. Não pedimos nem guardamos a data de nascimento.",
                        style = MaterialTheme.typography.bodySmall, color = Muted
                    )
                }
                item {
                    OutlinedTextField(
                        value = draft.saint,
                        onValueChange = { draft = draft.copy(saint = it.take(ProfileV3Policy.SAINT_LIMIT)) },
                        enabled = loaded && !busy, singleLine = true,
                        label = { Text("Santo de devoção (opcional)") },
                        supportingText = { Text("${draft.saint.length}/${ProfileV3Policy.SAINT_LIMIT}") },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-saint")
                    )
                    OutlinedTextField(
                        value = draft.devotionPhrase,
                        onValueChange = {
                            draft = draft.copy(devotionPhrase = it.take(ProfileV3Policy.DEVOTION_LIMIT))
                        },
                        enabled = loaded && !busy, minLines = 2, maxLines = 3,
                        label = { Text("Uma frase sobre essa devoção (opcional)") },
                        supportingText = {
                            Text("${draft.devotionPhrase.length}/${ProfileV3Policy.DEVOTION_LIMIT}")
                        },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-devotion")
                    )
                    VisibilityToggle(
                        "Mostrar minha devoção no perfil público",
                        "saint" in draft.visibleFields,
                        enabled = loaded && !busy && draft.saint.isNotBlank(),
                        tag = "atrio-profile-v3-show-saint"
                    ) { checked ->
                        draft = draft.copy(visibleFields = draft.visibleFields
                            .let { if (checked) it + "saint" else it - "saint" })
                    }
                }
                item {
                    Text("Faixa etária", fontWeight = FontWeight.Bold, color = Wine)
                    Text("Escolha uma faixa manualmente. Não guardamos sua data de nascimento.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    ProfileV3Policy.ageBands.forEach { option ->
                        SelectableProfileOption(
                            option, draft.ageBand == option, loaded && !busy,
                            "atrio-profile-v3-age-${option.hashCode()}"
                        ) {
                            draft = draft.copy(ageBand = if (draft.ageBand == option) "" else option)
                            if (draft.ageBand.isBlank()) draft =
                                draft.copy(visibleFields = draft.visibleFields - "ageBand")
                        }
                    }
                    VisibilityToggle("Mostrar minha faixa etária",
                        "ageBand" in draft.visibleFields,
                        enabled = loaded && !busy && draft.ageBand.isNotBlank(),
                        tag = "atrio-profile-v3-show-age"
                    ) { checked ->
                        draft = draft.copy(visibleFields = draft.visibleFields
                            .let { if (checked) it + "ageBand" else it - "ageBand" })
                    }
                }
                item {
                    Text("Estado civil", fontWeight = FontWeight.Bold, color = Wine)
                    Text("Oculto por padrão. Você decide se quer exibi-lo.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    ProfileV3Policy.maritalStatuses.forEach { option ->
                        SelectableProfileOption(
                            option, draft.maritalStatus == option, loaded && !busy,
                            "atrio-profile-v3-marital-${option.hashCode()}"
                        ) {
                            draft = draft.copy(maritalStatus =
                                if (draft.maritalStatus == option) "" else option)
                            if (draft.maritalStatus.isBlank()) draft =
                                draft.copy(visibleFields = draft.visibleFields - "maritalStatus")
                        }
                    }
                    VisibilityToggle("Mostrar meu estado civil",
                        "maritalStatus" in draft.visibleFields,
                        enabled = loaded && !busy && draft.maritalStatus.isNotBlank(),
                        tag = "atrio-profile-v3-show-marital"
                    ) { checked ->
                        draft = draft.copy(visibleFields = draft.visibleFields
                            .let { if (checked) it + "maritalStatus" else it - "maritalStatus" })
                    }
                }
                item {
                    Text("Vamos conversar sobre…", fontWeight = FontWeight.Bold, color = Wine)
                    Text("Selecione até três interesses já informados. Eles ficam privados até você escolhê-los.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                    availableInterests.forEachIndexed { index, interest ->
                        SelectableProfileOption(
                            interest, interest in draft.publicInterests, loaded && !busy &&
                                (interest in draft.publicInterests || draft.publicInterests.size < 3),
                            "atrio-profile-v3-interest-$index"
                        ) {
                            draft = draft.copy(publicInterests =
                                if (interest in draft.publicInterests) draft.publicInterests - interest
                                else (draft.publicInterests + interest).take(3))
                        }
                    }
                    if (availableInterests.isEmpty()) {
                        Text("Adicione interesses em Conta e privacidade antes de publicá-los.",
                            style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
                item {
                    HorizontalDivider()
                    Row(verticalAlignment = Alignment.Top) {
                        Checkbox(
                            checked = draft.consentAccepted,
                            onCheckedChange = { draft = draft.copy(consentAccepted = it) },
                            enabled = !busy, modifier = Modifier.testTag("atrio-profile-v3-consent")
                        )
                        Text(
                            "Autorizo guardar estes dados opcionais no meu perfil privado. " +
                                "Somente os campos marcados como visíveis serão mostrados a outros membros; " +
                                "posso ocultá-los ou apagá-los depois.",
                            modifier = Modifier.padding(top = 12.dp),
                            style = MaterialTheme.typography.bodySmall
                        )
                    }
                }
                if (message.isNotBlank()) item {
                    Text(message, color = if (message.startsWith("Não foi")) MaterialTheme.colorScheme.error else Wine,
                        modifier = Modifier.testTag("atrio-profile-v3-message"))
                }
                if (!loading && !loaded) item {
                    OutlinedButton(
                        onClick = { loading = true; message = ""; loadAttempt++ },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-retry")
                    ) { Text("Tentar carregar novamente") }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = loaded && !loading && !busy && valid && draft.consentAccepted,
                modifier = Modifier.testTag("atrio-profile-v3-save"),
                onClick = {
                    busy = true
                    message = ""
                    val current = draft
                    db.runTransaction { transaction ->
                        val privateProfile = transaction.get(profileRef)
                        val publicProfile = transaction.get(publicRef)
                        val preferences = transaction.get(preferencesRef)
                        val prefsInterests = (preferences.get("interests") as? List<*>)
                            ?.filterIsInstance<String>().orEmpty()
                            .filter { it in RegistrationOptionalPolicy.interests }
                        require(current.publicInterests.all { it in prefsInterests }) {
                            "Os interesses privados foram alterados. Recarregue o perfil."
                        }
                        val values = mapOf(
                            "saint" to current.saint.trim(),
                            "devotionPhrase" to current.devotionPhrase.trim(),
                            "ageBand" to current.ageBand,
                            "maritalStatus" to current.maritalStatus,
                            "visibleFields" to current.visibleFields.toList(),
                            "publicInterests" to current.publicInterests,
                            "consentVersion" to ProfileV3Policy.CONSENT_VERSION,
                            "consentAt" to FieldValue.serverTimestamp(),
                            "updatedAt" to FieldValue.serverTimestamp()
                        )
                        transaction.set(v3Ref, values)
                        if (publicProfile.exists()) {
                            require(privateProfile.exists()) { "Perfil privado indisponível." }
                            val joinedAt = privateProfile.getTimestamp("createdAt")
                                ?: throw IllegalStateException("Data do perfil público inválida")
                            val publicValues = mutableMapOf<String, Any>(
                                "displayName" to privateProfile.getString("displayName").orEmpty(),
                                "bio" to privateProfile.getString("bio").orEmpty(),
                                "joinedAt" to joinedAt,
                                "updatedAt" to FieldValue.serverTimestamp()
                            )
                            publicValues.putAll(ProfileV3Policy.projection(current))
                            transaction.set(publicRef, publicValues)
                        }
                        true
                    }.addOnCompleteListener { result ->
                        busy = false
                        if (result.isSuccessful) {
                            message = "Informações salvas."
                            onSaved()
                        } else message = "Não foi possível salvar. Confira sua conexão e sua autorização."
                    }
                }
            ) { Text(if (busy) "Salvando…" else "Salvar") }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = onClose) { Text("Fechar") }
        }
    )
}

@Composable
internal fun ProfileV3Preview(
    db: FirebaseFirestore, uid: String, displayName: String, biography: String, onClose: () -> Unit
) {
    var draft by remember(uid) { mutableStateOf(ProfileV3Draft()) }
    var published by remember(uid) { mutableStateOf(false) }
    var loading by remember(uid) { mutableStateOf(true) }
    var failed by remember(uid) { mutableStateOf(false) }
    BackHandler(onBack = onClose)
    LaunchedEffect(db, uid) {
        db.runTransaction { transaction ->
            val v3 = transaction.get(db.document("users/$uid/private/profile_v3"))
            val publicProfile = transaction.get(db.collection("public_profiles").document(uid))
            Pair(v3, publicProfile)
        }.addOnCompleteListener { result ->
            loading = false
            if (result.isSuccessful) {
                draft = ProfileV3Policy.data(result.result.first.takeIf { it.exists() })
                published = result.result.second.exists()
            } else failed = true
        }
    }
    LazyColumn(
        Modifier.fillMaxSize().testTag("atrio-profile-v3-preview"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp)
    ) {
        item {
            TextButton(onClick = onClose) { Text("Voltar ao perfil") }
            Text("Prévia do perfil público", style = MaterialTheme.typography.headlineSmall,
                color = Wine, fontWeight = FontWeight.Bold)
            Text(
                if (published) "Esta apresentação está publicada."
                else "Esta prévia só ficará pública depois que você publicar sua apresentação.",
                style = MaterialTheme.typography.bodySmall, color = Muted
            )
        }
        if (loading) item { CircularProgressIndicator() }
        if (failed) item {
            Text("Não foi possível carregar a prévia. Os dados privados continuam protegidos.",
                color = MaterialTheme.colorScheme.error)
        }
        if (!loading && !failed) {
            val visible = ProfileV3Policy.projection(draft)
            item {
                Card(
                    Modifier.fillMaxWidth(),
                    border = BorderStroke(1.dp, Line),
                    shape = RoundedCornerShape(AtrioDimensions.CardRadius)
                ) {
                    Column(Modifier.padding(18.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        MemberAvatar(displayName, uid, Modifier.size(76.dp))
                        Text(displayName, style = MaterialTheme.typography.headlineSmall,
                            fontWeight = FontWeight.Bold)
                        MemberBadgeRow(uid, Modifier.fillMaxWidth(), centered = true)
                        if (biography.isNotBlank()) {
                            Text(
                                if (published) biography
                                else "A apresentação aparecerá quando você publicar: $biography",
                                style = MaterialTheme.typography.bodyMedium
                            )
                        }
                        Text("Sobre mim", style = MaterialTheme.typography.titleMedium,
                            color = Wine, fontWeight = FontWeight.Bold)
                        visible["saint"]?.let { Text("Devoção · $it") }
                        visible["devotionPhrase"]?.let { Text("“$it”", color = Muted) }
                        visible["ageBand"]?.let { Text("Faixa etária · $it") }
                        visible["maritalStatus"]?.let { Text("Estado civil · $it") }
                        if (visible.isEmpty()) Text("Você ainda não escolheu informações para exibir.",
                            color = Muted)
                    }
                }
            }
            item {
                Text("Vamos conversar sobre…", style = MaterialTheme.typography.titleMedium,
                    color = Wine, fontWeight = FontWeight.Bold)
                val interests = visible["interests"] as? List<*>
                if (interests.isNullOrEmpty()) Text("Nenhum interesse escolhido para exibição.", color = Muted)
                else interests.filterIsInstance<String>().forEach { Text("• $it") }
            }
            item {
                Text("Dados privados não mostrados: data de nascimento, cidade, paróquia, " +
                    "e-mail e interesses não selecionados.", style = MaterialTheme.typography.bodySmall,
                    color = Muted)
            }
        }
    }
}

@Composable
private fun SelectableProfileOption(
    label: String,
    selected: Boolean,
    enabled: Boolean,
    tag: String,
    onClick: () -> Unit
) {
    Row(
        Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(selected, onCheckedChange = { onClick() }, enabled = enabled)
        Text(label, modifier = Modifier.padding(start = 6.dp))
    }
}

@Composable
private fun VisibilityToggle(
    label: String, checked: Boolean, enabled: Boolean, tag: String,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(Modifier.fillMaxWidth().heightIn(min = 48.dp),
        verticalAlignment = Alignment.CenterVertically) {
        Switch(checked, onCheckedChange, enabled = enabled,
            modifier = Modifier.testTag(tag))
        Text(label, modifier = Modifier.padding(start = 10.dp))
    }
}
