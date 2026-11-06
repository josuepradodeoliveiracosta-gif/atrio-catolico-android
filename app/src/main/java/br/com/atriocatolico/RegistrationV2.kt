package br.com.atriocatolico

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Source

/**
 * Cadastro progressivo com a paleta e os componentes JÁ existentes no Átrio.
 * O passo de boas-vindas não consulta Firebase e não solicita permissões.
 */
@Composable
internal fun RegistrationWelcomeScreen(onCreate: () -> Unit, onLogin: () -> Unit) {
    Column(
        Modifier.fillMaxSize().background(Paper).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 32.dp).testTag("atrio-signup-welcome"),
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Spacer(Modifier.height(20.dp))
        Text("✝", fontFamily = FontFamily.Serif, color = Gold, fontSize = 48.sp)
        Text("Átrio Católico", fontFamily = FontFamily.Serif,
            fontWeight = FontWeight.Bold, fontSize = 32.sp, color = Wine)
        Text("Seja bem-vindo(a)!", color = Wine, fontSize = 24.sp,
            fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center)
        Text(
            "Uma comunidade de formação e comunhão, para conversar sobre a fé " +
                "católica com respeito e fraternidade.",
            color = Ink, textAlign = TextAlign.Center,
            style = MaterialTheme.typography.bodyLarge
        )
        Card(
            border = BorderStroke(1.dp, Line),
            shape = RoundedCornerShape(AtrioDimensions.CardRadius),
            colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)
        ) {
            Column(Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Text("Seu primeiro passo", color = Wine,
                    style = MaterialTheme.typography.titleMedium)
                Text("Crie uma conta com nome, e-mail e senha. " +
                    "Depois, confirme seu e-mail. Seus interesses e sua apresentação são opcionais.",
                    style = MaterialTheme.typography.bodyMedium, color = Ink)
                Text("Quem já participa pode continuar usando a mesma conta.",
                    style = MaterialTheme.typography.bodySmall, color = Muted)
            }
        }
        Button(
            onClick = onCreate, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-welcome-create"),
            colors = ButtonDefaults.buttonColors(containerColor = Wine),
            shape = RoundedCornerShape(14.dp)
        ) { Text("Criar conta") }
        OutlinedButton(
            onClick = onLogin, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-welcome-login"),
            border = BorderStroke(1.dp, Gold),
            shape = RoundedCornerShape(14.dp)
        ) { Text("Entrar", color = Wine) }
        Text("Seus dados e sua participação são protegidos pelas regras da comunidade.",
            textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall, color = Muted)
    }
}

internal object RegistrationOptionalPolicy {
    const val CONSENT_VERSION = "cadastro-v2-2026-11"
    val interests = listOf("Oração", "Formação", "Comunidade", "Notícias católicas")
    val participations = listOf("Leigo(a)", "Religioso(a)", "Padre/Diácono")
    fun valid(interestsValue: List<String>, participation: String, city: String, parish: String): Boolean =
        interestsValue.distinct().size == interestsValue.size &&
            interestsValue.size <= interests.size &&
            interestsValue.all { it in interests } &&
            (participation.isBlank() || participation in participations) &&
            city.length <= 80 && parish.length <= 80 &&
            !city.any { it.isISOControl() } && !parish.any { it.isISOControl() }
    fun hasSensitive(interestsValue: List<String>, participation: String, parish: String): Boolean =
        interestsValue.isNotEmpty() || participation.isNotBlank() || parish.isNotBlank()
}

/**
 * Os dados desta tela são privados por padrão em users/{uid}/private/preferences.
 * Não alteram selos/grants. Não há partilha automática de cidade/paróquia.
 * Um usuário pode pular, editar mais tarde ou apagar completamente as preferências.
 */
