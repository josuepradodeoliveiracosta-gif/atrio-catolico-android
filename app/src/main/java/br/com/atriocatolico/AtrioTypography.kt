package br.com.atriocatolico

import androidx.compose.ui.unit.sp

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
