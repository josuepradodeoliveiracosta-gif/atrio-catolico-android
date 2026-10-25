package br.com.atriocatolico

import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.res.painterResource
import androidx.compose.ui.unit.sp

/**
 * Medalha do Fundador.
 *
 * Os PNG oficiais ficam em res/drawable-nodpi:
 *   selo_fundador.png (perfil)
 *   selo_fundador_icone.png (discussoes e respostas)
 *
 * Enquanto os arquivos ainda nao forem adicionados nesta branch, mantemos
 * o simbolo antigo para nao quebrar a compilacao e nao exibir imagem incorreta.
 */
@Composable
internal fun FounderBadgeArt(modifier: Modifier = Modifier, compact: Boolean = true) {
    val context = LocalContext.current
    val resourceName = if (compact) "selo_fundador_icone" else "selo_fundador"
    @Suppress("DiscouragedApi")
    val resourceId = remember(context, resourceName) {
        context.resources.getIdentifier(resourceName, "drawable", context.packageName)
    }
    if (resourceId != 0) {
        Image(
            painter = painterResource(resourceId),
            contentDescription = "Medalha dourada do Fundador do Átrio Católico",
            modifier = modifier,
            contentScale = ContentScale.Fit
        )
    } else {
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(
                text = "⛪",
                color = Color(0xFFD6AB59),
                fontSize = if (compact) 20.sp else 52.sp
            )
        }
    }
}