@Composable
internal fun RegistrationOptionalPreferences(
    db: FirebaseFirestore, uid: String, firstAccess: Boolean,
    onContinue: () -> Unit = {}
) {
    var editing by rememberSaveable(uid, firstAccess) { mutableStateOf(firstAccess) }
    var interests by rememberSaveable(uid) { mutableStateOf<List<String>>(emptyList()) }
    var participation by rememberSaveable(uid) { mutableStateOf("") }
    var city by rememberSaveable(uid) { mutableStateOf("") }
    var parish by rememberSaveable(uid) { mutableStateOf("") }
    var consent by rememberSaveable(uid) { mutableStateOf(false) }
    var busy by remember(uid) { mutableStateOf(false) }
    var loaded by remember(uid) { mutableStateOf(false) }
    var info by remember(uid) { mutableStateOf("") }
    val ref = remember(db, uid) { db.document("users/$uid/private/preferences") }

    LaunchedEffect(db, uid) {
        ref.get(Source.SERVER).addOnCompleteListener { task ->
            loaded = true
            if (task.isSuccessful) {
                val existing = task.result
                if (existing?.exists() == true) {
                    interests = (existing.get("interests") as? List<*>)
                        ?.filterIsInstance<String>().orEmpty()
                        .filter { it in RegistrationOptionalPolicy.interests }
                    participation = existing.getString("participation").orEmpty()
                    city = existing.getString("city").orEmpty()
                    parish = existing.getString("parish").orEmpty()
                    consent = existing.getString("consentVersion") ==
                        RegistrationOptionalPolicy.CONSENT_VERSION
                }
            } else {
                info = "Não foi possível consultar suas preferências. Elas são opcionais."
            }
        }
    }

    if (!editing) {
        OutlinedButton(
            onClick = { editing = true; info = "" },
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-onboarding-open")
        ) { Text("Editar interesses e apresentação") }
        return
    }

    Column(
        Modifier.fillMaxWidth().testTag("atrio-onboarding-panel"),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        if (firstAccess) {
            Text("Personalize se desejar", fontFamily = FontFamily.Serif, fontSize = 24.sp,
                fontWeight = FontWeight.Bold, color = Wine)
            Text("Passo opcional · Você já pode participar sem informar estes dados.",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        } else {
            Text("Interesses e dados opcionais", fontWeight = FontWeight.Bold,
                color = Wine, style = MaterialTheme.typography.titleMedium)
        }
        Text("Interesses", style = MaterialTheme.typography.titleSmall, color = Ink)
        RegistrationOptionalPolicy.interests.forEachIndexed { i, option ->
            Row(
                Modifier.fillMaxWidth().heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Checkbox(
                    checked = option in interests,
                    onCheckedChange = { selected ->
                        interests = if (selected) (interests + option).distinct()
                            else interests - option
                    }, enabled = !busy,
                    modifier = Modifier.testTag("atrio-onboarding-interest-$i")
                )
                Text(option, color = Ink, modifier = Modifier.padding(start = 6.dp))
            }
        }
        Text("Como você se apresenta? (autodeclaração, sem selo)",
            style = MaterialTheme.typography.titleSmall, color = Ink)
        RegistrationOptionalPolicy.participations.forEachIndexed { i, option ->
            Row(Modifier.fillMaxWidth().heightIn(min = 48.dp),
                verticalAlignment = Alignment.CenterVertically) {
                RadioButton(selected = participation == option,
                    enabled = !busy, onClick = {
                        participation = if (participation == option) "" else option
                    }, modifier = Modifier.testTag("atrio-onboarding-role-$i"))
                Text(option, modifier = Modifier.padding(start = 6.dp), color = Ink)
            }
        }
        Text("Selecionar Padre/Diácono não concede selo nem privilégios.",
            color = Muted, style = MaterialTheme.typography.bodySmall)
        OutlinedTextField(
            city, { city = it.take(80) }, label = { Text("Cidade (opcional)") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-city")
        )
        OutlinedTextField(
            parish, { parish = it.take(80) }, label = { Text("Paróquia (opcional)") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-parish")
        )
        Text("Esses dados permanecem privados e podem ser apagados no perfil. " +
            "Não são publicados na comunidade.", color = Muted,
            style = MaterialTheme.typography.bodySmall)
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
            Checkbox(checked = consent, enabled = !busy,
                onCheckedChange = { consent = it },
                modifier = Modifier.testTag("atrio-onboarding-consent"))
            Text("Autorizo guardar minhas escolhas de fé e vínculo paroquial " +
                "para personalizar minha experiência. Posso retirar esta autorização.",
                modifier = Modifier.weight(1f),
                style = MaterialTheme.typography.bodySmall, color = Ink)
        }
        val hasData = interests.isNotEmpty() || participation.isNotBlank() ||
            city.isNotBlank() || parish.isNotBlank()
        val allowed = !hasData || consent
        if (!allowed) {
            Text("Marque a autorização opcional para salvar estas informações. " +
                "Ou prossiga sem preenchê-las.", color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall)
        }
        if (info.isNotBlank()) Text(info, color = Wine,
            style = MaterialTheme.typography.bodySmall,
            modifier = Modifier.testTag("atrio-onboarding-info"))
        Button(onClick = {
            if (!hasData || !allowed) return@Button
            if (!RegistrationOptionalPolicy.valid(interests, participation, city.trim(), parish.trim())) {
                info = "Confira os campos e tente novamente."
                return@Button
            }
            busy = true
            info = "Salvando suas escolhas..."
            ref.set(mapOf(
                "interests" to interests,
                "participation" to participation,
                "city" to city.trim(),
                "parish" to parish.trim(),
                "consentVersion" to RegistrationOptionalPolicy.CONSENT_VERSION,
                "consentAt" to FieldValue.serverTimestamp(),
                "updatedAt" to FieldValue.serverTimestamp()
            )).addOnCompleteListener { task ->
                busy = false
                if (task.isSuccessful) {
                    info = "Preferências privadas salvas."
                    if (firstAccess) onContinue() else editing = false
                } else info = "Não foi possível salvar. Confira a conexão e as regras de acesso."
            }
        }, enabled = !busy && loaded && hasData && allowed,
            colors = ButtonDefaults.buttonColors(containerColor = Wine),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-onboarding-save")) { Text(if (busy) "Salvando..." else "Salvar preferências") }
        if (firstAccess) {
            OutlinedButton(onClick = onContinue, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-onboarding-skip")) { Text("Pular e entrar no Átrio") }
        } else {
            OutlinedButton(onClick = {
                busy = true
                ref.delete().addOnCompleteListener { task ->
                    busy = false
                    if (task.isSuccessful) {
                        interests = emptyList(); participation = ""; city = ""; parish = ""
                        consent = false; editing = false
                        info = "Preferências removidas."
                    } else info = "Não foi possível remover. Confira sua conexão."
                }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-delete")) { Text("Apagar minhas preferências") }
            TextButton(onClick = { editing = false }, enabled = !busy,
                modifier = Modifier.fillMaxWidth()) { Text("Fechar") }
        }
    }
}
