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
import androidx.compose.ui.platform.LocalUriHandler
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.CancellationException
import java.math.BigDecimal
import java.text.NumberFormat
import java.util.Locale

internal enum class QaShopAvailability(val label: String) {
    IN_STOCK("Em estoque"),
    OUT_OF_STOCK("Esgotado"),
    UNKNOWN("Estoque não confirmado")
}

internal data class QaShopVariant(
    val id: String,
    val sku: String,
    val label: String,
    val unitPriceMinor: Long,
    val availability: QaShopAvailability,
    val currency: String = "BRL"
)

internal data class QaShopProduct(
    val id: String,
    val categoryId: String,
    val category: String,
    val name: String,
    val description: String,
    val variants: List<QaShopVariant>
)

private const val QA_CHECKOUT_URL = "https://example.com/"

private object SimulatedQaShopSupplier {
    fun load(revisedOffer: Boolean): List<QaShopProduct> = listOf(
        QaShopProduct("terco", "tercos", "Terços", "Terço de madeira", "Contas de madeira com crucifixo.", listOf(
            QaShopVariant("terco-natural", "TRC-NAT", "Madeira natural", 2990, QaShopAvailability.OUT_OF_STOCK)
        )),
        QaShopProduct("medalha", "medalhas", "Medalhas", "Medalha de São Bento", "Medalha devocional em metal.", listOf(
            QaShopVariant("medalha-prateada", "MED-PRA", "Prateada",
                if (revisedOffer) 2490 else 1990, QaShopAvailability.IN_STOCK),
            QaShopVariant("medalha-dourada", "MED-DOU", "Dourada", 2290,
                if (revisedOffer) QaShopAvailability.OUT_OF_STOCK else QaShopAvailability.IN_STOCK)
        )),
        QaShopProduct("oratorio", "lar", "Artigos para o lar", "Oratório de mesa", "Oratório pequeno para uso doméstico.", listOf(
            QaShopVariant("oratorio-natural", "ORA-NAT", "Madeira natural", 4990, QaShopAvailability.UNKNOWN)
        ))
    )
}

private data class QaShopQuote(
    val unitPriceMinor: Long,
    val shippingMinor: Long,
    val currency: String,
    val deliveryDays: Int
) {
    val totalMinor: Long get() = unitPriceMinor + shippingMinor
}

private fun formatQaShopPrice(amountMinor: Long, currencyCode: String): String =
    NumberFormat.getCurrencyInstance(Locale.forLanguageTag("pt-BR")).apply {
        currency = java.util.Currency.getInstance(currencyCode)
    }.format(BigDecimal.valueOf(amountMinor, 2))

private fun QaShopVariant.testQuote(): QaShopQuote? =
    if (availability == QaShopAvailability.IN_STOCK) {
        QaShopQuote(unitPriceMinor, shippingMinor = 890, currency = currency, deliveryDays = 5)
    } else null

@Composable
internal fun QaShopScreen(
    loadCatalog: (suspend () -> List<QaShopProduct>)? = null,
    onClose: () -> Unit
) {
    val uriHandler = LocalUriHandler.current
    var checkoutError by rememberSaveable { mutableStateOf(false) }
    var attempt by rememberSaveable { mutableStateOf(0) }
    val catalog by produceState<Result<List<QaShopProduct>>?>(null, attempt) {
        value = null
        value = try {
            Result.success(loadCatalog?.invoke() ?: SimulatedQaShopSupplier.load(revisedOffer = attempt > 0))
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
    var selectedVariantId by rememberSaveable(productId) { mutableStateOf<String?>(null) }
    val selectedVariant = product?.variants?.let { variants ->
        variants.firstOrNull { it.id == selectedVariantId } ?: variants.firstOrNull()
    }
    val quote = selectedVariant?.testQuote()
    val catalogState = rememberLazyListState()
    val goBack: () -> Unit = {
        checkoutError = false
        if (product == null) onClose() else productId = null
    }

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
            if (product.variants.size > 1) {
                items(product.variants, key = { it.id }) { variant ->
                    FilterChip(
                        selected = selectedVariant == variant,
                        onClick = {
                            selectedVariantId = variant.id
                            checkoutError = false
                        },
                        label = { Text(variant.label) }
                    )
                }
            }
            selectedVariant?.let { variant ->
                item { Text(formatQaShopPrice(variant.unitPriceMinor, variant.currency), Modifier.testTag("atrio-qa-shop-price")) }
                item { Text(variant.availability.label, Modifier.testTag("atrio-qa-shop-stock")) }
            }
            quote?.let { current ->
                item {
                    Text("Frete simulado: ${formatQaShopPrice(current.shippingMinor, current.currency)}")
                }
                item {
                    Text("Total simulado: ${formatQaShopPrice(current.totalMinor, current.currency)}",
                        Modifier.testTag("atrio-qa-shop-quote-total"))
                }
                item { Text("Prazo estimado: ${current.deliveryDays} dias úteis") }
            }
            item {
                TextButton(enabled = quote != null, onClick = {
                    checkoutError = false
                    try {
                        uriHandler.openUri(QA_CHECKOUT_URL)
                    } catch (_: IllegalArgumentException) {
                        checkoutError = true
                    }
                }) { Text("Abrir página de teste") }
            }
            if (checkoutError) item { Text("Não foi possível abrir a página de teste.") }
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
                    val categories = products.distinctBy { it.categoryId }
                    val selectedCategory = category?.takeIf { id -> categories.any { it.categoryId == id } }
                    item { TextButton(onClick = { attempt++ }) { Text("Atualizar catálogo") } }
                    item {
                        FilterChip(
                            selected = selectedCategory == null,
                            onClick = { category = null },
                            label = { Text("Todos") }
                        )
                    }
                    items(categories) { option ->
                        FilterChip(
                            selected = selectedCategory == option.categoryId,
                            onClick = { category = option.categoryId },
                            label = { Text(option.category) }
                        )
                    }
                    items(products.filter { selectedCategory == null || it.categoryId == selectedCategory }, key = { it.id }) { item ->
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
