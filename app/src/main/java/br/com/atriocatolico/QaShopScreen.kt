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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.OutlinedCard
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.produceState
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException

internal data class QaShopProduct(
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
internal fun QaShopScreen(
    loadCatalog: suspend () -> List<QaShopProduct> = { qaShopProducts },
    onClose: () -> Unit
) {
    var attempt by rememberSaveable { mutableStateOf(0) }
    val catalog by produceState<Result<List<QaShopProduct>>?>(null, attempt) {
        value = null
        value = try {
            Result.success(loadCatalog())
        } catch (cancelled: CancellationException) {
            throw cancelled
        } catch (error: Exception) {
            Result.failure(error)
        }
    }
    val products = catalog?.getOrNull().orEmpty()
    var category by rememberSaveable { mutableStateOf<String?>(null) }
    var productId by rememberSaveable { mutableStateOf<String?>(null) }
    val product = products.firstOrNull { it.id == productId }
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
            val currentCatalog = catalog
            when {
                currentCatalog == null -> item {
                    CircularProgressIndicator(Modifier.testTag("atrio-qa-shop-loading"))
                    Text("Carregando catálogo")
                }
                currentCatalog.isFailure -> item {
                    Text("Não foi possível carregar o catálogo.")
                    TextButton(onClick = { attempt++ }) { Text("Tentar novamente") }
                }
                products.isEmpty() -> item { Text("Nenhum produto disponível.") }
                else -> {
                    val categories = products.map { it.category }.distinct()
                    val selectedCategory = category?.takeIf { it in categories }
                    item {
                        FilterChip(
                            selected = selectedCategory == null,
                            onClick = { category = null },
                            label = { Text("Todos") }
                        )
                    }
                    items(categories) { option ->
                        FilterChip(
                            selected = selectedCategory == option,
                            onClick = { category = option },
                            label = { Text(option) }
                        )
                    }
                    items(products.filter { selectedCategory == null || it.category == selectedCategory }, key = { it.id }) { item ->
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
    }
}
