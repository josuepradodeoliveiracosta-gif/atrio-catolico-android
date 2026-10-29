package br.com.atriocatolico

import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalConfiguration
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.selected
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp

/** Stateless persistence boundary: this UI never writes Firebase, preferences or notifications. */
@OptIn(ExperimentalMaterial3Api::class, androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
internal fun ReactionEmojiPicker(
    device: DeviceEmojiCatalog, replyId: String, selectedEmoji: String,
    summaries: List<ReactionSummary>, busy: Boolean,
    requested: Boolean = false, onRequestDismiss: () -> Unit = {},
    recents: () -> List<String>, onPick: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var quickOpen by remember(replyId) { mutableStateOf(false) }
    var catalogOpen by rememberSaveable(replyId) { mutableStateOf(false) }
    var variantsOf by remember(replyId) { mutableStateOf<ReactionEmoji?>(null) }
    var recent by remember(replyId) { mutableStateOf(emptyList<String>()) }
    LaunchedEffect(requested) { if (requested) quickOpen = true }
    fun dismissQuick() { quickOpen = false; onRequestDismiss() }
    fun choose(emoji: String) {
        if (!busy) {
            dismissQuick(); catalogOpen = false; variantsOf = null
            onPick(emoji)
        }
    }
    val catalog = device.catalog
    Column(modifier) {
        if (summaries.isNotEmpty()) {
            LazyRow(horizontalArrangement = Arrangement.spacedBy(6.dp), modifier = Modifier.fillMaxWidth()) {
                items(summaries, key = { it.emoji }) { summary ->
                    FilterChip(
                        selected = summary.mine, enabled = !busy,
                        onClick = { choose(summary.emoji) },
                        label = { Text("${summary.emoji} ${summary.count}", fontSize = 17.sp) },
                        modifier = Modifier.testTag("reaction-count-${summary.emoji}").semantics {
                            contentDescription = "${catalog.byGlyph[summary.emoji]?.label ?: "Emoji"}: ${summary.count} reações" +
                                if (summary.mine) ", sua reação" else ""
                        }
                    )
                }
            }
        }
        Box {
            TextButton(onClick = { quickOpen = true }, enabled = !busy,
                modifier = Modifier.testTag("reaction-open-$replyId")) {
                Text(if (busy) "Salvando reação…" else "Reagir ＋")
            }
            // Material DropdownMenu supplies the floating surface and enter/exit animation,
            // and positions it inside the window even near an edge of a narrow phone.
            DropdownMenu(expanded = quickOpen, onDismissRequest = ::dismissQuick,
                shape = RoundedCornerShape(28.dp),
                modifier = Modifier.width(minOf(376, LocalConfiguration.current.screenWidthDp - 24).dp)
                    .testTag("reaction-quick-bar")) {
                Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    LazyRow(Modifier.weight(1f)) {
                        items(quickReactionEmojis) { emoji ->
                            EmojiTile(catalog.byGlyph.getValue(emoji), emoji == selectedEmoji,
                                onClick = { choose(emoji) }, onVariants = {
                                    variantsOf = catalog.byGlyph.getValue(emoji)
                                    dismissQuick()
                                }, tag = "reaction-quick-$emoji")
                        }
                    }
                    FilledTonalIconButton(onClick = {
                        dismissQuick()
                        recent = recents().filter { it in catalog.byGlyph && it in device.supported }
                        catalogOpen = true
                    }, modifier = Modifier.size(48.dp).testTag("reaction-more").semantics {
                        contentDescription = "Abrir todos os emojis"
                    }) { Text("+", fontSize = 28.sp) }
                }
            }
        }
    }
    if (catalogOpen) {
        var query by rememberSaveable(replyId) { mutableStateOf("") }
        // -1: all categories, -2: recently used.
        var category by rememberSaveable(replyId) { mutableStateOf(-1) }
        val options = remember(query, category, recent, device) {
            if (category == -2 && query.isBlank()) recent.mapNotNull { catalog.byGlyph[it] }
            else catalog.search(query, category.takeIf { it >= 0 }).filter { it.glyph in device.supported }
        }
        ModalBottomSheet(onDismissRequest = { catalogOpen = false },
            sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
            Column(Modifier.fillMaxWidth().fillMaxHeight(0.86f).imePadding().padding(horizontal = 16.dp)) {
                Text("Escolha uma reação", style = MaterialTheme.typography.titleLarge)
                OutlinedTextField(query, { query = it.take(80) }, singleLine = true,
                    label = { Text("Pesquisar emoji") },
                    placeholder = { Text("Ex.: coração, oração, família…") },
                    modifier = Modifier.fillMaxWidth().testTag("emoji-search"))
                LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    item { FilterChip(category == -1, { category = -1 }, label = { Text("Todos") }) }
                    item { FilterChip(category == -2, { category = -2; query = "" }, label = { Text("Recentes") },
                        modifier = Modifier.testTag("emoji-recent")) }
                    items(reactionEmojiCategories.indices.toList()) { index ->
                        FilterChip(category == index, { category = index }, label = { Text(reactionEmojiCategories[index]) },
                            modifier = Modifier.testTag("emoji-category-$index"))
                    }
                }
                Text("Segure um emoji para ver tons de pele. São exibidos os emojis compatíveis com este Android.",
                    style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                if (options.isEmpty()) Text(if (category == -2) "Suas próximas reações aparecerão aqui."
                    else "Nenhum emoji encontrado. Tente outro termo.", modifier = Modifier.padding(vertical = 16.dp))
                LazyVerticalGrid(columns = GridCells.Adaptive(56.dp),
                    modifier = Modifier.weight(1f).testTag("emoji-catalog-grid"),
                    contentPadding = PaddingValues(vertical = 12.dp)) {
                    items(options, key = { it.glyph }) { emoji ->
                        EmojiTile(emoji, emoji.glyph == selectedEmoji, onClick = { choose(emoji.glyph) },
                            onVariants = { variantsOf = emoji }, tag = "emoji-cell-${emoji.glyph}")
                    }
                }
            }
        }
    }
    variantsOf?.let { emoji ->
        val variants = catalog.variants[emoji.variantKey].orEmpty().filter { it.glyph in device.supported }
        AlertDialog(onDismissRequest = { variantsOf = null },
            title = { Text("Variações do emoji") },
            text = {
                Column {
                    Text(emoji.label, style = MaterialTheme.typography.bodyMedium)
                    LazyVerticalGrid(columns = GridCells.Adaptive(56.dp), modifier = Modifier.heightIn(max = 300.dp)) {
                        items(variants, key = { it.glyph }) { variant ->
                            EmojiTile(variant, variant.glyph == selectedEmoji, onClick = { choose(variant.glyph) },
                                onVariants = {}, tag = "emoji-variant-${variant.glyph}")
                        }
                    }
                }
            }, confirmButton = { TextButton(onClick = { variantsOf = null }) { Text("Voltar") } })
    }
}

@OptIn(androidx.compose.foundation.ExperimentalFoundationApi::class)
@Composable
private fun EmojiTile(emoji: ReactionEmoji, selected: Boolean, onClick: () -> Unit,
                      onVariants: () -> Unit, tag: String) {
    Surface(shape = RoundedCornerShape(16.dp), color = if (selected) MaterialTheme.colorScheme.secondaryContainer
        else MaterialTheme.colorScheme.surface) {
        Box(Modifier.sizeIn(minWidth = 48.dp, minHeight = 52.dp).testTag(tag)
            .semantics { contentDescription = emoji.label; this.selected = selected }
            .combinedClickable(onClick = onClick, onLongClick = onVariants,
                onLongClickLabel = "Ver tons de pele e variações")
            .padding(6.dp), contentAlignment = Alignment.Center) {
            Text(emoji.glyph, fontSize = 28.sp)
        }
    }
}
