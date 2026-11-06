package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.BookmarkBorder
import androidx.compose.material.icons.outlined.ChatBubbleOutline
import androidx.compose.material.icons.outlined.Close
import androidx.compose.material.icons.outlined.MoreVert
import androidx.compose.material.icons.outlined.Send
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusRequester
import androidx.compose.ui.focus.focusRequester
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.LocalSoftwareKeyboardController
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch

/**
 * Tela de discussão V2. Mantém os callbacks de gravação/moderação existentes;
 * não escreve diretamente no Firebase e não cria notificações de acompanhamento.
 *
 * O compositor é irmão do LazyColumn, em vez de um item ao final: nenhuma resposta
 * fica escondida sob ele e a digitação funciona com ajuste da área do teclado.
 */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun DetailScreen(
    post: Post, name: String, onLike: () -> Unit, onSave: () -> Unit,
    onReply: (String, (Boolean) -> Unit) -> Unit, onReport: (() -> Unit)? = null,
    followed: Boolean = false, onFollow: (() -> Unit)? = null,
    followBusy: Boolean = false, followIsSynced: Boolean = false,
    onDirectReply: ((String, Reply, (Boolean) -> Unit) -> Unit)? = null,
    currentUid: String = "",
    onMentionReply: ((String, MentionCandidate, (Boolean) -> Unit) -> Unit)? = null,
    reactionsEnabled: Boolean = false,
    reactionContent: @Composable (Reply, Boolean, () -> Unit) -> Unit = { _, _, _ -> },
    onEdit: (() -> Unit)? = null, onDelete: (() -> Unit)? = null,
    onDeleteReply: ((String) -> Unit)? = null,
    onReportReply: ((Reply) -> Unit)? = null,
    onOpenProfile: (String, String) -> Unit = { _, _ -> },
    repliesFooter: @Composable () -> Unit = {},
    moreReplies: Boolean = false,
    repliesLoading: Boolean = false,
    newestFirst: Boolean = false,
    onReplySortChange: ((Boolean) -> Unit)? = null
) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    val focusRequester = remember(post.id) { FocusRequester() }
    val focusManager = LocalFocusManager.current
    val keyboard = LocalSoftwareKeyboardController.current
    var response by rememberSaveable(post.id) { mutableStateOf("") }
    var composerOpen by rememberSaveable(post.id) { mutableStateOf(false) }
    var sendingReply by remember(post.id) { mutableStateOf(false) }
    var quotedReply by remember(post.id) { mutableStateOf<Reply?>(null) }
    var mentioned by remember(post.id) { mutableStateOf<MentionCandidate?>(null) }
    var reactionReplyId by remember(post.id) { mutableStateOf<String?>(null) }
    var replyMenuId by remember(post.id) { mutableStateOf<String?>(null) }
    var postMenuOpen by remember(post.id) { mutableStateOf(false) }
    var sortMenuOpen by remember(post.id) { mutableStateOf(false) }
    var mentionMenuOpen by remember(post.id) { mutableStateOf(false) }
    val participants = remember(post.replies, post.ownerUid, currentUid) {
        mentionCandidates(post, currentUid)
    }
    LaunchedEffect(composerOpen) {
        if (composerOpen) focusRequester.requestFocus()
    }
    BackHandler(enabled = composerOpen) {
        composerOpen = false
        focusManager.clearFocus()
        keyboard?.hide()
    }

    Column(Modifier.fillMaxSize().imePadding().testTag("atrio-detail-v2")) {
        LazyColumn(
            modifier = Modifier.weight(1f).fillMaxWidth().testTag("atrio-detail-replies"),
            state = listState,
            contentPadding = PaddingValues(start = 16.dp, end = 16.dp, top = 12.dp, bottom = 16.dp)
        ) {
            item(key = "discussion-header") {
                Column(verticalArrangement = Arrangement.spacedBy(5.dp)) {
                    DiscussionCard(post,
                        onOpen = { scope.launch { listState.animateScrollToItem(1) } },
                        onLike = { onLike() }, onSave = { onSave() },
                        fullText = true, onOpenProfile = onOpenProfile)
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        if (onFollow != null) {
                            AssistChip(
                                onClick = onFollow,
                                enabled = !followBusy,
                                label = { Text(if (followBusy) "Atualizando…" else if (followed) "Acompanhando" else "Acompanhar") },
                                leadingIcon = { Icon(Icons.Outlined.BookmarkBorder, null, modifier = Modifier.size(16.dp)) },
                                modifier = Modifier.testTag("atrio-follow-discussion")
                            )
                            Spacer(Modifier.width(8.dp))
                            Text(if (followIsSynced) "Sem novos avisos" else "Só neste aparelho",
                                color = Muted, fontSize = 10.sp, modifier = Modifier.weight(1f))
                        } else Spacer(Modifier.weight(1f))
                        if (onReport != null || onEdit != null || onDelete != null) {
                            Box {
                                IconButton(onClick = { postMenuOpen = true },
                                    modifier = Modifier.testTag("atrio-discussion-options")) {
                                    Icon(Icons.Outlined.MoreVert, contentDescription = "Opções da discussão", tint = Wine)
                                }
                                DropdownMenu(expanded = postMenuOpen, onDismissRequest = { postMenuOpen = false }) {
                                    if (onEdit != null) DropdownMenuItem(
                                        text = { Text("Editar discussão") },
                                        onClick = { postMenuOpen = false; onEdit() })
                                    if (onDelete != null) DropdownMenuItem(
                                        text = { Text("Excluir discussão", color = MaterialTheme.colorScheme.error) },
                                        onClick = { postMenuOpen = false; onDelete() })
                                    if (onReport != null) DropdownMenuItem(
                                        text = { Text("Denunciar discussão") },
                                        onClick = { postMenuOpen = false; onReport() })
                                }
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            "Respostas (" + post.replies.size + (if (moreReplies) "+" else "") + ")",
                            fontFamily = FontFamily.Serif,
                            fontWeight = FontWeight.Bold,
                            fontSize = 22.sp,
                            color = Ink,
                            modifier = Modifier.weight(1f).testTag("atrio-replies-count")
                        )
                        if (onReplySortChange != null) {
                            Box {
                                TextButton(onClick = { sortMenuOpen = true },
                                    modifier = Modifier.testTag("atrio-replies-sort")) {
                                    Text(if (newestFirst) "Recentes" else "Antigas", fontSize = 12.sp)
                                    Icon(Icons.Outlined.ArrowDropDown, contentDescription = "Ordenar respostas")
                                }
                                DropdownMenu(expanded = sortMenuOpen, onDismissRequest = { sortMenuOpen = false }) {
                                    DropdownMenuItem(text = { Text("Mais recentes primeiro") },
                                        onClick = {
                                            sortMenuOpen = false
                                            if (!newestFirst) {
                                                onReplySortChange(true)
                                                scope.launch { listState.scrollToItem(1) }
                                            }
                                        })
                                    DropdownMenuItem(text = { Text("Mais antigas primeiro") },
                                        onClick = {
                                            sortMenuOpen = false
                                            if (newestFirst) {
                                                onReplySortChange(false)
                                                scope.launch { listState.scrollToItem(1) }
                                            }
                                        })
                                }
                            }
                        }
                    }
                    if (post.replies.isEmpty()) {
                        if (repliesLoading) {
                            LinearProgressIndicator(Modifier.fillMaxWidth().padding(vertical = 12.dp))
                        } else {
                            Text("Seja a primeira pessoa a responder!",
                                color = Muted, fontSize = 13.sp, modifier = Modifier.padding(vertical = 12.dp))
                        }
                    }
                }
            }
            itemsIndexed(post.replies, key = { index, r ->
                if (r.id.isNotBlank()) "reply-" + r.id else "local-reply-" + index
            }) { _, r ->
                Column(Modifier.fillMaxWidth().testTag("atrio-reply-row"), verticalArrangement = Arrangement.spacedBy(0.dp)) {
                    Row(
                        verticalAlignment = Alignment.Top,
                        modifier = Modifier.fillMaxWidth().padding(top = 10.dp, bottom = 7.dp)
                            .then(if (reactionsEnabled && r.id.isNotBlank()) Modifier.combinedClickable(
                                onClick = { quotedReply = r; mentioned = null; composerOpen = true },
                                onLongClick = { reactionReplyId = r.id },
                                onLongClickLabel = "Reagir com emoji"
                            ).testTag("reaction-reply-" + r.id) else Modifier)
                    ) {
                        MemberAvatar(r.author, r.ownerUid, Modifier.size(36.dp)
                            .clickable(enabled = r.ownerUid.isNotBlank()) { onOpenProfile(r.ownerUid, r.author) }
                            .testTag("atrio-open-reply-avatar-" + r.id))
                        Spacer(Modifier.width(10.dp))
                        Column(Modifier.weight(1f)) {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(r.author, fontSize = 13.sp, fontWeight = FontWeight.Bold,
                                    maxLines = 1, overflow = TextOverflow.Ellipsis,
                                    modifier = Modifier.weight(1f, fill = false)
                                        .clickable(enabled = r.ownerUid.isNotBlank()) {
                                            onOpenProfile(r.ownerUid, r.author)
                                        }.testTag("atrio-open-reply-name-" + r.id))
                                val age = replyAgeLabel(r.createdAtMillis, System.currentTimeMillis())
                                if (age.isNotBlank()) {
                                    Spacer(Modifier.width(7.dp))
                                    Text(age, fontSize = 10.sp, color = Muted, maxLines = 1)
                                }
                                Spacer(Modifier.weight(1f))
                                if (r.id.isNotBlank() && (onReportReply != null || (r.mine && onDeleteReply != null))) {
                                    Box {
                                        IconButton(
                                            onClick = { replyMenuId = r.id },
                                            modifier = Modifier.size(40.dp).testTag("atrio-reply-options-" + r.id)
                                        ) { Icon(Icons.Outlined.MoreVert, "Opções da resposta", tint = Muted) }
                                        DropdownMenu(expanded = replyMenuId == r.id,
                                            onDismissRequest = { replyMenuId = null }) {
                                            if (onReportReply != null) DropdownMenuItem(
                                                text = { Text("Denunciar resposta") },
                                                onClick = { replyMenuId = null; onReportReply(r) })
                                            if (r.mine && onDeleteReply != null) DropdownMenuItem(
                                                text = { Text("Excluir resposta", color = MaterialTheme.colorScheme.error) },
                                                onClick = { replyMenuId = null; onDeleteReply(r.id) })
                                        }
                                    }
                                }
                            }
                            MemberBadgeRow(r.ownerUid)
                            if (r.replyToId.isNotBlank()) {
                                val target = post.replies.firstOrNull { it.id == r.replyToId }
                                Text("↳ Em resposta a @" + (target?.author ?: "participante"),
                                    fontSize = 11.sp, color = Wine,
                                    modifier = Modifier.clickable(enabled = target?.ownerUid?.isNotBlank() == true) {
                                        target?.let { onOpenProfile(it.ownerUid, it.author) }
                                    }.testTag("atrio-open-quoted-member-" + r.id))
                            }
                            if (r.mentionUid.isNotBlank()) {
                                val person = if (r.mentionUid == post.ownerUid) post.author
                                    else post.replies.firstOrNull { it.ownerUid == r.mentionUid }?.author
                                if (!person.isNullOrBlank()) {
                                    Text("Mencionou @" + person, fontSize = 11.sp, color = Wine,
                                        modifier = Modifier.clickable { onOpenProfile(r.mentionUid, person) }
                                            .testTag("atrio-open-mentioned-member-" + r.id))
                                }
                            }
                            Text(r.message, color = Ink, fontSize = 14.sp, lineHeight = 20.sp,
                                modifier = Modifier.padding(top = 3.dp, bottom = 2.dp))
                            if (r.id.isNotBlank()) {
                                Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                                    if (reactionsEnabled) {
                                        Box(Modifier.weight(1f)) {
                                            reactionContent(r, reactionReplyId == r.id) { reactionReplyId = null }
                                        }
                                    } else Spacer(Modifier.weight(1f))
                                    TextButton(onClick = {
                                        quotedReply = r
                                        mentioned = null
                                        composerOpen = true
                                    }, modifier = Modifier.testTag("atrio-quote-reply")) {
                                        Text("Responder", fontSize = 12.sp, color = Wine)
                                    }
                                }
                            }
                        }
                    }
                    HorizontalDivider(color = Line)
                }
            }
            item(key = "discussion-replies-footer") { repliesFooter() }
        }

        Surface(color = Paper, shadowElevation = 5.dp, modifier = Modifier.fillMaxWidth()) {
            Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp)) {
                if (!composerOpen) {
                    OutlinedButton(
                        onClick = { composerOpen = true },
                        modifier = Modifier.fillMaxWidth().testTag("atrio-open-reply-composer"),
                        shape = RoundedCornerShape(28.dp),
                        contentPadding = PaddingValues(horizontal = 14.dp, vertical = 10.dp),
                        border = BorderStroke(1.dp, Line)
                    ) {
                        Icon(Icons.Outlined.ChatBubbleOutline, null, modifier = Modifier.size(18.dp))
                        Spacer(Modifier.width(10.dp))
                        Text("Escreva uma resposta…", modifier = Modifier.weight(1f), color = Muted)
                        Icon(Icons.Outlined.Send, null, modifier = Modifier.size(18.dp))
                    }
                } else {
                    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                        Text("Responder como $name", color = Wine, fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold, modifier = Modifier.weight(1f))
                        IconButton(onClick = {
                            composerOpen = false
                            focusManager.clearFocus()
                            keyboard?.hide()
                        }, modifier = Modifier.size(36.dp)) {
                            Icon(Icons.Outlined.Close, contentDescription = "Fechar campo de resposta")
                        }
                    }
                    if (onMentionReply != null && participants.isNotEmpty()) {
                        Box {
                            TextButton(onClick = { mentionMenuOpen = true },
                                modifier = Modifier.testTag("atrio-mention-pick")) {
                                Text(if (mentioned == null) "Mencionar participante @" else "Mencionando " + mentionDisplay(mentioned!!),
                                    fontSize = 12.sp)
                            }
                            DropdownMenu(expanded = mentionMenuOpen,
                                onDismissRequest = { mentionMenuOpen = false }) {
                                participants.forEach { candidate ->
                                    DropdownMenuItem(text = { Text(mentionDisplay(candidate)) }, onClick = {
                                        mentioned = candidate
                                        quotedReply = null
                                        mentionMenuOpen = false
                                    })
                                }
                            }
                        }
                        if (mentioned != null) TextButton(onClick = { mentioned = null }) {
                            Text("Retirar menção", fontSize = 11.sp)
                        }
                    }
                    quotedReply?.let { target ->
                        Surface(color = WineSoft, shape = RoundedCornerShape(8.dp)) {
                            Row(Modifier.fillMaxWidth().padding(8.dp), verticalAlignment = Alignment.CenterVertically) {
                                Column(Modifier.weight(1f)) {
                                    Text("Respondendo a " + target.author, color = Wine,
                                        fontWeight = FontWeight.SemiBold, fontSize = 11.sp)
                                    Text(target.message.take(90), maxLines = 1, overflow = TextOverflow.Ellipsis,
                                        fontSize = 11.sp, color = Muted)
                                }
                                IconButton(onClick = { quotedReply = null }, modifier = Modifier.size(32.dp)) {
                                    Icon(Icons.Outlined.Close, contentDescription = "Retirar citação")
                                }
                            }
                        }
                        Spacer(Modifier.height(6.dp))
                    }
                    OutlinedTextField(
                        value = response, onValueChange = { if (it.length <= 600) response = it },
                        modifier = Modifier.fillMaxWidth().focusRequester(focusRequester)
                            .testTag("atrio-reply-input"),
                        label = { Text("Sua resposta") }, minLines = 2, maxLines = 5,
                        supportingText = { Text(response.length.toString() + "/600") }
                    )
                    Button(
                        onClick = {
                            if (response.isBlank() || sendingReply) return@Button
                            sendingReply = true
                            val quote = quotedReply
                            val mention = mentioned
                            val callback: (Boolean) -> Unit = { ok ->
                                sendingReply = false
                                if (ok) {
                                    response = ""
                                    quotedReply = null
                                    mentioned = null
                                    composerOpen = false
                                    focusManager.clearFocus()
                                    keyboard?.hide()
                                }
                            }
                            if (mention != null && onMentionReply != null) {
                                onMentionReply(mentionBody(mention, response), mention, callback)
                            } else if (quote != null && onDirectReply != null &&
                                quote.id.isNotBlank() && quote.ownerUid.isNotBlank()) {
                                onDirectReply(response.trim(), quote, callback)
                            } else {
                                val prefix = if (quote == null) "" else "↳ Em resposta a " + quote.author.take(35) + ": "
                                val available = (600 - prefix.length).coerceAtLeast(0)
                                onReply(prefix + response.trim().take(available), callback)
                            }
                        },
                        enabled = response.isNotBlank() && !sendingReply,
                        modifier = Modifier.align(Alignment.End).testTag("atrio-reply-submit"),
                        shape = RoundedCornerShape(12.dp)
                    ) {
                        Text(if (sendingReply) "Enviando…" else "Enviar resposta")
                    }
                }
            }
        }
    }
}

/** Horário relativo sem consultar o servidor nem criar observadores por resposta. */
internal fun replyAgeLabel(createdAtMillis: Long, nowMillis: Long): String {
    if (createdAtMillis <= 0 || nowMillis < createdAtMillis) return ""
    val minutes = (nowMillis - createdAtMillis) / 60_000
    return when {
        minutes < 1 -> "agora"
        minutes < 60 -> "há " + minutes + " min"
        minutes < 1440 -> "há " + (minutes / 60) + " h"
        minutes < 10080 -> "há " + (minutes / 1440) + " d"
        else -> "há " + (minutes / 10080) + " sem"
    }
}
