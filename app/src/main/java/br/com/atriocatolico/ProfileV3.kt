package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.selection.toggleable
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges
import kotlinx.coroutines.flow.first

internal object ProfileV3Policy {
    const val CONSENT_VERSION = "perfil-v3-2026-11"
    const val SAINT_LIMIT = 60
    const val DEVOTION_LIMIT = 160
    val ageBands = listOf("18–24", "25–34", "35–44", "45–54", "55+")
    val maritalStatuses = listOf(
        "Solteiro(a)", "Casado(a)", "Separado(a)", "Divorciado(a)", "Viúvo(a)"
    )
    val visibleFields = listOf("saint", "ageBand", "maritalStatus")
    val publicFields = visibleFields + listOf("devotionPhrase", "interests", "interestQuestions")

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
        consentAccepted = document?.getString("consentVersion") == CONSENT_VERSION,
        interestDetails = (document?.get("interestDetails") as? Map<*, *>)?.let { stored ->
            ProfileV3Interest.entries.mapNotNull { interest ->
                val fields = stored[interest.id] as? Map<*, *> ?: return@mapNotNull null
                interest.id to ProfileV3InterestDetail(
                    question = fields["question"] as? String ?: "",
                    postId = (fields["postId"] as? String)?.takeIf(profileV3DocumentId::matches)
                )
            }.toMap()
        }.orEmpty()
    )

    fun projection(draft: ProfileV3Draft): Map<String, Any> = buildMap {
        if (!draft.consentAccepted) return@buildMap
        if ("saint" in draft.visibleFields && draft.saint.isNotBlank()) {
            put("saint", draft.saint.trim())
            if (draft.devotionPhrase.isNotBlank()) put("devotionPhrase", draft.devotionPhrase.trim())
        }
        if ("ageBand" in draft.visibleFields && draft.ageBand in ageBands) put("ageBand", draft.ageBand)
        if ("maritalStatus" in draft.visibleFields && draft.maritalStatus in maritalStatuses) {
            put("maritalStatus", draft.maritalStatus)
        }
        if (draft.publicInterests.isNotEmpty()) put("interests", draft.publicInterests)
        val questions = draft.interestProjection("question")
        if (questions.isNotEmpty()) put("interestQuestions", questions)
    }
}

internal data class ProfileV3Draft(
    val saint: String = "",
    val devotionPhrase: String = "",
    val ageBand: String = "",
    val maritalStatus: String = "",
    val visibleFields: Set<String> = emptySet(),
    val publicInterests: List<String> = emptyList(),
    val consentAccepted: Boolean = false,
    val interestDetails: Map<String, ProfileV3InterestDetail> = emptyMap()
)

internal data class ProfileIdentity(val name: String, val biography: String)

