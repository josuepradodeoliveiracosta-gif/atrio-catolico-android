package br.com.atriocatolico

import androidx.compose.foundation.Image
import androidx.compose.ui.graphics.ColorFilter
import androidx.compose.ui.graphics.ColorMatrix
import androidx.compose.ui.res.painterResource
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.MetadataChanges

private data class ContributionTrack(
    val key: String,
    val title: String,
    val description: String,
    val feedDescription: String,
    val thresholds: List<Int>
)

private val contributionTracks = listOf(
    ContributionTrack(
        "conversation", "Conversas que acolhem",
        "Reconhece discussões que recebem reações e respostas de outras pessoas.",
        "+3 pontos pelo primeiro comentário de cada outra pessoa em uma publicação ou pergunta sua.",
        listOf(15, 45, 100, 220, 450)
    ),
    ContributionTrack(
        "helpful", "Pessoa prestativa",
        "Reconhece respostas que recebem reações e conversas diretas.",
        "+2 pontos pela primeira resposta direta de cada outra pessoa a um comentário seu.",
        listOf(15, 45, 100, 220, 450)
    ),
    ContributionTrack(
        "welcome", "Portas abertas",
        "Reconhece quem acolhe pessoas em sua primeira publicação.",
        "+2 pontos ao comentar na primeira publicação elegível de alguém e +3 se essa pessoa responder.",
        listOf(10, 30, 65, 120, 200)
    )
)

private data class ContributionBadge(
    val track: String,
    val level: Int
)

internal fun contributionTrackTitle(track: String): String =
    contributionTracks.firstOrNull { it.key == track }?.title ?: "Insígnia de contribuição"

private fun Map<*, *>?.points(track: String): Int =
    ((this?.get(track) as? Number)?.toInt() ?: 0).coerceAtLeast(0)

private val contributionArtwork = mapOf(
    "conversation" to listOf(
        R.drawable.contribution_conversation_1,
        R.drawable.contribution_conversation_2,
        R.drawable.contribution_conversation_3,
        R.drawable.contribution_conversation_4,
        R.drawable.contribution_conversation_5
    ),
    "helpful" to listOf(
        R.drawable.contribution_helpful_1,
        R.drawable.contribution_helpful_2,
        R.drawable.contribution_helpful_3,
        R.drawable.contribution_helpful_4,
        R.drawable.contribution_helpful_5
    ),
    "welcome" to listOf(
        R.drawable.contribution_welcome_1,
        R.drawable.contribution_welcome_2,
        R.drawable.contribution_welcome_3,
        R.drawable.contribution_welcome_4,
        R.drawable.contribution_welcome_5
    )
)

@Composable
internal fun ContributionBadgeIcon(
    track: String,
    level: Int,
    modifier: Modifier = Modifier,
    earned: Boolean = true
) {
    val definition = contributionTracks.firstOrNull { it.key == track } ?: contributionTracks.first()
    val safeLevel = level.coerceIn(1, 5)
    val artwork = contributionArtwork.getValue(definition.key)[safeLevel - 1]
    Image(
        painter = painterResource(artwork),
        contentDescription = if (earned) "${definition.title}, nível $safeLevel"
            else "Insígnia de ${definition.title}, ainda não conquistada",
        modifier = modifier,
        alpha = if (earned) 1f else .58f,
        colorFilter = if (earned) null else ColorFilter.colorMatrix(
            ColorMatrix().apply { setToSaturation(0f) }
        )
    )
}

