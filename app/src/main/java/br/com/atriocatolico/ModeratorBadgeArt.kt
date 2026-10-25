package br.com.atriocatolico

import android.graphics.BitmapFactory
import android.util.Base64
import androidx.compose.foundation.Image
import androidx.compose.foundation.layout.Box
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.sp

/**
 * Medalha oficial do Moderador: escudo prateado, cruz dourada e
 * fundo azul-safira, com moldura circular ornamentada.
 * O recurso eh visual, nao concede privilegios nem substitui a atribuicao
 * de permissoes de moderacao definidas separadamente pela administracao.
 */
@Composable
internal fun ModeratorBadgeArt(modifier: Modifier = Modifier, compact: Boolean = true) {
    val context = LocalContext.current
    val badgeImage = remember(context) {
        runCatching {
            val encoded = context.resources.openRawResource(R.raw.selo_moderador_base64)
                .bufferedReader().use { it.readText() }
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    if (badgeImage != null) {
        Image(
            bitmap = badgeImage,
            contentDescription = "Medalha do Moderador com escudo prateado e cruz dourada",
            modifier = modifier,
            contentScale = ContentScale.Fit
        )
    } else {
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(
                text = "⬟",
                color = Color(0xFFD6AB59),
                fontSize = if (compact) 20.sp else 52.sp
            )
        }
    }
}