@Composable
internal fun ProfileV3Editor(
    db: FirebaseFirestore,
    uid: String,
    identity: ProfileIdentity? = null,
    onPhotoChanged: () -> Unit = {}
) {
    var editorOpen by rememberSaveable(uid) { mutableStateOf(false) }
    var status by remember(uid) { mutableStateOf<String?>(null) }
    var saveFeedbackPending by remember(uid) { mutableStateOf(false) }
    val window = LocalWindowInfo.current
    val revealStatus = remember { BringIntoViewRequester() }
    val openEditor = {
        saveFeedbackPending = false
        status = null
        editorOpen = true
    }
    if (editorOpen) ProfileV3EditorDialog(
        db, uid, onClose = { editorOpen = false },
        onSaved = {
            editorOpen = false
            saveFeedbackPending = true
        },
        onConsentWithdrawn = {
            editorOpen = false
            status = "Consentimento retirado. Dados opcionais do Perfil V3 apagados."
        },
        identity = identity,
        onPhotoChanged = onPhotoChanged
    )
    LaunchedEffect(uid, editorOpen, saveFeedbackPending) {
        if (editorOpen || !saveFeedbackPending) return@LaunchedEffect
        // O texto muda em uma região já presente depois que o diálogo devolve a janela.
        snapshotFlow { window.isWindowFocused }.first { it }
        revealStatus.bringIntoView()
        withFrameNanos { }
        status = "Informações atualizadas."
        saveFeedbackPending = false
    }
    Column {
        if (identity != null) {
            Button(onClick = openEditor, modifier = Modifier.fillMaxWidth().testTag("atrio-profile-edit")) {
                Text("Editar perfil")
            }
        } else {
            OutlinedButton(onClick = openEditor,
                modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-edit")) {
                Text("Editar informações e interesses")
            }
        }
        val feedback = status
        Text(
            text = feedback.orEmpty(),
            color = Wine,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.fillMaxWidth()
                .bringIntoViewRequester(revealStatus)
                .then(if (feedback == null) Modifier.height(1.dp) else Modifier.padding(top = 4.dp))
                .testTag(if (feedback == null) "atrio-profile-v3-status-region" else "atrio-profile-v3-status")
                .semantics { liveRegion = LiveRegionMode.Polite }
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
internal fun ProfileV3Summary(db: FirebaseFirestore, uid: String, modifier: Modifier = Modifier) {
    var draft by remember(db, uid) { mutableStateOf(ProfileV3Draft()) }
    DisposableEffect(db, uid) {
        val listener = db.document("users/$uid/private/profile_v3")
            .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, _ ->
                if (snapshot == null || snapshot.metadata.isFromCache) {
                    draft = ProfileV3Draft()
                } else if (!snapshot.metadata.hasPendingWrites()) {
                    draft = ProfileV3Policy.data(snapshot)
                }
            }
        onDispose { listener.remove() }
    }
    val hasAbout = draft.saint.isNotBlank() || draft.ageBand.isNotBlank() ||
        draft.maritalStatus.isNotBlank()
    val hasInterests = draft.publicInterests.isNotEmpty()
    if (!hasAbout && !hasInterests) return
    Column(
        modifier.fillMaxWidth().testTag("atrio-profile-v3-summary"),
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
            for (label in draft.publicInterests) {
                val detail = ProfileV3Interest.forLabel(label)?.let { draft.interestDetails[it.id] }
                Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(label, color = Ink, style = MaterialTheme.typography.titleSmall)
                    detail?.question?.takeIf { it.isNotBlank() }?.let { Text(it, color = Ink) }
                    if (detail?.postId != null) {
                        Text("Discussão vinculada", color = Muted, style = MaterialTheme.typography.bodySmall)
                    }
                }
            }
        }
    }
}

@Composable
private fun ProfilePrivateSummaryRow(label: String, value: String, visible: Boolean) {
    Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Text("$label · $value", modifier = Modifier.weight(1f), color = Ink)
        Text(if (visible) "Visível no perfil" else "Só você vê",
            style = MaterialTheme.typography.labelSmall, color = if (visible) Wine else Muted)
    }
}

private sealed interface ProfileV3SaveResult {
    data object Saved : ProfileV3SaveResult
    data object Stale : ProfileV3SaveResult
    data class InvalidLink(val interestKey: String) : ProfileV3SaveResult
}

