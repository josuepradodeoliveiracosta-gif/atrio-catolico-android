package br.com.atriocatolico

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Local QA only, existing admin and server-fresh page guards required. No writes. */
@Composable
internal fun GuardianReportPagePanel(rows: List<GuardianPageRow>, sessionActive: Boolean, adminApproved: Boolean, serverFresh: Boolean, hasMore: Boolean) {
    if (!sessionActive || !adminApproved || !serverFresh) return
    var kind by remember { mutableStateOf(GuardianPageKind.ALL) }
    var origin by remember { mutableStateOf(GuardianPageOrigin.ALL) }
    val summary = GuardianReportPageSummary.evaluate(rows, sessionActive, adminApproved, serverFresh, hasMore, kind, origin) ?: return
    Card(Modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Guardião — visão da página do fórum", style = MaterialTheme.typography.titleMedium)
            Text("${summary.reports} denúncias · ${summary.pending} pendentes · ${summary.reviewed} analisadas")
            Text("${summary.pendingTargets} alvos com denúncias pendentes")
            Text("Somente a página carregada (até 100 registros); não são totais globais.", style = MaterialTheme.typography.bodySmall)
            if (summary.truncated) Text("Há registros fora desta visão.")
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GuardianPageKind.values().forEach { value ->
                    FilterChip(selected = kind == value, onClick = { kind = value }, label = { Text(when(value) { GuardianPageKind.ALL -> "Todos"; GuardianPageKind.POST -> "Publicações"; GuardianPageKind.REPLY -> "Respostas" }) })
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                GuardianPageOrigin.values().forEach { value ->
                    FilterChip(selected = origin == value, onClick = { origin = value }, label = { Text(when(value) { GuardianPageOrigin.ALL -> "Todas as origens"; GuardianPageOrigin.COMMUNITY -> "Comunidade"; GuardianPageOrigin.GUARDIAN -> "Guardião" }) })
                }
            }
            Text("${summary.matching} denúncias pendentes nos filtros desta visão.")
            Text("Sinais não confirmam infração. Use o fluxo de revisão original.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