@Composable
internal fun ContributionProgressScreen(
    db: FirebaseFirestore,
    uid: String,
    onBack: () -> Unit,
    feedEnabled: Boolean = false,
) {
    var points by remember(uid) { mutableStateOf<Map<*, *>?>(null) }
    var progressLoading by remember(uid) { mutableStateOf(true) }
    var progressFailed by remember(uid) { mutableStateOf(false) }
    var selectedTrack by remember(uid) { mutableStateOf("") }
    var selectionFailed by remember(uid) { mutableStateOf(false) }
    var saving by remember(uid) { mutableStateOf(false) }
    var feedback by remember(uid) { mutableStateOf("") }
    var retry by remember(uid) { mutableIntStateOf(0) }
    var feedScoring by remember(db, uid, feedEnabled) { mutableStateOf<Boolean?>(null) }

    DisposableEffect(db, uid, feedEnabled, retry) {
        feedScoring = null
        if (!feedEnabled) onDispose {}
        else {
            val registration = db.document("contribution_config/feed_rollout")
                .addSnapshotListener(MetadataChanges.INCLUDE) { snapshot, error ->
                    feedScoring = if (error == null && snapshot != null && !snapshot.metadata.isFromCache) {
                        snapshot.getTimestamp("startedAt")?.toDate()?.time?.let { it > 0 } == true
                    } else null
                }
            onDispose { registration.remove() }
        }
    }

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
            Text("Insígnias de contribuição", style = MaterialTheme.typography.headlineSmall,
                color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
            if (feedEnabled) {
                Text(
                    when (feedScoring) {
                        true -> "A pontuação reúne seu histórico e as contribuições na Linha do tempo e nos Canais."
                        false -> "Seus pontos conquistados continuam no perfil. A pontuação da Linha do tempo e dos Canais aguarda ativação."
                        null -> "Seus pontos conquistados continuam no perfil. O status da pontuação do feed está indisponível."
                    },
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.testTag("atrio-contribution-feed-status"),
                )
            }
        }
        if (progressLoading) item {
            Box(Modifier.fillMaxWidth().testTag("atrio-contribution-loading"),
                contentAlignment = Alignment.Center) {
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
                Text("Você ainda não recebeu pontos nestas trilhas.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall,
                    modifier = Modifier.testTag("atrio-contribution-empty"))
            }
            items(contributionTracks.size) { index ->
                val track = contributionTracks[index]
                ContributionTrackCard(
                    track = track,
                    description = if (feedEnabled) track.feedDescription else track.description,
                    points = currentPoints.points(track.key),
                    selected = selectedTrack == track.key,
                    saving = saving,
                    onSelect = {
                        if (!saving) {
                            saving = true
                            feedback = ""
                            val ref = db.collection("contribution_highlight_settings").document(uid)
                            val removing = selectedTrack == track.key
                            val request = if (removing) ref.delete()
                            else ref.set(mapOf(
                                "track" to track.key,
                                "updatedAt" to FieldValue.serverTimestamp()
                            ))
                            request.addOnCompleteListener { result ->
                                saving = false
                                if (result.isSuccessful) {
                                    feedback = if (removing)
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
                Text(feedback, color = if (feedback.startsWith("Não foi")) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary,
                    modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite })
            }
            if (selectionFailed) item {
                Text("Não foi possível carregar a insígnia destacada.",
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.testTag("atrio-contribution-selection-error"))
            }
            item {
                Text("A mesma pessoa conta uma vez por interação elegível. Remover uma contribuição pode reverter os pontos.",
                    color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun ContributionTrackCard(
    track: ContributionTrack,
    description: String,
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
        border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
        colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
    ) {
        Column(Modifier.fillMaxWidth().padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                ContributionBadgeIcon(track.key, level.coerceAtLeast(1), Modifier.size(58.dp), earned = level > 0)
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
                    Text(track.title, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold)
                    Text("${points} pontos · Nível $level",
                        style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                }
            }
            Text(description, style = MaterialTheme.typography.bodySmall)
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
                        style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
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
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        badge == null -> Text("Nenhuma insígnia de contribuição destacada.",
            modifier = modifier.testTag("atrio-contribution-public-empty"),
            style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        else -> {
            val current = badge!!
            Card(
                onClick = { detailsOpen = true },
                modifier = modifier.fillMaxWidth().testTag("atrio-contribution-public-badge"),
                shape = RoundedCornerShape(16.dp),
                border = BorderStroke(1.dp, MaterialTheme.colorScheme.outlineVariant),
                colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surfaceVariant)
            ) {
                Row(Modifier.fillMaxWidth().padding(12.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ContributionBadgeIcon(current.track, current.level, Modifier.size(52.dp))
                    Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                        Text("${contributionTrackTitle(current.track)} · Nível ${current.level}",
                            fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.onSurfaceVariant)
                    }
                }
            }
            if (detailsOpen) AlertDialog(
                onDismissRequest = { detailsOpen = false },
                title = { Text(contributionTrackTitle(current.track)) },
                text = { Text("Nível ${current.level} de 5 na trilha de contribuição.") },
                confirmButton = {
                    TextButton(onClick = { detailsOpen = false }) { Text("Entendi") }
                }
            )
        }
    }
}
