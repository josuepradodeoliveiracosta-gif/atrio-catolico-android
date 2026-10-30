package br.com.atriocatolico

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Pure in-memory demo, using the real preflight source. No Firebase or network. */
class GuardianOfflineLabActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent { MaterialTheme { Surface { GuardianOfflineLabScreen() } } }
    }
}

@Composable
internal fun GuardianOfflineLabScreen() {
    var draft by remember { mutableStateOf("") }
    var warning by remember { mutableStateOf<GuardianPreflight.Warning?>(null) }
    var mockPost by remember { mutableStateOf("") }
    var reported by remember { mutableStateOf(false) }
    var outcome by remember { mutableStateOf("") }
    var appeal by remember { mutableStateOf("") }
    var info by remember { mutableStateOf("Nada é enviado ou armazenado.") }
    fun pretendPublish() {
        warning = GuardianPreflight.inspect(draft)
        if (warning == null) {
            mockPost = draft
            reported = false
            outcome = ""
            appeal = ""
            info = "Publicação fictícia criada apenas na memória."
        } else info = "Aviso preventivo encontrado. Não houve publicação."
    }

    Column(
        Modifier.fillMaxSize().verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        Text("Átrio Guardião • LAB offline", style = MaterialTheme.typography.headlineSmall)
        Text("SIMULAÇÃO LOCAL: não acessa contas, Firebase, Cloudflare ou a comunidade real.")
        Text("1. Orientação preventiva", style = MaterialTheme.typography.titleMedium)
        OutlinedTextField(draft, { draft = it.take(4001) },
            modifier = Modifier.fillMaxWidth(), label = { Text("Texto fictício") }, minLines = 3)
        Button(enabled = draft.isNotBlank(), onClick = { pretendPublish() }) {
            Text("Simular publicação")
        }
        OutlinedButton(onClick = {
            draft = "Clique https://exemplo.invalid e informe sua senha."
            warning = null
        }) { Text("Exemplo de link suspeito") }
        warning?.let { notice ->
            HorizontalDivider()
            Text("Aviso: " + notice.rule, style = MaterialTheme.typography.titleMedium)
            Text(notice.explanation)
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedButton(onClick = {
                    warning = null
                    info = "Revisar: rascunho preservado, nada publicado."
                }) { Text("Revisar texto") }
                Button(onClick = {
                    warning = null
                    mockPost = draft
                    reported = false
                    outcome = ""
                    appeal = ""
                    info = "Continuação simulada: nenhum dado saiu do aparelho."
                }) { Text("Continuar na simulação") }
            }
        }
        Text(info, style = MaterialTheme.typography.bodySmall)
        HorizontalDivider()
        Text("2. Denúncia e revisão simuladas", style = MaterialTheme.typography.titleMedium)
        if (mockPost.isBlank()) {
            Text("Simule primeiro uma publicação para experimentar as próximas etapas.")
        } else {
            Text("Texto fictício: " + mockPost.take(240))
            if (!reported) OutlinedButton(onClick = { reported = true }) {
                Text("Simular denúncia")
            } else {
                Text("Denúncia fictícia pendente.")
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    OutlinedButton(onClick = { outcome = "Arquivada (simulação)" }) {
                        Text("Arquivar")
                    }
                    OutlinedButton(onClick = { outcome = "Removida (simulação)" }) {
                        Text("Remover")
                    }
                }
                if (outcome.isNotBlank()) {
                    Text(outcome)
                    OutlinedTextField(appeal, { appeal = it.take(500) },
                        label = { Text("Recurso fictício (não enviado)") },
                        modifier = Modifier.fillMaxWidth())
                }
            }
        }
        HorizontalDivider()
        OutlinedButton(onClick = {
            draft = ""; warning = null; mockPost = ""
            reported = false; outcome = ""; appeal = ""
            info = "Laboratório reiniciado. Nada foi armazenado."
        }) { Text("Reiniciar") }
        Text("A moderação real exige Firebase Auth, regras e servidor; este LAB só testa o aviso real e a interface fictícia. Não executa Guardião 24/7.",
            style = MaterialTheme.typography.bodySmall)
    }
}
