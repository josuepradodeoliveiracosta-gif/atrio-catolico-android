package br.com.atriocatolico

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.Checkbox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore

internal object CommunityRulesPolicy {
    const val VERSION = "2026-11-v1"
    const val RULES =
        "Nossa comunidade é dedicada ao diálogo respeitoso sobre a fé católica. " +
        "Não são permitidos ameaças, assédio, discursos de ódio, exposição de dados privados, " +
        "fraudes, spam, exploração sexual, conteúdo ilegal ou falsificação de identidade. " +
        "Não se passe por sacerdotes, diáconos, moderadores ou administradores. " +
        "Posts, respostas e participantes podem ser denunciados; denúncias são revisadas " +
        "pela moderação. Respeite os demais participantes e não compartilhe segredos de terceiros."
}

/**
 * Mostrado para TODAS as contas sem aceite persistente, inclusive contas criadas
 * antes do formulário novo. A liberação depende de escrita confirmada no Firestore.
 */
@Composable
internal fun CommunityRulesGate(
    db: FirebaseFirestore,
    uid: String,
    loaded: Boolean
) {
    var accepted by remember(uid) { mutableStateOf(false) }
    var busy by remember(uid) { mutableStateOf(false) }
    var info by remember(uid) { mutableStateOf("") }
    Box(Modifier.fillMaxSize().background(Paper).padding(24.dp), contentAlignment = Alignment.Center) {
        if (!loaded) {
            CircularProgressIndicator(modifier = Modifier.testTag("atrio-rules-loading"))
        } else {
            Column(
                modifier = Modifier.fillMaxWidth().verticalScroll(rememberScrollState())
                    .testTag("atrio-rules-gate"),
                verticalArrangement = Arrangement.spacedBy(14.dp)
            ) {
                Text("Regras da Comunidade", style = MaterialTheme.typography.headlineSmall, color = Wine)
                Text("Para participar das discussões do Átrio Católico, " +
                    "leia e aceite as regras abaixo.", style = MaterialTheme.typography.bodyMedium)
                Text(CommunityRulesPolicy.RULES, style = MaterialTheme.typography.bodyMedium)
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Checkbox(
                        checked = accepted,
                        onCheckedChange = { accepted = it },
                        enabled = !busy,
                        modifier = Modifier.testTag("atrio-rules-checkbox")
                    )
                    Text("Li e aceito as Regras da Comunidade.", style = MaterialTheme.typography.bodyMedium)
                }
                if (info.isNotBlank()) Text(info, color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodySmall)
                Button(
                    enabled = accepted && !busy,
                    modifier = Modifier.fillMaxWidth().testTag("atrio-rules-accept"),
                    onClick = {
                        busy = true
                        info = ""
                        db.collection("community_consents").document(uid).set(mapOf(
                            "version" to CommunityRulesPolicy.VERSION,
                            "acceptedAt" to FieldValue.serverTimestamp()
                        )).addOnCompleteListener { result ->
                            busy = false
                            if (!result.isSuccessful) {
                                info = "Não foi possível registrar o aceite. Confira a conexão."
                            }
                            // Um listener em OnlineUserScreen libera o app
                            // somente depois de constatar o aceite no Firestore.
                        }
                    }
                ) { Text(if (busy) "Registrando..." else "Aceitar e entrar") }
                Text("Seu aceite fica vinculado à conta. Regras e política de privacidade " +
                    "completa deverão ser revisadas antes da publicação na Play.",
                    style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}
