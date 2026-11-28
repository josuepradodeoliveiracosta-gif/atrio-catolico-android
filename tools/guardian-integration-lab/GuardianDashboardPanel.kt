package br.com.atriocatolico.guardian.offline

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

/** Candidate read-only section for the existing LazyColumn. Not wired to Android.
 * Fixture only; never pass real user data. Filter callbacks are local only. */
@Composable
fun GuardianDashboardPanel(state: DashboardState, filter: DashboardFilter, onFilter: (DashboardFilter) -> Unit, modifier: Modifier = Modifier) {
    Card(modifier.fillMaxWidth()) {
        Column(Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            Text("Átrio Guardião — triagem", style = MaterialTheme.typography.titleLarge)
            Text("Protótipo offline · dados fictícios", style = MaterialTheme.typography.labelMedium)
            if (state.status != DashboardStatus.READY || state.counts == null || state.remoteAuthorized) {
                Text(when(state.status) {
                    DashboardStatus.DENIED -> "Acesso administrativo indisponível."
                    DashboardStatus.LOADING -> "Carregando a página de demonstração…"
                    else -> "Não foi possível consultar a página."
                })
                return@Column
            }
            val counts = state.counts
            Text("${counts.groups} grupos · ${counts.reports} denúncias nesta página carregada")
            Text("Urgentes: ${counts.urgent} · Prioritárias: ${counts.priority} · Normais: ${counts.normal}")
            Text("Prioridade não confirma infração. Cada denúncia exige análise individual.", style = MaterialTheme.typography.bodySmall)
            Text("Origem", style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = filter.source == null, onClick = { onFilter(filter.copy(source = null, page = 0)) }, label = { Text("Todas") })
                Source.values().forEach { source -> FilterChip(selected = filter.source == source, onClick = { onFilter(filter.copy(source = source, page = 0)) }, label = { Text(source.label) }) }
            }
            Text("Prioridade", style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = filter.priority == null, onClick = { onFilter(filter.copy(priority = null, page = 0)) }, label = { Text("Todas") })
                Priority.values().reversed().forEach { priority -> FilterChip(selected = filter.priority == priority, onClick = { onFilter(filter.copy(priority = priority, page = 0)) }, label = { Text(priority.label) }) }
            }
            Text("Categoria", style = MaterialTheme.typography.titleSmall)
            Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                FilterChip(selected = filter.category == null, onClick = { onFilter(filter.copy(category = null, page = 0)) }, label = { Text("Todas") })
                Category.values().forEach { category -> FilterChip(selected = filter.category == category, onClick = { onFilter(filter.copy(category = category, page = 0)) }, label = { Text(category.label) }) }
            }
            Text("${state.filteredGroups} grupos encontrados na página carregada")
            if (state.rows.isEmpty()) Text("Nenhum grupo corresponde aos filtros.")
            state.rows.forEach { entry ->
                HorizontalDivider()
                Text("${entry.kind.label} · ${entry.priority.label}", style = MaterialTheme.typography.titleMedium)
                Text(entry.categories.sortedBy { it.ordinal }.joinToString(" · ") { it.label })
                Text("${entry.reports} denúncias · ${entry.source.label}", style = MaterialTheme.typography.bodySmall)
            }
            if (state.pageCount > 0) {
                Text("Página local ${state.page + 1} de ${state.pageCount}")
                TextButton(enabled = state.page > 0, onClick = { onFilter(filter.copy(page = state.page - 1)) }) { Text("Página anterior") }
                TextButton(enabled = state.page + 1 < state.pageCount, onClick = { onFilter(filter.copy(page = state.page + 1)) }) { Text("Próxima página") }
            }
            if (state.moreRemote) Text("Há outros registros fora da página carregada. Os totais não são globais.")
            Text("A revisão, os avisos e os recursos continuam nos fluxos originais. Nenhuma decisão pode ser executada neste protótipo.", style = MaterialTheme.typography.bodySmall)
        }
    }
}
