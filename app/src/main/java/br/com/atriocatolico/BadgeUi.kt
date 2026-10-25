package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.*
import androidx.compose.ui.Alignment
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions

/**
 * Selos públicos não são permissões de moderação.
 * Apenas a autodeclaração leiga pode ser modificada pelo cliente.
 */
internal val LocalFounderUid = compositionLocalOf { "" }

private data class PublicBadges(
    val lay: String = "",
    val clergy: String = "",
    val moderator: Boolean = false
)

private fun DocumentSnapshot?.asPublicBadges() = PublicBadges(
    lay = this?.getString("lay").orEmpty(),
    clergy = this?.getString("clergy").orEmpty(),
    moderator = this?.getBoolean("moderator") == true
)

private data class BadgeDescription(
    val symbol: String,
    val name: String,
    val details: String,
    val tint: Color,
    val isFounder: Boolean = false,
    val isPriest: Boolean = false,
    val isDeacon: Boolean = false
)

private fun listBadges(value: PublicBadges, founder: Boolean): List<BadgeDescription> = buildList {
    if (founder) add(BadgeDescription(
        "⛪", "Fundador", "Conta oficial do criador do Átrio Católico.", Color(0xFF927020), isFounder = true
    ))
    when (value.clergy) {
        "padre" -> add(BadgeDescription("✝", "Padre",
            "Identidade sacerdotal verificada pela administração.", Wine, isPriest = true))
        "diacono" -> add(BadgeDescription("✝", "Diácono",
            "Identidade diaconal verificada pela administração.", Wine, isDeacon = true))
    }
    if (value.moderator) add(BadgeDescription("⬟", "Moderador",
        "Identificação atribuída pela administração da comunidade.", Color(0xFF315C91)))
    if (value.clergy.isBlank()) {
        when (value.lay) {
            "leigo" -> add(BadgeDescription("◈", "Leigo",
                "Identificação opcional declarada pelo próprio membro.", Muted))
            "leiga" -> add(BadgeDescription("◈", "Leiga",
                "Identificação opcional declarada pela própria integrante.", Muted))
        }
    }
}

@Composable
internal fun MemberBadgeRow(uid: String, modifier: Modifier = Modifier) {
    if (uid.isBlank()) return
    val db = remember { FirebaseFirestore.getInstance() }
    val founderUid = LocalFounderUid.current
    var badges by remember(uid) { mutableStateOf(PublicBadges()) }
    var info by remember { mutableStateOf<BadgeDescription?>(null) }

    DisposableEffect(db, uid) {
        val registration = db.collection("badges").document(uid).addSnapshotListener { snapshot, failure ->
            // Uma leitura com falha nunca produz um selo privilegiado.
            badges = if (failure == null) snapshot.asPublicBadges() else PublicBadges()
        }
        onDispose { registration.remove() }
    }
    val visible = listBadges(badges, founderUid.isNotBlank() && founderUid == uid)
    if (visible.isNotEmpty()) {
        LazyRow(modifier = modifier, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
            items(visible, key = { it.name }) { badge ->
                AssistChip(
                    onClick = { info = badge },
                    label = {
                        Row(verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                            when {
                                badge.isFounder -> FounderBadgeArt(Modifier.size(27.dp), compact = true)
                                badge.isPriest -> PriestBadgeArt(Modifier.size(27.dp), compact = true)
                                badge.isDeacon -> DeaconBadgeArt(Modifier.size(27.dp), compact = true)
                                else -> Text(badge.symbol, color = badge.tint, fontSize = 12.sp)
                            }
                            Text(badge.name, color = badge.tint, fontSize = 10.sp)
                        }
                    }
                )
            }
        }
    }
    info?.let { badge ->
        AlertDialog(
            onDismissRequest = { info = null },
            title = { Text(badge.name) },
            text = { Text(badge.details) },
            confirmButton = { TextButton(onClick = { info = null }) { Text("Entendi") } }
        )
    }
}

@Composable
internal fun BadgeSettings(uid: String) {
    val db = remember { FirebaseFirestore.getInstance() }
    var badges by remember(uid) { mutableStateOf(PublicBadges()) }
    var requestKind by remember(uid) { mutableStateOf("") }
    var requestStatus by remember(uid) { mutableStateOf("") }
    var busy by remember(uid) { mutableStateOf(false) }
    var feedback by remember(uid) { mutableStateOf("") }

    DisposableEffect(db, uid) {
        val badgeRegistration = db.collection("badges").document(uid).addSnapshotListener { data, error ->
            if (error == null) badges = data.asPublicBadges()
        }
        val requestRegistration = db.collection("badge_requests").document(uid)
            .addSnapshotListener { data, error ->
                if (error == null) {
                    requestKind = data?.getString("kind").orEmpty()
                    requestStatus = data?.getString("status").orEmpty()
                }
            }
        onDispose { badgeRegistration.remove(); requestRegistration.remove() }
    }

    Text("Selos da comunidade", fontWeight = FontWeight.Bold, color = Wine)
    Text("Leigo e Leiga são identificações opcionais escolhidas pelo próprio usuário.",
        color = Muted, fontSize = 12.sp)

    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((label, value) in listOf("Leigo" to "leigo", "Leiga" to "leiga", "Nenhum" to "")) {
            FilterChip(
                selected = badges.lay == value, onClick = {
                    if (!busy && badges.lay != value) {
                        busy = true
                        db.collection("badges").document(uid)
                            .set(mapOf("lay" to value), SetOptions.merge())
                            .addOnCompleteListener { result ->
                                busy = false
                                feedback = if (result.isSuccessful) "Identificação atualizada."
                                    else "Não foi possível atualizar a identificação."
                            }
                    }
                }, label = { Text(label) }, enabled = !busy
            )
        }
    }

    Spacer(Modifier.height(8.dp))
    if (badges.clergy.isNotBlank()) {
        Text("Sua identidade religiosa já está registrada.", color = Wine, fontSize = 12.sp)
    } else {
        Text("Padre e Diácono exigem verificação pela administração.",
            color = Muted, fontSize = 12.sp)
        when (requestStatus) {
            "pending" -> Text(
                "Solicitação de ${if (requestKind == "padre") "Padre" else "Diácono"} em análise.",
                color = Wine, fontSize = 12.sp
            )
            "approved" -> Text("Solicitação aprovada pela administração.",
                color = Wine, fontSize = 12.sp)
            else -> {
                if (requestStatus in listOf("rejected", "dismissed")) {
                    Text("Solicitação anterior não aprovada. Você pode enviar uma nova.",
                        color = Muted, fontSize = 12.sp)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for ((label, kind) in listOf("Sou Padre" to "padre", "Sou Diácono" to "diacono")) {
                        OutlinedButton(
                            onClick = {
                                busy = true
                                db.collection("badge_requests").document(uid).set(
                                    mapOf("kind" to kind, "status" to "pending",
                                        "createdAt" to FieldValue.serverTimestamp()),
                                    SetOptions.merge()
                                ).addOnCompleteListener { result ->
                                    busy = false
                                    feedback = if (result.isSuccessful) "Pedido enviado para verificação."
                                        else "Não foi possível registrar o pedido."
                                }
                            },
                            enabled = !busy
                        ) { Text(label) }
                    }
                }
            }
        }
    }
    Text("Os selos de Fundador e Moderador são definidos apenas pela administração.",
        color = Muted, fontSize = 11.sp)
    if (feedback.isNotBlank()) Text(feedback, color = Wine, fontSize = 12.sp)
}
