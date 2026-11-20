package br.com.atriocatolico

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

private data class ContributionTrack(
    val key: String,
    val title: String,
    val description: String,
    val color: Color,
    val thresholds: List<Int>
)

private val contributionTracks = listOf(
    ContributionTrack(
        "conversation", "Conversas que acolhem",
        "Reconhece discussões que recebem reações e respostas de outras pessoas.",
        Color(0xFF761B31), listOf(15, 45, 100, 220, 450)
    ),
    ContributionTrack(
        "helpful", "Pessoa prestativa",
        "Reconhece respostas que recebem reações e conversas diretas.",
        Color(0xFF386B45), listOf(15, 45, 100, 220, 450)
    ),
    ContributionTrack(
        "welcome", "Portas abertas",
        "Reconhece quem acolhe pessoas em sua primeira publicação.",
        Color(0xFF315F91), listOf(10, 30, 65, 120, 200)
    )
)

private data class ContributionBadge(
    val track: String,
    val level: Int
)

internal fun contributionTrackTitle(track: String): String =
    contributionTracks.firstOrNull { it.key == track }?.title ?: "Insígnia de contribuição"

private fun contributionTrackDescription(track: String): String =
    contributionTracks.firstOrNull { it.key == track }?.description
        ?: "Esta insígnia reconhece a participação na comunidade do Átrio."

private fun Map<*, *>?.points(track: String): Int =
    ((this?.get(track) as? Number)?.toInt() ?: 0).coerceAtLeast(0)

