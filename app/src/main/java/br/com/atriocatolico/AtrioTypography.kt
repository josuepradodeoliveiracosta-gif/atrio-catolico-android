package br.com.atriocatolico

import androidx.compose.ui.unit.sp
import androidx.compose.material3.Typography

/**
 * Escala tipográfica do Átrio Católico.
 *
 * Os valores usam sp (respeitam o tamanho de fonte configurado no Android).
 * Não alterar títulos grandes da marca e elementos decorativos por reflexo:
 * a hierarquia visual deve ser mantida.
 *
 * Leitura: conteúdo de publicações, respostas e biografias.
 * Secundário: avisos de privacidade, tutoriais e mensagens administrativas.
 * Compacto: selos, categorias e ações de menu.
 * Metadado: datas e contadores não essenciais.
 *
 * ATENÇÃO: não aplique um fator manual à LocalDensity.fontScale.
 * O Android já faz a ampliação a partir dos valores sp.
 */
internal object AtrioType {
    val reading = 16.sp
    val readingLine = 24.sp
    val author = 15.sp
    val uiAction = 14.sp
    val secondary = 14.sp
    val secondaryLine = 21.sp
    val compact = 13.sp
    val compactLine = 19.sp
    val metadata = 12.sp
    val metadataLine = 17.sp
}

/**
 * Preserva estilos e pesos originais do Material 3, alterando somente tamanho
 * e altura de linha dos textos que aparecem em toda a interface.
 * Labels secundários são limitados a 12 sp, mensagens a 14 sp e leitura a 16 sp.
 */
private val baseTypography = Typography()
internal val AtrioMaterialTypography = Typography(
    displayLarge = baseTypography.displayLarge,
    displayMedium = baseTypography.displayMedium,
    displaySmall = baseTypography.displaySmall,
    headlineLarge = baseTypography.headlineLarge,
    headlineMedium = baseTypography.headlineMedium,
    headlineSmall = baseTypography.headlineSmall,
    titleLarge = baseTypography.titleLarge,
    titleMedium = baseTypography.titleMedium,
    titleSmall = baseTypography.titleSmall,
    bodyLarge = baseTypography.bodyLarge.copy(
        fontSize = AtrioType.reading,
        lineHeight = AtrioType.readingLine
    ),
    bodyMedium = baseTypography.bodyMedium.copy(
        fontSize = 15.sp,
        lineHeight = 22.sp
    ),
    bodySmall = baseTypography.bodySmall.copy(
        fontSize = AtrioType.secondary,
        lineHeight = AtrioType.secondaryLine
    ),
    labelLarge = baseTypography.labelLarge.copy(
        fontSize = AtrioType.uiAction,
        lineHeight = 20.sp
    ),
    labelMedium = baseTypography.labelMedium.copy(
        fontSize = AtrioType.compact,
        lineHeight = AtrioType.compactLine
    ),
    labelSmall = baseTypography.labelSmall.copy(
        fontSize = AtrioType.metadata,
        lineHeight = AtrioType.metadataLine
    )
)
