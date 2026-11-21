package br.com.atriocatolico

import android.view.View
import android.view.accessibility.AccessibilityManager
import android.view.accessibility.AccessibilityNodeInfo
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.relocation.BringIntoViewRequester
import androidx.compose.foundation.relocation.bringIntoViewRequester
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusProperties
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.node.RootForTest
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getAllSemanticsNodes
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.Source
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull

@Composable
internal fun ProfileV3InterestEditor(
    db: FirebaseFirestore,
    actor: FirebaseUser,
    interest: ProfileV3Interest,
    detail: ProfileV3InterestDetail,
    enabled: Boolean,
    invalidLink: Boolean,
    restoreFocus: Boolean,
    onFocusRestored: () -> Unit,
    onEdit: (ProfileV3InterestDetail) -> Unit,
    onPick: () -> Unit
) {
    val pickerFocus = remember { FocusRequester() }
    val revealPicker = remember { BringIntoViewRequester() }
    val window = LocalWindowInfo.current
    val view = LocalView.current
    val pickerTag = "atrio-v3-pick-${interest.id}"
    LaunchedEffect(restoreFocus, enabled) {
        if (!restoreFocus || !enabled) return@LaunchedEffect
        snapshotFlow { window.isWindowFocused }.first { it }
        revealPicker.bringIntoView()
        val restored = withTimeoutOrNull(750L) {
            var inputFocused = false
            var accessibilityFocused = false
            while (!inputFocused || !accessibilityFocused) {
                withFrameNanos { }
                if (!view.hasWindowFocus()) continue
                if (!inputFocused) inputFocused = pickerFocus.requestFocus(FocusDirection.Enter)
                if (inputFocused) accessibilityFocused = view.restorePickerAccessibilityFocus(pickerTag)
            }
            true
        }
        if (restored == true) onFocusRestored()
    }
    val length = detail.question.profileV3QuestionLength()
    OutlinedTextField(
        value = detail.question,
        onValueChange = { onEdit(detail.copy(question = it)) },
        label = { Text("Pergunta opcional · ${interest.label}") },
        supportingText = {
            Text(if (length > PROFILE_V3_QUESTION_LIMIT) "$length/$PROFILE_V3_QUESTION_LIMIT · Limite excedido"
                else "$length/$PROFILE_V3_QUESTION_LIMIT")
        },
        enabled = enabled,
        isError = length > PROFILE_V3_QUESTION_LIMIT,
        maxLines = 4,
        modifier = Modifier.fillMaxWidth().testTag("atrio-v3-question-${interest.id}")
    )
    if (detail.question.isNotEmpty()) {
        TextButton(
            enabled = enabled,
            onClick = { onEdit(detail.copy(question = "")) },
            modifier = Modifier.testTag("atrio-v3-clear-question-${interest.id}")
        ) {
            Text("Apagar pergunta")
        }
    }
    detail.postId?.let { id ->
        val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
        var linkTitle by remember(auth, actor, id) { mutableStateOf<String?>(null) }
        DisposableEffect(db, actor, id) {
            var active = true
            db.collection("posts").document(id).get(Source.SERVER).addOnSuccessListener { post ->
                if (!active || auth.currentUser !== actor) return@addOnSuccessListener
                val author = post.getString("uid")?.takeIf(profileV3DocumentId::matches)
                    ?: return@addOnSuccessListener
                val title = post.getString("title")?.takeIf { it.isNotBlank() }
                    ?: return@addOnSuccessListener
                db.document("users/${actor.uid}/blockedMembers/$author").get(Source.SERVER)
                    .addOnSuccessListener { blocked ->
                        if (active && auth.currentUser === actor && !blocked.exists()) linkTitle = title
                    }
            }
            onDispose { active = false }
        }
        Text(
            linkTitle?.let { "Discussão vinculada · $it" } ?: "Discussão vinculada",
            style = MaterialTheme.typography.bodyMedium
        )
    }
    TextButton(
        enabled = enabled,
        onClick = onPick,
        modifier = Modifier
            .bringIntoViewRequester(revealPicker)
            .focusRequester(pickerFocus)
            .focusProperties { canFocus = enabled }
            .testTag(pickerTag)
            .semantics { testTagsAsResourceId = true }
    ) {
        Text(if (detail.postId == null) "Escolher discussão" else "Trocar discussão")
    }
    if (detail.postId != null) {
        TextButton(
            enabled = enabled,
            onClick = { onEdit(detail.copy(postId = null)) },
            modifier = Modifier.testTag("atrio-v3-remove-link-${interest.id}")
        ) {
            Text("Remover vínculo")
        }
    }
    if (invalidLink) {
        Text(
            "Discussão indisponível. Troque ou remova o vínculo.",
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            color = MaterialTheme.colorScheme.error,
            style = MaterialTheme.typography.bodySmall
        )
    }
    if (detail.fields().isNotEmpty()) {
        Text("Ao ocultar este interesse e salvar, a pergunta e o vínculo serão apagados.",
            style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

private fun View.restorePickerAccessibilityFocus(pickerTag: String): Boolean {
    val access = context.getSystemService(AccessibilityManager::class.java)
    if (access?.isTouchExplorationEnabled != true) return true
    // Compose publica a ação como um nó virtual. Aguarde que ela reapareça na janela ativa.
    val semanticsId = (this as? RootForTest)?.semanticsOwner
        ?.getAllSemanticsNodes(mergingEnabled = false)
        ?.firstOrNull { it.config.getOrNull(SemanticsProperties.TestTag) == pickerTag }?.id ?: return false
    val provider = accessibilityNodeProvider ?: return false
    val action = provider.createAccessibilityNodeInfo(semanticsId) ?: return false
    if (!action.isVisibleToUser) return false
    return action.isAccessibilityFocused || provider.performAction(
        semanticsId, AccessibilityNodeInfo.ACTION_ACCESSIBILITY_FOCUS, null
    )
}

private data class PickableDiscussion(val id: String, val title: String, val category: String)

@Composable
internal fun ProfileV3DiscussionPicker(
    db: FirebaseFirestore,
    uid: String,
    interest: ProfileV3Interest,
    current: String?,
    onClose: () -> Unit,
    onSelect: (String) -> Unit
) {
    val auth = remember(db) { FirebaseAuth.getInstance(db.app) }
    val actor = remember(auth, uid) { auth.currentUser?.takeIf { it.uid == uid } }
    var filtered by remember(interest) { mutableStateOf(true) }
    var selected by remember(interest) { mutableStateOf<String?>(null) }
    var pageStart by remember(interest) { mutableStateOf<DocumentSnapshot?>(null) }
    var next by remember(interest) { mutableStateOf<DocumentSnapshot?>(null) }
    var posts by remember(interest) { mutableStateOf<List<PickableDiscussion>>(emptyList()) }
    var loading by remember(interest) { mutableStateOf(true) }
    var failed by remember(interest) { mutableStateOf(false) }
    var retry by remember(interest) { mutableIntStateOf(0) }

    DisposableEffect(db, uid, actor, interest, filtered, pageStart, retry) {
        var active = true
        loading = true
        failed = false
        next = null
        posts = emptyList()
        fun usable() = active && actor != null && auth.currentUser === actor
        if (actor == null || auth.currentUser !== actor) {
            loading = false
            failed = true
        } else {
            db.collection("users").document(uid).collection("blockedMembers").get(Source.SERVER)
                .addOnCompleteListener { blocks ->
                    if (!usable()) return@addOnCompleteListener
                    if (!blocks.isSuccessful) {
                        loading = false
                        failed = true
                        return@addOnCompleteListener
                    }
                    val hidden = blocks.result.documents.mapTo(mutableSetOf()) { it.id }
                    var query: Query = db.collection("posts")
                    if (filtered) query = query.whereEqualTo("category", interest.category)
                    pageStart?.let { query = query.startAfter(it) }
                    query.limit(20).get(Source.SERVER).addOnCompleteListener postsLoaded@{ result ->
                        if (!usable()) return@postsLoaded
                        loading = false
                        failed = !result.isSuccessful
                        if (result.isSuccessful) {
                            val documents = result.result.documents
                            next = documents.lastOrNull().takeIf { documents.size == 20 }
                            posts = documents.mapNotNull { document ->
                                val author = document.getString("uid")
                                val title = document.getString("title")
                                val category = document.getString("category").orEmpty()
                                if (author == null || author in hidden || title.isNullOrBlank() ||
                                    !profileV3DocumentId.matches(document.id)) null
                                else PickableDiscussion(document.id, title, category)
                            }
                        }
                    }
                }
        }
        val sessionListener = FirebaseAuth.AuthStateListener {
            if (it.currentUser !== actor) onClose()
        }
        auth.addAuthStateListener(sessionListener)
        onDispose {
            active = false
            auth.removeAuthStateListener(sessionListener)
        }
    }

    AlertDialog(
        onDismissRequest = onClose,
        title = { Text("Escolher discussão") },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = filtered,
                    onClick = {
                        selected = null
                        pageStart = null
                        filtered = !filtered
                    },
                    label = { Text(interest.category) }
                )
                when {
                    loading -> CircularProgressIndicator()
                    failed -> {
                        Text("Não foi possível consultar o mural.")
                        TextButton(onClick = { retry++ }) { Text("Tentar novamente") }
                    }
                    else -> LazyColumn(
                        Modifier.heightIn(max = 280.dp).testTag("atrio-v3-discussion-candidates")
                    ) {
                        if (posts.isEmpty()) item { Text("Nenhuma discussão disponível nesta página.") }
                        items(posts, key = { it.id }) { post ->
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                RadioButton(
                                    selected = selected == post.id,
                                    onClick = { selected = post.id },
                                    modifier = Modifier.testTag("atrio-v3-candidate-${post.id}")
                                )
                                Column {
                                    Text(post.title, fontWeight = FontWeight.SemiBold)
                                    Text(post.category, style = MaterialTheme.typography.bodySmall)
                                }
                            }
                        }
                        next?.let { cursor ->
                            item {
                                TextButton(onClick = { selected = null; pageStart = cursor }) {
                                    Text("Próxima página")
                                }
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            TextButton(
                enabled = !loading && selected != null && posts.any { it.id == selected },
                onClick = { if (auth.currentUser === actor) selected?.let(onSelect) },
                modifier = Modifier.testTag("atrio-v3-link-confirm")
            ) { Text(if (current == null) "Vincular" else "Trocar vínculo") }
        },
        dismissButton = { TextButton(onClick = onClose) { Text("Cancelar") } }
    )
}

@Composable
internal fun PublicProfileV3Interest(
    auth: FirebaseAuth,
    viewer: FirebaseUser,
    profileUid: String,
    interest: ProfileV3Interest,
    question: String?,
    resolver: ProfileV3DiscussionResolver,
    stillVisible: () -> Boolean,
    onOpen: (String) -> Unit
) {
    val scope = rememberCoroutineScope()
    val open by rememberUpdatedState(onOpen)
    val visible by rememberUpdatedState(stillVisible)
    var result by remember { mutableStateOf<ProfileV3Discussion?>(null) }
    LaunchedEffect(resolver) {
        val checked = resolver.resolve(viewer, profileUid, interest)
        if (auth.currentUser === viewer && visible()) result = checked
    }
    Text(interest.label, fontWeight = FontWeight.SemiBold)
    question?.let { Text(it, style = MaterialTheme.typography.bodyMedium) }
    when (val confirmed = result) {
        null -> Text("Consultando discussão…", style = MaterialTheme.typography.bodySmall, color = Muted)
        ProfileV3Discussion.NoLink -> Unit
        ProfileV3Discussion.Unavailable -> Text(
            "Discussão indisponível",
            modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            style = MaterialTheme.typography.bodySmall, color = Muted
        )
        is ProfileV3Discussion.Available -> {
            Text(confirmed.title, style = MaterialTheme.typography.bodyMedium)
            OutlinedButton(
                onClick = {
                    if (result != confirmed || auth.currentUser !== viewer || !visible()) return@OutlinedButton
                    result = null
                    scope.launch {
                        val checked = resolver.resolve(viewer, profileUid, interest)
                        if (auth.currentUser !== viewer || !visible()) return@launch
                        result = if (checked == ProfileV3Discussion.NoLink) ProfileV3Discussion.Unavailable else checked
                        if (checked is ProfileV3Discussion.Available && checked.postId == confirmed.postId) {
                            open(checked.postId)
                        }
                    }
                },
                modifier = Modifier.fillMaxWidth().testTag("atrio-v3-open-${interest.id}")
            ) { Text("Ver conversa no mural") }
        }
    }
}
