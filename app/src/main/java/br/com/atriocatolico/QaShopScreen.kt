package br.com.atriocatolico

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

private data class QaShopProduct(
    val id: String,
    val category: String,
    val name: String,
    val description: String
)

private val qaShopProducts = listOf(
    QaShopProduct("terco", "Terços", "Terço de madeira", "Contas de madeira com crucifixo."),
    QaShopProduct("medalha", "Medalhas", "Medalha de São Bento", "Medalha devocional em metal."),
    QaShopProduct("oratorio", "Artigos para o lar", "Oratório de mesa", "Oratório pequeno para uso doméstico.")
)

@Composable
internal fun QaShopScreen(onClose: () -> Unit) {
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var productId by rememberSaveable { mutableStateOf<String?>(null) }
    val product = qaShopProducts.firstOrNull { it.id == productId }
    val catalogState = rememberLazyListState()
    val goBack: () -> Unit = { if (product == null) onClose() else productId = null }

    BackHandler(onBack = goBack)
    if (product != null) {
        LazyColumn(
            Modifier.fillMaxSize().testTag("atrio-qa-shop-product"),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { TextButton(onClick = goBack) { Text("Voltar ao catálogo") } }
            item { SectionTitle(product.name) }
            item { Text(product.description) }
            item { Text("Produto fictício para testes de QA.") }
        }
    } else {
        LazyColumn(
            Modifier.fillMaxSize().testTag("atrio-qa-shop-catalog"),
            state = catalogState,
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            item { TextButton(onClick = goBack) { Text("Voltar ao Início") } }
            item { SectionTitle("Átrio Loja") }
            item { Text("Catálogo fictício para QA") }
            item { FilterChip(selected = category == null, onClick = { category = null }, label = { Text("Todos") }) }
            items(qaShopProducts.map { it.category }.distinct()) { option ->
                FilterChip(selected = category == option, onClick = { category = option }, label = { Text(option) })
            }
            items(qaShopProducts.filter { category == null || it.category == category }, key = { it.id }) { item ->
                OutlinedCard(
                    onClick = { productId = item.id },
                    modifier = Modifier.fillMaxWidth().testTag("atrio-qa-shop-product-${item.id}")
                ) {
                    Text(item.name, Modifier.padding(16.dp))
                }
            }
        }
    }
}
