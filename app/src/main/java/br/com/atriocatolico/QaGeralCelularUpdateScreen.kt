package br.com.atriocatolico

import android.content.Context
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import java.util.UUID
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

private const val MARKER_KEY = "marcador"

@Composable
internal fun QaGeralCelularUpdateScreen() {
    val context = LocalContext.current
    val preferences = remember(context) {
        context.getSharedPreferences("qa-celular-atualizacao", Context.MODE_PRIVATE)
    }
    var marker by remember(preferences) { mutableStateOf(preferences.getString(MARKER_KEY, null)) }
    var saving by remember { mutableStateOf(false) }
    var failed by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    Surface(modifier = Modifier.fillMaxSize()) {
        Column(
            modifier = Modifier.verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            Text("QA Geral Celular", style = MaterialTheme.typography.headlineSmall)
            Text("Teste de atualização · versão ${BuildConfig.ATRIO_QA_GERAL_CELULAR_PAIR_CODE}")
            val savedMarker = marker
            if (savedMarker != null) {
                Text("Marcador local salvo")
                SelectionContainer { Text(savedMarker) }
            } else {
                Text("Nenhum marcador local salvo.")
            }
            if (failed) Text("Não foi possível salvar o marcador. Tente novamente.")
            Button(
                enabled = !saving && savedMarker == null,
                onClick = {
                    saving = true
                    failed = false
                    scope.launch {
                        val value = UUID.randomUUID().toString()
                        val written = withContext(Dispatchers.IO) {
                            preferences.edit().putString(MARKER_KEY, value).commit()
                        }
                        if (written) marker = value else failed = true
                        saving = false
                    }
                }
            ) {
                Text("Gerar e salvar marcador")
            }
        }
    }
}