@Composable
internal fun ContributionBadgeIcon(
    track: String,
    level: Int,
    modifier: Modifier = Modifier,
    earned: Boolean = true
) {
    val definition = contributionTracks.firstOrNull { it.key == track } ?: contributionTracks.first()
    val safeLevel = level.coerceIn(1, 5)
    Canvas(modifier.semantics {
        contentDescription = if (earned)
            "${definition.title}, nível $safeLevel"
        else "Insígnia de ${definition.title}, ainda não conquistada"
    }) {
        val width = size.width
        val height = size.height
        val inset = minOf(width, height) * 0.1f
        val shape = Path()
        when (safeLevel) {
            1 -> shape.addOval(
                androidx.compose.ui.geometry.Rect(inset, inset, width - inset, height - inset)
            )
            2 -> {
                shape.moveTo(width * .5f, inset)
                shape.lineTo(width - inset, height * .28f)
                shape.lineTo(width * .82f, height * .72f)
                shape.lineTo(width * .5f, height - inset)
                shape.lineTo(width * .18f, height * .72f)
                shape.lineTo(inset, height * .28f)
                shape.close()
            }
            3 -> {
                shape.moveTo(width * .25f, inset)
                shape.lineTo(width * .75f, inset)
                shape.lineTo(width - inset, height * .5f)
                shape.lineTo(width * .75f, height - inset)
                shape.lineTo(width * .25f, height - inset)
                shape.lineTo(inset, height * .5f)
                shape.close()
            }
            4 -> {
                shape.moveTo(inset, height - inset)
                shape.lineTo(inset, height * .46f)
                shape.cubicTo(inset, height * .14f, width - inset, height * .14f,
                    width - inset, height * .46f)
                shape.lineTo(width - inset, height - inset)
                shape.close()
            }
            else -> {
                val center = Offset(width * .5f, height * .5f)
                val outer = minOf(width, height) * .42f
                val inner = outer * .78f
                for (point in 0 until 20) {
                    val angle = Math.PI * point / 10.0 - Math.PI / 2.0
                    val radius = if (point % 2 == 0) outer else inner
                    val x = center.x + kotlin.math.cos(angle).toFloat() * radius
                    val y = center.y + kotlin.math.sin(angle).toFloat() * radius
                    if (point == 0) shape.moveTo(x, y) else shape.lineTo(x, y)
                }
                shape.close()
            }
        }
        val tint = if (earned) definition.color else Color(0xFF8C8C8C)
        drawPath(shape, tint.copy(alpha = if (earned) .96f else .16f))
        drawPath(shape, Gold.copy(alpha = if (earned) .95f else .65f), style = Stroke(width = 2.dp.toPx()))
        drawPath(shape, Color.White.copy(alpha = if (earned) .14f else .2f),
            style = Stroke(width = 1.dp.toPx()))

        val metal = Gold.copy(alpha = if (earned) 1f else .55f)
        when (track) {
            "conversation" -> {
                val left = width * .31f
                val top = height * .35f
                val boxWidth = width * .38f
                val boxHeight = height * .27f
                drawRoundRect(
                    metal, Offset(left, top), Size(boxWidth, boxHeight),
                    cornerRadius = CornerRadius(width * .045f),
                    style = Stroke(width = 2.dp.toPx())
                )
                val tail = Path().apply {
                    moveTo(width * .4f, top + boxHeight)
                    lineTo(width * .36f, height * .68f)
                    lineTo(width * .49f, top + boxHeight)
                }
                drawPath(tail, metal, style = Stroke(width = 2.dp.toPx()))
            }
            "helpful" -> {
                val hand = Path().apply {
                    moveTo(width * .3f, height * .59f)
                    lineTo(width * .42f, height * .7f)
                    lineTo(width * .65f, height * .7f)
                    cubicTo(width * .72f, height * .7f, width * .75f, height * .62f,
                        width * .68f, height * .59f)
                    lineTo(width * .56f, height * .59f)
                    lineTo(width * .66f, height * .47f)
                    cubicTo(width * .71f, height * .39f, width * .65f, height * .35f,
                        width * .6f, height * .42f)
                    lineTo(width * .5f, height * .52f)
                    lineTo(width * .43f, height * .46f)
                    lineTo(width * .3f, height * .46f)
                    close()
                }
                drawPath(hand, metal, style = Stroke(width = 2.2.dp.toPx()))
                drawLine(metal, Offset(width * .36f, height * .48f),
                    Offset(width * .36f, height * .59f), 2.dp.toPx())
            }
            else -> {
                val doorway = Path().apply {
                    moveTo(width * .32f, height * .69f)
                    lineTo(width * .32f, height * .45f)
                    cubicTo(width * .32f, height * .28f, width * .68f, height * .28f,
                        width * .68f, height * .45f)
                    lineTo(width * .68f, height * .69f)
                }
                drawPath(doorway, metal, style = Stroke(width = 2.2.dp.toPx()))
                drawLine(metal, Offset(width * .57f, height * .42f),
                    Offset(width * .57f, height * .69f), 1.8.dp.toPx())
                drawCircle(metal, radius = width * .018f, center = Offset(width * .62f, height * .56f))
            }
        }
    }
}

