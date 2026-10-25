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
 * Medalhas dos fieis leigos: cruz dourada, Biblia e ornamentos.
 * "leigo": azul escuro. "leiga": vinho com lirios.
 * Sao identificacoes opcionais selecionadas no perfil, nao papeis administrativos.
 */
@Composable
internal fun LayBadgeArt(kind: String, modifier: Modifier = Modifier) {
    val context = LocalContext.current
    val isFemale = kind == "leiga"
    val resourceId = if (isFemale) R.raw.selo_leiga_base64 else R.raw.selo_leigo_base64
    val badgeImage = remember(context, resourceId) {
        runCatching {
            val encoded = context.resources.openRawResource(resourceId)
                .bufferedReader().use { it.readText() }
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
        }.getOrNull()
    }
    if (badgeImage != null) {
        Image(
            bitmap = badgeImage,
            contentDescription = if (isFemale) "Medalha Leiga com cruz, Biblia e lirios" 
                else "Medalha Leigo com cruz, Biblia e ramos",
            modifier = modifier,
            contentScale = ContentScale.Fit
        )
    } else {
        Box(modifier, contentAlignment = Alignment.Center) {
            Text(text = "◈", color = Color(0xFFD6AB59), fontSize = 20.sp)
        }
    }
}
