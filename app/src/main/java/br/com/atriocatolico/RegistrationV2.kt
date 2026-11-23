package br.com.atriocatolico

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.Image
import androidx.compose.foundation.isSystemInDarkTheme
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.res.painterResource
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
    val dark = isSystemInDarkTheme()
    val background = if (dark) Color(0xFF20171A) else Color(0xFFFAF5ED)
    val titleColor = if (dark) Color(0xFFFFB2C6) else Color(0xFF701333)
    val bodyColor = if (dark) Color(0xFFF8E8ED) else Color(0xFF31272A)
    val outlineColor = if (dark) Color(0xFFE8BA62) else Color(0xFFA57926)
    BoxWithConstraints(
        Modifier.fillMaxSize().background(background).testTag("atrio-signup-welcome"),
        contentAlignment = Alignment.TopCenter
    ) {
        val glassHeight = (maxHeight * 0.34f).coerceIn(104.dp, 240.dp)
        Column(
            Modifier.widthIn(max = 440.dp).fillMaxWidth()
                .verticalScroll(rememberScrollState()).padding(horizontal = 24.dp, vertical = 24.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Image(
                painter = painterResource(R.drawable.atrio_boas_vindas_vitral),
                contentDescription = null,
                modifier = Modifier.height(glassHeight).fillMaxWidth().testTag("atrio-welcome-vitral")
            )
            Text(
                "Átrio Católico", fontFamily = FontFamily.Serif, fontWeight = FontWeight.Bold,
                color = titleColor, textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineLarge
            )
            Text(
                "Boas-vindas!", color = titleColor, fontWeight = FontWeight.SemiBold,
                textAlign = TextAlign.Center, style = MaterialTheme.typography.headlineSmall
            )
            Text(
                "Aprenda mais sobre a fé católica, converse com respeito e viva a comunhão em comunidade.",
                color = bodyColor, textAlign = TextAlign.Center, style = MaterialTheme.typography.bodyLarge
            )
            Button(
                onClick = onCreate, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-welcome-create"),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF701333), contentColor = Color.White),
                shape = RoundedCornerShape(14.dp)
            ) { Text("Criar conta") }
            OutlinedButton(
                onClick = onLogin, modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-welcome-login"),
                border = BorderStroke(1.dp, outlineColor),
                shape = RoundedCornerShape(14.dp)
            ) { Text("Entrar", color = titleColor) }
        }
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
            Text("Personalize seu perfil", fontFamily = FontFamily.Serif, fontSize = 24.sp,
                fontWeight = FontWeight.Bold, color = Wine)
            Text("Todos os campos são opcionais.",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        } else {
            Text("Interesses e dados opcionais", fontWeight = FontWeight.Bold,
                color = Wine, style = MaterialTheme.typography.titleMedium)
        }
        Text("Interesses (opcional)", style = MaterialTheme.typography.titleSmall, color = Ink)
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
        if (!firstAccess) {
            Text("Como você se apresenta? (opcional)",
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
            Text("Padre, Diácono, Religioso(a) exigem verificação administrativa. " +
                "Esta escolha não concede selo nem privilégios.",
                color = Muted, style = MaterialTheme.typography.bodySmall)
        }
        OutlinedTextField(
            parish, { parish = it.take(80) }, label = { Text("Paróquia (opcional)") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-parish")
        )
        OutlinedTextField(
            city, { city = it.take(80) }, label = { Text("Cidade (opcional)") },
            enabled = !busy, singleLine = true, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-city")
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
                } else info = "Não foi possível salvar. Se um interesse já aparece no perfil público, " +
                    "oculte-o no editor antes de removê-lo. Confira também a conexão."
            }
        }, enabled = !busy && loaded && hasData && allowed,
            colors = ButtonDefaults.buttonColors(containerColor = Wine),
            modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                .testTag("atrio-onboarding-save")) { Text(if (busy) "Salvando..." else if (firstAccess) "Salvar e continuar" else "Salvar preferências") }
        if (firstAccess) {
            OutlinedButton(onClick = onContinue, enabled = !busy,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-onboarding-skip")) { Text("Pular por agora") }
        } else {
            OutlinedButton(onClick = {
                busy = true
                ref.delete().addOnCompleteListener { task ->
                    busy = false
                    if (task.isSuccessful) {
                        interests = emptyList(); participation = ""; city = ""; parish = ""
                        consent = false; editing = false
                        info = "Preferências removidas."
                    } else info = "Não foi possível remover. Primeiro oculte os interesses que aparecem " +
                        "no perfil público; depois tente novamente."
                }
            }, enabled = !busy, modifier = Modifier.fillMaxWidth()
                .testTag("atrio-onboarding-delete")) { Text("Apagar minhas preferências") }
            TextButton(onClick = { editing = false }, enabled = !busy,
                modifier = Modifier.fillMaxWidth()) { Text("Fechar") }
        }
    }
}


/** Apenas a conta já confirmada chega aqui; sucesso só após Firebase Auth. */
@Composable
internal fun RegistrationOnboardingScreen(
    db: FirebaseFirestore, uid: String, onFinish: () -> Unit
) {
    var confirmed by rememberSaveable(uid) { mutableStateOf(false) }
    var profileSaved by remember(uid) { mutableStateOf<Boolean?>(null) }
    LaunchedEffect(db, uid) {
        db.collection("profiles").document(uid).get(Source.SERVER)
            .addOnCompleteListener { result ->
                // Task.result lança RuntimeExecutionException se a leitura falhar.
                // Em uma sessão nova ou sem acesso ao servidor, o onboarding
                // deve seguir oferecendo "Continuar", sem derrubar o app.
                if (!result.isSuccessful) {
                    profileSaved = false
                } else {
                    val validNameLength = result.result?.getString("displayName")
                        ?.trim()?.length ?: 0
                    profileSaved = validNameLength in 2..35
                }
            }
    }
    Column(
        Modifier.fillMaxSize().background(Paper).verticalScroll(rememberScrollState())
            .padding(horizontal = 24.dp, vertical = 24.dp)
            .testTag("atrio-onboarding-screen"),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Text("Átrio Católico", fontFamily = FontFamily.Serif,
            color = Wine, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        if (!confirmed) {
            Text("E-mail confirmado · Passo 3 de 3",
                color = Wine, style = MaterialTheme.typography.titleMedium)
            RegistrationOptionalPreferences(
                db = db, uid = uid, firstAccess = true,
                onContinue = { confirmed = true }
            )
        } else {
            if (profileSaved == true) {
                Text("Cadastro concluído!", color = Wine,
                    fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text("Seu e-mail foi confirmado e seu nome público está salvo. " +
                    "Bem-vindo(a) à comunidade! Você poderá editar seus interesses depois.",
                    color = Ink, style = MaterialTheme.typography.bodyLarge)
            } else {
                Text("E-mail confirmado", color = Wine,
                    fontSize = 26.sp, fontWeight = FontWeight.Bold)
                Text("Não foi possível confirmar seu nome público no servidor. " +
                    "Você poderá concluí-lo na próxima tela, sem perder a conta.",
                    color = Ink, style = MaterialTheme.typography.bodyLarge)
            }
            Button(
                onClick = onFinish,
                modifier = Modifier.fillMaxWidth().heightIn(min = 48.dp)
                    .testTag("atrio-onboarding-enter"),
                colors = ButtonDefaults.buttonColors(containerColor = Wine),
                shape = RoundedCornerShape(14.dp)
            ) { Text(if (profileSaved == true) "Entrar no Átrio" else "Continuar") }
        }
    }
}