@Composable
internal fun ContributionProgressScreen(
    db: FirebaseFirestore,
    uid: String,
    onBack: () -> Unit
) {
    var points by remember(uid) { mutableStateOf<Map<*, *>?>(null) }
    var progressLoading by remember(uid) { mutableStateOf(true) }
    var progressFailed by remember(uid) { mutableStateOf(false) }
    var selectedTrack by remember(uid) { mutableStateOf("") }
    var selectionFailed by remember(uid) { mutableStateOf(false) }
    var saving by remember(uid) { mutableStateOf(false) }
    var feedback by remember(uid) { mutableStateOf("") }
    var retry by remember(uid) { mutableIntStateOf(0) }

    DisposableEffect(db, uid, retry) {
        var active = true
        val progressListener = db.collection("contribution_progress").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (!active) return@addSnapshotListener
                progressLoading = false
                progressFailed = error != null
                if (error == null) points = snapshot?.get("points") as? Map<*, *> ?: emptyMap<Any, Any>()
            }
        val selectionListener = db.collection("contribution_highlight_settings").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (!active) return@addSnapshotListener
                selectionFailed = error != null
                if (error == null) selectedTrack = snapshot?.getString("track").orEmpty()
            }
        onDispose {
            active = false
            progressListener.remove()
            selectionListener.remove()
        }
    }

    LazyColumn(
        modifier = Modifier.fillMaxSize().testTag("atrio-contribution-progress"),
        contentPadding = PaddingValues(16.dp),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        item {
            TextButton(onClick = onBack, modifier = Modifier.testTag("atrio-contribution-back")) {
                Text("Voltar ao perfil")
            }
            Text("Minha participação", style = MaterialTheme.typography.headlineSmall,
                color = Wine, fontWeight = FontWeight.Bold)
            Text("Acompanhe cada trilha separadamente. Não existe placar geral.",
                color = Muted, style = MaterialTheme.typography.bodyMedium)
        }
        if (progressLoading) item {
            Box(Modifier.fillMaxWidth(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
        if (progressFailed) item {
            Text("Não foi possível carregar sua pontuação.",
                color = MaterialTheme.colorScheme.error, modifier = Modifier.testTag("atrio-contribution-error"))
            TextButton(onClick = { progressLoading = true; retry++ }) { Text("Tentar novamente") }
        }
        if (!progressLoading && !progressFailed) {
            val currentPoints = points
            if (contributionTracks.all { currentPoints.points(it.key) == 0 }) item {
                Text("Sua participação pontuável ainda não apareceu. As ações começam a contar após a ativação das insígnias.",
                    color = Muted, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("atrio-contribution-empty"))
            }
            items(contributionTracks.size) { index ->
                val track = contributionTracks[index]
                ContributionTrackCard(
                    track = track,
                    points = currentPoints.points(track.key),
                    selected = selectedTrack == track.key,
                    saving = saving,
                    onSelect = {
                        if (!saving) {
                            saving = true
                            feedback = ""
                            val ref = db.collection("contribution_highlight_settings").document(uid)
                            val request = if (selectedTrack == track.key) ref.delete()
                            else ref.set(mapOf(
                                "track" to track.key,
                                "updatedAt" to FieldValue.serverTimestamp()
                            ))
                            request.addOnCompleteListener { result ->
                                saving = false
                                if (result.isSuccessful) {
                                    feedback = if (selectedTrack == track.key)
                                        "Destaque removido do seu perfil."
                                    else "Insígnia selecionada para destaque."
                                } else {
                                    feedback = "Não foi possível salvar a escolha. Tente novamente."
                                }
                            }
                        }
                    }
                )
            }
            if (saving) item { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            if (feedback.isNotBlank()) item {
                Text(feedback, color = if (feedback.startsWith("Não foi")) MaterialTheme.colorScheme.error else Wine,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            if (selectionFailed) item {
                Text("Não foi possível carregar a insígnia destacada.",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("atrio-contribution-selection-error"))
            }
            item {
                Text("Créditos são únicos por pessoa e interação. Auto-interações não pontuam; remoções e decisões de moderação podem estornar pontos.",
                    color = Muted, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ContributionTrackCard(
    track: ContributionTrack,
    points: Int,
    selected: Boolean,
    saving: Boolean,
    onSelect: () -> Unit
) {
    val level = track.thresholds.count { points >= it }
    val currentThreshold = if (level == 0) 0 else track.thresholds[level - 1]
    val nextThreshold = track.thresholds.getOrNull(level)
    val fraction = if (nextThreshold == null) 1f
        else ((points - currentThreshold).toFloat() / (nextThreshold - currentThreshold))
            .coerceIn(0f, 1f)

    Card(
        modifier = Modifier.fillMaxWidth().testTag("atrio-contribution-track-${track.key}"),
        shape = RoundedCornerShape(AtrioDimensions.CardRadius),
        border = BorderStroke(1.dp, Line),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ContributionBadgeIcon(track.key, level.coerceAtLeast(1), Modifier.size(58.dp), earned = level > 0)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(track.title, color = if (androidx.compose.foundation.isSystemInDarkTheme()) Ink else track.color, fontWeight = FontWeight.Bold)
                    Text("${points} pontos · Nível $level",
                        style = MaterialTheme.typography.bodySmall, color = Muted)
                }
            }
            Text(track.description, style = MaterialTheme.typography.bodySmall)
            LinearProgressIndicator(progress = { fraction }, modifier = Modifier.fillMaxWidth())
            Text(
                if (nextThreshold == null) "Nível máximo alcançado"
                else "Faltam ${nextThreshold - points} pontos para o nível ${level + 1} (${nextThreshold} no total)",
                style = MaterialTheme.typography.labelMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(
                    selected = selected,
                    onClick = onSelect,
                    enabled = !saving && (selected || level > 0),
                    label = { Text(if (selected) "Destaque selecionado" else "Destacar no perfil") },
                    modifier = Modifier.testTag("atrio-contribution-highlight-${track.key}")
                )
                if (selected && level == 0) {
                    Text("A insígnia ficará oculta até recuperar o nível 1.",
                        style = MaterialTheme.typography.labelSmall, color = Muted)
                }
            }
        }
    }
}

@Composable
internal fun ContributionPublicBadge(
    db: FirebaseFirestore,
    uid: String,
    modifier: Modifier = Modifier
) {
    var badge by remember(uid) { mutableStateOf<ContributionBadge?>(null) }
    var loading by remember(uid) { mutableStateOf(true) }
    var failed by remember(uid) { mutableStateOf(false) }
    var detailsOpen by remember(uid) { mutableStateOf(false) }

    DisposableEffect(db, uid) {
        var active = true
        val registration = db.collection("contribution_public").document(uid)
            .addSnapshotListener { snapshot, error ->
                if (!active) return@addSnapshotListener
                loading = false
                failed = error != null
                if (error == null) {
                    val track = snapshot?.getString("track").orEmpty()
                    val level = snapshot?.getLong("level")?.toInt() ?: 0
                    badge = if (track in contributionTracks.map { it.key } && level in 1..5)
                        ContributionBadge(track, level) else null
                }
            }
        onDispose { active = false; registration.remove() }
    }

    when {
        loading -> LinearProgressIndicator(modifier.fillMaxWidth().testTag("atrio-contribution-public-loading"))
        failed -> Text("Insígnia de contribuição indisponível.",
            modifier = modifier.testTag("atrio-contribution-public-error"),
            style = MaterialTheme.typography.labelSmall, color = Muted)
        badge == null -> Text("Nenhuma insígnia de contribuição destacada.",
            modifier = modifier.testTag("atrio-contribution-public-empty"),
            style = MaterialTheme.typography.labelSmall, color = Muted)
        else -> {
            val current = badge!!
            Card(
                onClick = { detailsOpen = true },
                modifier = modifier.fillMaxWidth().testTag("atrio-contribution-public-badge"),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, Gold),
                colors = CardDefaults.cardColors(containerColor = WineSoft)
            ) {
                Row(Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ContributionBadgeIcon(current.track, current.level, Modifier.size(52.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("Contribuição na comunidade", color = Wine,
                            style = MaterialTheme.typography.labelMedium)
                        Text("${contributionTrackTitle(current.track)} · Nível ${current.level}",
                            fontWeight = FontWeight.Bold, color = Wine)
                        Text("Sobre esta insígnia", style = MaterialTheme.typography.labelSmall, color = Muted)
                    }
                }
            }
            if (detailsOpen) AlertDialog(
                onDismissRequest = { detailsOpen = false },
                title = { Text(contributionTrackTitle(current.track)) },
                text = { Text(contributionTrackDescription(current.track) +
                    "\n\nNível ${current.level}. A pontuação fica apenas nesta trilha e não participa de um placar geral.") },
                confirmButton = {
                    TextButton(onClick = { detailsOpen = false }) { Text("Entendi") }
                }
            )
        }
    }
}