@Composable
internal fun ProfileV3EditorDialog(
    db: FirebaseFirestore,
    uid: String,
    onClose: () -> Unit,
    onSaved: () -> Unit,
    onConsentWithdrawn: () -> Unit,
    identity: ProfileIdentity? = null,
    onPhotoChanged: () -> Unit = {}
) {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    val actor = remember(auth, uid) { auth.currentUser?.takeIf { it.uid == uid } }
    val close by rememberUpdatedState(onClose)
    DisposableEffect(auth, actor) {
        val listener = FirebaseAuth.AuthStateListener {
            if (actor == null || it.currentUser !== actor) close()
        }
        auth.addAuthStateListener(listener)
        onDispose { auth.removeAuthStateListener(listener) }
    }
    if (actor == null || auth.currentUser !== actor) return

    var draft by remember(uid) { mutableStateOf(ProfileV3Draft()) }
    var availableInterests by remember(uid) { mutableStateOf<List<String>>(emptyList()) }
    var loading by remember(uid) { mutableStateOf(true) }
    var busy by remember(uid) { mutableStateOf(false) }
    var message by remember(uid) { mutableStateOf("") }
    var loadedV3 by remember(db, uid) { mutableStateOf<DocumentSnapshot?>(null) }
    val loaded = loadedV3 != null
    var confirmWithdrawal by remember(uid) { mutableStateOf(false) }
    var loadAttempt by remember(uid) { mutableIntStateOf(0) }
    val v3Ref = remember(db, uid) { db.document("users/$uid/private/profile_v3") }
    val preferencesRef = remember(db, uid) { db.document("users/$uid/private/preferences") }
    val publicRef = remember(db, uid) { db.collection("public_profiles").document(uid) }
    val profileRef = remember(db, uid) { db.collection("profiles").document(uid) }
    val linksRef = remember(publicRef) { publicRef.profileV3Links() }
    val editorScroll = rememberLazyListState()
    var invalidLink by remember(db, uid) { mutableStateOf<String?>(null) }
    var restoreFocus by remember(db, uid) { mutableStateOf<String?>(null) }
    var picking by remember(db, uid) { mutableStateOf<ProfileV3Interest?>(null) }
    var draftPreview by remember(db, uid) { mutableStateOf(false) }
    val originalIdentity = remember(db, uid) { identity }
    var draftName by rememberSaveable(uid) { mutableStateOf(identity?.name.orEmpty()) }
    var draftBio by rememberSaveable(uid) { mutableStateOf(identity?.biography.orEmpty()) }
    var confirmDiscard by remember(uid) { mutableStateOf(false) }
    val editedIdentity = ProfileIdentity(draftName.trim(), draftBio.trim())
    val identityChanged = originalIdentity != null && editedIdentity != originalIdentity
    val originalDraft = loadedV3?.let { ProfileV3Policy.data(it.takeIf { it.exists() }) }
    val optionalChanged = originalDraft != null && draft != originalDraft
    val saveOptional = loaded && draft.consentAccepted && (identity == null || optionalChanged)
    val canSave = if (identity == null) saveOptional else
        editedIdentity.name.length in 2..35 && (identityChanged || saveOptional) &&
            (!optionalChanged || saveOptional)
    fun closeEditor() {
        when {
            busy || picking != null -> Unit
            draftPreview -> draftPreview = false
            identity != null && (identityChanged || optionalChanged) -> confirmDiscard = true
            else -> onClose()
        }
    }

    fun editInterest(interest: ProfileV3Interest, detail: ProfileV3InterestDetail) {
        if (detail.postId != draft.interestDetails[interest.id]?.postId && invalidLink == interest.id) {
            invalidLink = null
        }
        draft = draft.copy(interestDetails = draft.interestDetails + (interest.id to detail))
    }

    LaunchedEffect(db, uid, loadAttempt) {
        if (loaded) return@LaunchedEffect
        db.runTransaction { transaction ->
            val v3 = transaction.get(v3Ref)
            val preferences = transaction.get(preferencesRef)
            Pair(v3, preferences)
        }.addOnCompleteListener { result ->
            if (auth.currentUser !== actor) return@addOnCompleteListener
            loading = false
            if (result.isSuccessful) {
                val snapshots = result.result
                draft = ProfileV3Policy.data(snapshots.first.takeIf { it.exists() })
                availableInterests = (snapshots.second.get("interests") as? List<*>)
                    ?.filterIsInstance<String>().orEmpty()
                    .filter { it in RegistrationOptionalPolicy.interests }.distinct()
                loadedV3 = snapshots.first
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
        draft.interestDetails.values.all { it.question.profileV3QuestionLength() <= PROFILE_V3_QUESTION_LIMIT } &&
        ("saint" !in draft.visibleFields || draft.saint.trim().isNotEmpty()) &&
        ("ageBand" !in draft.visibleFields || draft.ageBand.isNotBlank()) &&
        ("maritalStatus" !in draft.visibleFields || draft.maritalStatus.isNotBlank())

    if (confirmWithdrawal) {
        AlertDialog(
            onDismissRequest = { if (!busy) confirmWithdrawal = false },
            title = { Text("Retirar consentimento do Perfil V3?") },
            text = {
                Text("Os dados opcionais do Perfil V3 serão apagados e deixarão de aparecer " +
                    "na sua apresentação pública. Seu perfil anterior e os interesses do cadastro " +
                    "serão preservados.")
            },
            confirmButton = {
                TextButton(
                    enabled = !busy,
                    modifier = Modifier.testTag("atrio-profile-v3-withdraw-confirm"),
                    onClick = {
                        if (auth.currentUser !== actor) return@TextButton
                        busy = true
                        db.runTransaction { transaction ->
                            val privateV3 = transaction.get(v3Ref)
                            val publicProfile = transaction.get(publicRef)
                            val links = transaction.get(linksRef)
                            val fields = ProfileV3Policy.publicFields.filter { publicProfile.contains(it) }
                            if (fields.isNotEmpty()) {
                                val changes = fields.associateWith { FieldValue.delete() } +
                                    ("updatedAt" to FieldValue.serverTimestamp())
                                transaction.update(publicRef, changes)
                            }
                            transaction.syncProfileV3Links(links, emptyMap())
                            if (privateV3.exists()) transaction.delete(v3Ref)
                            Unit
                        }.addOnCompleteListener { result ->
                            if (auth.currentUser !== actor) return@addOnCompleteListener
                            busy = false
                            confirmWithdrawal = false
                            if (result.isSuccessful) {
                                draft = ProfileV3Draft()
                                loadedV3 = null
                                onConsentWithdrawn()
                            } else {
                                message = "Não foi possível retirar o consentimento. Confira sua " +
                                    "conexão e tente novamente."
                            }
                        }
                    }
                ) {
                    Text(if (busy) "Retirando…" else "Retirar consentimento",
                        color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(enabled = !busy, onClick = { confirmWithdrawal = false }) {
                    Text("Cancelar")
                }
            }
        )
        return
    }

    fun closePicker(interest: ProfileV3Interest) {
        picking = null
        restoreFocus = interest.id
    }

    BackHandler(enabled = picking == null && !busy, onBack = ::closeEditor)
    AlertDialog(
        onDismissRequest = ::closeEditor,
        title = {
            Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Editar perfil")
                if (message.isNotBlank()) Text(
                    message,
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("atrio-profile-v3-message")
                        .semantics { liveRegion = LiveRegionMode.Polite }
                )
            }
        },
        text = {
            LazyColumn(
                state = editorScroll,
                modifier = Modifier.heightIn(max = 520.dp).testTag("atrio-profile-v3-editor"),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                if (identity != null) item(key = "identity") {
                    Text("Identidade", fontWeight = FontWeight.Bold, color = Wine)
                    OutlinedTextField(draftName, { draftName = it.take(35) },
                        enabled = !busy, singleLine = true,
                        label = { Text("Nome público") },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-name"),
                        supportingText = { Text("${draftName.trim().length}/35 · mínimo de 2 caracteres") })
                    OutlinedTextField(draftBio, { draftBio = it.take(180) },
                        enabled = !busy, minLines = 2, maxLines = 4,
                        label = { Text("Apresentação (opcional)") },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-bio"),
                        supportingText = { Text("${draftBio.length}/180 caracteres") })
                    Text("Sua apresentação só fica pública com sua autorização.",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                }
                if (identity != null) item(key = "photo") {
                    if (!busy) ProfilePhotoManager(uid, onPhotoChanged)
                }
                if (identity != null) item(key = "preview") {
                    TextButton(
                        onClick = { draftPreview = true },
                        enabled = !busy,
                        modifier = Modifier.testTag("atrio-profile-draft-preview")
                    ) { Text("Ver prévia") }
                }
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
                }
                availableInterests.forEachIndexed { index, label ->
                    val interest = ProfileV3Interest.forLabel(label) ?: return@forEachIndexed
                    item(key = interest.id) {
                        val selected = label in draft.publicInterests
                        val detail = draft.interestDetails[interest.id] ?: ProfileV3InterestDetail()
                        SelectableProfileOption(
                            label, selected, loaded && !busy && (selected || draft.publicInterests.size < 3),
                            "atrio-profile-v3-interest-$index"
                        ) {
                            if (selected && invalidLink == interest.id) invalidLink = null
                            draft = if (selected) draft.copy(
                                publicInterests = draft.publicInterests - label,
                                interestDetails = draft.interestDetails - interest.id
                            ) else draft.copy(publicInterests = (draft.publicInterests + label).take(3))
                        }
                        if (!selected && originalDraft?.publicInterests?.contains(label) == true) {
                            Text(
                                "Ao salvar, o interesse será ocultado e sua pergunta e vínculo serão removidos.",
                                style = MaterialTheme.typography.bodySmall,
                                color = Muted
                            )
                        }
                        if (selected) ProfileV3InterestEditor(
                            db = db,
                            actor = actor,
                            interest = interest,
                            detail = detail,
                            enabled = loaded && !busy,
                            invalidLink = invalidLink == interest.id,
                            restoreFocus = restoreFocus == interest.id,
                            onFocusRestored = { restoreFocus = null },
                            onEdit = { editInterest(interest, it) },
                            onPick = {
                                restoreFocus = null
                                picking = interest
                            }
                        )
                    }
                }
                item {
                    if (availableInterests.isEmpty()) {
                        Text("Adicione interesses em Conta e privacidade antes de publicá-los.",
                            style = MaterialTheme.typography.bodySmall, color = Muted)
                    }
                }
                if (identity == null && draft.publicInterests.isNotEmpty()) item {
                    TextButton(onClick = { draftPreview = true }, enabled = !busy) {
                        Text("Ver como os outros veem")
                    }
                }
                item {
                    HorizontalDivider()
                    Row(verticalAlignment = Alignment.Top) {
                        Checkbox(
                            checked = draft.consentAccepted,
                            onCheckedChange = { draft = draft.copy(consentAccepted = it) },
                            enabled = loaded && !busy,
                            modifier = Modifier.testTag("atrio-profile-v3-consent")
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
                if (loadedV3?.exists() == true) item {
                    TextButton(
                        enabled = !busy,
                        onClick = { confirmWithdrawal = true; message = "" },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-profile-v3-withdraw")
                    ) { Text("Retirar consentimento", color = MaterialTheme.colorScheme.error) }
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
                enabled = !busy && canSave && (!saveOptional || valid),
                modifier = Modifier.testTag(if (identity == null) "atrio-profile-v3-save" else "atrio-profile-save"),
                onClick = {
                    if (auth.currentUser !== actor) return@TextButton
                    busy = true
                    message = ""
                    val current = draft
                    val original = loadedV3?.data
                    val newIdentity = editedIdentity.takeIf { identityChanged }
                    invalidLink = null
                    db.runTransaction<ProfileV3SaveResult> { transaction ->
                        val privateProfile = transaction.get(profileRef)
                        val publicProfile = transaction.get(publicRef)
                        if (newIdentity != null && ProfileIdentity(
                                privateProfile.getString("displayName").orEmpty(),
                                privateProfile.getString("bio").orEmpty()
                            ) != originalIdentity
                        ) return@runTransaction ProfileV3SaveResult.Stale
                        val identityValues = newIdentity?.let {
                            mapOf("displayName" to it.name, "bio" to it.biography)
                        }
                        if (!saveOptional) {
                            requireNotNull(identityValues)
                            transaction.update(profileRef, identityValues)
                            if (publicProfile.exists()) {
                                transaction.update(publicRef, identityValues +
                                    ("updatedAt" to FieldValue.serverTimestamp()))
                            }
                            return@runTransaction ProfileV3SaveResult.Saved
                        }
                        val privateV3 = transaction.get(v3Ref)
                        if (privateV3.data != original) return@runTransaction ProfileV3SaveResult.Stale
                        val preferences = transaction.get(preferencesRef)
                        val links = transaction.get(linksRef)
                        val prefsInterests = (preferences.get("interests") as? List<*>)
                            ?.filterIsInstance<String>().orEmpty()
                            .filter { it in RegistrationOptionalPolicy.interests }
                        require(current.publicInterests.all { it in prefsInterests }) {
                            "Os interesses privados foram alterados. Recarregue o perfil."
                        }
                        val postIds = current.interestProjection("postId")
                        val previousIds = ProfileV3Policy.data(privateV3).interestProjection("postId")
                        val publishedIds = links.get("postIds") as? Map<*, *>
                        for ((key, postId) in postIds) {
                            if (previousIds[key] == postId &&
                                (!publicProfile.exists() || publishedIds?.get(key) == postId)) continue
                            val post = transaction.get(db.collection("posts").document(postId))
                            val author = post.getString("uid")?.takeIf(profileV3DocumentId::matches)
                            if (author == null || post.getString("title").isNullOrBlank() ||
                                transaction.get(db.document("users/$uid/blockedMembers/$author")).exists()
                            ) return@runTransaction ProfileV3SaveResult.InvalidLink(key)
                        }
                        val values = mutableMapOf<String, Any>(
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
                        val details = current.interestFields()
                        if (details.isNotEmpty() || privateV3.contains("interestDetails")) {
                            values["interestDetails"] = details
                        }
                        if (identityValues != null) transaction.update(profileRef, identityValues)
                        transaction.set(v3Ref, values)
                        if (publicProfile.exists()) {
                            require(privateProfile.exists()) { "Perfil privado indisponível." }
                            val joinedAt = privateProfile.getTimestamp("createdAt")
                                ?: throw IllegalStateException("Data do perfil público inválida")
                            val publicValues = mutableMapOf<String, Any>(
                                "displayName" to (newIdentity?.name ?: privateProfile.getString("displayName").orEmpty()),
                                "bio" to (newIdentity?.biography ?: privateProfile.getString("bio").orEmpty()),
                                "joinedAt" to joinedAt,
                                "updatedAt" to FieldValue.serverTimestamp()
                            )
                            publicValues.putAll(ProfileV3Policy.projection(current))
                            transaction.set(publicRef, publicValues)
                            transaction.syncProfileV3Links(links, postIds)
                        } else {
                            transaction.syncProfileV3Links(links, emptyMap())
                        }
                        ProfileV3SaveResult.Saved
                    }.addOnCompleteListener { result ->
                        if (auth.currentUser !== actor) return@addOnCompleteListener
                        busy = false
                        when (val saved = if (result.isSuccessful) result.result else null) {
                            ProfileV3SaveResult.Saved -> onSaved()
                            ProfileV3SaveResult.Stale -> {
                                message = "Os dados do Perfil V3 mudaram. Feche e reabra o editor para recarregar."
                            }
                            is ProfileV3SaveResult.InvalidLink -> {
                                invalidLink = saved.interestKey
                                message = "Uma discussão ficou indisponível. Troque ou remova o vínculo indicado."
                            }
                            null -> message = "Não foi possível salvar. Confira sua conexão e sua autorização."
                        }
                    }
                }
            ) { Text(if (busy) "Salvando…" else if (identity != null) "Salvar perfil" else "Salvar") }
        },
        dismissButton = {
            TextButton(enabled = !busy, onClick = ::closeEditor) { Text(if (identity != null) "Cancelar" else "Fechar") }
        }
    )
    if (draftPreview) {
        val visible = ProfileV3Policy.projection(draft)
        AlertDialog(
            onDismissRequest = { draftPreview = false },
            title = { Text("Prévia · alterações não salvas") },
            text = {
                Column(Modifier.heightIn(max = 520.dp).verticalScroll(rememberScrollState()),
                    verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    if (identity != null) {
                        MemberAvatar(editedIdentity.name, uid, Modifier.size(64.dp))
                        Text(editedIdentity.name, style = MaterialTheme.typography.titleMedium)
                        if (editedIdentity.biography.isNotBlank()) Text(
                            editedIdentity.biography,
                            modifier = Modifier.testTag("atrio-profile-draft-preview-bio")
                        )
                    }
                    visible["saint"]?.let { Text("Devoção · $it") }
                    visible["devotionPhrase"]?.let { Text("“$it”") }
                    visible["ageBand"]?.let { Text("Faixa etária · $it") }
                    visible["maritalStatus"]?.let { Text("Estado civil · $it") }
                    if (draft.consentAccepted) {
                        val questions = draft.interestProjection("question")
                        draft.publicInterests.forEach { label ->
                            Text(label, fontWeight = FontWeight.SemiBold)
                            ProfileV3Interest.forLabel(label)?.let { interest ->
                                questions[interest.id]?.let { Text(it) }
                            }
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { draftPreview = false }) { Text("Fechar prévia") }
            }
        )
    }

    if (confirmDiscard) AlertDialog(
        onDismissRequest = { confirmDiscard = false },
        title = { Text("Descartar alterações?") },
        text = { Text("As alterações ainda não foram salvas.") },
        confirmButton = { TextButton(onClick = onClose) { Text("Descartar") } },
        dismissButton = {
            TextButton(onClick = { confirmDiscard = false }) { Text("Continuar editando") }
        }
    )

    // Preserve o botão e a posição da lista na janela sob o seletor.
    picking?.let { interest ->
        ProfileV3DiscussionPicker(
            db = db,
            uid = uid,
            interest = interest,
            current = draft.interestDetails[interest.id]?.postId,
            onClose = { closePicker(interest) },
            onSelect = { postId ->
                val detail = draft.interestDetails[interest.id] ?: ProfileV3InterestDetail()
                editInterest(interest, detail.copy(postId = postId))
                closePicker(interest)
            }
        )
    }
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
                else interests.filterIsInstance<String>().forEach { label ->
                    Text(label, fontWeight = FontWeight.SemiBold)
                    ProfileV3Interest.forLabel(label)?.let { interest ->
                        draft.interestProjection("question")[interest.id]?.let { Text(it) }
                    }
                }
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
        Modifier.fillMaxWidth().heightIn(min = 48.dp).testTag(tag)
            .toggleable(value = selected, enabled = enabled, role = Role.Checkbox, onValueChange = { onClick() }),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Checkbox(selected, onCheckedChange = null, enabled = enabled)
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
